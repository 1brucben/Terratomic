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

  // --- Warship patrol state ---
  /** The enemy warship we're currently patrolling near (null = no target). */
  private _patrolTargetUnit: Unit | null = null;
  /** Tick when we last updated warship patrol targets. */
  private _lastPatrolUpdateTick: number = -Infinity;
  /** Tick when we last repositioned warships along the coast. */
  private _lastCoastalRepositionTick: number = -Infinity;
  /** Tick when we last assigned idle (no-enemy) port patrol positions. */
  private _lastIdlePatrolTick: number = -Infinity;
  /** Set of warship IDs currently assigned to intercept transports. */
  private _interceptingWarshipIds: Set<number> = new Set();
  /** Previous set of intercepting warship IDs (for detecting freed warships). */
  private _prevInterceptingWarshipIds: Set<number> = new Set();
  /** When true, forces the next patrol update to run regardless of interval. */
  private _patrolDirty = true;

  /** How often (in ticks) to re-evaluate warship patrol targets. */
  private static readonly PATROL_UPDATE_INTERVAL = 60;
  /** How often (in ticks) to reposition warships along the coast. */
  private static readonly COASTAL_REPOSITION_INTERVAL = 600;
  /** How often (in ticks) to rescan enemy warship counts. */
  private static readonly WARSHIP_SCAN_INTERVAL = 50;
  /** Internal base constant for warship score numerator. */
  private static readonly WARSHIP_BASE_SCORE = 2.5e5;

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
      const prev = this._cachedEnemyMaxWarships;
      this.refreshEnemyWarshipCount(player);
      this._cachedEnemyWarshipsTick = ticks;
      // If the enemy fleet size changed, force an immediate patrol update
      if (this._cachedEnemyMaxWarships !== prev) {
        this._patrolDirty = true;
      }
    }
  }

  /**
   * Force the next patrol update to run immediately (e.g. after spawning
   * warships, or when war/peace state changes externally).
   */
  markPatrolDirty(): void {
    this._patrolDirty = true;
  }

  /**
   * Main tick for unit purchase decisions.
   * Called every tick by AIPlayerExecution (skipped when a nuke sequence is active).
   */
  tickUnitPurchase(ticks: number): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) return;

    // Pick best target if we don't have one
    this._target ??= this.pickTarget(player);
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

    // Immediately update patrol targets for all warships (including newly spawned)
    if (spawned > 0) {
      this.updateWarshipPatrol(player);
    }
  }

  /**
   * Main tick for unit movement decisions.
   * Called every tick by AIPlayerExecution.
   *
   * Periodically re-evaluates warship patrol targets:
   * - If enemy warships exist and we outnumber the strongest enemy fleet,
   *   all owned warships patrol near the nearest enemy warship.
   * - If enemy warships exist but we're outnumbered, all warships retreat
   *   to patrol near the nearest friendly port.
   * - If no enemy warships exist, warships patrol near the average
   *   position of own ports.
   */
  tickUnitMovement(ticks: number): void {
    const intervalElapsed =
      ticks - this._lastPatrolUpdateTick >=
      AIUnitHandler.PATROL_UPDATE_INTERVAL;
    if (!intervalElapsed && !this._patrolDirty) return;
    this._lastPatrolUpdateTick = ticks;
    this._patrolDirty = false;

    const player = this.getPlayer();
    if (!player || !player.isAlive()) return;

    this.updateWarshipPatrol(player);
  }

  /**
   * Core warship patrol update logic.
   * Priority order:
   * 1. Intercept incoming enemy transports targeting us
   * 2. Coastal defense mode (at war with stronger enemy, no land border)
   * 3. Enemy warship patrol / port patrol (original logic)
   */
  private updateWarshipPatrol(player: Player): void {
    const ownWarships = this.getOwnActiveWarships(player);
    if (ownWarships.length === 0) {
      this._patrolTargetUnit = null;
      this._interceptingWarshipIds.clear();
      return;
    }

    // --- Phase 1: Intercept incoming enemy transports ---
    const incomingTransports = this.findIncomingEnemyTransports(player);
    // Clean up interceptors that are no longer valid
    this._interceptingWarshipIds = new Set(
      [...this._interceptingWarshipIds].filter((id) =>
        ownWarships.some((ws) => ws.id() === id),
      ),
    );

    // Assign nearest un-assigned warship to each incoming transport
    const newlyAssigned = new Set<number>();
    for (const transport of incomingTransports) {
      const targetTile = (transport as any).boatTargetTile?.() as
        | TileRef
        | null
        | undefined;
      if (targetTile === null || targetTile === undefined) continue;

      // Find the interception point: a shoreline (ocean) tile near the transport's destination
      const interceptTile = this.findOceanNearTile(targetTile);
      if (interceptTile === null) continue;

      // Find the nearest available warship (prefer non-interceptors)
      let bestWs: Unit | null = null;
      let bestDist = Infinity;
      for (const ws of ownWarships) {
        if (newlyAssigned.has(ws.id())) continue;
        const d = this.mg.euclideanDistSquared(ws.tile(), interceptTile);
        // Prefer warships not already intercepting
        const penalty = this._interceptingWarshipIds.has(ws.id()) ? 0 : -1e9;
        if (d + penalty < bestDist) {
          bestDist = d + penalty;
          bestWs = ws;
        }
      }
      if (bestWs) {
        bestWs.setPatrolTile(interceptTile);
        bestWs.setTargetTile(undefined);
        newlyAssigned.add(bestWs.id());
      }
    }
    // Detect warships freed from interception duty — force them to get a
    // fresh patrol tile immediately so they don't linger at stale positions.
    const freedFromIntercept = new Set(
      [...this._prevInterceptingWarshipIds].filter(
        (id) => !newlyAssigned.has(id),
      ),
    );
    this._prevInterceptingWarshipIds = new Set(newlyAssigned);
    this._interceptingWarshipIds = newlyAssigned;

    // Warships not assigned to interception
    const freeWarships = ownWarships.filter(
      (ws) => !this._interceptingWarshipIds.has(ws.id()),
    );
    if (freeWarships.length === 0) return;

    // Clear stale patrol tiles on warships just freed from intercept duty
    for (const ws of freeWarships) {
      if (freedFromIntercept.has(ws.id())) {
        ws.setTargetTile(undefined);
      }
    }

    // --- Phase 2: Coastal defense mode ---
    if (this.shouldUseCoastalDefense(player)) {
      this.assignCoastalPatrol(player, freeWarships);
      return;
    }

    // --- Phase 3: Original enemy warship / port patrol logic ---
    this.assignStandardPatrol(player, freeWarships);
  }

  /**
   * Check if coastal defense mode should be active.
   * True when at war with a player that has higher military strength
   * and does not share a land border with us.
   */
  private shouldUseCoastalDefense(player: Player): boolean {
    const myStrength = player.militaryStrength();
    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (other.type() !== PlayerType.Human && other.type() !== PlayerType.AI)
        continue;
      if (!player.isAtWarWith(other)) continue;
      if (other.militaryStrength() > myStrength) {
        if (!player.sharesBorderWith(other)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Spread warships evenly along the player's coastal border.
   * Only repositions every COASTAL_REPOSITION_INTERVAL ticks.
   */
  private assignCoastalPatrol(player: Player, warships: Unit[]): void {
    if (
      this.mg.ticks() - this._lastCoastalRepositionTick <
      AIUnitHandler.COASTAL_REPOSITION_INTERVAL
    )
      return;
    this._lastCoastalRepositionTick = this.mg.ticks();

    const coastTiles = this.getCoastalBorderTiles(player);
    if (coastTiles.length === 0) {
      // Fallback to port patrol
      this.assignStandardPatrol(player, warships);
      return;
    }

    // Evenly distribute warships along the coast
    const step = Math.max(1, Math.floor(coastTiles.length / warships.length));
    for (let i = 0; i < warships.length; i++) {
      const coastIdx = Math.min(
        (i * step) % coastTiles.length,
        coastTiles.length - 1,
      );
      const coastTile = coastTiles[coastIdx];
      // Find an ocean tile near this shore tile for patrol
      const oceanTile = this.findOceanNearTile(coastTile);
      if (oceanTile !== null) {
        this.setPatrolIfChanged(warships[i], oceanTile);
      }
    }
  }

  /**
   * Get shoreline border tiles (land tiles owned by player that are adjacent to ocean).
   * Returns them sorted by position for even distribution.
   */
  private getCoastalBorderTiles(player: Player): TileRef[] {
    const border = player.borderTiles();
    const coastTiles: TileRef[] = [];
    for (const tile of border) {
      if (this.mg.isShore(tile)) {
        coastTiles.push(tile);
      }
    }
    // Sort by x then y for spatial consistency
    coastTiles.sort((a, b) => {
      const dx = this.mg.x(a) - this.mg.x(b);
      return dx !== 0 ? dx : this.mg.y(a) - this.mg.y(b);
    });
    return coastTiles;
  }

  /**
   * Find incoming enemy transport ships targeting this player.
   */
  private findIncomingEnemyTransports(player: Player): Unit[] {
    const transports: Unit[] = [];
    for (const ship of this.mg.units(UnitType.TransportShip)) {
      if (!ship.isActive()) continue;
      if (ship.owner().id() === player.id()) continue;
      if (ship.owner().isFriendly(player)) continue;
      const targetPID = (ship as any).boatTargetPlayerID?.() as
        | PlayerID
        | null
        | undefined;
      if (targetPID === player.id()) {
        transports.push(ship);
      }
    }
    return transports;
  }

  /**
   * Find a valid ocean tile near a given tile (for patrol/interception points).
   * Searches neighbors first, then expanding radius.
   */
  private findOceanNearTile(tile: TileRef): TileRef | null {
    // Check immediate neighbors
    for (const n of this.mg.neighbors(tile)) {
      if (this.mg.isOcean(n) && this.mg.isShoreline(n)) return n;
    }
    // Expand search radius
    const radius = 100;
    for (let attempts = 0; attempts < 30; attempts++) {
      const rx = this.random.nextInt(
        this.mg.x(tile) - radius,
        this.mg.x(tile) + radius,
      );
      const ry = this.random.nextInt(
        this.mg.y(tile) - radius,
        this.mg.y(tile) + radius,
      );
      if (!this.mg.isValidCoord(rx, ry)) continue;
      const t = this.mg.ref(rx, ry);
      if (this.mg.isOcean(t)) return t;
    }
    return null;
  }

  /**
   * Standard patrol logic (original behavior):
   * - If enemy warships exist and we outnumber them, patrol near enemy.
   * - If outnumbered, retreat to nearest friendly port.
   * - If no enemies, patrol near average port position.
   */
  private assignStandardPatrol(player: Player, warships: Unit[]): void {
    // Validate current patrol target is still alive and still an enemy
    if (this._patrolTargetUnit !== null) {
      if (
        !this._patrolTargetUnit.isActive() ||
        this._patrolTargetUnit.health() <= 0 ||
        !player.isAtWarWith(this._patrolTargetUnit.owner())
      ) {
        this._patrolTargetUnit = null;
      }
    }

    // Find the nearest enemy warship (to our capital)
    const nearestEnemy = this.findNearestEnemyWarship(player);

    if (nearestEnemy) {
      // Enemy warships exist — check strength comparison
      this.refreshEnemyWarshipCount(player);
      const enemyMax = this._cachedEnemyMaxWarships;
      const totalOwn = this.getOwnActiveWarships(player).length;

      if (totalOwn > enemyMax) {
        // We outnumber the strongest enemy fleet — patrol near enemy
        this._patrolTargetUnit = nearestEnemy;
        for (const ws of warships) {
          this.setPatrolIfChanged(ws, nearestEnemy.tile());
        }
      } else {
        // Outnumbered — retreat to nearest friendly port
        this._patrolTargetUnit = null;
        const portTile = this.findNearestPortToCapital(player);
        if (portTile !== null) {
          for (const ws of warships) {
            this.setPatrolIfChanged(ws, portTile);
          }
        }
      }
    } else {
      // No enemy warships — patrol near average position of own ports.
      // Only reposition every COASTAL_REPOSITION_INTERVAL to avoid
      // spamming setPatrolTile every 10 ticks when nothing has changed.
      this._patrolTargetUnit = null;
      if (
        this.mg.ticks() - this._lastIdlePatrolTick >=
        AIUnitHandler.COASTAL_REPOSITION_INTERVAL
      ) {
        this._lastIdlePatrolTick = this.mg.ticks();
        const avgPortTile = this.findAveragePortPosition(player);
        if (avgPortTile !== null) {
          for (const ws of warships) {
            this.setPatrolIfChanged(ws, avgPortTile);
          }
        }
      }
    }
  }

  /**
   * Set a warship's patrol tile only when it actually changed, to avoid
   * clearing in-progress pathfinding unnecessarily.
   */
  private setPatrolIfChanged(ws: Unit, newPatrol: TileRef): void {
    if (ws.patrolTile() === newPatrol) return;
    ws.setPatrolTile(newPatrol);
    ws.setTargetTile(undefined);
  }

  /**
   * Returns all active warships owned by this player.
   */
  private getOwnActiveWarships(player: Player): Unit[] {
    return player
      .units(UnitType.Warship)
      .filter((u) => u.isActive() && u.health() > 0);
  }

  /**
   * Find the nearest enemy warship to our capital (or first warship if no capital).
   * Only considers Human/AI players we're at war with.
   */
  private findNearestEnemyWarship(player: Player): Unit | null {
    const capital = player.capital();
    let refTile: TileRef | null = null;

    if (capital) {
      refTile = this.mg.ref(capital.x, capital.y);
    } else {
      // Fallback: use first owned warship's tile as reference
      const ownWs = player.units(UnitType.Warship).find((u) => u.isActive());
      if (ownWs) refTile = ownWs.tile();
    }
    if (refTile === null) return null;

    let closest: Unit | null = null;
    let closestDist = Infinity;

    for (const warship of this.mg.units(UnitType.Warship)) {
      if (!warship.isActive()) continue;
      const owner = warship.owner();
      if (owner.id() === player.id()) continue;
      if (owner.type() !== PlayerType.Human && owner.type() !== PlayerType.AI)
        continue;
      if (!player.isAtWarWith(owner)) continue;
      const dist = this.mg.euclideanDistSquared(refTile, warship.tile());
      if (dist < closestDist) {
        closestDist = dist;
        closest = warship;
      }
    }
    return closest;
  }

  /**
   * Find the nearest owned port tile to the player's capital.
   * Returns null if the player has no ports.
   */
  private findNearestPortToCapital(player: Player): TileRef | null {
    const capital = player.capital();
    let refTile: TileRef | null = null;

    if (capital) {
      refTile = this.mg.ref(capital.x, capital.y);
    }

    const ports: TileRef[] = [];
    for (const port of this.mg.units(UnitType.Port)) {
      if (!port.isActive()) continue;
      if (port.owner().id() !== player.id()) continue;
      ports.push(port.tile());
    }
    if (ports.length === 0) return null;

    // If no capital, just pick the first port
    if (refTile === null) return ports[0];

    let best: TileRef | null = null;
    let bestDist = Infinity;
    for (const portTile of ports) {
      const d = this.mg.euclideanDistSquared(refTile, portTile);
      if (d < bestDist) {
        bestDist = d;
        best = portTile;
      }
    }
    return best;
  }

  /**
   * Compute the average position of all owned ports and return the
   * nearest valid ocean tile to that centroid. Returns null if no ports.
   */
  private findAveragePortPosition(player: Player): TileRef | null {
    const ports: TileRef[] = [];
    for (const port of this.mg.units(UnitType.Port)) {
      if (!port.isActive()) continue;
      if (port.owner().id() !== player.id()) continue;
      ports.push(port.tile());
    }
    if (ports.length === 0) return null;
    if (ports.length === 1) return ports[0];

    // Compute centroid
    let sumX = 0;
    let sumY = 0;
    for (const p of ports) {
      sumX += this.mg.x(p);
      sumY += this.mg.y(p);
    }
    const avgX = Math.round(sumX / ports.length);
    const avgY = Math.round(sumY / ports.length);

    // Return the port tile closest to the centroid as the patrol point
    if (this.mg.isValidCoord(avgX, avgY)) {
      const centroid = this.mg.ref(avgX, avgY);
      let best: TileRef | null = null;
      let bestDist = Infinity;
      for (const p of ports) {
        const d = this.mg.euclideanDistSquared(centroid, p);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      return best;
    }

    // Fallback: just use the first port
    return ports[0];
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
   *   numerator = WARSHIP_BASE_SCORE
   *             + warshipTradeIncomeWeight  * globalTradeShipGoldPerMinute
   *             + warshipCoastalThreatWeight * coastalThreatIndicator
   *   score = (numerator * weightWarship) / (1 + r)^T
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

    // Build the numerator: base + trade-income component + coastal-threat component
    const tradeWeight = this.params.warshipTradeIncomeWeight ?? 0;
    const coastalWeight = this.params.warshipCoastalThreatWeight ?? 0;

    // Sum trade income across all players for a global moving average
    let globalTradeIncome = 0;
    for (const p of this.mg.players()) {
      globalTradeIncome += p.tradeShipGoldPerMinute();
    }
    const tradeComponent = tradeWeight * globalTradeIncome;
    const coastalIndicator = this.shouldUseCoastalDefense(player) ? 1 : 0;
    const coastalComponent = coastalWeight * coastalIndicator;

    const numerator =
      AIUnitHandler.WARSHIP_BASE_SCORE + tradeComponent + coastalComponent;

    return (numerator * weight) / Math.pow(1 + discountRate, T);
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
