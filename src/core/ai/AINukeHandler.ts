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

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {}

  /**
   * Called each tick by the owning AI player. Picks a random tile, scores it
   * for both bomb types considering war relationships, and updates the best
   * targets if improved.
   */
  tick(ticks: number): void {
    this.player = this.mg.player(this.playerId);
    if (!this.player || !this.player.isAlive()) return;

    // Periodic reevaluation of saved best tiles
    if (
      this._lastReevalTick < 0 ||
      ticks - this._lastReevalTick >= AINukeHandler.REEVALUATE_INTERVAL
    ) {
      this.reevaluateBest();
      this._lastReevalTick = ticks;
    }

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
   * Pick a random tile within a hydrogen bomb's inner radius of a random
   * enemy structure (owned by an AI or Human player we're at war with).
   * Returns null if no enemy structures exist.
   */
  private pickTileNearEnemyStructure(): TileRef | null {
    // Single call for all structure types instead of 12 separate calls
    const enemyStructures: Unit[] = [];
    for (const structure of this.mg.units(
      ...AINukeHandler.ALL_STRUCTURE_TYPES,
    )) {
      if (!structure.isActive()) continue;
      const owner = structure.owner();
      if (owner.type() !== PlayerType.Human && owner.type() !== PlayerType.AI) {
        continue;
      }
      if (owner.id() === this.playerId) continue;
      if (!this.player!.isAtWarWith(owner)) continue;
      enemyStructures.push(structure);
    }

    if (enemyStructures.length === 0) return null;

    // Pick a random enemy structure
    const target =
      enemyStructures[this.random.nextInt(0, enemyStructures.length)];
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
        hydrogenEnemyValue += value;
        if (distSquared <= atomInnerRangeSq) atomEnemyValue += value;
      } else {
        hydrogenFriendlyValue += value;
        if (distSquared <= atomInnerRangeSq) atomFriendlyValue += value;
      }
    }

    // Shared cost components (SAM penalty + silo capacity)
    const samLevels = this.calculateSAMPenalty(tile);
    const atomBombCost = Number(
      this.mg.unitInfo(UnitType.AtomBomb).cost(this.player!),
    );
    const siloCapacity = this.getPlayerSiloCapacity();
    const siloCostExtra =
      this.computeSiloCost(samLevels, siloCapacity) /
      AINukeHandler.EXPECTED_NUKES_PER_SILO;

    // Atom score
    const atomNumerator =
      atomEnemyValue - friendlyDamageWeight * atomFriendlyValue;
    const atomTotalCost =
      atomBombCost + samLevels * atomBombCost + siloCostExtra;
    const atomScore = atomNumerator / Math.max(atomTotalCost, 1);

    // Hydrogen score
    const hydrogenNumerator =
      hydrogenEnemyValue - friendlyDamageWeight * hydrogenFriendlyValue;
    const hydrogenBombCost = Number(
      this.mg.unitInfo(UnitType.HydrogenBomb).cost(this.player!),
    );
    const hydrogenTotalCost =
      hydrogenBombCost + samLevels * atomBombCost + siloCostExtra;
    const hydrogenScore = hydrogenNumerator / Math.max(hydrogenTotalCost, 1);

    return { atomScore, hydrogenScore };
  }

  /**
   * Compute extra silo cost needed to support (1 + samLevels) bombs.
   */
  private computeSiloCost(samLevels: number, siloCapacity: number): number {
    const bombsNeeded = 1 + samLevels;
    if (siloCapacity >= bombsNeeded) return 0;

    const siloCost = Number(
      this.mg.unitInfo(UnitType.MissileSilo).cost(this.player!),
    );
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
   *       / (cost of the bomb + SAM penalty + silo penalty)
   */
  private calculateNukeScore(tile: TileRef, bombType: UnitType): number {
    const magnitude: NukeMagnitude = this.mg.config().nukeMagnitudes(bombType);
    const innerRange = magnitude.inner;

    const friendlyDamageWeight = this.params.nukeFriendlyDamageWeight ?? 1.0;

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
        enemyValue += this.getStructureValue(structure);
      } else {
        friendlyValue += this.getStructureValue(structure);
      }
    }

    const numerator = enemyValue - friendlyDamageWeight * friendlyValue;

    const bombCost = Number(this.mg.unitInfo(bombType).cost(this.player!));
    const atomBombCost = Number(
      this.mg.unitInfo(UnitType.AtomBomb).cost(this.player!),
    );
    const samLevels = this.calculateSAMPenalty(tile);
    const siloCapacity = this.getPlayerSiloCapacity();
    const totalCost =
      bombCost +
      samLevels * atomBombCost +
      this.computeSiloCost(samLevels, siloCapacity) /
        AINukeHandler.EXPECTED_NUKES_PER_SILO;

    return numerator / Math.max(totalCost, 1);
  }

  /**
   * Count total SAM levels within SAM range of the tile.
   * Each SAM's range depends on the owning player's tech level.
   */
  calculateSAMPenalty(tile: TileRef): number {
    const allSAMs = this.mg.units(UnitType.SAMLauncher);
    let totalSAMLevels = 0;

    for (const sam of allSAMs) {
      if (!sam.isActive()) continue;

      const owner = sam.owner();
      const samRange = this.getEffectiveSAMRange(owner);
      const samRangeSquared = samRange * samRange;

      if (this.mg.euclideanDistSquared(tile, sam.tile()) <= samRangeSquared) {
        totalSAMLevels += sam.stackCount();
      }
    }

    return totalSAMLevels;
  }

  /**
   * Compute the value of a structure: base cost + 80% per upgrade level.
   */
  private getStructureValue(structure: Unit): number {
    const unitType = structure.type();
    const owner = structure.owner();
    const baseCost = Number(this.mg.unitInfo(unitType).cost(owner));
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
   * Get the silo launch capacity for this AI player.
   * Returns the stack count of the player's largest silo, or 0 if none exist.
   */
  getPlayerSiloCapacity(): number {
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
    const result: Unit[] = [];
    for (const sam of this.mg.units(UnitType.SAMLauncher)) {
      if (!sam.isActive()) continue;
      const owner = sam.owner();
      const samRange = this.getEffectiveSAMRange(owner);
      const samRangeSquared = samRange * samRange;
      if (this.mg.euclideanDistSquared(tile, sam.tile()) <= samRangeSquared) {
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
