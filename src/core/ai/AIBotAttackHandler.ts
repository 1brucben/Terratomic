import { AttackExecution } from "../execution/AttackExecution";
import { TransportShipExecution } from "../execution/TransportShipExecution";
import { closestTwoTiles } from "../execution/Util";
import { Game, Player, PlayerID, PlayerType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles attack behavior against Bot players only.
 * Player attacks (Human, FakeHuman, etc.) are handled separately.
 */
export class AIBotAttackHandler {
  private currentBotTarget: Player | null = null;

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {}

  private getPlayer(): Player | null {
    if (!this.mg.hasPlayer(this.playerId)) {
      return null;
    }
    return this.mg.player(this.playerId);
  }

  handleBotAttack(): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    const attackThreshold = this.params.botAttackTroopThreshold ?? 0.5;
    const maxPop = this.mg.config().maxPopulation(player);
    const maxTroops = maxPop * player.targetTroopRatio();
    const troopRatio = player.troops() / maxTroops;

    // Only attack bots if we have enough troops
    if (troopRatio < attackThreshold) {
      return;
    }

    // If no bot target, find one
    if (this.currentBotTarget === null || !this.currentBotTarget.isAlive()) {
      this.currentBotTarget = this.findBotTarget(player);
    }

    if (this.currentBotTarget === null) {
      return;
    }

    this.launchBotAttack(player, this.currentBotTarget);
  }

  private findBotTarget(player: Player): Player | null {
    const maxDistance = this.params.botAttackMaxDistance ?? 200;
    const playerCapital = player.capital();

    if (playerCapital === null) {
      return null;
    }

    // Get all bots sorted by distance to our capital
    const candidates: { player: Player; distance: number }[] = [];

    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (other.type() !== PlayerType.Bot) continue;
      if (!other.isAlive()) continue;

      const otherCapital = other.capital();
      if (otherCapital === null) continue;

      const distance = Math.sqrt(
        (playerCapital.x - otherCapital.x) ** 2 +
          (playerCapital.y - otherCapital.y) ** 2,
      );

      if (distance <= maxDistance) {
        candidates.push({ player: other, distance });
      }
    }

    // Sort by distance (nearest first)
    candidates.sort((a, b) => a.distance - b.distance);

    // Find the first reachable target
    for (const candidate of candidates) {
      if (this.isReachable(player, candidate.player)) {
        return candidate.player;
      }
    }

    return null;
  }

  private isReachable(player: Player, target: Player): boolean {
    // Check if shares land border
    if (player.sharesBorderWith(target)) {
      return true;
    }

    // Check if reachable by boat (both have ocean shore tiles)
    const playerShore = Array.from(player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    const targetShore = Array.from(target.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );

    if (playerShore.length > 0 && targetShore.length > 0) {
      const closest = closestTwoTiles(this.mg, playerShore, targetShore);
      return closest !== null;
    }

    return false;
  }

  private launchBotAttack(player: Player, target: Player): void {
    const alpha = this.params.botAttackOwnTroopPercent ?? 0.2;
    const beta = this.params.botAttackEnemyTroopMultiplier ?? 1.5;

    const troopsFromOwn = player.troops() * alpha;
    const troopsFromEnemy = target.troops() * beta;
    const troops = Math.min(troopsFromOwn, troopsFromEnemy);

    if (troops < 1) {
      return;
    }

    // Check if we share a land border - if so, use land attack
    if (player.sharesBorderWith(target)) {
      this.mg.addExecution(new AttackExecution(troops, player, target.id()));
      return;
    }

    // Otherwise, try boat attack against the bot
    const playerShore = Array.from(player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    const targetShore = Array.from(target.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );

    const closest = closestTwoTiles(this.mg, playerShore, targetShore);
    if (closest !== null) {
      this.mg.addExecution(
        new TransportShipExecution(
          player,
          target.id(),
          closest.y,
          troops,
          null,
        ),
      );
    }
  }
}
