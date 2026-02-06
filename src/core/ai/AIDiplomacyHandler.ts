import { Game, Player, PlayerID, PlayerType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles AI diplomacy decisions: war declarations, peace requests, etc.
 */
export class AIDiplomacyHandler {
  private static readonly WAR_SCORE_EVALUATION_INTERVAL = 10;
  private static readonly WAR_SCORE_HISTORY_LENGTH = 10; // 10 samples * 10 ticks = 100 ticks window

  // Phase seed for spreading periodic actions across AIs
  private readonly phaseSeed: number;

  // Current war scores for each player (keyed by PlayerID)
  private _warScores: Map<PlayerID, number> = new Map();

  // Historical war scores for moving average (keyed by PlayerID -> circular buffer of scores)
  private _warScoreHistory: Map<PlayerID, number[]> = new Map();

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {
    // Stagger periodic actions across AIs using random offset
    this.phaseSeed = random.nextInt(0, 0x7fffffff);
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
   * For now, this is equivalent to sharing a border.
   * In the future, this could include boat accessibility.
   */
  private isReachable(from: Player, to: Player): boolean {
    return from.sharesBorderWith(to);
  }

  /**
   * Main tick function for diplomacy handling.
   */
  tickDiplomacy(ticks: number): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    // Periodically evaluate war scores
    if (
      this.shouldRunPeriodic(
        ticks,
        AIDiplomacyHandler.WAR_SCORE_EVALUATION_INTERVAL,
      )
    ) {
      this.evaluateWarScores(player);
      this.updateWarScoreHistory();
      this.maybeDeclarWars(player);
    }
  }

  /**
   * Evaluates war scores for all other human and AI players.
   */
  private evaluateWarScores(player: Player): void {
    this._warScores.clear();

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

      const score = this.calculateWarScore(player, other);
      this._warScores.set(other.id(), score);
    }
  }

  /**
   * Calculates the war score against a specific player.
   * Higher score = more likely to declare war.
   * Returns a linear combination of weighted factors.
   */
  private calculateWarScore(player: Player, other: Player): number {
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
    // effectiveOwnStrength / totalEnemyStrength
    // effectiveOwnStrength = own + allies against target (scaled by target's share of their wars)
    // totalEnemyStrength = target + sum of current enemies (weighted by border status)
    const militaryStrengthWeight =
      this.params.warScoreMilitaryStrengthWeight ?? 0;
    if (militaryStrengthWeight !== 0) {
      const nonReachableWeight =
        this.params.warScoreNonReachableEnemyWeight ?? 0.2;
      let effectiveOwnStrength = player.militaryStrength();

      // Add military strength of others already at war with target, scaled by
      // how much of their attention is on the target
      for (const ally of this.mg.players()) {
        if (
          ally.id() !== player.id() &&
          ally.id() !== other.id() &&
          ally.isAlive() &&
          ally.isAtWarWith(other)
        ) {
          // Calculate total military strength of all players at war with this ally
          // weighted by whether they can reach the ally
          let totalEnemyStrengthOfAlly = 0;
          for (const allyEnemy of this.mg.players()) {
            if (
              allyEnemy.id() !== ally.id() &&
              allyEnemy.isAlive() &&
              ally.isAtWarWith(allyEnemy)
            ) {
              const enemyStrength = allyEnemy.militaryStrength();
              if (this.isReachable(allyEnemy, ally)) {
                totalEnemyStrengthOfAlly += enemyStrength;
              } else {
                totalEnemyStrengthOfAlly += enemyStrength * nonReachableWeight;
              }
            }
          }

          // Scale ally's contribution by target's share of their total enemies
          // Also scale by whether the ally can reach the target
          if (totalEnemyStrengthOfAlly > 0) {
            let targetStrengthForAlly = other.militaryStrength();
            if (!this.isReachable(ally, other)) {
              targetStrengthForAlly *= nonReachableWeight;
            }
            const targetShare =
              targetStrengthForAlly / totalEnemyStrengthOfAlly;
            effectiveOwnStrength += ally.militaryStrength() * targetShare;
          }
        }
      }

      let totalEnemyStrength = other.militaryStrength();

      // Add military strength of all players we're already at war with
      for (const enemy of this.mg.players()) {
        if (
          enemy.id() !== player.id() &&
          enemy.id() !== other.id() &&
          enemy.isAlive() &&
          player.isAtWarWith(enemy)
        ) {
          const enemyStrength = enemy.militaryStrength();
          if (this.isReachable(enemy, player)) {
            // Reachable enemy: full weight
            totalEnemyStrength += enemyStrength;
          } else {
            // Non-reachable enemy: reduced weight (harder for them to attack us)
            totalEnemyStrength += enemyStrength * nonReachableWeight;
          }
        }
      }

      if (totalEnemyStrength > 0) {
        const strengthRatio = effectiveOwnStrength / totalEnemyStrength;
        score += militaryStrengthWeight * strengthRatio;
      }
    }

    // Factor 3: Ally penalty (negative contribution)
    const allyPenalty = this.params.warScoreAllyPenalty ?? 0;
    if (allyPenalty !== 0 && player.isAlliedWith(other)) {
      score -= allyPenalty;
    }

    return score;
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
   * Declares war on players whose moving average war score exceeds the threshold.
   */
  private maybeDeclarWars(player: Player): void {
    const threshold = this.params.warDeclarationThreshold ?? 1.0;

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
}
