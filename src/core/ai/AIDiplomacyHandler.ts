import { Game, Player, PlayerID, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * War score breakdown for a single AI → target pair (debug overlay).
 */
export interface WarScoreBreakdown {
  targetId: PlayerID;
  targetName: string;
  total: number;
  threshold: number;
  borderScore: number;
  militaryScore: number;
  allyPenalty: number;
  distancePenalty: number;
  dominanceBonus: number;
  movingAverage: number;
  isAtWar: boolean;
  isFriendly: boolean;
  unreachable: boolean;
}

/**
 * All war score breakdowns for one AI player (debug overlay).
 */
export interface WarScoreDebugData {
  playerId: PlayerID;
  playerName: string;
  breakdowns: WarScoreBreakdown[];
}

/**
 * Cached ocean shore sample for a player.
 * Contains extremum tiles (min/max X/Y) plus a random sample.
 */
interface OceanShoreSample {
  extrema: TileRef[]; // Up to 4 tiles: minX, maxX, minY, maxY
  randomSample: TileRef[]; // Small random sample
  closestRandom: TileRef | null; // Best random tile from last calculation
  lastUpdate: number; // Tick when extrema were last refreshed
}

/**
 * Handles AI diplomacy decisions: war declarations, peace requests, etc.
 */
export class AIDiplomacyHandler {
  // 10 ticks/second * 5 seconds = 50 ticks between evaluations
  private static readonly WAR_SCORE_EVALUATION_INTERVAL = 50;
  // 30 seconds / 5 seconds per sample = 6 samples for moving average
  private static readonly WAR_SCORE_HISTORY_LENGTH = 6;
  // Invalidate shore sample cache every 100 ticks (10 seconds)
  private static readonly SHORE_SAMPLE_CACHE_TTL = 100;
  // Number of random shore tiles to sample (in addition to 4 extrema)
  private static readonly RANDOM_SHORE_SAMPLE_SIZE = 4;
  // Peace score evaluation interval (50 ticks = 5 seconds, same as war score)
  private static readonly PEACE_SCORE_EVALUATION_INTERVAL = 50;
  // 30 seconds / 5 seconds per sample = 6 samples for peace moving average
  private static readonly PEACE_SCORE_HISTORY_LENGTH = 6;

  // Static registry of all active handlers for cross-AI peace request evaluation
  private static readonly registry = new Map<PlayerID, AIDiplomacyHandler>();

  // Phase seed for spreading periodic actions across AIs
  private readonly phaseSeed: number;

  // Current war scores for each player (keyed by PlayerID)
  private _warScores: Map<PlayerID, number> = new Map();

  // Historical war scores for moving average (keyed by PlayerID -> circular buffer of scores)
  private _warScoreHistory: Map<PlayerID, number[]> = new Map();

  // Cache for shore distances between player pairs (keyed by "fromId:toId")
  private _shoreDistanceCache: Map<string, number | null> = new Map();

  // Cache for ocean shore samples per player (keyed by PlayerID)
  private _oceanShoreSampleCache: Map<PlayerID, OceanShoreSample> = new Map();

  // Current peace scores for each player we're at war with (keyed by PlayerID)
  private _peaceScores: Map<PlayerID, number> = new Map();

  // Historical peace scores for moving average (keyed by PlayerID -> buffer of scores)
  private _peaceScoreHistory: Map<PlayerID, number[]> = new Map();

  // Ordered list of peace candidate PlayerIDs (sorted by peace score ascending)
  private _pendingPeaceCandidates: PlayerID[] = [];
  // Current index into the pending peace candidates list
  private _currentPeaceCandidateIndex = 0;
  // Whether peace was successfully made this evaluation cycle
  private _peaceCompletedThisCycle = false;

  // Ticks at peace without any active wars (for threshold decay)
  private _ticksAtPeace = 0;
  // Ticks at war (for gradual threshold recovery)
  private _ticksAtWar = 0;
  // Whether the AI was at war last tick (to detect war start/end transitions)
  private _wasAtWar = false;
  // Accumulated threshold reduction from peaceful ticks
  private _warThresholdDecay = 0;
  // How many peaceful ticks before threshold drops by 1
  private static readonly PEACE_DECAY_INTERVAL = 200;
  // How many ticks at war before threshold recovers by 1 toward baseline
  private static readonly WAR_RECOVERY_INTERVAL = 200;

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {
    // Stagger periodic actions across AIs using random offset
    this.phaseSeed = random.nextInt(0, 0x7fffffff);
    // Register this handler for cross-AI peace request evaluation
    AIDiplomacyHandler.registry.set(this.playerId, this);
  }

  private periodicOffset(period: number): number {
    const p = Math.max(1, Math.floor(period));
    return this.phaseSeed % p;
  }

  private shouldRunPeriodic(ticks: number, period: number): boolean {
    const p = Math.max(1, Math.floor(period));
    return ticks % p === this.periodicOffset(p);
  }

  private getPlayer(): Player | null {
    if (!this.mg.hasPlayer(this.playerId)) {
      return null;
    }
    return this.mg.player(this.playerId);
  }

  /**
   * Determines if one player can reach another for military purposes.
   * Players are reachable if they share a border OR both border the ocean.
   */
  private isReachable(from: Player, to: Player): boolean {
    if (from.sharesBorderWith(to)) {
      return true;
    }
    // Check ocean reachability: both must border ocean (uses cached values)
    return from.bordersOcean() && to.bordersOcean();
  }

  /**
   * Gets the closest manhattan distance between ocean shore tiles of two players.
   * Returns null if either player doesn't border the ocean.
   * Uses extremum tiles + random sampling for efficiency.
   */
  private closestOceanShoreDistance(
    from: Player,
    to: Player,
    currentTick: number,
  ): number | null {
    // Check cache first
    const cacheKey = `${from.id()}:${to.id()}`;
    if (this._shoreDistanceCache.has(cacheKey)) {
      return this._shoreDistanceCache.get(cacheKey)!;
    }

    // Fast path: check if either doesn't border ocean
    if (!from.bordersOcean() || !to.bordersOcean()) {
      this._shoreDistanceCache.set(cacheKey, null);
      return null;
    }

    // Get shore samples for both players
    const fromSample = this.getOceanShoreSample(from, currentTick);
    const toSample = this.getOceanShoreSample(to, currentTick);

    if (fromSample === null || toSample === null) {
      this._shoreDistanceCache.set(cacheKey, null);
      return null;
    }

    // Combine extrema + closestRandom + randomSample for each player
    const fromTiles = this.getSampleTiles(fromSample);
    const toTiles = this.getSampleTiles(toSample);

    if (fromTiles.length === 0 || toTiles.length === 0) {
      this._shoreDistanceCache.set(cacheKey, null);
      return null;
    }

    // Find minimum distance and track closest random tiles
    let minDist = Infinity;
    let closestFromRandom: TileRef | null = null;
    let closestToRandom: TileRef | null = null;

    for (const fromTile of fromTiles) {
      const isFromRandom = fromSample.randomSample.includes(fromTile);
      for (const toTile of toTiles) {
        const dist = this.mg.manhattanDist(fromTile, toTile);
        if (dist < minDist) {
          minDist = dist;
          if (isFromRandom) closestFromRandom = fromTile;
          if (toSample.randomSample.includes(toTile)) closestToRandom = toTile;
        }
      }
    }

    // Update closestRandom for future iterations
    if (closestFromRandom !== null) {
      fromSample.closestRandom = closestFromRandom;
    }
    if (closestToRandom !== null) {
      toSample.closestRandom = closestToRandom;
    }

    this._shoreDistanceCache.set(cacheKey, minDist);
    return minDist;
  }

  /**
   * Gets combined sample tiles: extrema + closestRandom (if any) + randomSample.
   */
  private getSampleTiles(sample: OceanShoreSample): TileRef[] {
    const tiles = [...sample.extrema];
    if (sample.closestRandom !== null) {
      tiles.push(sample.closestRandom);
    }
    tiles.push(...sample.randomSample);
    return tiles;
  }

  /**
   * Gets or creates an ocean shore sample for a player.
   * Refreshes extrema if TTL expired, keeps closestRandom, replaces random sample.
   */
  private getOceanShoreSample(
    player: Player,
    currentTick: number,
  ): OceanShoreSample | null {
    const cached = this._oceanShoreSampleCache.get(player.id());
    const needsRefresh =
      !cached ||
      currentTick - cached.lastUpdate >
        AIDiplomacyHandler.SHORE_SAMPLE_CACHE_TTL;

    if (!needsRefresh && cached) {
      return cached;
    }

    // Use cached ocean shore tiles from Player
    const oceanShores = player.oceanShoreTiles();
    if (oceanShores.length === 0) {
      this._oceanShoreSampleCache.delete(player.id());
      return null;
    }

    // Use cached extrema from Player
    const extrema = [...player.oceanShoreExtrema()];

    // Create set of extrema tiles to exclude from random sampling
    const extremaSet = new Set(extrema);

    // Get random sample (excluding extrema and closestRandom)
    const closestRandom = cached?.closestRandom ?? null;
    const availableForSampling = oceanShores.filter(
      (t) => !extremaSet.has(t) && t !== closestRandom,
    );

    const randomSample = this.sampleTiles(
      availableForSampling,
      AIDiplomacyHandler.RANDOM_SHORE_SAMPLE_SIZE,
    );

    const sample: OceanShoreSample = {
      extrema,
      randomSample,
      closestRandom,
      lastUpdate: currentTick,
    };

    this._oceanShoreSampleCache.set(player.id(), sample);
    return sample;
  }

  /**
   * Randomly samples n tiles from the array.
   */
  private sampleTiles(tiles: readonly TileRef[], n: number): TileRef[] {
    if (tiles.length <= n) {
      return [...tiles];
    }
    const result: TileRef[] = [];
    const indices = new Set<number>();
    while (result.length < n) {
      const idx = this.random.nextInt(0, tiles.length);
      if (!indices.has(idx)) {
        indices.add(idx);
        result.push(tiles[idx]);
      }
    }
    return result;
  }

  /**
   * Main tick function for diplomacy handling.
   */
  tickDiplomacy(ticks: number): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    // Track war/peace state for threshold decay
    this.updateWarThresholdDecay(player);

    // Periodically evaluate war scores
    if (
      this.shouldRunPeriodic(
        ticks,
        AIDiplomacyHandler.WAR_SCORE_EVALUATION_INTERVAL,
      )
    ) {
      this.evaluateWarScores(player, ticks);
      this.updateWarScoreHistory();
      this.maybeDeclarWars(player);
    }

    // Periodically evaluate peace scores and rebuild candidate list
    if (
      this.shouldRunPeriodic(
        ticks,
        AIDiplomacyHandler.PEACE_SCORE_EVALUATION_INTERVAL,
      )
    ) {
      this.evaluatePeaceScores(player, ticks);
    }

    // Try peace negotiation each tick (advances through candidate list)
    this.tryPeaceNegotiation(player, ticks);
  }

  /**
   * Evaluates war scores for all other human and AI players.
   */
  private evaluateWarScores(player: Player, ticks: number): void {
    this._warScores.clear();
    // Clear distance cache so new samples can affect results
    this._shoreDistanceCache.clear();

    for (const other of this.mg.players()) {
      // Skip self
      if (other.id() === player.id()) {
        continue;
      }

      // Only consider Human and AI players (not Bots)
      if (other.type() !== PlayerType.Human && other.type() !== PlayerType.AI) {
        continue;
      }

      // Skip dead players
      if (!other.isAlive()) {
        continue;
      }

      // Skip players we're already at war with
      if (player.isAtWarWith(other)) {
        continue;
      }

      // Skip allies and team members
      if (player.isFriendly(other)) {
        continue;
      }

      const score = this.calculateWarScore(player, other, ticks);
      this._warScores.set(other.id(), score);
    }
  }

  /**
   * Calculates the war score against a specific player.
   * Higher score = more likely to declare war.
   * Returns a linear combination of weighted factors.
   */
  private calculateWarScore(
    player: Player,
    other: Player,
    ticks: number,
  ): number {
    // No point declaring war on someone we can't reach
    if (!this.isReachable(player, other)) {
      return 0;
    }

    let score = 0;

    // Factor 1: Shared border length ratio
    // sharedBorderLength / ownTotalBorderLength
    const sharedBorderWeight = this.params.warScoreSharedBorderWeight ?? 0;
    if (sharedBorderWeight !== 0) {
      const ownTotalBorderLength = player.borderTiles().size;
      if (ownTotalBorderLength > 0) {
        const sharedBorderLength = player.sharedBorderLength(other);
        const borderRatio = sharedBorderLength / ownTotalBorderLength;
        score += sharedBorderWeight * borderRatio;
      }
    }

    // Factor 2: Military strength ratio
    // Numerator: ownStrength weighted by target's share of all enemies
    // Denominator: target's military strength only
    const militaryStrengthWeight =
      this.params.warScoreMilitaryStrengthWeight ?? 0;
    if (militaryStrengthWeight !== 0) {
      const ownStrength = player.militaryStrength();
      const targetStrength = other.militaryStrength();

      // Sum military strength of countries we are already at war with
      let existingEnemiesStrength = 0;
      for (const enemy of this.mg.players()) {
        if (
          enemy.id() !== player.id() &&
          enemy.id() !== other.id() &&
          enemy.isAlive() &&
          enemy.type() !== PlayerType.Bot &&
          player.isAtWarWith(enemy)
        ) {
          existingEnemiesStrength += enemy.militaryStrength();
        }
      }

      if (targetStrength > 0) {
        // Weight own strength by target's share of total enemy burden
        const targetShare =
          targetStrength / (targetStrength + existingEnemiesStrength);
        const weightedOwnStrength = ownStrength * targetShare;
        const strengthRatio = Math.min(weightedOwnStrength / targetStrength, 4);
        score += militaryStrengthWeight * strengthRatio;
      }
    }

    // Factor 3: Ally penalty (negative contribution)
    const allyPenalty = this.params.warScoreAllyPenalty ?? 0;
    if (allyPenalty !== 0 && player.isAlliedWith(other)) {
      score -= allyPenalty;
    }

    // Factor 4: Distance penalty for non-bordering players
    // Penalizes distant ocean-only targets, normalized by player's own size
    const distancePenaltyWeight =
      this.params.warScoreDistancePenaltyWeight ?? 0;
    if (distancePenaltyWeight !== 0 && !player.sharesBorderWith(other)) {
      const shoreDist = this.closestOceanShoreDistance(player, other, ticks);
      if (shoreDist !== null && shoreDist > 0) {
        // Normalize by sqrt of own tile count (player's "width")
        const playerWidth = Math.sqrt(player.numTilesOwned());
        if (playerWidth > 0) {
          const normalizedDist = shoreDist / playerWidth;
          // Squared penalty
          const penalty = normalizedDist * normalizedDist;
          score -= distancePenaltyWeight * penalty;
        }
      }
    }

    // Factor 5: Dominance bonus – incentivise attacking the strongest player
    // Only fires when the target has the highest military strength in the game.
    const dominanceWeight = this.params.warScoreDominanceWeight ?? 0;
    if (dominanceWeight !== 0) {
      let totalGameStrength = 0;
      let highestStrength = 0;
      let secondHighestStrength = 0;

      for (const p of this.mg.players()) {
        if (!p.isAlive() || p.type() === PlayerType.Bot) continue;
        const s = p.militaryStrength();
        totalGameStrength += s;
        if (s > highestStrength) {
          secondHighestStrength = highestStrength;
          highestStrength = s;
        } else if (s > secondHighestStrength) {
          secondHighestStrength = s;
        }
      }

      const targetStrength = other.militaryStrength();
      if (
        totalGameStrength > 0 &&
        targetStrength >= highestStrength &&
        targetStrength > 0
      ) {
        const targetShare = targetStrength / totalGameStrength;
        const denominator = 0.8 - targetShare;
        // Only apply when target share is below 80% (denominator > 0)
        if (denominator > 0 && secondHighestStrength > 0) {
          const gapPercent =
            (targetStrength - secondHighestStrength) / secondHighestStrength;
          score += dominanceWeight * (gapPercent / denominator);
        }
      }
    }

    return score;
  }

  /**
   * Debug: returns per-factor breakdown of war score for a specific target.
   * Used only by the debug overlay.
   */
  public calculateWarScoreBreakdown(
    other: Player,
    ticks: number,
  ): WarScoreBreakdown | null {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) return null;
    if (!other.isAlive()) return null;
    if (!this.isReachable(player, other)) {
      return {
        targetId: other.id(),
        targetName: other.displayName(),
        total: 0,
        threshold: this.effectiveWarThreshold,
        borderScore: 0,
        militaryScore: 0,
        allyPenalty: 0,
        distancePenalty: 0,
        dominanceBonus: 0,
        movingAverage: this.getMovingAverageWarScore(other.id()) ?? 0,
        isAtWar: player.isAtWarWith(other),
        isFriendly: player.isFriendly(other),
        unreachable: true,
      };
    }

    // Factor 1: Border
    let borderScore = 0;
    const sharedBorderWeight = this.params.warScoreSharedBorderWeight ?? 0;
    if (sharedBorderWeight !== 0) {
      const ownTotalBorderLength = player.borderTiles().size;
      if (ownTotalBorderLength > 0) {
        const sharedBorderLength = player.sharedBorderLength(other);
        const borderRatio = sharedBorderLength / ownTotalBorderLength;
        borderScore = sharedBorderWeight * borderRatio;
      }
    }

    // Factor 2: Military
    let militaryScore = 0;
    const militaryStrengthWeight =
      this.params.warScoreMilitaryStrengthWeight ?? 0;
    if (militaryStrengthWeight !== 0) {
      const ownStrength = player.militaryStrength();
      const targetStrength = other.militaryStrength();

      // Sum military strength of countries we are already at war with
      let existingEnemiesStrength = 0;
      for (const enemy of this.mg.players()) {
        if (
          enemy.id() !== player.id() &&
          enemy.id() !== other.id() &&
          enemy.isAlive() &&
          enemy.type() !== PlayerType.Bot &&
          player.isAtWarWith(enemy)
        ) {
          existingEnemiesStrength += enemy.militaryStrength();
        }
      }

      if (targetStrength > 0) {
        // Weight own strength by target's share of total enemy burden
        const targetShare =
          targetStrength / (targetStrength + existingEnemiesStrength);
        const weightedOwnStrength = ownStrength * targetShare;
        const strengthRatio = Math.min(weightedOwnStrength / targetStrength, 4);
        militaryScore = militaryStrengthWeight * strengthRatio;
      }
    }

    // Factor 3: Ally penalty
    let allyPenaltyVal = 0;
    const allyPenalty = this.params.warScoreAllyPenalty ?? 0;
    if (allyPenalty !== 0 && player.isAlliedWith(other)) {
      allyPenaltyVal = allyPenalty;
    }

    // Factor 4: Distance penalty
    let distancePenaltyVal = 0;
    const distancePenaltyWeight =
      this.params.warScoreDistancePenaltyWeight ?? 0;
    if (distancePenaltyWeight !== 0 && !player.sharesBorderWith(other)) {
      const shoreDist = this.closestOceanShoreDistance(player, other, ticks);
      if (shoreDist !== null && shoreDist > 0) {
        const playerWidth = Math.sqrt(player.numTilesOwned());
        if (playerWidth > 0) {
          const normalizedDist = shoreDist / playerWidth;
          const penalty = normalizedDist * normalizedDist;
          distancePenaltyVal = distancePenaltyWeight * penalty;
        }
      }
    }

    // Factor 5: Dominance bonus
    let dominanceBonusVal = 0;
    const dominanceWeight = this.params.warScoreDominanceWeight ?? 0;
    if (dominanceWeight !== 0) {
      let totalGameStrength = 0;
      let highestStrength = 0;
      let secondHighestStrength = 0;
      for (const p of this.mg.players()) {
        if (!p.isAlive() || p.type() === PlayerType.Bot) continue;
        const s = p.militaryStrength();
        totalGameStrength += s;
        if (s > highestStrength) {
          secondHighestStrength = highestStrength;
          highestStrength = s;
        } else if (s > secondHighestStrength) {
          secondHighestStrength = s;
        }
      }
      const targetStrength = other.militaryStrength();
      if (
        totalGameStrength > 0 &&
        targetStrength >= highestStrength &&
        targetStrength > 0
      ) {
        const targetShare = targetStrength / totalGameStrength;
        const denominator = 0.8 - targetShare;
        if (denominator > 0 && secondHighestStrength > 0) {
          const gapPercent =
            (targetStrength - secondHighestStrength) / secondHighestStrength;
          dominanceBonusVal = dominanceWeight * (gapPercent / denominator);
        }
      }
    }

    const total =
      borderScore +
      militaryScore -
      allyPenaltyVal -
      distancePenaltyVal +
      dominanceBonusVal;

    return {
      targetId: other.id(),
      targetName: other.displayName(),
      total,
      threshold: this.effectiveWarThreshold,
      borderScore,
      militaryScore,
      allyPenalty: allyPenaltyVal,
      distancePenalty: distancePenaltyVal,
      dominanceBonus: dominanceBonusVal,
      movingAverage: this.getMovingAverageWarScore(other.id()) ?? total,
      isAtWar: player.isAtWarWith(other),
      isFriendly: player.isFriendly(other),
      unreachable: false,
    };
  }

  /**
   * Debug: returns war score breakdowns for all AI players against all others.
   */
  public static getAllWarScoreBreakdowns(
    game: Game,
    ticks: number,
  ): WarScoreDebugData[] {
    const results: WarScoreDebugData[] = [];
    for (const [playerId, handler] of AIDiplomacyHandler.registry) {
      const player = game.player(playerId);
      if (!player.isPlayer() || !player.isAlive()) continue;

      const breakdowns: WarScoreBreakdown[] = [];
      for (const other of game.players()) {
        if (other.id() === playerId) continue;
        if (!other.isAlive()) continue;
        if (other.type() === PlayerType.Bot) continue;
        const bd = handler.calculateWarScoreBreakdown(other, ticks);
        if (bd) breakdowns.push(bd);
      }
      results.push({
        playerId,
        playerName: player.displayName(),
        breakdowns,
      });
    }
    return results;
  }

  /**
   * Updates the war score history for moving average calculation.
   * Adds current scores to history and removes old entries.
   */
  private updateWarScoreHistory(): void {
    // Add current scores to history
    for (const [otherId, score] of this._warScores) {
      let history = this._warScoreHistory.get(otherId);
      if (!history) {
        history = [];
        this._warScoreHistory.set(otherId, history);
      }
      history.push(score);
      // Keep only the last N samples
      if (history.length > AIDiplomacyHandler.WAR_SCORE_HISTORY_LENGTH) {
        history.shift();
      }
    }

    // Clean up history for players no longer in war scores (e.g., died, allied, at war)
    for (const otherId of this._warScoreHistory.keys()) {
      if (!this._warScores.has(otherId)) {
        this._warScoreHistory.delete(otherId);
      }
    }
  }

  /**
   * Calculates the moving average war score for a player.
   */
  private getMovingAverageWarScore(otherId: PlayerID): number {
    const history = this._warScoreHistory.get(otherId);
    if (!history || history.length === 0) {
      return 0;
    }
    const sum = history.reduce((acc, score) => acc + score, 0);
    return sum / history.length;
  }

  /**
   * Returns the effective war declaration threshold, accounting for peaceful decay.
   */
  private get effectiveWarThreshold(): number {
    return (
      (this.params.warDeclarationThreshold ?? 1.0) - this._warThresholdDecay
    );
  }

  /**
   * Checks if the AI is currently at war with any non-bot player.
   */
  private isAtWar(player: Player): boolean {
    for (const other of this.mg.players()) {
      if (
        other.id() !== player.id() &&
        other.isAlive() &&
        other.type() !== PlayerType.Bot &&
        player.isAtWarWith(other)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Updates the war threshold decay based on peace/war state transitions.
   *
   * At peace: every PEACE_DECAY_INTERVAL ticks, threshold drops by 1
   *           (making the AI more aggressive over time).
   * At war:   every WAR_RECOVERY_INTERVAL ticks, threshold recovers by 1
   *           back toward the baseline (undoing accumulated decay).
   */
  private updateWarThresholdDecay(player: Player): void {
    const atWar = this.isAtWar(player);

    if (atWar) {
      // Entering war: reset peace counter
      if (!this._wasAtWar) {
        this._ticksAtPeace = 0;
      }
      this._wasAtWar = true;

      // Gradually recover threshold toward baseline while at war
      if (this._warThresholdDecay > 0) {
        this._ticksAtWar++;
        if (this._ticksAtWar >= AIDiplomacyHandler.WAR_RECOVERY_INTERVAL) {
          this._ticksAtWar -= AIDiplomacyHandler.WAR_RECOVERY_INTERVAL;
          this._warThresholdDecay--;
        }
      }
    } else {
      // Entering peace: reset war recovery counter
      if (this._wasAtWar) {
        this._ticksAtWar = 0;
      }
      this._wasAtWar = false;

      // Decay threshold while at peace
      this._ticksAtPeace++;
      if (this._ticksAtPeace >= AIDiplomacyHandler.PEACE_DECAY_INTERVAL) {
        this._ticksAtPeace -= AIDiplomacyHandler.PEACE_DECAY_INTERVAL;
        this._warThresholdDecay++;
      }
    }
  }

  /**
   * Declares war on players whose moving average war score exceeds the threshold.
   */
  private maybeDeclarWars(player: Player): void {
    const threshold = this.effectiveWarThreshold;

    for (const [otherId] of this._warScores) {
      const avgScore = this.getMovingAverageWarScore(otherId);
      if (avgScore > threshold) {
        const other = this.mg.player(otherId);
        if (other && other.isAlive() && !player.isAtWarWith(other)) {
          // Declare war (mutual)
          player.setWarWith(other);
          other.setWarWith(player);
          // Clear history after declaring war
          this._warScoreHistory.delete(otherId);
        }
      }
    }
  }

  /**
   * Gets the current war score against a specific player.
   * Returns 0 if no score has been calculated.
   */
  getWarScore(otherId: PlayerID): number {
    return this._warScores.get(otherId) ?? 0;
  }

  /**
   * Gets all current war scores.
   */
  getAllWarScores(): Map<PlayerID, number> {
    return new Map(this._warScores);
  }

  // ---------------------------------------------------------------------------
  // Peace handling
  // ---------------------------------------------------------------------------

  /**
   * Returns the peace threshold for this AI.
   * Peace threshold = warDeclarationThreshold - peaceThresholdGap.
   * A war score below this value means the AI is willing to make peace.
   */
  private get peaceThreshold(): number {
    const warThreshold = this.effectiveWarThreshold;
    const gap = this.params.peaceThresholdGap ?? 30;
    return warThreshold - gap;
  }

  /**
   * Evaluates peace scores for all players we are currently at war with.
   * Updates peace score history and builds a sorted candidate list of enemies
   * whose moving-average peace score is below the peace threshold.
   * Resets the negotiation state for this cycle.
   */
  private evaluatePeaceScores(player: Player, ticks: number): void {
    // Clear distance cache so fresh samples are used
    this._shoreDistanceCache.clear();

    this._peaceScores.clear();

    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (other.type() === PlayerType.Bot) continue;
      if (!other.isAlive()) continue;
      if (!player.isAtWarWith(other)) continue;

      // Peace score is calculated identically to war score, treating the
      // target as if we are NOT currently at war with them.
      // calculateWarScore already does this: it counts the target as the
      // primary enemy and adds OTHER current enemies separately (excluding
      // the target via the enemy.id() !== other.id() check).
      const score = this.calculateWarScore(player, other, ticks);
      this._peaceScores.set(other.id(), score);
    }

    // Update peace score history with current scores
    this.updatePeaceScoreHistory();

    // Build candidate list using moving average
    const peaceScores: { id: PlayerID; score: number }[] = [];
    for (const [otherId] of this._peaceScores) {
      const avgScore = this.getMovingAveragePeaceScore(otherId);
      if (avgScore < this.peaceThreshold) {
        peaceScores.push({ id: otherId, score: avgScore });
      }
    }

    // Sort ascending: lowest score = most desirable peace partner
    peaceScores.sort((a, b) => a.score - b.score);

    this._pendingPeaceCandidates = peaceScores.map((e) => e.id);
    this._currentPeaceCandidateIndex = 0;
    this._peaceCompletedThisCycle = false;
  }

  /**
   * Updates the peace score history for moving average calculation.
   * Adds current scores to history and removes entries for players
   * no longer at war.
   */
  private updatePeaceScoreHistory(): void {
    for (const [otherId, score] of this._peaceScores) {
      let history = this._peaceScoreHistory.get(otherId);
      if (!history) {
        history = [];
        this._peaceScoreHistory.set(otherId, history);
      }
      history.push(score);
      if (history.length > AIDiplomacyHandler.PEACE_SCORE_HISTORY_LENGTH) {
        history.shift();
      }
    }

    // Clean up history for players no longer in peace scores (e.g., died, peace made)
    for (const otherId of this._peaceScoreHistory.keys()) {
      if (!this._peaceScores.has(otherId)) {
        this._peaceScoreHistory.delete(otherId);
      }
    }
  }

  /**
   * Calculates the moving average peace score for a player.
   */
  private getMovingAveragePeaceScore(otherId: PlayerID): number {
    const history = this._peaceScoreHistory.get(otherId);
    if (!history || history.length === 0) {
      return this._peaceScores.get(otherId) ?? 0;
    }
    const sum = history.reduce((acc, score) => acc + score, 0);
    return sum / history.length;
  }

  /**
   * Attempts peace negotiation with the current candidate. Called each tick.
   * For AI targets: pre-checks acceptance, then creates the request (auto-accepted).
   * For human targets: creates a pending request (human will reply via UI).
   * If declined or cannot send, advances to the next candidate on the next tick.
   */
  private tryPeaceNegotiation(player: Player, ticks: number): void {
    // Already made peace this cycle, or no candidates left
    if (this._peaceCompletedThisCycle) return;
    if (this._currentPeaceCandidateIndex >= this._pendingPeaceCandidates.length)
      return;

    const candidateId =
      this._pendingPeaceCandidates[this._currentPeaceCandidateIndex];

    // Validate candidate is still a valid target
    if (!this.mg.hasPlayer(candidateId)) {
      this._currentPeaceCandidateIndex++;
      return;
    }

    const candidate = this.mg.player(candidateId);
    if (!candidate.isAlive() || !player.isAtWarWith(candidate)) {
      this._currentPeaceCandidateIndex++;
      return;
    }

    // Can't send if there's already a pending request or cooldown
    if (!player.canSendPeaceRequest(candidate)) {
      this._currentPeaceCandidateIndex++;
      return;
    }

    // For AI targets: pre-check if they would accept before creating request
    if (candidate.type() === PlayerType.AI) {
      const otherHandler = AIDiplomacyHandler.registry.get(candidateId);
      if (
        otherHandler &&
        !otherHandler.evaluateIncomingPeaceRequest(player, ticks)
      ) {
        // Declined – advance to next candidate on next tick
        this._currentPeaceCandidateIndex++;
        return;
      }
    }

    // Create the peace request (for humans it stays pending; for AI it will be auto-accepted by handleIncomingPeaceRequests)
    player.createPeaceRequest(candidate);
    this._peaceCompletedThisCycle = true;

    // Clear score histories so fresh evaluation starts if relations worsen again
    this._warScoreHistory.delete(candidateId);
    this._peaceScoreHistory.delete(candidateId);
  }

  /**
   * Handles incoming peace requests for this AI player.
   * Evaluates each request and accepts/rejects based on peace score threshold.
   * Waits a short delay before responding to feel more natural.
   * Called each tick by the AI execution loop.
   */
  handleIncomingPeaceRequests(ticks: number): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) return;

    const RESPONSE_DELAY = 10; // ticks before AI responds to a peace request

    for (const request of player.incomingPeaceRequests()) {
      if (ticks - request.createdAt() < RESPONSE_DELAY) {
        continue;
      }
      const sender = request.requestor();
      if (this.evaluateIncomingPeaceRequest(sender, ticks)) {
        request.accept();
      } else {
        request.reject();
      }
    }
  }

  /**
   * Evaluates whether this AI should accept an incoming peace request
   * from the given player. Returns true if the peace score for the sender
   * is below this AI's peace threshold.
   */
  evaluateIncomingPeaceRequest(sender: Player, ticks: number): boolean {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) return false;
    if (!player.isAtWarWith(sender)) return false;

    // Calculate the war score for the sender as if not at war with them
    const score = this.calculateWarScore(player, sender, ticks);
    return score < this.peaceThreshold;
  }
}
