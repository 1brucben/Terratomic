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

    // Score for atom bomb
    const atomScore = this.calculateNukeScore(tile, UnitType.AtomBomb);
    if (atomScore > this._bestAtomScore) {
      this._bestAtomScore = atomScore;
      this._bestAtomTile = tile;
    }

    // Score for hydrogen bomb
    const hydrogenScore = this.calculateNukeScore(tile, UnitType.HydrogenBomb);
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
    // Collect all active enemy structures
    const enemyStructures: Unit[] = [];
    for (const structureType of AINukeHandler.ALL_STRUCTURE_TYPES) {
      for (const structure of this.mg.units(structureType)) {
        if (!structure.isActive()) continue;
        const owner = structure.owner();
        if (
          owner.type() !== PlayerType.Human &&
          owner.type() !== PlayerType.AI
        ) {
          continue;
        }
        if (owner.id() === this.playerId) continue;
        if (!this.player!.isAtWarWith(owner)) continue;
        enemyStructures.push(structure);
      }
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
   * Calculate the nuke score for a given tile and bomb type.
   *
   * Score = (value of enemy structures within inner blast range)
   *       - (friendly damage weight × value of non-enemy player structures)
   *       - (cost of the bomb)
   *       - (atom bomb cost × total SAM levels within SAM range of tile)
   *
   * Only structures owned by AI or Human players at war with this AI
   * count as positive value. Structures owned by other (non-enemy) AI/Human
   * players are subtracted after being multiplied by the friendly damage weight.
   */
  private calculateNukeScore(tile: TileRef, bombType: UnitType): number {
    const magnitude: NukeMagnitude = this.mg.config().nukeMagnitudes(bombType);
    const innerRange = magnitude.inner;
    const innerRangeSquared = innerRange * innerRange;

    const friendlyDamageWeight = this.params.nukeFriendlyDamageWeight ?? 1.0;

    let enemyValue = 0;
    let friendlyValue = 0;

    for (const structureType of AINukeHandler.ALL_STRUCTURE_TYPES) {
      const structures = this.mg.units(structureType);
      for (const structure of structures) {
        if (!structure.isActive()) continue;
        const dist2 = this.mg.euclideanDistSquared(tile, structure.tile());
        if (dist2 > innerRangeSquared) continue;

        const owner = structure.owner();

        // Skip structures not owned by AI or Human players
        if (
          owner.type() !== PlayerType.Human &&
          owner.type() !== PlayerType.AI
        ) {
          continue;
        }

        // Skip our own structures (treated as friendly damage)
        if (owner.id() === this.playerId) {
          friendlyValue += this.getStructureValue(structure);
          continue;
        }

        if (this.player!.isAtWarWith(owner)) {
          // Enemy structure: adds to score
          enemyValue += this.getStructureValue(structure);
        } else {
          // Non-enemy player structure: penalizes score
          friendlyValue += this.getStructureValue(structure);
        }
      }
    }

    let totalScore = enemyValue;

    // Subtract friendly/neutral player structure damage
    totalScore -= friendlyDamageWeight * friendlyValue;

    // Subtract the cost of the bomb
    const bombCost = Number(this.mg.unitInfo(bombType).cost(this.player!));
    totalScore -= bombCost;

    // Subtract atom bomb cost for every SAM level within SAM range of the tile
    const atomBombCost = Number(
      this.mg.unitInfo(UnitType.AtomBomb).cost(this.player!),
    );
    const samLevels = this.calculateSAMPenalty(tile);
    const samPenalty = samLevels * atomBombCost;
    totalScore -= samPenalty;

    // Subtract silo cost for any missing silo capacity.
    // Total bombs needed = 1 (the nuke) + SAM levels (one atom bomb each).
    // Available capacity = sum of stackCount() across our silos.
    const bombsNeeded = 1 + samLevels;
    const siloCapacity = this.getPlayerSiloCapacity();
    if (siloCapacity < bombsNeeded) {
      const siloCost = Number(
        this.mg.unitInfo(UnitType.MissileSilo).cost(this.player!),
      );
      totalScore -= (bombsNeeded - siloCapacity) * siloCost;
    }

    return totalScore;
  }

  /**
   * Count total SAM levels within SAM range of the tile.
   * Each SAM's range depends on the owning player's tech level.
   */
  private calculateSAMPenalty(tile: TileRef): number {
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
  private getPlayerSiloCapacity(): number {
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
  private getEffectiveSAMRange(player: Player): number {
    const baseRange = this.mg.config().defaultSamRange();
    const rangeBonus = this.mg.config().samRangeUpgradePercent();
    const techLevel = this.getPlayerSAMTechLevel(player);
    if (techLevel <= 1) return baseRange;
    return baseRange * Math.pow(1 + rangeBonus, techLevel - 1);
  }

  /**
   * Get a player's SAM tech level.
   */
  private getPlayerSAMTechLevel(player: Player): number {
    return playerMaxStructureTechLevel(player, UnitType.SAMLauncher);
  }
}
