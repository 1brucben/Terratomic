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
  private currentSearchRange: number = 50;
  private tnExpansionDisabled: boolean = false;
  private lastTNCheckTick: number = 0;
  private lastBoatAttemptTick: number = 0;
  private playerShoreCache: { tiles: TileRef[]; tick: number } | null = null;
  private static readonly MIN_SEARCH_RANGE = 50;
  private static readonly MAX_SEARCH_RANGE = 300;
  private static readonly RANGE_INCREASE_INTERVAL = 10; // ticks
  private static readonly TN_RECHECK_INTERVAL = 100; // ticks between re-checking if TN exists
  private static readonly BOAT_ATTEMPT_INTERVAL = 5; // only attempt boat attacks every N ticks
  private static readonly SHORE_CACHE_INTERVAL = 10;
  private static readonly RANDOM_SHORE_MAX_ITERATIONS = 150;

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

  handleTerraNulliusAttack(): boolean {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return false;
    }

    // If TN expansion is disabled, periodically re-check if TN exists (fallout can create new TN)
    if (this.tnExpansionDisabled) {
      const currentTick = this.mg.ticks();
      if (
        currentTick - this.lastTNCheckTick >=
        AITerraNulliusHandler.TN_RECHECK_INTERVAL
      ) {
        this.lastTNCheckTick = currentTick;
        if (this.hasTNLandTiles()) {
          this.tnExpansionDisabled = false;
        }
      }
      if (this.tnExpansionDisabled) {
        return false;
      }
    }

    // Clean up pending targets (tiles we now own)
    this.cleanupPendingTargets(player);

    const attackThreshold =
      (this.params.terraNulliusTroopThreshold ?? 0.3) + this.thresholdOffset;
    const maxPop = this.mg.config().maxPopulation(player);
    const maxTroops = maxPop * player.targetTroopRatio();
    const totalTroops = player.troops() + player.attackingTroops();
    const troopRatio = totalTroops / maxTroops;

    if (troopRatio < attackThreshold) {
      return false;
    }

    // Check if we have enough defending troops at home
    const defendingTroopTarget = this.params.defendingTroopTarget ?? 0.5;
    const defendingRatio = player.troops() / totalTroops;
    if (defendingRatio < defendingTroopTarget) {
      return false;
    }

    const tn = this.mg.terraNullius();

    // Try land attack first if we border Terra Nullius
    if (player.sharesBorderWith(tn)) {
      return this.launchLandAttack(
        player,
        troopRatio,
        maxPop,
        maxTroops,
        totalTroops,
      );
    }

    // Otherwise, try boat attack (rate-limited to avoid expensive shore searches)
    const currentTick = this.mg.ticks();
    if (
      currentTick - this.lastBoatAttemptTick <
      AITerraNulliusHandler.BOAT_ATTEMPT_INTERVAL
    ) {
      // Rate limited - skip without expanding search range
      return false;
    }
    this.lastBoatAttemptTick = currentTick;

    const boatAttacked = this.launchBoatAttack(player);
    if (boatAttacked) {
      return true;
    }

    // No valid TN attack available - increase search range
    // (increase by 5 since we only check every BOAT_ATTEMPT_INTERVAL ticks)
    this.currentSearchRange = Math.min(
      this.currentSearchRange + 5,
      AITerraNulliusHandler.MAX_SEARCH_RANGE,
    );

    // If we've maxed out search range and still can't find TN, check if TN exists at all
    if (this.currentSearchRange >= AITerraNulliusHandler.MAX_SEARCH_RANGE) {
      if (!this.hasTNLandTiles()) {
        this.tnExpansionDisabled = true;
        this.lastTNCheckTick = this.mg.ticks();
      }
    }

    return false;
  }

  /**
   * Check if any Terra Nullius land tiles exist in the game.
   * TN tiles = total land tiles - fallout tiles - all player-owned tiles
   */
  private hasTNLandTiles(): boolean {
    const totalLand = this.mg.numLandTiles();
    const fallout = this.mg.numTilesWithFallout();
    const playerOwned = this.mg
      .players()
      .reduce((sum, p) => sum + p.numTilesOwned(), 0);
    const tnTiles = totalLand - fallout - playerOwned;
    return tnTiles > 0;
  }

  private launchLandAttack(
    player: Player,
    troopRatio: number,
    maxPop: number,
    maxTroops: number,
    totalTroops: number,
  ): boolean {
    const ownTroopPercent = this.params.terraNulliusOwnTroopPercent ?? 0.1;
    const troops = player.troops() * ownTroopPercent;

    if (troops < 1) {
      return false;
    }

    if (player.name() === "Mongolia") {
      console.log(
        `[AI ${player.name()}] Terra Nullius land attack: troops=${Math.floor(troops)}, troopRatio=${(troopRatio * 100).toFixed(1)}%, maxPop=${Math.floor(maxPop)}, maxTroops=${Math.floor(maxTroops)}, totalTroops=${Math.floor(totalTroops)}, player.troops()=${Math.floor(player.troops())}, player.attackingTroops()=${Math.floor(player.attackingTroops())}`,
      );
    }
    this.mg.addExecution(new AttackExecution(troops, player, null));
    return true;
  }

  private launchBoatAttack(player: Player): boolean {
    const currentTick = this.mg.ticks();
    const minSpacing = this.params.terraNulliusBoatSpacing ?? 30;
    const boatTroopPercent = this.params.terraNulliusBoatTroopPercent ?? 0.05;

    // Get player's ocean shore tiles (cached)
    const playerShore = this.getPlayerShoreCached(player, currentTick);
    if (playerShore.length === 0) {
      return false;
    }

    const shoreSample = this.random.sampleArray(playerShore, 8);

    for (const tile of shoreSample) {
      const dst = this.findRandomTNShore(tile, this.currentSearchRange);
      if (dst === null) {
        continue;
      }

      // Check spacing from pending targets
      if (this.isTooCloseToExisting(dst, minSpacing)) {
        continue;
      }

      const troops = player.troops() * boatTroopPercent;
      if (troops < 1) {
        return false;
      }

      this.pendingBoatTargets.add(dst);
      this.mg.addExecution(
        new TransportShipExecution(player, null, dst, troops, null),
      );
      return true;
    }
    return false;
  }

  /**
   * Get player's ocean shore tiles with caching.
   */
  private getPlayerShoreCached(player: Player, currentTick: number): TileRef[] {
    if (
      this.playerShoreCache &&
      currentTick - this.playerShoreCache.tick <
        AITerraNulliusHandler.SHORE_CACHE_INTERVAL
    ) {
      return this.playerShoreCache.tiles;
    }

    const tiles = Array.from(player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    this.playerShoreCache = { tiles, tick: currentTick };
    return tiles;
  }

  private findRandomTNShore(
    fromTile: TileRef,
    maxDistance: number,
  ): TileRef | null {
    const tn = this.mg.terraNullius();
    const x = this.mg.x(fromTile);
    const y = this.mg.y(fromTile);

    for (
      let i = 0;
      i < AITerraNulliusHandler.RANDOM_SHORE_MAX_ITERATIONS;
      i++
    ) {
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
