import { AttackExecution } from "../execution/AttackExecution";
import { TransportShipExecution } from "../execution/TransportShipExecution";
import { Game, Player, PlayerID } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { canBuildTransportShip } from "../game/TransportShipUtils";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles expansion attacks against Terra Nullius (unclaimed land).
 */
export class AITerraNulliusHandler {
  private pendingBoatTargets: Set<TileRef> = new Set();
  private currentSearchRange: number = 50;
  private tnExpansionDisabled: boolean = false;
  private boatExpansionDisabled: boolean = false;
  private lastTNCheckTick: number = 0;
  private lastBoatCheckTick: number = 0;
  private lastBoatAttemptTick: number = 0;
  private playerShoreCache: { tiles: TileRef[]; tick: number } | null = null;
  private tnBorderCache: { borders: boolean; tick: number } | null = null;
  private static readonly MAX_SEARCH_RANGE = 270;
  private static readonly TN_RECHECK_INTERVAL = 100; // ticks between re-checking if TN exists
  private static readonly BOAT_RECHECK_INTERVAL = 100; // ticks between re-checking if boat TN reachable
  private static readonly BOAT_ATTEMPT_INTERVAL = 10; // only attempt boat attacks every N ticks
  private static readonly TN_BORDER_CACHE_INTERVAL = 20; // cache sharesBorderWith(tn) result
  private static readonly SHORE_CACHE_INTERVAL = 10;
  private static readonly RANDOM_SHORE_MAX_ITERATIONS = 150;
  private static readonly OPPORTUNISTIC_BOAT_SAMPLES = 1; // random tiles to check for opportunistic boat attacks

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

    // Check if TN exists at all (cheap arithmetic check) - re-check periodically
    const currentTick = this.mg.ticks();
    if (this.tnExpansionDisabled) {
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
    } else if (
      currentTick - this.lastTNCheckTick >=
      AITerraNulliusHandler.TN_RECHECK_INTERVAL
    ) {
      // Periodically verify TN still exists before expensive sharesBorderWith check
      this.lastTNCheckTick = currentTick;
      if (!this.hasTNLandTiles()) {
        this.tnExpansionDisabled = true;
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

    // Try opportunistic boat attack first (finds TN across rivers/water that land attack can't reach)
    if (this.tryOpportunisticBoatAttack(player)) {
      return true;
    }

    // Try land attack if we border Terra Nullius (cached check)
    if (this.bordersTNCached(player, tn, currentTick)) {
      return this.launchLandAttack(
        player,
        troopRatio,
        maxPop,
        maxTroops,
        totalTroops,
      );
    }

    // Otherwise, try boat attack (rate-limited to avoid expensive shore searches)
    // Check if boat expansion is disabled (no reachable TN ocean shore)
    if (this.boatExpansionDisabled) {
      if (
        currentTick - this.lastBoatCheckTick >=
        AITerraNulliusHandler.BOAT_RECHECK_INTERVAL
      ) {
        this.lastBoatCheckTick = currentTick;
        // Re-enable to try again - if TN land tiles changed, there might be new boat targets
        this.boatExpansionDisabled = false;
        this.currentSearchRange = 50; // Reset search range for fresh attempt
      } else {
        return false;
      }
    }

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
    // (increase by 1 since we only check every BOAT_ATTEMPT_INTERVAL ticks)
    this.currentSearchRange = Math.min(
      this.currentSearchRange + 1,
      AITerraNulliusHandler.MAX_SEARCH_RANGE,
    );

    // If we've maxed out search range and still can't find TN, disable boat expansion
    if (this.currentSearchRange >= AITerraNulliusHandler.MAX_SEARCH_RANGE) {
      if (!this.hasTNLandTiles()) {
        this.tnExpansionDisabled = true;
        this.lastTNCheckTick = currentTick;
      }
      // Disable boat expansion specifically - no reachable TN ocean shore found
      this.boatExpansionDisabled = true;
      this.lastBoatCheckTick = currentTick;
    }

    return false;
  }

  /**
   * Check if any Terra Nullius land tiles exist in the game.
   * TN tiles = total land tiles - all player-owned tiles
   */
  private hasTNLandTiles(): boolean {
    const totalLand = this.mg.numLandTiles();
    const playerOwned = this.mg
      .players()
      .reduce((sum, p) => sum + p.numTilesOwned(), 0);
    const tnTiles = totalLand - playerOwned;
    return tnTiles > 0;
  }

  /**
   * Cached check for whether player borders Terra Nullius.
   * Invalidates when player successfully attacks TN (acquires new land).
   */
  private bordersTNCached(
    player: Player,
    tn: ReturnType<Game["terraNullius"]>,
    currentTick: number,
  ): boolean {
    if (
      this.tnBorderCache &&
      currentTick - this.tnBorderCache.tick <
        AITerraNulliusHandler.TN_BORDER_CACHE_INTERVAL
    ) {
      return this.tnBorderCache.borders;
    }

    const borders = player.sharesBorderWith(tn);
    this.tnBorderCache = { borders, tick: currentTick };
    return borders;
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

    this.mg.addExecution(new AttackExecution(troops, player, null));
    return true;
  }

  /**
   * Opportunistic boat attack: picks random tiles within search range and checks
   * if any are TN ocean shore tiles that can be boat attacked. This finds TN
   * across rivers/water that land attacks can't reach.
   */
  private tryOpportunisticBoatAttack(player: Player): boolean {
    const tn = this.mg.terraNullius();
    const minSpacing = this.params.terraNulliusBoatSpacing ?? 30;
    const boatTroopPercent = this.params.terraNulliusBoatTroopPercent ?? 0.05;

    // Get a random border tile as our search origin
    const borderTiles = Array.from(player.borderTiles());
    if (borderTiles.length === 0) {
      return false;
    }
    const origin = borderTiles[this.random.nextInt(0, borderTiles.length - 1)];
    const originX = this.mg.x(origin);
    const originY = this.mg.y(origin);
    const range = this.params.terraNulliusOpportunisticBoatRange ?? 20;

    for (let i = 0; i < AITerraNulliusHandler.OPPORTUNISTIC_BOAT_SAMPLES; i++) {
      // Pick a random tile within opportunistic boat range
      const randX = this.random.nextInt(originX - range, originX + range);
      const randY = this.random.nextInt(originY - range, originY + range);

      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }

      const tile = this.mg.ref(randX, randY);

      // Must be TN-owned ocean shore
      if (!this.mg.isOceanShore(tile)) {
        continue;
      }
      if (this.mg.owner(tile) !== tn) {
        continue;
      }

      // Check spacing from pending targets
      if (this.isTooCloseToExisting(tile, minSpacing)) {
        continue;
      }

      // Check if we can actually boat attack this tile
      if (canBuildTransportShip(this.mg, player, tile) === false) {
        continue;
      }

      const troops = player.troops() * boatTroopPercent;
      if (troops < 1) {
        return false;
      }

      this.pendingBoatTargets.add(tile);
      this.mg.addExecution(
        new TransportShipExecution(player, null, tile, troops, null),
      );
      return true;
    }

    return false;
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

      // Validate boat attack is possible
      if (canBuildTransportShip(this.mg, player, dst) === false) {
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
