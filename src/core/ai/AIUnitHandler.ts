import { ConstructionExecution } from "../execution/ConstructionExecution";
import {
  Game,
  Gold,
  Player,
  PlayerID,
  PlayerType,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { getUnitLevelCost } from "../game/UnitUpgrades";
import { playerMaxUnitLevel } from "../game/Upgradeables";
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

  // --- Warship scoring cache (refreshed every WARSHIP_SCAN_INTERVAL ticks) ---
  private _cachedEnemyMaxWarships = 0;
  private _cachedEnemyWarshipsTick = -Infinity;

  /** How often (in ticks) to rescan enemy warship counts. */
  private static readonly WARSHIP_SCAN_INTERVAL = 50;
  /** Internal base constant for warship score numerator. */
  private static readonly WARSHIP_BASE_SCORE = 3e5;

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

    const hasPorts = player.unitsOwned(UnitType.Port) > 0;

    let best = 0;
    for (const unitType of UNIT_CANDIDATES) {
      if (!this.isUnitEnabled(unitType)) continue;
      // Naval units require at least one port to build
      if (
        !hasPorts &&
        (unitType === UnitType.Warship || unitType === UnitType.Submarine)
      )
        continue;
      const s = this.scoreUnit(player, unitType);
      if (s > best) best = s;
    }
    return best;
  }

  /**
   * Returns the best score among naval unit types (warship, submarine).
   * Used to boost port priority when the AI has no ports.
   */
  bestNavalScore(): number {
    const player = this.getPlayer();
    if (!player) return 0;

    let best = 0;
    for (const unitType of [UnitType.Warship, UnitType.Submarine] as const) {
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
   * Refresh cached data (e.g. enemy warship counts) that scoring depends on.
   * Called every tick from AIPlayerExecution so scores are always fresh,
   * even before tickUnitPurchase runs.
   */
  refreshCaches(ticks: number): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) return;

    if (
      ticks - this._cachedEnemyWarshipsTick >=
      AIUnitHandler.WARSHIP_SCAN_INTERVAL
    ) {
      this.refreshEnemyWarshipCount(player);
      this._cachedEnemyWarshipsTick = ticks;
    }
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

    // Naval units require at least one port
    if (
      (this._target === UnitType.Warship ||
        this._target === UnitType.Submarine) &&
      player.unitsOwned(UnitType.Port) === 0
    ) {
      this._target = null;
      return;
    }

    // Warships use batch purchasing: save for N+1 then spawn them all
    if (this._target === UnitType.Warship) {
      this.tickWarshipBatchPurchase(player);
      return;
    }

    // Other units: single purchase
    const cost = this.unitCostAtLevel(player, this._target);
    if (player.gold() < cost) return;

    const placed = this.tryBuildUnit(player, this._target);
    if (placed) {
      this._target = null;
    }
  }

  /**
   * Warship batch purchase: save up for (enemyMax + 1) warships, then
   * spawn them all at once near the closest enemy warship to our capital.
   * If no enemy warships exist, spawn a single warship near a random port.
   */
  private tickWarshipBatchPurchase(player: Player): void {
    const enemyMax = this._cachedEnemyMaxWarships;
    const ownWarships = player.unitCount(UnitType.Warship);
    const targetCount = enemyMax - ownWarships + 1;
    const unitCost = this.unitCostAtLevel(player, UnitType.Warship);
    const totalCost = unitCost * BigInt(targetCount);

    // Wait until we can afford the whole batch
    if (player.gold() < totalCost) return;

    // Determine spawn tile: near closest enemy warship to our capital,
    // or near a random port if no enemy warships exist.
    const spawnTile = this.findWarshipPlacementTile(player);
    if (spawnTile === null) {
      // No valid placement — clear target and retry later
      this._target = null;
      return;
    }

    // Spawn the full batch
    let spawned = 0;
    for (let i = 0; i < targetCount; i++) {
      const tile = player.canBuild(UnitType.Warship, spawnTile);
      if (tile === false) {
        break;
      }
      if (player.gold() < unitCost) break;
      this.mg.addExecution(
        new ConstructionExecution(player, UnitType.Warship, tile),
      );
      spawned++;
    }

    // Clear target regardless — either we spawned or we failed
    this._target = null;
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
   */
  private scoreUnit(player: Player, unitType: UnitCandidate): number {
    switch (unitType) {
      case UnitType.Warship:
        return this.scoreWarship(player);
      case UnitType.Submarine:
        return 0; // TODO
      case UnitType.FighterJet:
        return 0; // TODO
      case UnitType.Artillery:
        return 0; // TODO
      default:
        return 0;
    }
  }

  /**
   * Warship score: if we already have more warships than the most-armed
   * enemy we're at war with, score is 0. Otherwise:
   *
   *   score = (WARSHIP_BASE_SCORE * weightWarship) / (1 + r)^T
   *
   * where T = minutes to fund (enemyMax + 1) warships at current income.
   */
  private scoreWarship(player: Player): number {
    const ownWarships = player.unitCount(UnitType.Warship);
    const enemyMax = this._cachedEnemyMaxWarships;

    // Already at parity or above — no need for more
    if (ownWarships > enemyMax) return 0;

    const targetCount = enemyMax - ownWarships + 1;
    const warshipCost = Number(this.unitCostAtLevel(player, UnitType.Warship));
    const totalCost = warshipCost * targetCount;

    const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
    if (grossGoldPerMinute <= 0) return 0;

    const T = totalCost / grossGoldPerMinute;
    const discountRate = this.params.discountFactor ?? 0.1;
    const weight = this.params.weightWarship ?? 1;

    return (
      (AIUnitHandler.WARSHIP_BASE_SCORE * weight) /
      Math.pow(1 + discountRate, T)
    );
  }

  /**
   * Scan all Human/AI players we're at war with and cache the maximum
   * warship count among them.
   */
  private refreshEnemyWarshipCount(player: Player): void {
    let maxWarships = 0;
    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (other.type() !== PlayerType.Human && other.type() !== PlayerType.AI) {
        continue;
      }
      if (!player.isAtWarWith(other)) continue;
      const count = other.unitCount(UnitType.Warship);
      if (count > maxWarships) maxWarships = count;
    }
    this._cachedEnemyMaxWarships = maxWarships;
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
    const cost = this.unitCostAtLevel(player, unitType);
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
        return this.findWarshipPlacementTile(player);
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
   * Find a placement tile for warships.
   *
   * Strategy: find the enemy warship (belonging to a Human/AI player we're
   * at war with) that is closest to our capital, then spawn near the port
   * that is closest to that enemy warship. If no enemy warships exist,
   * fall back to a random owned port.
   */
  private findWarshipPlacementTile(player: Player): TileRef | null {
    const capital = player.capital();

    // Collect owned port tiles
    const portTiles: TileRef[] = [];
    for (const port of this.mg.units(UnitType.Port)) {
      if (!port.isActive()) continue;
      if (port.owner().id() !== player.id()) continue;
      portTiles.push(port.tile());
    }
    if (portTiles.length === 0) return null;

    // Find closest enemy warship to our capital
    let closestEnemyWarship: Unit | null = null;
    let closestDist = Infinity;

    if (capital) {
      const capitalTile = this.mg.ref(capital.x, capital.y);
      for (const warship of this.mg.units(UnitType.Warship)) {
        if (!warship.isActive()) continue;
        const owner = warship.owner();
        if (owner.id() === player.id()) continue;
        if (
          owner.type() !== PlayerType.Human &&
          owner.type() !== PlayerType.AI
        ) {
          continue;
        }
        if (!player.isAtWarWith(owner)) continue;
        const dist = this.mg.euclideanDistSquared(capitalTile, warship.tile());
        if (dist < closestDist) {
          closestDist = dist;
          closestEnemyWarship = warship;
        }
      }
    }

    if (closestEnemyWarship) {
      // Spawn near the port closest to that enemy warship
      let bestPort: TileRef | null = null;
      let bestPortDist = Infinity;
      for (const portTile of portTiles) {
        const d = this.mg.euclideanDistSquared(
          portTile,
          closestEnemyWarship.tile(),
        );
        if (d < bestPortDist) {
          bestPortDist = d;
          bestPort = portTile;
        }
      }
      return bestPort ? this.findOceanNearPort(bestPort) : null;
    }

    // No enemy warships — pick a random port
    const port = this.random.randElement(portTiles);
    return this.findOceanNearPort(port);
  }

  /**
   * Find a tile near a port for submarine placement.
   */
  private findNavalPlacementTile(player: Player): TileRef | null {
    const ports: TileRef[] = [];
    for (const port of this.mg.units(UnitType.Port)) {
      if (!port.isActive()) continue;
      if (port.owner().id() !== player.id()) continue;
      ports.push(port.tile());
    }
    if (ports.length === 0) return null;
    const port = this.random.randElement(ports);
    return this.findOceanNearPort(port);
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

  /**
   * Find an ocean tile near a port for naval unit spawning.
   * Searches a random area within a radius of the port for a valid ocean tile.
   */
  private findOceanNearPort(portTile: TileRef): TileRef | null {
    const radius = 250;
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = this.random.nextInt(
        this.mg.x(portTile) - radius,
        this.mg.x(portTile) + radius,
      );
      const randY = this.random.nextInt(
        this.mg.y(portTile) - radius,
        this.mg.y(portTile) + radius,
      );
      if (!this.mg.isValidCoord(randX, randY)) continue;
      const tile = this.mg.ref(randX, randY);
      if (!this.mg.isOcean(tile)) continue;
      return tile;
    }
    return null;
  }

  /**
   * Return the actual gold cost for building a unit at the player's current
   * tech level. Falls back to the base cost when there are no upgrades.
   */
  private unitCostAtLevel(player: Player, unitType: UnitCandidate): Gold {
    const level = playerMaxUnitLevel(player, unitType);
    if (level > 1) {
      const levelCost = getUnitLevelCost(unitType, level);
      if (levelCost > 0n) return levelCost;
    }
    return this.mg.unitInfo(unitType).cost(player);
  }

  private getPlayer(): Player | undefined {
    return this.mg.players().find((p) => p.id() === this.playerId);
  }
}
