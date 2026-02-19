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

  // --- Naval share EMA (refreshed every NAVAL_SHARE_SCAN_INTERVAL ticks) ---
  /** EMA of the military-strength-weighted share of enemies that are naval. [0, 1] */
  private _navalShareEMA = 0;
  private _lastNavalShareTick = -Infinity;

  // --- Global trade income cache (refreshed alongside warship count) ---
  private _cachedGlobalTradeIncome = 0;

  // --- Warship patrol state ---
  /** Set of warship IDs currently on default (coast) patrol. */
  private _availableWarshipIds: Set<number> = new Set();
  /** Enemy transport ID → own warship ID assigned to intercept it. */
  private _transportAssignments: Map<number, number> = new Map();
  /** Enemy warship ID → list of own warship IDs assigned to engage it (max 2). */
  private _warshipAssignments: Map<number, number[]> = new Map();
  /** Tick when default patrol positions were last refreshed. */
  private _lastDefaultPatrolTick: number = -Infinity;
  /** Tick when assigned (unavailable) warship patrol tiles were last refreshed. */
  private _lastAssignedPatrolTick: number = -Infinity;
  /** Tick when the assignment scan last ran. */
  private _lastAssignmentScanTick: number = -Infinity;

  /** How often (in ticks) to scan for enemy threats and (re)assign warships. */
  private static readonly ASSIGNMENT_SCAN_INTERVAL = 10;
  /** How often (in ticks) to refresh default patrol positions for available warships. */
  private static readonly DEFAULT_PATROL_INTERVAL = 600;
  /** How often (in ticks) to refresh patrol tiles for assigned (unavailable) warships. */
  private static readonly ASSIGNED_PATROL_INTERVAL = 300;
  /** How often (in ticks) to rescan enemy warship counts. */
  private static readonly WARSHIP_SCAN_INTERVAL = 50;
  /** How often (in ticks) to recompute the naval-share EMA. */
  private static readonly NAVAL_SHARE_SCAN_INTERVAL = 10;
  /**
   * EMA smoothing factor for naval share.
   * Window ≈ 600 ticks (1 minute), updated every 10 ticks → 60 samples.
   * alpha = 2 / (60 + 1) ≈ 0.0328.
   */
  private static readonly NAVAL_SHARE_EMA_ALPHA = 2 / 61;
  /** Internal base constant for warship score numerator. */
  private static readonly WARSHIP_BASE_SCORE = 2e5;

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
      this.refreshGlobalTradeIncome();
      this._cachedEnemyWarshipsTick = ticks;
    }

    if (
      ticks - this._lastNavalShareTick >=
      AIUnitHandler.NAVAL_SHARE_SCAN_INTERVAL
    ) {
      this.refreshNavalShareEMA(player);
      this._lastNavalShareTick = ticks;
    }
  }

  /**
   * Force the next default patrol refresh to run immediately (e.g. after
   * spawning warships, or when war/peace state changes externally).
   */
  markPatrolDirty(): void {
    this._lastDefaultPatrolTick = -Infinity;
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
      this.markPatrolDirty();
    }
  }

  /**
   * Main tick for unit movement decisions.
   * Called every tick by AIPlayerExecution.
   *
   * Every ASSIGNMENT_SCAN_INTERVAL ticks:
   * - Cleans up stale assignments (dead targets / own warships).
   * - Assigns 1 available warship per enemy transport targeting us (priority).
   * - Assigns up to 2 available warships per enemy warship.
   * - Freed warships return to available pool.
   *
   * Default patrol (every DEFAULT_PATROL_INTERVAL ticks):
   * - own ships < enemy max → spread along own coast.
   * - own ships >= enemy max → spread along enemy coast(s), fallback own coast.
   *
   * Assigned warships refresh patrol tiles every ASSIGNED_PATROL_INTERVAL ticks.
   */
  tickUnitMovement(ticks: number): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) return;

    const ownWarships = this.getOwnActiveWarships(player);
    if (ownWarships.length === 0) {
      this._availableWarshipIds.clear();
      this._transportAssignments.clear();
      this._warshipAssignments.clear();
      return;
    }

    const ownWarshipIds = new Set(ownWarships.map((ws) => ws.id()));

    // --- Assignment scan (every 10 ticks) ---
    const scanDue =
      ticks - this._lastAssignmentScanTick >=
      AIUnitHandler.ASSIGNMENT_SCAN_INTERVAL;
    if (scanDue) {
      this._lastAssignmentScanTick = ticks;
      this.updateAssignments(player, ownWarships, ownWarshipIds);
    }

    // --- Default patrol for available warships (every 600 ticks) ---
    const defaultPatrolDue =
      ticks - this._lastDefaultPatrolTick >=
      AIUnitHandler.DEFAULT_PATROL_INTERVAL;
    if (defaultPatrolDue) {
      this._lastDefaultPatrolTick = ticks;
      const available = ownWarships.filter((ws) =>
        this._availableWarshipIds.has(ws.id()),
      );
      if (available.length > 0) {
        this.assignDefaultPatrol(player, available);
      }
    }

    // --- Refresh assigned warship patrol tiles (every 300 ticks) ---
    const assignedPatrolDue =
      ticks - this._lastAssignedPatrolTick >=
      AIUnitHandler.ASSIGNED_PATROL_INTERVAL;
    if (assignedPatrolDue) {
      this._lastAssignedPatrolTick = ticks;
      this.refreshAssignedPatrolTiles(player, ownWarships);
    }
  }

  // ---------------------------------------------------------------------------
  // Assignment system
  // ---------------------------------------------------------------------------

  /**
   * Update warship assignments: clean stale, assign to transports (priority),
   * then to enemy warships (up to 2 each). Freed warships become available.
   */
  private updateAssignments(
    player: Player,
    ownWarships: Unit[],
    ownWarshipIds: Set<number>,
  ): void {
    // --- 1. Clean up stale transport assignments ---
    for (const [enemyId, ownId] of this._transportAssignments) {
      if (
        !ownWarshipIds.has(ownId) ||
        !this.isValidEnemyTransport(player, enemyId)
      ) {
        this._transportAssignments.delete(enemyId);
        // Own warship becomes available again (if still alive)
        if (ownWarshipIds.has(ownId)) {
          this._availableWarshipIds.add(ownId);
        }
      }
    }

    // --- 2. Clean up stale warship assignments ---
    for (const [enemyId, ownIds] of this._warshipAssignments) {
      const validOwn = ownIds.filter((id) => ownWarshipIds.has(id));
      if (!this.isValidEnemyWarship(player, enemyId) || validOwn.length === 0) {
        // Free all assigned warships
        for (const id of validOwn) {
          this._availableWarshipIds.add(id);
        }
        this._warshipAssignments.delete(enemyId);
      } else if (validOwn.length < ownIds.length) {
        // Some own warships died; keep the survivors assigned
        this._warshipAssignments.set(enemyId, validOwn);
      }
    }

    // Build set of all currently-assigned warship IDs
    const assignedIds = new Set<number>();
    for (const ownId of this._transportAssignments.values()) {
      assignedIds.add(ownId);
    }
    for (const ownIds of this._warshipAssignments.values()) {
      for (const id of ownIds) assignedIds.add(id);
    }

    // Any warship not in an assignment is available
    for (const ws of ownWarships) {
      if (!assignedIds.has(ws.id())) {
        this._availableWarshipIds.add(ws.id());
      }
    }
    // Remove dead warships from available
    for (const id of [...this._availableWarshipIds]) {
      if (!ownWarshipIds.has(id)) {
        this._availableWarshipIds.delete(id);
      }
    }

    // --- 3. Assign to enemy transports (priority) ---
    const incomingTransports = this.findIncomingEnemyTransports(player);
    for (const transport of incomingTransports) {
      if (this._transportAssignments.has(transport.id())) continue; // already assigned

      const ws = this.findNearestAvailable(ownWarships, transport.tile());
      if (ws) {
        this._transportAssignments.set(transport.id(), ws.id());
        this._availableWarshipIds.delete(ws.id());
        this.setPatrolToTransportTarget(ws, transport);
      } else {
        // No available — try to steal from warship assignment
        const stolen = this.stealFromWarshipAssignment(ownWarships);
        if (stolen) {
          this._transportAssignments.set(transport.id(), stolen.id());
          this._availableWarshipIds.delete(stolen.id());
          this.setPatrolToTransportTarget(stolen, transport);
        }
      }
    }

    // --- 4. Assign to enemy warships (up to 2 each) ---
    const enemyWarships = this.findAllEnemyWarships(player);
    for (const enemy of enemyWarships) {
      const existing = this._warshipAssignments.get(enemy.id()) ?? [];
      const needed = 2 - existing.length;
      if (needed <= 0) continue;

      for (let i = 0; i < needed; i++) {
        const ws = this.findNearestAvailable(ownWarships, enemy.tile());
        if (!ws) break;
        existing.push(ws.id());
        this._availableWarshipIds.delete(ws.id());
        this.setPatrolIfChanged(ws, enemy.tile());
      }
      if (existing.length > 0) {
        this._warshipAssignments.set(enemy.id(), existing);
      }
    }

    // --- 5. Newly-available warships get default patrol immediately ---
    const newlyAvailable = ownWarships.filter(
      (ws) =>
        this._availableWarshipIds.has(ws.id()) && !assignedIds.has(ws.id()),
    );
    // We don't wait for the 600-tick timer here — these just became free
    // and the old assignment set didn't have them, so give them a patrol now.
    // (This is a no-op if assignDefaultPatrol was just called.)
  }

  /**
   * Check if an enemy transport (by unit ID) is still a valid target.
   */
  private isValidEnemyTransport(player: Player, unitId: number): boolean {
    for (const ship of this.mg.units(UnitType.TransportShip)) {
      if (ship.id() !== unitId) continue;
      if (!ship.isActive()) return false;
      if (ship.owner().isFriendly(player)) return false;
      const targetPID = (ship as any).boatTargetPlayerID?.() as
        | PlayerID
        | null
        | undefined;
      return targetPID === player.id();
    }
    return false;
  }

  /**
   * Check if an enemy warship (by unit ID) is still a valid target.
   */
  private isValidEnemyWarship(player: Player, unitId: number): boolean {
    for (const ws of this.mg.units(UnitType.Warship)) {
      if (ws.id() !== unitId) continue;
      if (!ws.isActive() || ws.health() <= 0) return false;
      const owner = ws.owner();
      if (owner.id() === player.id()) return false;
      if (owner.type() !== PlayerType.Human && owner.type() !== PlayerType.AI)
        return false;
      return player.isAtWarWith(owner);
    }
    return false;
  }

  /**
   * Find all active enemy warships belonging to Human/AI players at war with us.
   */
  private findAllEnemyWarships(player: Player): Unit[] {
    const result: Unit[] = [];
    for (const ws of this.mg.units(UnitType.Warship)) {
      if (!ws.isActive() || ws.health() <= 0) continue;
      const owner = ws.owner();
      if (owner.id() === player.id()) continue;
      if (owner.type() !== PlayerType.Human && owner.type() !== PlayerType.AI)
        continue;
      if (!player.isAtWarWith(owner)) continue;
      result.push(ws);
    }
    return result;
  }

  /**
   * Find the nearest available warship to a given tile.
   */
  private findNearestAvailable(
    ownWarships: Unit[],
    tile: TileRef,
  ): Unit | null {
    let best: Unit | null = null;
    let bestDist = Infinity;
    for (const ws of ownWarships) {
      if (!this._availableWarshipIds.has(ws.id())) continue;
      const d = this.mg.euclideanDistSquared(ws.tile(), tile);
      if (d < bestDist) {
        bestDist = d;
        best = ws;
      }
    }
    return best;
  }

  /**
   * Steal a warship from a warship assignment (not transport — those have priority).
   * Picks the assignment with the most warships and removes the last one.
   */
  private stealFromWarshipAssignment(ownWarships: Unit[]): Unit | null {
    let bestKey: number | null = null;
    let bestLen = 0;
    for (const [enemyId, ownIds] of this._warshipAssignments) {
      if (ownIds.length > bestLen) {
        bestLen = ownIds.length;
        bestKey = enemyId;
      }
    }
    if (bestKey === null || bestLen === 0) return null;

    const ids = this._warshipAssignments.get(bestKey)!;
    const stolenId = ids.pop()!;
    if (ids.length === 0) {
      this._warshipAssignments.delete(bestKey);
    }
    return ownWarships.find((ws) => ws.id() === stolenId) ?? null;
  }

  /**
   * Set a warship's patrol tile to the target tile of an enemy transport.
   */
  private setPatrolToTransportTarget(ws: Unit, transport: Unit): void {
    const targetTile = (transport as any).boatTargetTile?.() as
      | TileRef
      | null
      | undefined;
    if (targetTile !== null && targetTile !== undefined) {
      const oceanTile = this.findOceanNearTile(targetTile);
      if (oceanTile !== null) {
        this.setPatrolIfChanged(ws, oceanTile);
        return;
      }
    }
    // Fallback: patrol near the transport itself
    this.setPatrolIfChanged(ws, transport.tile());
  }

  /**
   * Refresh patrol tiles for all assigned (unavailable) warships
   * so they track moving enemies.
   */
  private refreshAssignedPatrolTiles(
    player: Player,
    ownWarships: Unit[],
  ): void {
    const wsById = new Map<number, Unit>();
    for (const ws of ownWarships) wsById.set(ws.id(), ws);

    // Refresh transport-assigned warships
    for (const [enemyId, ownId] of this._transportAssignments) {
      const ownWs = wsById.get(ownId);
      if (!ownWs) continue;
      // Find the transport unit to get its current target tile
      for (const ship of this.mg.units(UnitType.TransportShip)) {
        if (ship.id() === enemyId && ship.isActive()) {
          this.setPatrolToTransportTarget(ownWs, ship);
          break;
        }
      }
    }

    // Refresh warship-assigned warships
    for (const [enemyId, ownIds] of this._warshipAssignments) {
      // Find the enemy warship's current position
      let enemyTile: TileRef | null = null;
      for (const ws of this.mg.units(UnitType.Warship)) {
        if (ws.id() === enemyId && ws.isActive()) {
          enemyTile = ws.tile();
          break;
        }
      }
      if (enemyTile === null) continue;
      for (const ownId of ownIds) {
        const ownWs = wsById.get(ownId);
        if (ownWs) {
          this.setPatrolIfChanged(ownWs, enemyTile);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Default patrol
  // ---------------------------------------------------------------------------

  /**
   * Default patrol for available warships:
   * - own ships < enemy max → spread along own coast.
   * - own ships >= enemy max → spread along enemy coast(s); fallback own coast.
   */
  private assignDefaultPatrol(player: Player, warships: Unit[]): void {
    if (warships.length === 0) return;

    const totalOwn = this.getOwnActiveWarships(player).length;
    const enemyMax = this._cachedEnemyMaxWarships;

    if (totalOwn < enemyMax) {
      // Outnumbered — patrol own coast
      const ownCoast = this.getCoastalBorderTiles(player);
      if (ownCoast.length > 0) {
        this.spreadWarshipsAlongCoast(warships, ownCoast);
      }
    } else {
      // At parity or above — patrol enemy coast(s)
      const enemyCoastTiles = this.collectEnemyCoastTiles(player);
      if (enemyCoastTiles.length > 0) {
        this.spreadWarshipsAlongCoast(warships, enemyCoastTiles);
      } else {
        // No enemy coast — fallback to own coast
        const ownCoast = this.getCoastalBorderTiles(player);
        if (ownCoast.length > 0) {
          this.spreadWarshipsAlongCoast(warships, ownCoast);
        }
      }
    }
  }

  /**
   * Collect coastal border tiles of all enemies we're at war with.
   * Returns them sorted by position for even distribution.
   */
  private collectEnemyCoastTiles(player: Player): TileRef[] {
    const tiles: TileRef[] = [];
    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (other.type() !== PlayerType.Human && other.type() !== PlayerType.AI)
        continue;
      if (!player.isAtWarWith(other)) continue;
      for (const tile of this.getCoastalBorderTiles(other)) {
        tiles.push(tile);
      }
    }
    tiles.sort((a, b) => {
      const dx = this.mg.x(a) - this.mg.x(b);
      return dx !== 0 ? dx : this.mg.y(a) - this.mg.y(b);
    });
    return tiles;
  }

  // ---------------------------------------------------------------------------
  // Coastal helpers
  // ---------------------------------------------------------------------------

  /**
   * Recompute the military-strength-weighted share of enemies that are
   * naval-only (no shared land border) and feed it into the EMA.
   *
   * navalShare = Σ(isNaval_i * milStr_i) / Σ(milStr_i)  ∈ [0, 1]
   *
   * Called every NAVAL_SHARE_SCAN_INTERVAL ticks from refreshCaches.
   */
  private refreshNavalShareEMA(player: Player): void {
    let totalWeight = 0;
    let navalWeight = 0;

    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (other.type() !== PlayerType.Human && other.type() !== PlayerType.AI)
        continue;
      if (!player.isAtWarWith(other)) continue;

      const strength = other.militaryStrength();
      totalWeight += strength;
      if (!player.sharesBorderWith(other)) {
        navalWeight += strength;
      }
    }

    const sample = totalWeight > 0 ? navalWeight / totalWeight : 0;
    const alpha = AIUnitHandler.NAVAL_SHARE_EMA_ALPHA;
    this._navalShareEMA = alpha * sample + (1 - alpha) * this._navalShareEMA;
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
   * Evenly distribute warships along a set of coastal tiles.
   * Each warship is assigned an ocean tile near an evenly-spaced shore tile.
   */
  private spreadWarshipsAlongCoast(
    warships: Unit[],
    coastTiles: TileRef[],
  ): void {
    if (coastTiles.length === 0 || warships.length === 0) return;
    const step = Math.max(1, Math.floor(coastTiles.length / warships.length));
    for (let i = 0; i < warships.length; i++) {
      const coastIdx = Math.min(
        (i * step) % coastTiles.length,
        coastTiles.length - 1,
      );
      const coastTile = coastTiles[coastIdx];
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
   * Returns all active warships owned by this player.
   */
  private getOwnActiveWarships(player: Player): Unit[] {
    return player
      .units(UnitType.Warship)
      .filter((u) => u.isActive() && u.health() > 0);
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
   *             + warshipCoastalThreatWeight * navalShareEMA
   *   score = (numerator * weightWarship) / (1 + r)^T
   *
   * where T = minutes to fund (enemyMax + 1) warships at current income,
   * and navalShareEMA is an exponential moving average [0,1] of the
   * military-strength-weighted share of enemies that are naval-only.
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

    // Use cached global trade income (refreshed every WARSHIP_SCAN_INTERVAL ticks)
    const globalTradeIncome = this._cachedGlobalTradeIncome;
    const tradeComponent = tradeWeight * globalTradeIncome;
    const coastalComponent = coastalWeight * this._navalShareEMA;

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

  /**
   * Cache the sum of tradeShipGoldPerMinute across all players.
   * Called alongside refreshEnemyWarshipCount (every WARSHIP_SCAN_INTERVAL ticks).
   */
  private refreshGlobalTradeIncome(): void {
    let total = 0;
    for (const p of this.mg.players()) {
      total += p.tradeShipGoldPerMinute();
    }
    this._cachedGlobalTradeIncome = total;
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
