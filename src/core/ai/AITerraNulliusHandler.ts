import { AttackExecution } from "../execution/AttackExecution";
import { TransportShipExecution } from "../execution/TransportShipExecution";
import { Game, Player, PlayerID } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles expansion attacks against Terra Nullius (unclaimed land).
 */
export class AITerraNulliusHandler {
  private pendingBoatTargets: Set<TileRef> = new Set();

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

  handleTerraNulliusAttack(): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    // Clean up pending targets (tiles we now own)
    this.cleanupPendingTargets(player);

    const attackThreshold = this.params.terraNulliusTroopThreshold ?? 0.3;
    const maxPop = this.mg.config().maxPopulation(player);
    const maxTroops = maxPop * player.targetTroopRatio();
    const totalTroops = player.troops() + player.attackingTroops();
    const troopRatio = totalTroops / maxTroops;

    if (troopRatio < attackThreshold) {
      return;
    }

    // Check if we border Terra Nullius - if so, attack by land
    const tn = this.mg.terraNullius();
    if (player.sharesBorderWith(tn)) {
      this.launchLandAttack(player);
      return;
    }

    // Otherwise, try to boat to TN via random sampling
    this.launchBoatAttack(player);
  }

  private launchLandAttack(player: Player): void {
    const ownTroopPercent = this.params.terraNulliusOwnTroopPercent ?? 0.1;
    const troops = player.troops() * ownTroopPercent;

    if (troops < 1) {
      return;
    }

    this.mg.addExecution(new AttackExecution(troops, player, null));
  }

  private launchBoatAttack(player: Player): void {
    const maxDistance = this.params.terraNulliusMaxDistance ?? 300;
    const minSpacing = this.params.terraNulliusBoatSpacing ?? 30;
    const ownTroopPercent = this.params.terraNulliusOwnTroopPercent ?? 0.1;

    // Sample player's ocean shore tiles
    const playerShore = Array.from(player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    if (playerShore.length === 0) {
      return;
    }

    const shoreSample = this.random.sampleArray(playerShore, 8);

    for (const tile of shoreSample) {
      const dst = this.findRandomTNShore(tile, maxDistance);
      if (dst === null) {
        continue;
      }

      // Check spacing from pending targets
      if (this.isTooCloseToExisting(dst, minSpacing)) {
        continue;
      }

      const troops = player.troops() * ownTroopPercent;
      if (troops < 1) {
        return;
      }

      this.pendingBoatTargets.add(dst);
      this.mg.addExecution(
        new TransportShipExecution(player, null, dst, troops, null),
      );
      return;
    }
  }

  private findRandomTNShore(
    fromTile: TileRef,
    maxDistance: number,
  ): TileRef | null {
    const tn = this.mg.terraNullius();
    const x = this.mg.x(fromTile);
    const y = this.mg.y(fromTile);

    for (let i = 0; i < 500; i++) {
      const randX = this.random.nextInt(x - maxDistance, x + maxDistance);
      const randY = this.random.nextInt(y - maxDistance, y + maxDistance);

      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }

      const randTile = this.mg.ref(randX, randY);

      if (!this.mg.isOceanShore(randTile)) {
        continue;
      }

      if (this.mg.owner(randTile) === tn) {
        return randTile;
      }
    }

    return null;
  }

  private isTooCloseToExisting(tile: TileRef, minSpacing: number): boolean {
    const minSpacingSq = minSpacing * minSpacing;
    for (const pending of this.pendingBoatTargets) {
      const dx = this.mg.x(tile) - this.mg.x(pending);
      const dy = this.mg.y(tile) - this.mg.y(pending);
      if (dx * dx + dy * dy < minSpacingSq) {
        return true;
      }
    }
    return false;
  }

  private cleanupPendingTargets(player: Player): void {
    for (const tile of this.pendingBoatTargets) {
      if (this.mg.owner(tile) === player) {
        this.pendingBoatTargets.delete(tile);
      }
    }
  }
}
