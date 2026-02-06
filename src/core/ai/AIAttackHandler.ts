import { AttackExecution } from "../execution/AttackExecution";
import { Game, Player, PlayerID, PlayerType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles attack behavior against AI and Human players.
 * Only attacks players we are at war with.
 * Bot and TerraNullius attacks are handled separately.
 */
export class AIAttackHandler {
  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
    private readonly thresholdOffset: number,
  ) {}

  private getPlayer(): Player | null {
    if (!this.mg.hasPlayer(this.playerId)) {
      return null;
    }
    return this.mg.player(this.playerId);
  }

  handleAttack(): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    const attackThreshold =
      (this.params.attackTroopThreshold ?? 0.5) + this.thresholdOffset;
    const maxPop = this.mg.config().maxPopulation(player);
    const maxTroops = maxPop * player.targetTroopRatio();
    const totalTroops = player.troops() + player.attackingTroops();
    const troopRatio = totalTroops / maxTroops;

    // Only attack if we have enough troops
    if (troopRatio < attackThreshold) {
      return;
    }

    // Check if we have enough defending troops at home
    const defendingTroopTarget = this.params.defendingTroopTarget ?? 0.5;
    const defendingRatio = player.troops() / totalTroops;
    if (defendingRatio < defendingTroopTarget) {
      return;
    }

    // Find target: enemy we're at war with, that borders us, with lowest troop density
    const target = this.findTarget(player);
    if (target === null) {
      return;
    }

    this.launchAttack(player, target);
  }

  private findTarget(player: Player): Player | null {
    let bestTarget: Player | null = null;
    let lowestDensity = Infinity;

    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (!other.isAlive()) continue;

      // Only attack AI and Human players
      if (other.type() !== PlayerType.Human && other.type() !== PlayerType.AI) {
        continue;
      }

      // Must be at war with them
      if (!player.isAtWarWith(other)) {
        continue;
      }

      // Must share a border (no boating for now)
      if (!player.sharesBorderWith(other)) {
        continue;
      }

      // Calculate troop density (troops per tile)
      const numTiles = other.numTilesOwned();
      if (numTiles === 0) continue;

      const troopDensity = other.troops() / numTiles;
      if (troopDensity < lowestDensity) {
        lowestDensity = troopDensity;
        bestTarget = other;
      }
    }

    return bestTarget;
  }

  private launchAttack(player: Player, target: Player): void {
    const alpha = this.params.attackOwnTroopPercent ?? 0.2;
    const beta = this.params.attackEnemyTroopMultiplier ?? 1.5;

    const troopsFromOwn = player.troops() * alpha;
    const troopsFromEnemy = target.troops() * beta;
    const troops = Math.min(troopsFromOwn, troopsFromEnemy);

    if (troops < 1) {
      return;
    }

    this.mg.addExecution(new AttackExecution(troops, player, target.id()));
  }
}
