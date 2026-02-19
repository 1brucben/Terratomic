import { NukeMagnitude } from "../configuration/Config";
import {
  Game,
  isStructureType,
  Player,
  PlayerID,
  PlayerType,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { playerMaxStructureTechLevel } from "../game/Upgradeables";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Best nuke target info for a given bomb type (per-player).
 */
export interface NukeHandlerBestTarget {
  tile: TileRef;
  score: number;
}

/**
 * Per-AI-player handler that evaluates potential nuclear strike targets
 * against players the AI is currently at war with.
 *
 * Every tick, picks a random tile and calculates two scores (atom bomb and
 * hydrogen bomb) based on the value of enemy structures within the bomb's
 * inner blast range, minus the bomb cost, SAM penalties, and a penalty for
 * collateral damage to non-enemy player structures.
 *
 * Unlike the shared AINukeEvaluator, each AI player has its own instance
 * so scores reflect that player's specific war relationships.
 */
export class AINukeHandler {
  private static readonly REEVALUATE_INTERVAL = 100;
  private static readonly UPGRADE_MULTIPLIER = 0.8;
  /** Expected number of nukes launched per silo built; amortises silo cost in score. */
  private static readonly EXPECTED_NUKES_PER_SILO = 2;

  private static readonly ALL_STRUCTURE_TYPES: UnitType[] = Object.values(
    UnitType,
  ).filter((t) => isStructureType(t));

  // Best atom bomb target for this AI player
  private _bestAtomScore: number = 0;
  private _bestAtomTile: TileRef | null = null;

  // Best hydrogen bomb target for this AI player
  private _bestHydrogenScore: number = 0;
  private _bestHydrogenTile: TileRef | null = null;

  // Tick tracking for reevaluation
  private _lastReevalTick: number = -1;

  private player: Player | null = null;

  /** Maximum possible SAM range (base × (1 + upgrade%)^maxLevel). */
  private readonly _maxSAMRange: number;

  // Phase seed for spreading periodic actions across AIs
  private readonly phaseSeed: number;

  /**
   * Optional callback that returns the war-score (without dominance) for a
   * given target player.  Set via `setWarScoreProvider`.
   */
  private _warScoreProvider: ((targetId: PlayerID) => number) | null = null;

  // --- Per-tick caches (refreshed at the start of each tick()) ---
  private _cachedTickNumber: number = -1;
  private _cachedStrongestEnemyId: PlayerID | null = null;
  private _cachedSigmoids: Map<PlayerID, number> = new Map();
  private _cachedSiloCapacity: number = 0;
  /** Per-tick cache for unitInfo().cost() results, keyed by "unitType:playerId". */
  private _cachedUnitCosts: Map<string, number> = new Map();

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {
    // Precompute worst-case SAM range (max tech level = 3) for spatial queries
    const baseRange = this.mg.config().defaultSamRange();
    const rangeBonus = this.mg.config().samRangeUpgradePercent();
    const maxTechLevel = 3; // SAMLauncher max stack count
    this._maxSAMRange = baseRange * Math.pow(1 + rangeBonus, maxTechLevel - 1);

    // Stagger periodic actions across AIs using random offset
    this.phaseSeed = random.nextInt(0, 0x7fffffff);
  }

  private shouldRunPeriodic(ticks: number, period: number): boolean {
    const p = Math.max(1, Math.floor(period));
    return ticks % p === this.phaseSeed % p;
  }

  /**
   * Set the provider that returns war-score (without dominance) for a target.
   */
  setWarScoreProvider(provider: (targetId: PlayerID) => number): void {
    this._warScoreProvider = provider;
  }

  /** Sigmoid helper: 1 / (1 + exp(-x)). */
  private static sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  // warScoreSigmoid is now served by getCachedSigmoid / computeWarScoreSigmoid

  /**
   * Called each tick by the owning AI player. Evaluates every other tick
   * (phased across players) to reduce work.
   */
  tick(ticks: number): void {
    this.player = this.mg.player(this.playerId);
    if (!this.player || !this.player.isAlive()) return;

    // Refresh per-tick caches
    this.refreshTickCaches(ticks);

    // Periodic reevaluation of saved best tiles (always check, independent of skip)
    if (
      this._lastReevalTick < 0 ||
      ticks - this._lastReevalTick >= AINukeHandler.REEVALUATE_INTERVAL
    ) {
      this.reevaluateBest();
      this._lastReevalTick = ticks;
    }

    // Only evaluate a new tile every other tick, phased across players
    if (!this.shouldRunPeriodic(ticks, 2)) return;

    // Pick a random tile near a random enemy structure
    const tile = this.pickTileNearEnemyStructure();
    if (tile === null) return;

    // Score both bomb types in a single pass (one spatial query)
    const { atomScore, hydrogenScore } = this.scoreTileBothBombs(tile);

    if (atomScore > this._bestAtomScore) {
      this._bestAtomScore = atomScore;
      this._bestAtomTile = tile;
    }
    if (hydrogenScore > this._bestHydrogenScore) {
      this._bestHydrogenScore = hydrogenScore;
      this._bestHydrogenTile = tile;
    }
  }

  /**
   * Returns the best atom bomb target found so far (or null if none).
   */
  bestAtomTarget(): NukeHandlerBestTarget | null {
    if (this._bestAtomTile === null) return null;
    return { tile: this._bestAtomTile, score: this._bestAtomScore };
  }

  /**
   * Returns the best hydrogen bomb target found so far (or null if none).
   */
  bestHydrogenTarget(): NukeHandlerBestTarget | null {
    if (this._bestHydrogenTile === null) return null;
    return { tile: this._bestHydrogenTile, score: this._bestHydrogenScore };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Refresh all per-tick caches. Called once at the start of each tick().
   */
  private refreshTickCaches(ticks: number): void {
    if (ticks === this._cachedTickNumber) return;
    this._cachedTickNumber = ticks;

    // Strongest enemy
    this._cachedStrongestEnemyId = this.computeStrongestEnemyId();

    // Sigmoid cache
    this._cachedSigmoids.clear();

    // Silo capacity
    this._cachedSiloCapacity = this.computeSiloCapacity();

    // Unit cost cache
    this._cachedUnitCosts.clear();
  }

  /**
   * Pick a random tile within a hydrogen bomb's inner radius of a random
   * enemy structure (owned by an AI or Human player we're at war with).
   *
   * Picks a random enemy player first, then a random structure from that
   * player, avoiding a full iteration over every structure on the map.
   * Returns null if no enemy structures exist.
   */
  private pickTileNearEnemyStructure(): TileRef | null {
    // Collect enemy players we're at war with
    const enemyPlayers: Player[] = [];
    for (const p of this.mg.players()) {
      if (!p.isAlive()) continue;
      if (p.id() === this.playerId) continue;
      if (p.type() !== PlayerType.Human && p.type() !== PlayerType.AI) continue;
      if (!this.player!.isAtWarWith(p)) continue;
      enemyPlayers.push(p);
    }
    if (enemyPlayers.length === 0) return null;

    // Pick a random enemy player
    const enemy = enemyPlayers[this.random.nextInt(0, enemyPlayers.length)];

    // Get that player's structures
    const structures = enemy.units(...AINukeHandler.ALL_STRUCTURE_TYPES);
    if (structures.length === 0) return null;

    // Pick a random structure from that player
    const target = structures[this.random.nextInt(0, structures.length)];
    const structureTile = target.tile();

    // Random offset within hydrogen bomb inner radius
    const hRadius = this.mg
      .config()
      .nukeMagnitudes(UnitType.HydrogenBomb).inner;
    const sx = this.mg.x(structureTile);
    const sy = this.mg.y(structureTile);
    const ox = this.random.nextInt(-hRadius, hRadius + 1);
    const oy = this.random.nextInt(-hRadius, hRadius + 1);
    const tx = Math.max(0, Math.min(this.mg.width() - 1, sx + ox));
    const ty = Math.max(0, Math.min(this.mg.height() - 1, sy + oy));

    return this.mg.ref(tx, ty);
  }

  /**
   * Reevaluate the saved best tiles. If the tile is no longer valuable,
   * reset it so future sampling can find a better one.
   */
  private reevaluateBest(): void {
    if (this._bestAtomTile !== null) {
      const newScore = this.calculateNukeScore(
        this._bestAtomTile,
        UnitType.AtomBomb,
      );
      if (newScore <= 0) {
        this._bestAtomScore = 0;
        this._bestAtomTile = null;
      } else {
        this._bestAtomScore = newScore;
      }
    }

    if (this._bestHydrogenTile !== null) {
      const newScore = this.calculateNukeScore(
        this._bestHydrogenTile,
        UnitType.HydrogenBomb,
      );
      if (newScore <= 0) {
        this._bestHydrogenScore = 0;
        this._bestHydrogenTile = null;
      } else {
        this._bestHydrogenScore = newScore;
      }
    }
  }

  /**
   * Score both atom and hydrogen bombs for a tile in a single pass.
   * Uses one spatial query (hydrogen has the larger radius) and one
   * SAM/silo cost computation.
   *
   * Denominator uses (1 + discountRate)^T where T = minutes to afford
   * the total cost at current income.
   */
  private scoreTileBothBombs(tile: TileRef): {
    atomScore: number;
    hydrogenScore: number;
  } {
    const atomMagnitude = this.mg.config().nukeMagnitudes(UnitType.AtomBomb);
    const hydrogenMagnitude = this.mg
      .config()
      .nukeMagnitudes(UnitType.HydrogenBomb);
    const atomInnerRange = atomMagnitude.inner;
    const hydrogenInnerRange = hydrogenMagnitude.inner;
    const atomInnerRangeSq = atomInnerRange * atomInnerRange;

    const friendlyDamageWeight = this.params.nukeFriendlyDamageWeight ?? 1.0;

    const strongestEnemyId = this._cachedStrongestEnemyId;

    let atomEnemyValue = 0;
    let atomFriendlyValue = 0;
    let hydrogenEnemyValue = 0;
    let hydrogenFriendlyValue = 0;

    // Single spatial query using the larger hydrogen radius
    const nearby = this.mg.nearbyUnits(
      tile,
      hydrogenInnerRange,
      AINukeHandler.ALL_STRUCTURE_TYPES,
    );

    for (const { unit: structure, distSquared } of nearby) {
      const owner = structure.owner();
      if (owner.type() !== PlayerType.Human && owner.type() !== PlayerType.AI) {
        continue;
      }

      const value = this.getStructureValue(structure);
      const isEnemy =
        owner.id() !== this.playerId && this.player!.isAtWarWith(owner);

      if (isEnemy) {
        const bonus = owner.id() === strongestEnemyId ? 1000 : 0;
        const sig = this.getCachedSigmoid(owner.id());
        hydrogenEnemyValue += (value + bonus) * sig;
        if (distSquared <= atomInnerRangeSq)
          atomEnemyValue += (value + bonus) * sig;
      } else {
        hydrogenFriendlyValue += value;
        if (distSquared <= atomInnerRangeSq) atomFriendlyValue += value;
      }
    }

    // Shared cost components (SAM penalty + silo capacity)
    const samLevels = this.calculateSAMPenalty(tile);
    const atomBombCost = this.getCachedUnitCost(
      UnitType.AtomBomb,
      this.player!,
    );
    const siloCapacity = this._cachedSiloCapacity;

    // Use moving-average income estimate for time-to-fund
    const grossGoldPerMinute = this.player!.estimatedGoldIncomePerMinute();
    const discountRate = this.params.discountFactor ?? 0.1;

    // Atom score
    const atomNumerator =
      atomEnemyValue - friendlyDamageWeight * atomFriendlyValue;
    const atomTotalCost = atomBombCost + samLevels * atomBombCost;
    const atomT =
      grossGoldPerMinute > 0 ? atomTotalCost / grossGoldPerMinute : Infinity;
    const atomScore = atomNumerator / Math.pow(1 + discountRate, atomT);

    // Hydrogen score
    const hydrogenNumerator =
      hydrogenEnemyValue - friendlyDamageWeight * hydrogenFriendlyValue;
    const hydrogenBombCost = this.getCachedUnitCost(
      UnitType.HydrogenBomb,
      this.player!,
    );
    const hydrogenTotalCost = hydrogenBombCost + samLevels * atomBombCost;
    const hydrogenT =
      grossGoldPerMinute > 0
        ? hydrogenTotalCost / grossGoldPerMinute
        : Infinity;
    const hydrogenScore =
      hydrogenNumerator / Math.pow(1 + discountRate, hydrogenT);

    return { atomScore, hydrogenScore };
  }

  /**
   * Look up the cached war-score sigmoid for `targetId`, computing and
   * storing it on first access within this tick.
   */
  private getCachedSigmoid(targetId: PlayerID): number {
    let val = this._cachedSigmoids.get(targetId);
    if (val === undefined) {
      val = this.computeWarScoreSigmoid(targetId);
      this._cachedSigmoids.set(targetId, val);
    }
    return val;
  }

  /**
   * Raw sigmoid computation (not cached). Use `getCachedSigmoid` instead.
   */
  private computeWarScoreSigmoid(targetId: PlayerID): number {
    const scale = this.params.nukeWarScoreSigmoidScale ?? 1 / 50;
    if (scale === 0 || !this._warScoreProvider) return 1;
    const ws = this._warScoreProvider(targetId);
    return AINukeHandler.sigmoid(scale * (ws - 4));
  }

  /**
   * Find the enemy at war with this AI player that has the highest
   * military strength. Returns its PlayerID, or null if none.
   */
  private computeStrongestEnemyId(): PlayerID | null {
    let strongestId: PlayerID | null = null;
    let highestStrength = -Infinity;
    for (const p of this.mg.players()) {
      if (!p.isAlive()) continue;
      if (p.id() === this.playerId) continue;
      if (p.type() !== PlayerType.Human && p.type() !== PlayerType.AI) continue;
      if (!this.player!.isAtWarWith(p)) continue;
      const strength = p.militaryStrength();
      if (strength > highestStrength) {
        highestStrength = strength;
        strongestId = p.id();
      }
    }
    return strongestId;
  }

  /**
   * Compute extra silo cost needed to support (1 + samLevels) bombs.
   */
  private computeSiloCost(samLevels: number, siloCapacity: number): number {
    const bombsNeeded = 1 + samLevels;
    if (siloCapacity >= bombsNeeded) return 0;

    const siloCost = this.getCachedUnitCost(UnitType.MissileSilo, this.player!);
    const levelsNeeded = bombsNeeded - siloCapacity;

    if (siloCapacity > 0) {
      return levelsNeeded * siloCost * AINukeHandler.UPGRADE_MULTIPLIER;
    }
    // No silo — first level at full cost, rest at upgrade cost
    let cost = siloCost;
    for (let i = 1; i < levelsNeeded; i++) {
      cost += siloCost * AINukeHandler.UPGRADE_MULTIPLIER;
    }
    return cost;
  }

  /**
   * Calculate the nuke score for a given tile and bomb type.
   * Uses spatial grid query (nearbyUnits) instead of iterating all structures.
   *
   * Score = (value of enemy structures - friendly damage weight × friendly structures)
   *       / (1 + discountRate)^T
   * where T = minutes to afford (bombCost + SAM penalty + silo penalty) at current income.
   */
  private calculateNukeScore(tile: TileRef, bombType: UnitType): number {
    const magnitude: NukeMagnitude = this.mg.config().nukeMagnitudes(bombType);
    const innerRange = magnitude.inner;

    const friendlyDamageWeight = this.params.nukeFriendlyDamageWeight ?? 1.0;

    const strongestEnemyId = this._cachedStrongestEnemyId;

    let enemyValue = 0;
    let friendlyValue = 0;

    // Spatial query: only checks nearby grid cells, not all structures
    const nearby = this.mg.nearbyUnits(
      tile,
      innerRange,
      AINukeHandler.ALL_STRUCTURE_TYPES,
    );

    for (const { unit: structure } of nearby) {
      const owner = structure.owner();

      if (owner.type() !== PlayerType.Human && owner.type() !== PlayerType.AI) {
        continue;
      }

      if (owner.id() === this.playerId) {
        friendlyValue += this.getStructureValue(structure);
        continue;
      }

      if (this.player!.isAtWarWith(owner)) {
        const bonus = owner.id() === strongestEnemyId ? 1000 : 0;
        const sig = this.getCachedSigmoid(owner.id());
        enemyValue += (this.getStructureValue(structure) + bonus) * sig;
      } else {
        friendlyValue += this.getStructureValue(structure);
      }
    }

    const numerator = enemyValue - friendlyDamageWeight * friendlyValue;

    const bombCost = this.getCachedUnitCost(bombType, this.player!);
    const atomBombCost = this.getCachedUnitCost(
      UnitType.AtomBomb,
      this.player!,
    );
    const samLevels = this.calculateSAMPenalty(tile);
    const siloCapacity = this._cachedSiloCapacity;
    const totalCost =
      bombCost +
      samLevels * atomBombCost +
      this.computeSiloCost(samLevels, siloCapacity) /
        AINukeHandler.EXPECTED_NUKES_PER_SILO;

    // T = minutes to afford totalCost at current income
    const grossGoldPerMinute = this.player!.estimatedGoldIncomePerMinute();
    const discountRate = this.params.discountFactor ?? 0.1;
    const T =
      grossGoldPerMinute > 0 ? totalCost / grossGoldPerMinute : Infinity;

    return numerator / Math.pow(1 + discountRate, T);
  }

  /**
   * Count total SAM levels within SAM range of the tile.
   * Uses spatial query with max possible SAM range, then filters
   * by each SAM's actual effective range based on owner tech level.
   */
  calculateSAMPenalty(tile: TileRef): number {
    const nearbySAMs = this.mg.nearbyUnits(
      tile,
      this._maxSAMRange,
      UnitType.SAMLauncher,
    );
    let totalSAMLevels = 0;

    for (const { unit: sam, distSquared } of nearbySAMs) {
      const owner = sam.owner();
      const samRange = this.getEffectiveSAMRange(owner);
      const samRangeSquared = samRange * samRange;

      if (distSquared <= samRangeSquared) {
        totalSAMLevels += sam.stackCount();
      }
    }

    return totalSAMLevels;
  }

  /**
   * Get the cached cost (as number) for a unit type owned by a player.
   * Avoids repeated unitInfo() object allocation + cost() calls.
   */
  private getCachedUnitCost(unitType: UnitType, owner: Player): number {
    const key = `${unitType}:${owner.id()}`;
    let cost = this._cachedUnitCosts.get(key);
    if (cost === undefined) {
      cost = Number(this.mg.unitInfo(unitType).cost(owner));
      this._cachedUnitCosts.set(key, cost);
    }
    return cost;
  }

  /**
   * Compute the value of a structure: base cost + 80% per upgrade level.
   */
  private getStructureValue(structure: Unit): number {
    const baseCost = this.getCachedUnitCost(
      structure.type(),
      structure.owner(),
    );
    const level = structure.stackCount?.() ?? 1;

    if (level <= 1) {
      return baseCost;
    }

    let totalValue = baseCost;
    for (let i = 2; i <= level; i++) {
      totalValue += baseCost * AINukeHandler.UPGRADE_MULTIPLIER;
    }
    return totalValue;
  }

  /**
   * Get the silo launch capacity for this AI player (cached per tick).
   * Returns the stack count of the player's largest silo, or 0 if none exist.
   */
  getPlayerSiloCapacity(): number {
    if (this._cachedTickNumber === -1) {
      return this.computeSiloCapacity();
    }
    return this._cachedSiloCapacity;
  }

  /**
   * Compute the silo capacity from scratch (called once per tick).
   */
  private computeSiloCapacity(): number {
    let maxCapacity = 0;
    for (const silo of this.mg.units(UnitType.MissileSilo)) {
      if (!silo.isActive()) continue;
      if (silo.owner().id() !== this.playerId) continue;
      if (silo.stackCount() > maxCapacity) {
        maxCapacity = silo.stackCount();
      }
    }
    return maxCapacity;
  }

  /**
   * Compute the effective SAM range for a player's tech level.
   */
  getEffectiveSAMRange(player: Player): number {
    const baseRange = this.mg.config().defaultSamRange();
    const rangeBonus = this.mg.config().samRangeUpgradePercent();
    const techLevel = this.getPlayerSAMTechLevel(player);
    if (techLevel <= 1) return baseRange;
    return baseRange * Math.pow(1 + rangeBonus, techLevel - 1);
  }

  /**
   * Get a player's SAM tech level.
   */
  getPlayerSAMTechLevel(player: Player): number {
    return playerMaxStructureTechLevel(player, UnitType.SAMLauncher);
  }

  /**
   * Returns the list of SAM units (with their tiles) that are in range of
   * the given tile. Each SAM appears once; the caller should use
   * stackCount() to determine how many atom bombs to target at each.
   */
  getSAMsInRange(tile: TileRef): Unit[] {
    const nearbySAMs = this.mg.nearbyUnits(
      tile,
      this._maxSAMRange,
      UnitType.SAMLauncher,
    );
    const result: Unit[] = [];
    for (const { unit: sam, distSquared } of nearbySAMs) {
      const owner = sam.owner();
      const samRange = this.getEffectiveSAMRange(owner);
      if (distSquared <= samRange * samRange) {
        result.push(sam);
      }
    }
    return result;
  }

  /**
   * Reset all cached best-target scores and tiles. Call after a nuke
   * sequence completes so the handler starts fresh.
   */
  resetScores(): void {
    this._bestAtomScore = 0;
    this._bestAtomTile = null;
    this._bestHydrogenScore = 0;
    this._bestHydrogenTile = null;
  }

  /**
   * Compute the nuke score for an arbitrary tile and bomb type.
   * Used for a final validation before committing to a launch.
   */
  scoreForTile(tile: TileRef, bombType: UnitType): number {
    this.player = this.mg.player(this.playerId);
    if (!this.player || !this.player.isAlive()) return 0;
    return this.calculateNukeScore(tile, bombType);
  }

  /**
   * How many bomb launches are needed for a strike at the given tile:
   * 1 (main bomb) + total SAM levels in range.
   */
  bombsNeeded(tile: TileRef): number {
    return 1 + this.calculateSAMPenalty(tile);
  }
}
