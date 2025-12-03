import { S3 } from "@aws-sdk/client-s3";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { PlayerRecord } from "../core/Schemas";
import { getClanTag } from "../core/Util";
import { logger } from "./Logger";

const config = getServerConfigFromServer();
const log = logger.child({ component: "RankingService" });

// R2 client configuration (reuse same credentials as Archive)
const r2 = new S3({
  region: "auto",
  endpoint: config.r2Endpoint(),
  credentials: {
    accessKeyId: config.r2AccessKey(),
    secretAccessKey: config.r2SecretKey(),
  },
});

const bucket = config.r2Bucket();
const RANKINGS_KEY = "rankings/player-rankings.json";
const SAVE_INTERVAL_MS = 5 * 60 * 1000; // Save to R2 every 5 minutes
const RELOAD_INTERVAL_MS = 30 * 1000; // Reload from R2 every 30 seconds
const HALL_OF_FAME_SIZE = 10; // Top N players/clans saved to hall of fame

export interface PlayerRanking {
  persistentID: string;
  username: string;
  games: number;
  wins: number;
  score: number; // Calculated ranking score
  lastGameAt: number; // Timestamp of last game
}

export interface ClanRanking {
  clanTag: string;
  members: number; // Number of unique players
  games: number; // Total games played by all members
  wins: number; // Total wins by all members
  score: number; // Calculated clan score
  lastGameAt: number; // Timestamp of last game by any member
}

export interface MonthlyWinner {
  month: string; // Format: "YYYY-MM"
  players: PlayerRanking[];
  clans: ClanRanking[];
}

export interface RankingData {
  players: Record<string, PlayerRanking>; // keyed by persistentID
  clans: Record<string, ClanRanking>; // keyed by clanTag (uppercase)
  currentMonth: string; // Format: "YYYY-MM"
  hallOfFame: MonthlyWinner[]; // Past monthly winners
  lastUpdated: number;
  version: number;
}

class RankingService {
  private data: RankingData = {
    players: {},
    clans: {},
    currentMonth: this.getCurrentMonth(),
    hallOfFame: [],
    lastUpdated: Date.now(),
    version: 1,
  };
  private isDirty = false;
  private saveIntervalId: ReturnType<typeof setInterval> | null = null;
  private reloadIntervalId: ReturnType<typeof setInterval> | null = null;
  private isInitialized = false;
  private isWorker0 = false;

  /**
   * Initialize the ranking service - load from R2 and start periodic saves
   * @param isWorker0 - If true, this worker will serve API requests and reload periodically
   */
  async initialize(isWorker0: boolean = false): Promise<void> {
    if (this.isInitialized) return;

    this.isWorker0 = isWorker0;

    try {
      await this.loadFromR2();
      log.info("Rankings loaded from R2", {
        playerCount: Object.keys(this.data.players).length,
        clanCount: Object.keys(this.data.clans).length,
        currentMonth: this.data.currentMonth,
        hallOfFameMonths: this.data.hallOfFame?.length ?? 0,
      });
    } catch (error) {
      log.warn("Could not load rankings from R2, starting fresh", { error });
      this.data = {
        players: {},
        clans: {},
        currentMonth: this.getCurrentMonth(),
        hallOfFame: [],
        lastUpdated: Date.now(),
        version: 1,
      };
    }

    // Ensure fields exist (for backwards compatibility)
    if (!this.data.clans) {
      this.data.clans = {};
    }
    if (!this.data.currentMonth) {
      this.data.currentMonth = this.getCurrentMonth();
    }
    if (!this.data.hallOfFame) {
      this.data.hallOfFame = [];
    }

    // Check if we need to start a new month
    this.checkMonthRollover();

    // Start periodic save (backup, in case immediate save fails)
    this.saveIntervalId = setInterval(() => {
      this.saveToR2IfDirty();
    }, SAVE_INTERVAL_MS);

    // Worker 0 reloads from R2 periodically to get updates from other workers
    if (isWorker0) {
      this.reloadIntervalId = setInterval(() => {
        this.reloadFromR2();
      }, RELOAD_INTERVAL_MS);
    }

    this.isInitialized = true;
    log.info("RankingService initialized", { isWorker0 });
  }

  /**
   * Update rankings for players after a game ends
   * Uses read-modify-write pattern to avoid overwriting other workers' updates
   */
  async updateGameResults(
    players: PlayerRecord[],
    winnerClientID: string | null,
  ): Promise<void> {
    // Read fresh data from R2 before modifying to avoid overwriting other workers' updates
    try {
      await this.loadFromR2();
    } catch (error) {
      log.warn("Could not load fresh rankings from R2, using local state", {
        error,
      });
    }

    // Check if we need to roll over to a new month
    this.checkMonthRollover();

    const now = Date.now();
    const clanUpdates: Map<
      string,
      { games: number; wins: number; members: Set<string> }
    > = new Map();

    for (const player of players) {
      // Skip bots/NPCs (they don't have persistentID)
      if (!player.persistentID || player.persistentID === "") continue;

      const existing = this.data.players[player.persistentID];
      const isWinner = player.clientID === winnerClientID;

      if (existing) {
        existing.games += 1;
        existing.wins += isWinner ? 1 : 0;
        existing.username = player.username; // Update to latest username
        existing.lastGameAt = now;
        existing.score = this.calculateScore(existing.games, existing.wins);
      } else {
        this.data.players[player.persistentID] = {
          persistentID: player.persistentID,
          username: player.username,
          games: 1,
          wins: isWinner ? 1 : 0,
          score: this.calculateScore(1, isWinner ? 1 : 0),
          lastGameAt: now,
        };
      }

      // Track clan participation
      const clanTag = getClanTag(player.username);
      if (clanTag) {
        const clanData = clanUpdates.get(clanTag) ?? {
          games: 0,
          wins: 0,
          members: new Set<string>(),
        };
        clanData.games += 1;
        clanData.wins += isWinner ? 1 : 0;
        clanData.members.add(player.persistentID);
        clanUpdates.set(clanTag, clanData);
      }
    }

    // Update clan rankings
    for (const [clanTag, update] of clanUpdates) {
      const existing = this.data.clans[clanTag];
      if (existing) {
        existing.games += update.games;
        existing.wins += update.wins;
        existing.lastGameAt = now;
        // Count unique members across all time
        existing.members = Math.max(existing.members, update.members.size);
        existing.score = this.calculateClanScore(
          existing.games,
          existing.wins,
          existing.members,
        );
      } else {
        this.data.clans[clanTag] = {
          clanTag,
          members: update.members.size,
          games: update.games,
          wins: update.wins,
          score: this.calculateClanScore(
            update.games,
            update.wins,
            update.members.size,
          ),
          lastGameAt: now,
        };
      }
    }

    this.data.lastUpdated = now;
    this.isDirty = true;

    // Save immediately so other workers can see the update
    try {
      await this.saveToR2();
    } catch (error) {
      log.error("Failed to save rankings immediately, will retry later", {
        error,
      });
    }
  }

  /**
   * Calculate player ranking score
   * Formula: wins * 100 + games * 10 + win_rate_bonus
   * Win rate bonus: up to 500 points for high win rate with minimum games
   */
  private calculateScore(games: number, wins: number): number {
    const baseScore = wins * 100 + games * 10;

    // Win rate bonus: requires at least 5 games, max 500 bonus
    if (games >= 5) {
      const winRate = wins / games;
      const winRateBonus = Math.floor(winRate * 500);
      return baseScore + winRateBonus;
    }

    return baseScore;
  }

  /**
   * Calculate clan ranking score
   * Formula: wins * 50 + games * 5 + member_bonus + win_rate_bonus
   */
  private calculateClanScore(
    games: number,
    wins: number,
    members: number,
  ): number {
    const baseScore = wins * 50 + games * 5;
    const memberBonus = members * 20; // Bonus for having more members

    // Win rate bonus: requires at least 10 games, max 300 bonus
    if (games >= 10) {
      const winRate = wins / games;
      const winRateBonus = Math.floor(winRate * 300);
      return baseScore + memberBonus + winRateBonus;
    }

    return baseScore + memberBonus;
  }

  /**
   * Get top N players by score
   * If worker 0 has no data, try to reload from R2 first
   */
  async getLeaderboard(limit: number = 100): Promise<PlayerRanking[]> {
    // If we're worker 0 and have no data, try to reload from R2
    if (this.isWorker0 && Object.keys(this.data.players).length === 0) {
      await this.reloadFromR2();
    }
    return Object.values(this.data.players)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get a specific player's ranking
   */
  getPlayerRanking(persistentID: string): PlayerRanking | null {
    return this.data.players[persistentID] ?? null;
  }

  /**
   * Get a player's position in the leaderboard (1-indexed)
   */
  getPlayerPosition(persistentID: string): number | null {
    const sorted = Object.values(this.data.players).sort(
      (a, b) => b.score - a.score,
    );
    const index = sorted.findIndex((p) => p.persistentID === persistentID);
    return index >= 0 ? index + 1 : null;
  }

  /**
   * Get total player count
   */
  getTotalPlayers(): number {
    return Object.keys(this.data.players).length;
  }

  /**
   * Get top N clans by score
   * If worker 0 has no data, try to reload from R2 first
   */
  async getClanLeaderboard(limit: number = 100): Promise<ClanRanking[]> {
    // If we're worker 0 and have no data, try to reload from R2
    if (this.isWorker0 && Object.keys(this.data.players).length === 0) {
      await this.reloadFromR2();
    }
    return Object.values(this.data.clans)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get a specific clan's ranking
   */
  getClanRanking(clanTag: string): ClanRanking | null {
    return this.data.clans[clanTag.toUpperCase()] ?? null;
  }

  /**
   * Get a clan's position in the leaderboard (1-indexed)
   */
  getClanPosition(clanTag: string): number | null {
    const sorted = Object.values(this.data.clans).sort(
      (a, b) => b.score - a.score,
    );
    const index = sorted.findIndex((c) => c.clanTag === clanTag.toUpperCase());
    return index >= 0 ? index + 1 : null;
  }

  /**
   * Get total clan count
   */
  getTotalClans(): number {
    return Object.keys(this.data.clans).length;
  }

  /**
   * Get current month in YYYY-MM format
   */
  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  /**
   * Check if we've entered a new month and need to archive + reset rankings
   */
  private checkMonthRollover(): void {
    const currentMonth = this.getCurrentMonth();

    if (this.data.currentMonth && this.data.currentMonth !== currentMonth) {
      log.info("New month detected, archiving rankings", {
        oldMonth: this.data.currentMonth,
        newMonth: currentMonth,
      });

      // Archive current top players and clans to hall of fame
      const topPlayers = Object.values(this.data.players)
        .sort((a, b) => b.score - a.score)
        .slice(0, HALL_OF_FAME_SIZE);

      const topClans = Object.values(this.data.clans)
        .sort((a, b) => b.score - a.score)
        .slice(0, HALL_OF_FAME_SIZE);

      // Only add to hall of fame if there were players
      if (topPlayers.length > 0) {
        this.data.hallOfFame.push({
          month: this.data.currentMonth,
          players: topPlayers,
          clans: topClans,
        });

        log.info("Archived monthly winners", {
          month: this.data.currentMonth,
          playerCount: topPlayers.length,
          clanCount: topClans.length,
          topPlayer: topPlayers[0]?.username,
          topClan: topClans[0]?.clanTag,
        });
      }

      // Reset current rankings
      this.data.players = {};
      this.data.clans = {};
      this.data.currentMonth = currentMonth;
      this.isDirty = true;
    }
  }

  /**
   * Get hall of fame (past monthly winners)
   */
  getHallOfFame(): MonthlyWinner[] {
    return this.data.hallOfFame ?? [];
  }

  /**
   * Load rankings from R2
   */
  private async loadFromR2(): Promise<void> {
    const response = await r2.getObject({
      Bucket: bucket,
      Key: RANKINGS_KEY,
    });

    if (response.Body) {
      const bodyContents = await response.Body.transformToString();
      this.data = JSON.parse(bodyContents) as RankingData;
    }
  }

  /**
   * Reload rankings from R2 (for worker 0 to get updates from other workers)
   */
  private async reloadFromR2(): Promise<void> {
    try {
      await this.loadFromR2();
      // Ensure clans object exists
      if (!this.data.clans) {
        this.data.clans = {};
      }
      this.isDirty = false;
    } catch (error) {
      // Silent failure - will retry on next interval
    }
  }

  /**
   * Save rankings to R2 if there are pending changes
   */
  private async saveToR2IfDirty(): Promise<void> {
    if (!this.isDirty) return;
    await this.saveToR2();
  }

  /**
   * Force save rankings to R2
   */
  async saveToR2(): Promise<void> {
    try {
      await r2.putObject({
        Bucket: bucket,
        Key: RANKINGS_KEY,
        Body: JSON.stringify(this.data),
        ContentType: "application/json",
      });
      this.isDirty = false;
      log.info("Rankings saved to R2", {
        playerCount: Object.keys(this.data.players).length,
      });
    } catch (error) {
      log.error("Failed to save rankings to R2", { error });
      throw error;
    }
  }

  /**
   * Graceful shutdown - save to R2 and stop interval
   */
  async shutdown(): Promise<void> {
    if (this.saveIntervalId) {
      clearInterval(this.saveIntervalId);
      this.saveIntervalId = null;
    }

    if (this.reloadIntervalId) {
      clearInterval(this.reloadIntervalId);
      this.reloadIntervalId = null;
    }

    if (this.isDirty) {
      log.info("Saving rankings before shutdown...");
      await this.saveToR2();
    }

    log.info("RankingService shutdown complete");
  }
}

// Export singleton instance
export const rankingService = new RankingService();
