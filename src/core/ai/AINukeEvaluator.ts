import { NukeMagnitude } from "../configuration/Config";
import { Game, isStructureType, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { playerMaxStructureTechLevel } from "../game/Upgradeables";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";

/**
 * Best nuke target info for a given bomb type.
 */
export interface NukeBestTarget {
  tile: TileRef;
  score: number;
}

/**
 * Shared AI handler that evaluates potential nuclear strike targets.
 *
 * Every tick, picks a random tile and calculates two scores (atom bomb and
 * hydrogen bomb) based on the value of all structures within the bomb's inner
 * blast range, minus the bomb cost and SAM interception penalties.
 *
 * Scores are shared across all AI players in the same game.
 * Every 100 ticks, the currently saved best tiles are reevaluated.
 */
export class AINukeEvaluator {
  // One shared instance per game, keyed by GameID
  private static _instances: Map<GameID, AINukeEvaluator> = new Map();

  private static readonly REEVALUATE_INTERVAL = 100;
  private static readonly UPGRADE_MULTIPLIER = 0.8;

  private static readonly ALL_STRUCTURE_TYPES: UnitType[] = Object.values(
    UnitType,
  ).filter((t) => isStructureType(t));

  // Best atom bomb target
  private _bestAtomScore: number = 0;
  private _bestAtomTile: TileRef | null = null;

  // Best hydrogen bomb target
  private _bestHydrogenScore: number = 0;
  private _bestHydrogenTile: TileRef | null = null;

  // Tick tracking for reevaluation
  private _lastReevalTick: number = -1;

  private constructor(private mg: Game) {}

  /**
   * Get or create the shared NukeHandler instance for this game.
   */
  static getInstance(gameID: GameID, mg: Game): AINukeEvaluator {
    let instance = AINukeEvaluator._instances.get(gameID);
    if (!instance) {
      instance = new AINukeEvaluator(mg);
      AINukeEvaluator._instances.set(gameID, instance);
    }
    return instance;
  }

  /**
   * Remove the shared instance for a game (call on game end).
   */
  static removeInstance(gameID: GameID): void {
    AINukeEvaluator._instances.delete(gameID);
  }

  /**
   * Called each tick by any AI player. Picks a random tile, scores it for
   * both bomb types, and updates the best targets if improved.
   */
  tick(random: PseudoRandom, ticks: number): void {
    // Every 100 ticks, reevaluate the saved best tiles
    if (
      this._lastReevalTick < 0 ||
      ticks - this._lastReevalTick >= AINukeEvaluator.REEVALUATE_INTERVAL
    ) {
      this.reevaluateBest();
      this._lastReevalTick = ticks;
    }

    // Pick a random tile on the map
    const w = this.mg.width();
    const h = this.mg.height();
    const rx = random.nextInt(0, w);
    const ry = random.nextInt(0, h);
    const tile = this.mg.ref(rx, ry);

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
  bestAtomTarget(): NukeBestTarget | null {
    if (this._bestAtomTile === null) return null;
    return { tile: this._bestAtomTile, score: this._bestAtomScore };
  }

  /**
   * Returns the best hydrogen bomb target found so far (or null if none).
   */
  bestHydrogenTarget(): NukeBestTarget | null {
    if (this._bestHydrogenTile === null) return null;
    return { tile: this._bestHydrogenTile, score: this._bestHydrogenScore };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
   * Score = (total value of all structures within inner blast range)
   *       / (cost of the bomb + atom bomb cost × SAM levels within SAM range)
   */
  private calculateNukeScore(tile: TileRef, bombType: UnitType): number {
    const magnitude: NukeMagnitude = this.mg.config().nukeMagnitudes(bombType);
    const innerRange = magnitude.inner;
    const innerRangeSquared = innerRange * innerRange;

    // Sum value of all structures within inner range
    let totalValue = 0;
    for (const structureType of AINukeEvaluator.ALL_STRUCTURE_TYPES) {
      const structures = this.mg.units(structureType);
      for (const structure of structures) {
        if (!structure.isActive()) continue;
        const dist2 = this.mg.euclideanDistSquared(tile, structure.tile());
        if (dist2 > innerRangeSquared) continue;
        totalValue += this.getStructureValue(structure);
      }
    }

    // Compute total cost: bomb + SAM interception
    const bombCost = Number(
      this.mg.unitInfo(bombType).cost(this.dummyPlayer()),
    );
    const atomBombCost = Number(
      this.mg.unitInfo(UnitType.AtomBomb).cost(this.dummyPlayer()),
    );
    const samPenalty = this.calculateSAMPenalty(tile) * atomBombCost;
    const totalCost = Math.max(bombCost + samPenalty, 1);

    return totalValue / totalCost;
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

      // Get the SAM's effective range based on its owner's tech level
      const owner = sam.owner();
      const samRange = this.getEffectiveSAMRange(owner);
      const samRangeSquared = samRange * samRange;

      // Check if the tile is within this SAM's range
      if (this.mg.euclideanDistSquared(tile, sam.tile()) <= samRangeSquared) {
        totalSAMLevels += sam.stackCount();
      }
    }

    return totalSAMLevels;
  }

  /**
   * Compute the value of a structure: base cost + 80% per upgrade level.
   * Same calculation as AIConstructionHandler.getStructureValue.
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
      totalValue += baseCost * AINukeEvaluator.UPGRADE_MULTIPLIER;
    }
    return totalValue;
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

  /**
   * Get a dummy player reference for cost lookups.
   * unitInfo().cost() requires a Player, but for base cost we use the first alive player.
   * Falls back to any player if none alive.
   */
  private _dummyCached: Player | null = null;
  private dummyPlayer(): Player {
    if (this._dummyCached && this._dummyCached.isAlive()) {
      return this._dummyCached;
    }
    const players = this.mg.players();
    this._dummyCached =
      players.find((p) => p.isAlive()) ??
      (players.length > 0 ? players[0] : null);
    if (!this._dummyCached) {
      throw new Error("No players available for cost lookup");
    }
    return this._dummyCached;
  }
}
