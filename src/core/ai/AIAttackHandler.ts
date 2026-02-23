import { AttackExecution } from "../execution/AttackExecution";
import { TransportShipExecution } from "../execution/TransportShipExecution";
import { Game, Player, PlayerID, PlayerType, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { canBuildTransportShip } from "../game/TransportShipUtils";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

// ─── Debug overlay types ─────────────────────────────────────────────────────

/** Per-enemy breakdown for a single AI player's attack evaluation. */
export interface AttackTargetBreakdown {
  targetId: PlayerID;
  targetName: string;
  isAtWar: boolean;
  sharesBorder: boolean;
  /** Which path was selected: "land", "boat", or "none". */
  attackPath: "land" | "boat" | "none";
  /** Why the attack was blocked, if it was. */
  blockReason: string;
  /** Manhattan distance to nearest enemy shore (boat targeting). 0 if N/A. */
  boatDistance: number;
  /** Does the enemy border ocean? */
  enemyBordersOcean: boolean;
}

/** All attack debug data for one AI player. */
export interface AttackDebugData {
  playerId: PlayerID;
  playerName: string;
  /** Whether handleAttack() is being reached (not suppressed by TN/bot). */
  handleAttackReached: boolean;
  /** Last tick handleAttack() was called. */
  lastHandleAttackTick: number;
  /** Troop ratio vs threshold. */
  troopRatio: number;
  attackThreshold: number;
  /** Defending troop ratio vs target. */
  defendingRatio: number;
  defendingTarget: number;
  /** Does this player border ocean? */
  bordersOcean: boolean;
  /** Number of ocean shore tiles. */
  oceanShoreTileCount: number;
  /** Current transport ship count / max. */
  boatCount: number;
  boatMax: number;
  /** Ticks since last boat attack. */
  ticksSinceLastBoat: number;
  /** Boat cooldown threshold. */
  boatCooldown: number;
  /** Current boat search range (Manhattan distance). */
  boatSearchRange: number;
  /** Per-enemy breakdown. */
  targets: AttackTargetBreakdown[];
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles attack behavior against AI and Human players.
 * Only attacks players we are at war with.
 * Bot and TerraNullius attacks are handled separately.
 */
export class AIAttackHandler {
  // Static registry for debug overlay access
  private static readonly registry = new Map<PlayerID, AIAttackHandler>();
  // Number of random shore tiles to sample (in addition to extrema)
  private static readonly RANDOM_SHORE_SAMPLE_SIZE = 4;

  // Cooldown between boat attacks (ticks)
  private static readonly BOAT_ATTACK_COOLDOWN = 50;

  // Best non-extremum tile found per enemy player (for boat targeting)
  // Maps enemy PlayerID -> their best shore tile we've found
  private closestRandomEnemy = new Map<PlayerID, TileRef>();

  // Last tick we sent a boat attack
  private lastBoatAttackTick = 0;

  // Growing boat search range (Manhattan distance)
  private currentBoatSearchRange: number | null = null;

  // Debug: last tick handleAttack() was actually called
  private _lastHandleAttackTick = 0;
  // Debug: whether handleAttack was reached last tick cycle
  private _handleAttackReached = false;

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
    private readonly thresholdOffset: number,
  ) {
    AIAttackHandler.registry.set(playerId, this);
  }

  private getPlayer(): Player | null {
    if (!this.mg.hasPlayer(this.playerId)) {
      return null;
    }
    return this.mg.player(this.playerId);
  }

  handleAttack(): boolean {
    this._handleAttackReached = true;
    this._lastHandleAttackTick = this.mg.ticks();

    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return false;
    }

    const attackThreshold =
      (this.params.attackTroopThreshold ?? 0.5) + this.thresholdOffset;
    const maxPop = this.mg.config().maxPopulation(player);
    const maxTroops = maxPop * player.targetTroopRatio();
    const totalTroops = player.troops() + player.attackingTroops();
    const troopRatio = player.troops() / maxTroops;

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
      // No target found at all — grow range for next attempt
      this.growBoatSearchRange();
      return null;
    }

    // Check if the best target is within the current search range
    const range = this.getBoatSearchRange();
    if (shortestDistance > range) {
      // Target exists but too far — grow range for next attempt
      this.growBoatSearchRange();
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

  private getBoatSearchRange(): number {
    if (this.currentBoatSearchRange === null) {
      this.currentBoatSearchRange = this.params.attackBoatInitialRange ?? 50;
    }
    return this.currentBoatSearchRange;
  }

  private growBoatSearchRange(): void {
    const growth = this.params.attackBoatRangeGrowth ?? 0.5;
    this.currentBoatSearchRange = this.getBoatSearchRange() + growth;
  }

  private launchLandAttack(player: Player, target: Player): void {
    // Verify the border actually exists (cache may be stale)
    const targetSmallID = target.smallID();
    let hasConquerableTile = false;
    for (const tile of player.borderTiles()) {
      for (const n of this.mg.neighbors(tile)) {
        if (!this.mg.isWater(n) && this.mg.ownerID(n) === targetSmallID) {
          hasConquerableTile = true;
          break;
        }
      }
      if (hasConquerableTile) break;
    }
    if (!hasConquerableTile) {
      return;
    }

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
    this.mg.addExecution(
      new TransportShipExecution(player, targetTile, troops),
    );
    return true;
  }

  // ─── Debug overlay support ──────────────────────────────────────────────────

  /**
   * Collects debug data for all registered AI attack handlers.
   */
  public static getAllAttackDebugData(game: Game): AttackDebugData[] {
    const results: AttackDebugData[] = [];
    for (const [playerId, handler] of AIAttackHandler.registry) {
      if (!game.hasPlayer(playerId)) continue;
      const player = game.player(playerId);
      if (!player.isPlayer() || !player.isAlive()) continue;
      results.push(handler.collectDebugData(player));
    }
    return results;
  }

  private collectDebugData(player: Player): AttackDebugData {
    const attackThreshold =
      (this.params.attackTroopThreshold ?? 0.5) + this.thresholdOffset;
    const maxPop = this.mg.config().maxPopulation(player);
    const maxTroops = maxPop * player.targetTroopRatio();
    const totalTroops = player.troops() + player.attackingTroops();
    const troopRatio = totalTroops / maxTroops;

    const defendingTroopTarget = this.params.defendingTroopTarget ?? 0.5;
    const defendingRatio = totalTroops > 0 ? player.troops() / totalTroops : 1;

    const currentTick = this.mg.ticks();
    const boatMax = this.mg.config().boatMaxNumber();
    const boatCount = player.unitCount(UnitType.TransportShip);

    const targets: AttackTargetBreakdown[] = [];
    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (!other.isAlive()) continue;
      if (other.type() !== PlayerType.Human && other.type() !== PlayerType.AI)
        continue;
      if (!player.isAtWarWith(other)) continue;

      const sharesBorder = player.sharesBorderWith(other);
      const enemyBordersOcean = other.bordersOcean();

      let attackPath: "land" | "boat" | "none" = "none";
      let blockReason = "";
      let boatDistance = 0;

      if (sharesBorder) {
        // Would go through land attack path
        attackPath = "land";
        // Check if land attack would actually succeed
        if (troopRatio < attackThreshold) {
          blockReason = `troopRatio ${troopRatio.toFixed(2)} < threshold ${attackThreshold.toFixed(2)}`;
        } else if (defendingRatio < defendingTroopTarget) {
          blockReason = `defendingRatio ${defendingRatio.toFixed(2)} < target ${defendingTroopTarget.toFixed(2)}`;
        } else {
          // Check if conquerable tiles exist
          const targetSmallID = other.smallID();
          let hasConquerable = false;
          for (const tile of player.borderTiles()) {
            for (const n of this.mg.neighbors(tile)) {
              if (!this.mg.isWater(n) && this.mg.ownerID(n) === targetSmallID) {
                hasConquerable = true;
                break;
              }
            }
            if (hasConquerable) break;
          }
          if (!hasConquerable) {
            blockReason = "no conquerable land tiles at border";
          } else {
            blockReason = "OK (land attack active)";
          }
        }
      } else {
        // Would go through boat attack path
        attackPath = "boat";
        if (troopRatio < attackThreshold) {
          blockReason = `troopRatio ${troopRatio.toFixed(2)} < threshold ${attackThreshold.toFixed(2)}`;
        } else if (defendingRatio < defendingTroopTarget) {
          blockReason = `defendingRatio ${defendingRatio.toFixed(2)} < target ${defendingTroopTarget.toFixed(2)}`;
        } else if (!player.bordersOcean()) {
          blockReason = "player does not border ocean";
        } else if (player.oceanShoreTiles().length === 0) {
          blockReason = "player has no ocean shore tiles";
        } else if (
          currentTick - this.lastBoatAttackTick <
          AIAttackHandler.BOAT_ATTACK_COOLDOWN
        ) {
          blockReason = `boat cooldown (${currentTick - this.lastBoatAttackTick}/${AIAttackHandler.BOAT_ATTACK_COOLDOWN} ticks)`;
        } else if (!enemyBordersOcean) {
          blockReason = "enemy does not border ocean";
        } else if (other.oceanShoreTiles().length === 0) {
          blockReason = "enemy has no ocean shore tiles";
        } else if (boatCount >= boatMax) {
          blockReason = `boat cap (${boatCount}/${boatMax})`;
        } else {
          // Check distance — simulate findBoatTarget
          const playerSample = this.getOceanShoreSample(player, true);
          const otherSample = this.getOceanShoreSample(other);
          if (playerSample.length === 0) {
            blockReason = "no player ocean shore sample";
          } else if (otherSample.length === 0) {
            blockReason = "no enemy ocean shore sample";
          } else {
            let minDist = Infinity;
            for (const s of playerSample) {
              for (const t of otherSample) {
                const d = this.mg.manhattanDist(s, t);
                if (d < minDist) minDist = d;
              }
            }
            boatDistance = minDist;
            const currentRange = this.getBoatSearchRange();
            if (minDist > currentRange) {
              blockReason = `out of range (dist=${minDist}, range=${currentRange.toFixed(1)})`;
            } else {
              // Try canBuildTransportShip
              const bestEnemyTile = otherSample.reduce((best, t) => {
                const dBest = this.mg.manhattanDist(playerSample[0], best);
                const dT = this.mg.manhattanDist(playerSample[0], t);
                return dT < dBest ? t : best;
              });
              if (
                canBuildTransportShip(this.mg, player, bestEnemyTile) === false
              ) {
                blockReason = `canBuildTransportShip failed (dist=${minDist})`;
              } else {
                const boatTroopPercent =
                  this.params.attackBoatTroopPercent ?? 0.1;
                const troops = player.troops() * boatTroopPercent;
                if (troops < 1) {
                  blockReason = `boat troops too low (${troops.toFixed(0)})`;
                } else {
                  blockReason = `OK (boat ready, dist=${minDist})`;
                }
              }
            }
          }
        }
      }

      targets.push({
        targetId: other.id(),
        targetName: other.displayName(),
        isAtWar: true,
        sharesBorder,
        attackPath,
        blockReason,
        boatDistance,
        enemyBordersOcean,
      });
    }

    return {
      playerId: this.playerId,
      playerName: player.displayName(),
      handleAttackReached: this._handleAttackReached,
      lastHandleAttackTick: this._lastHandleAttackTick,
      troopRatio,
      attackThreshold,
      defendingRatio,
      defendingTarget: defendingTroopTarget,
      bordersOcean: player.bordersOcean(),
      oceanShoreTileCount: player.oceanShoreTiles().length,
      boatCount,
      boatMax,
      ticksSinceLastBoat: currentTick - this.lastBoatAttackTick,
      boatCooldown: AIAttackHandler.BOAT_ATTACK_COOLDOWN,
      boatSearchRange: this.getBoatSearchRange(),
      targets,
    };
  }
}
