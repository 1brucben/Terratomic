import { Game, Player, PlayerID, PlayerType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles AI diplomacy decisions: war declarations, peace requests, etc.
 */
export class AIDiplomacyHandler {
  private static readonly WAR_SCORE_EVALUATION_INTERVAL = 10;

  // Phase seed for spreading periodic actions across AIs
  private readonly phaseSeed: number;

  // Cached war scores for each player (keyed by PlayerID)
  private _warScores: Map<PlayerID, number> = new Map();

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
   * Returns a value where higher = more desire to go to war.
   */
  private calculateWarScore(_player: Player, _other: Player): number {
    // TODO: Implement actual war score calculation based on:
    // - Relative strength (troops, territory, structures)
    // - Border proximity (do we share a border?)
    // - Threat level (are they expanding toward us?)
    // - Opportunity (are they at war with others?)
    // - Relations (historical aggression, broken alliances)
    // For now, return 0 to prevent any war declarations
    return 0;
  }

  /**
   * Declares war on players whose war score exceeds the threshold.
   */
  private maybeDeclarWars(player: Player): void {
    const threshold = this.params.warDeclarationThreshold ?? 1.0;

    for (const [otherId, score] of this._warScores) {
      if (score > threshold) {
        const other = this.mg.player(otherId);
        if (other && other.isAlive() && !player.isAtWarWith(other)) {
          // Declare war (mutual)
          player.setWarWith(other);
          other.setWarWith(player);
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
