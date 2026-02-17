import { ConstructionExecution } from "../execution/ConstructionExecution";
import { Game, Player, PlayerID, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Candidate unit types the AI can build, with their scoring functions.
 */
type UnitCandidate =
  | UnitType.Warship
  | UnitType.Submarine
  | UnitType.FighterJet
  | UnitType.Artillery;

const UNIT_CANDIDATES: UnitCandidate[] = [
  UnitType.Warship,
  UnitType.Submarine,
  UnitType.FighterJet,
  UnitType.Artillery,
];

/**
 * Handles AI decisions about building and moving military units
 * (warships, submarines, fighter jets, artillery).
 *
 * Scoring is analogous to AIConstructionHandler: each unit type gets a score,
 * and the best score is surfaced so AIPlayerExecution can compare it against
 * nuke and construction scores.
 */
export class AIUnitHandler {
  /** The unit type the AI is currently saving up to build (or null). */
  private _target: UnitCandidate | null = null;

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns the best score across all candidate unit types.
   * Called by AIPlayerExecution to compare against nuke and construction scores.
   */
  bestUnitScore(): number {
    const player = this.getPlayer();
    if (!player) return 0;

    let best = 0;
    for (const unitType of UNIT_CANDIDATES) {
      if (!this.isUnitEnabled(unitType)) continue;
      const s = this.scoreUnit(player, unitType);
      if (s > best) best = s;
    }
    return best;
  }

  /**
   * Returns a breakdown of scores per unit type (for debugging).
   */
  unitScoreBreakdown(): Map<UnitCandidate, number> {
    const result = new Map<UnitCandidate, number>();
    const player = this.getPlayer();
    if (!player) return result;

    for (const unitType of UNIT_CANDIDATES) {
      if (!this.isUnitEnabled(unitType)) continue;
      result.set(unitType, this.scoreUnit(player, unitType));
    }
    return result;
  }

  /**
   * Main tick for unit purchase decisions.
   * Called every tick by AIPlayerExecution (skipped when a nuke sequence is active).
   */
  tickUnitPurchase(ticks: number): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) return;

    // Pick best target if we don't have one
    if (this._target === null) {
      this._target = this.pickTarget(player);
    }
    if (this._target === null) return;

    // Wait until we can afford it
    const cost = this.mg.unitInfo(this._target).cost(player);
    if (player.gold() < cost) return;

    // Attempt to find a placement tile and build
    const placed = this.tryBuildUnit(player, this._target);
    if (placed) {
      this._target = null;
    }
  }

  /**
   * Main tick for unit movement decisions.
   * Called every tick by AIPlayerExecution.
   *
   * TODO: Implement unit movement logic (patrol repositioning,
   * strategic repositioning based on war state, etc.)
   */
  tickUnitMovement(_ticks: number): void {
    // Placeholder — unit movement AI will be implemented here.
    // Future considerations:
    // - Reposition warships toward enemy ports / trade routes
    // - Move submarines to interdict enemy shipping lanes
    // - Redirect fighter jets to areas with incoming bombers
    // - Advance artillery toward front lines
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  /**
   * Score a unit type for the current game state.
   * For now all scores return 0 — scoring formulas will be calibrated later.
   */
  private scoreUnit(_player: Player, _unitType: UnitCandidate): number {
    // TODO: Implement scoring per unit type. Ideas for future:
    //
    // Warship:
    //   - Based on number of enemy ports / trade ships / coastal exposure
    //   - Diminishing returns per existing warship
    //
    // Submarine:
    //   - Based on enemy trade volume, enemy warship count
    //   - Value of stealth interdiction
    //
    // FighterJet:
    //   - Based on enemy bomber/cargo plane count
    //   - Air superiority needs
    //
    // Artillery:
    //   - Based on front-line length, enemy structure density near borders
    //   - Siege value against clustered enemy cities
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Target selection
  // ---------------------------------------------------------------------------

  /**
   * Pick the unit type with the highest score among affordable candidates.
   */
  private pickTarget(player: Player): UnitCandidate | null {
    let bestScore = 0;
    const best: UnitCandidate[] = [];

    for (const unitType of UNIT_CANDIDATES) {
      if (!this.isUnitEnabled(unitType)) continue;
      if (this.mg.config().isUnitDisabled(unitType)) continue;

      const s = this.scoreUnit(player, unitType);
      if (s > bestScore) {
        bestScore = s;
        best.length = 0;
        best.push(unitType);
      } else if (s === bestScore && s > 0) {
        best.push(unitType);
      }
    }

    if (best.length === 0) return null;
    return this.random.randElement(best);
  }

  /**
   * Check if a unit type is enabled via AI behavior params.
   */
  private isUnitEnabled(unitType: UnitCandidate): boolean {
    switch (unitType) {
      case UnitType.Warship:
        return this.params.buildWarships ?? false;
      case UnitType.Submarine:
        return this.params.buildSubmarines ?? false;
      case UnitType.FighterJet:
        return this.params.buildFighterJets ?? false;
      case UnitType.Artillery:
        return this.params.buildArtillery ?? false;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Building
  // ---------------------------------------------------------------------------

  /**
   * Attempt to build a unit. Returns true if the build was initiated.
   */
  private tryBuildUnit(player: Player, unitType: UnitCandidate): boolean {
    const tile = this.findPlacementTile(player, unitType);
    if (tile === null) return false;

    const spawnTile = player.canBuild(unitType, tile);
    if (spawnTile === false) return false;

    // Double-check affordability right before committing
    const cost = this.mg.unitInfo(unitType).cost(player);
    if (player.gold() < cost) return false;

    this.mg.addExecution(
      new ConstructionExecution(player, unitType, spawnTile),
    );
    return true;
  }

  /**
   * Find a suitable tile to place a unit build order.
   *
   * - Naval units (Warship, Submarine): pick a random owned ocean-adjacent
   *   tile near a port, or a random shoreline tile.
   * - Air units (FighterJet): pick a tile near an airfield.
   * - Land units (Artillery): pick a tile near a factory.
   *
   * TODO: Improve placement logic with strategic considerations.
   */
  private findPlacementTile(
    player: Player,
    unitType: UnitCandidate,
  ): TileRef | null {
    switch (unitType) {
      case UnitType.Warship:
      case UnitType.Submarine:
        return this.findNavalPlacementTile(player);
      case UnitType.FighterJet:
        return this.findAirPlacementTile(player);
      case UnitType.Artillery:
        return this.findLandPlacementTile(player);
      default:
        return null;
    }
  }

  /**
   * Find a tile near a port for naval unit placement.
   * Warships/submarines spawn from ports, so we pick an ocean tile
   * in the vicinity of a random owned port.
   */
  private findNavalPlacementTile(player: Player): TileRef | null {
    const ports: TileRef[] = [];
    for (const port of this.mg.units(UnitType.Port)) {
      if (!port.isActive()) continue;
      if (port.owner().id() !== player.id()) continue;
      ports.push(port.tile());
    }
    if (ports.length === 0) return null;

    // Pick a random port and use its tile as the patrol/target tile
    const portTile = this.random.randElement(ports);
    return portTile;
  }

  /**
   * Find a tile near an airfield for fighter jet placement.
   */
  private findAirPlacementTile(player: Player): TileRef | null {
    const airfields: TileRef[] = [];
    for (const airfield of this.mg.units(UnitType.Airfield)) {
      if (!airfield.isActive()) continue;
      if (airfield.owner().id() !== player.id()) continue;
      airfields.push(airfield.tile());
    }
    if (airfields.length === 0) return null;

    return this.random.randElement(airfields);
  }

  /**
   * Find a tile near a factory for artillery placement.
   */
  private findLandPlacementTile(player: Player): TileRef | null {
    const factories: TileRef[] = [];
    for (const factory of this.mg.units(UnitType.Factory)) {
      if (!factory.isActive()) continue;
      if (factory.owner().id() !== player.id()) continue;
      factories.push(factory.tile());
    }
    if (factories.length === 0) return null;

    return this.random.randElement(factories);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getPlayer(): Player | undefined {
    return this.mg.players().find((p) => p.id() === this.playerId);
  }
}
