import { AttackExecution } from "../execution/AttackExecution";
import { TransportShipExecution } from "../execution/TransportShipExecution";
import { Game, Player, PlayerID, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { canBuildTransportShip } from "../game/TransportShipUtils";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles attack behavior against AI and Human players.
 * Only attacks players we are at war with.
 * Bot and TerraNullius attacks are handled separately.
 */
export class AIAttackHandler {
  // Number of random shore tiles to sample (in addition to extrema)
  private static readonly RANDOM_SHORE_SAMPLE_SIZE = 4;

  // Cooldown between boat attacks (ticks)
  private static readonly BOAT_ATTACK_COOLDOWN = 50;

  // Best non-extremum tile found per enemy player (for boat targeting)
  // Maps enemy PlayerID -> their best shore tile we've found
  private closestRandomEnemy = new Map<PlayerID, TileRef>();

  // Last tick we sent a boat attack
  private lastBoatAttackTick = 0;

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

  handleAttack(): boolean {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return false;
    }

    const attackThreshold =
      (this.params.attackTroopThreshold ?? 0.5) + this.thresholdOffset;
    const maxPop = this.mg.config().maxPopulation(player);
    const maxTroops = maxPop * player.targetTroopRatio();
    const totalTroops = player.troops() + player.attackingTroops();
    const troopRatio = totalTroops / maxTroops;

    // Only attack if we have enough troops
    if (troopRatio < attackThreshold) {
      return false;
    }

    // Check if we have enough defending troops at home
    const defendingTroopTarget = this.params.defendingTroopTarget ?? 0.5;
    const defendingRatio = player.troops() / totalTroops;
    if (defendingRatio < defendingTroopTarget) {
      return false;
    }

    // Find land target: enemy we're at war with, that borders us, with lowest troop density
    const landTarget = this.findLandTarget(player);
    if (landTarget !== null) {
      this.launchLandAttack(player, landTarget);
      return true;
    }

    // No land target found, try boat attack
    // Rate-limit boat attacks to prevent sending multiple ships in quick succession
    const currentTick = this.mg.ticks();
    if (
      currentTick - this.lastBoatAttackTick <
      AIAttackHandler.BOAT_ATTACK_COOLDOWN
    ) {
      return false;
    }

    const boatTarget = this.findBoatTarget(player);
    if (boatTarget !== null) {
      return this.launchBoatAttack(player, boatTarget.target, boatTarget.tile);
    }

    return false;
  }

  private findLandTarget(player: Player): Player | null {
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

  /**
   * Finds a boat attack target: enemy at war with us, reachable by boat,
   * doesn't share a border. Returns the target and the nearest tile to attack.
   */
  private findBoatTarget(
    player: Player,
  ): { target: Player; tile: TileRef } | null {
    // Fast path: skip if we don't border ocean
    if (!player.bordersOcean()) {
      return null;
    }

    // Get our ocean shore sample (extrema + closestRandom + random)
    const playerSample = this.getOceanShoreSample(player, true);
    if (playerSample.length === 0) {
      return null;
    }

    // Use first tile as reference point for finding enemy shores
    const refShore = playerSample[0];

    let bestTarget: Player | null = null;
    let bestTile: TileRef | null = null;
    let shortestDistance = Infinity;

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

      // Skip if we share a border (should use land attack)
      if (player.sharesBorderWith(other)) {
        continue;
      }

      // Fast path: skip if enemy doesn't border ocean
      if (!other.bordersOcean()) {
        continue;
      }

      // Get enemy's ocean shore sample
      const otherSample = this.getOceanShoreSample(other);
      if (otherSample.length === 0) {
        continue;
      }

      // Find closest enemy tile to our reference shore
      let closestTile: TileRef | null = null;
      let closestToRef = Infinity;
      for (const tile of otherSample) {
        const dist = this.mg.manhattanDist(refShore, tile);
        if (dist < closestToRef) {
          closestToRef = dist;
          closestTile = tile;
        }
      }

      if (closestTile === null) {
        continue;
      }

      // Find distance from closest enemy tile to our nearest sample tile
      let minDist = Infinity;
      let bestShoreTile: TileRef | null = null;
      for (const shore of playerSample) {
        const dist = this.mg.manhattanDist(shore, closestTile);
        if (dist < minDist) {
          minDist = dist;
          bestShoreTile = shore;
        }
      }

      // Remember best non-extremum tile for this enemy
      if (bestShoreTile !== null) {
        const extremaSet = new Set(player.oceanShoreExtrema());
        if (!extremaSet.has(bestShoreTile)) {
          this.closestRandomEnemy.set(other.id(), bestShoreTile);
        }
      }

      if (minDist < shortestDistance) {
        shortestDistance = minDist;
        bestTarget = other;
        bestTile = closestTile;
      }
    }

    if (bestTarget === null || bestTile === null) {
      return null;
    }
    return { target: bestTarget, tile: bestTile };
  }

  /**
   * Gets ocean shore sample for a player: extrema + closestRandom + random tiles.
   * For our own player, uses closestRandomEnemy values.
   * For enemy players, just uses extrema + random.
   */
  private getOceanShoreSample(
    player: Player,
    isOwn: boolean = false,
  ): TileRef[] {
    const extrema = player.oceanShoreExtrema();
    const allShores = player.oceanShoreTiles();

    if (allShores.length === 0) {
      return [];
    }

    // Start with extrema
    const result = [...extrema];
    const usedSet = new Set(extrema);

    // For our own player, include remembered best tiles from previous evaluations
    if (isOwn) {
      for (const tile of this.closestRandomEnemy.values()) {
        // Verify tile still belongs to us
        if (
          this.mg.isValidRef(tile) &&
          this.mg.owner(tile).id() === player.id() &&
          !usedSet.has(tile)
        ) {
          result.push(tile);
          usedSet.add(tile);
        }
      }
    }

    // Add random samples
    const availableForSampling = allShores.filter((t) => !usedSet.has(t));
    const randomSample = this.sampleTiles(
      availableForSampling,
      AIAttackHandler.RANDOM_SHORE_SAMPLE_SIZE,
    );
    result.push(...randomSample);

    return result;
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

  private launchLandAttack(player: Player, target: Player): void {
    const alpha = this.params.attackOwnTroopPercent ?? 0.2;
    const beta = this.params.attackEnemyTroopMultiplier ?? 1.5;

    const troopsFromOwn = player.troops() * alpha;
    const troopsFromEnemy = target.troops() * beta;
    const troops = Math.min(troopsFromOwn, troopsFromEnemy);

    if (troops < 1) {
      return;
    }

    // Only log when this is a genuinely new attack (no existing outgoing to same target)
    const hasExisting = player
      .outgoingAttacks()
      .some((a) => a.target() === target && a.isActive());
    if (!hasExisting) {
      console.log(
        `[AI Attack] LAND: ${player.name()} -> ${target.name()} | ` +
          `troops=${Math.floor(troops)}, ownTroops=${Math.floor(player.troops())}, ` +
          `targetTroops=${Math.floor(target.troops())}, ` +
          `alpha=${alpha.toFixed(3)}, beta=${beta.toFixed(3)}, ` +
          `tick=${this.mg.ticks()}`,
      );
    }
    this.mg.addExecution(new AttackExecution(troops, player, target.id()));
  }

  private launchBoatAttack(
    player: Player,
    target: Player,
    targetTile: TileRef,
  ): boolean {
    // Validate that we can actually build a transport ship to this destination
    if (canBuildTransportShip(this.mg, player, targetTile) === false) {
      return false;
    }

    const boatTroopPercent = this.params.attackBoatTroopPercent ?? 0.1;
    const troops = player.troops() * boatTroopPercent;

    if (troops < 1) {
      return false;
    }

    this.lastBoatAttackTick = this.mg.ticks();
    console.log(
      `[AI Attack] BOAT: ${player.name()} -> ${target.name()} | ` +
        `troops=${Math.floor(troops)}, ownTroops=${Math.floor(player.troops())}, ` +
        `boatTroopPercent=${boatTroopPercent.toFixed(3)}, ` +
        `tick=${this.mg.ticks()}`,
    );
    this.mg.addExecution(
      new TransportShipExecution(player, target.id(), targetTile, troops, null),
    );
    return true;
  }
}
