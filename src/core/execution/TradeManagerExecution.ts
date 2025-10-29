import {
  Cell,
  Execution,
  Game,
  Player,
  PlayerType,
  Tick,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";

type PairKey = string; // `${fromId}->${toId}`

interface DemandRoute {
  from: Player;
  to: Player;
}

/**
 * Centralized trade system:
 * - Accumulates bilateral demand via gravity model every N ticks
 * - Maintains a FIFO demand queue; when demand >= 1, enqueues route
 * - Each port supplies X trade ships (default 1) available for assignment
 * - Assigns routes to available ships, moving them to start port then to end port
 * - On completion, awards fixed income split between both traders and the ship owner
 * - Handles replacement timers for new/lost trade ships per port
 */
export class TradeManagerExecution implements Execution {
  private mg!: Game;
  private active = true;
  private lastDemandTick: Tick = -1;
  private demand: Map<PairKey, number> = new Map();
  private queue: DemandRoute[] = [];
  // Periodic logger for queue length
  private queueLogIntervalId: any;
  // Port -> replacement due tick (if scheduled)
  private replacementDueAt: Map<number /*portUnitID*/, Tick> = new Map();
  // Track last-known owner for each port to detect captures
  private portOwnerById: Map<number /*portUnitID*/, Player> = new Map();
  // Track trade ships to detect losses (capture/deletion) and their home ports
  private shipOwnerById: Map<number, Player> = new Map();
  private shipHomePortById: Map<number, number /*portUnitID*/> = new Map();
  private knownPortIds: Set<number> = new Set();

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    // Start periodic queue length logging (every 5 seconds)
    if (!this.queueLogIntervalId) {
      this.queueLogIntervalId = setInterval(() => {
        // Keep lightweight and consistent with other [TRADE] logs
        console.log(`[TRADE] queue length=${this.queue.length}`);
      }, 5000);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  tick(ticks: number): void {
    if (!this.active) return;

    // 1) Periodic gravity-based demand accumulation
    const interval = this.mg.config().tradeDemandTickInterval();
    if (this.lastDemandTick === -1) this.lastDemandTick = ticks;
    if (ticks - this.lastDemandTick >= interval) {
      this.lastDemandTick = ticks;
      this.accumulateDemand();
    }

    // 2) Maintain per-port replacement timers and spawn replacements when due
    this.processPortSupply(ticks);

    // 3) Drop any queued routes that are now embargoed
    this.pruneEmbargoedRoutes();

    // 4) Assign ships to queued routes when available
    this.assignRoutes();
  }

  private playersForTrade(): Player[] {
    // Consider all non-bot players who currently have at least one port,
    // regardless of territory (alive()). This aligns with spec: exclude bots.
    return this.mg
      .players()
      .filter(
        (p) => p.type() !== PlayerType.Bot && p.units(UnitType.Port).length > 0,
      );
  }

  private pruneEmbargoedRoutes(): void {
    const before = this.queue.length;
    if (before === 0) return;
    this.queue = this.queue.filter(({ from, to }) => {
      // Remove routes where either side embargoes the other
      return !(from.hasEmbargoAgainst(to) || to.hasEmbargoAgainst(from));
    });
  }

  private key(from: Player, to: Player): PairKey {
    return `${from.id()}->${to.id()}`;
  }

  private accumulateDemand(): void {
    const K = this.mg.config().tradeGravityK();
    // World GDP = sum of all alive players' GDPs (bots and humans)
    const worldGDP = this.mg
      .players()
      .filter((p) => p.isAlive())
      .reduce((sum, p) => sum + p.gdp(), 0);
    const players = this.playersForTrade();
    for (let i = 0; i < players.length; i++) {
      for (let j = 0; j < players.length; j++) {
        if (i === j) continue;
        const a = players[i];
        const b = players[j];
        // If either side has an embargo against the other, demand is zero
        if (a.hasEmbargoAgainst(b) || b.hasEmbargoAgainst(a)) {
          // Keep fractional demand at 0 for this pair
          this.demand.set(this.key(a, b), 0);
          continue;
        }
        const capA = a.capital();
        const capB = b.capital();
        if (capA === null || capB === null) continue;

        const dist = this.capitalDistance(capA, capB);
        if (dist <= 0) continue;
        // New gravity model scaling:
        // demand += K * gdp_i * gdp_j / distance / world_gdp
        // Safeguard zero world GDP
        const demandDelta =
          worldGDP > 0 ? (K * a.gdp() * b.gdp()) / dist / worldGDP : 0;
        const k = this.key(a, b);
        const prev = this.demand.get(k) ?? 0;
        const next = prev + demandDelta;
        // Enqueue integer demand, keep fractional remainder
        if (next >= 1) {
          const count = Math.floor(next);
          for (let c = 0; c < count; c++) {
            this.queue.push({ from: a, to: b });
          }
          this.demand.set(k, next - count);
        } else {
          this.demand.set(k, next);
        }
      }
    }
  }

  private capitalDistance(a: Cell, b: Cell): number {
    const refA = this.mg.ref(a.x, a.y);
    const refB = this.mg.ref(b.x, b.y);
    return Math.sqrt(this.mg.euclideanDistSquared(refA, refB));
  }

  // (removed) nearestOceanWithin helper was unused after direct undocking implementation

  private processPortSupply(ticks: Tick): void {
    const perPort = this.mg.config().tradeShipPerPortSupply();
    const delay = this.mg.config().tradeShipReplacementDelayTicks();

    // 1) Update current home-port assignments and track current owners
    const currentShipIds = new Set<number>();
    const shipsSnapshot = [...this.mg.units(UnitType.TradeShip)];
    for (const ship of shipsSnapshot) {
      // Remove trade ships owned by eliminated players
      if (!ship.owner().isAlive()) {
        // Delete without messages; considered a consequence of elimination
        ship.delete(false);
        // Clean up tracking
        const sid = ship.id();
        this.shipOwnerById.delete(sid);
        this.shipHomePortById.delete(sid);
        continue;
      }
      if (!ship.isActive()) continue;
      const sid = ship.id();
      currentShipIds.add(sid);
      const prevOwner = this.shipOwnerById.get(sid);
      const currOwner = ship.owner();
      if (prevOwner && prevOwner !== currOwner) {
        // Captured by another nation -> schedule replacement for its last known home port
        const homePortId = this.shipHomePortById.get(sid);
        if (homePortId !== undefined) {
          const port = this.mg
            .units(UnitType.Port)
            .find((p) => p.id() === homePortId && p.isActive());
          if (port && this.activeHomeSupplyCount(port) < perPort) {
            if (!this.replacementDueAt.has(homePortId)) {
              this.replacementDueAt.set(homePortId, ticks + delay);
            }
          }
        }
        // Clear home assignment after capture
        this.shipHomePortById.delete(sid);
      }
      this.shipOwnerById.set(sid, currOwner);

      // If idle and docked at own port (on the port tile), assign/update home port
      if (ship.targetUnit() === undefined) {
        const dockPort = this.mg
          .unitsAt(ship.tile())
          .find(
            (u) => u.type() === UnitType.Port && u.owner() === currOwner,
          ) as Unit | undefined;
        if (dockPort) this.shipHomePortById.set(sid, dockPort.id());
      }
    }
    // Detect deletions (sunk etc.) -> schedule replacement at last known home port
    for (const [sid, prevOwner] of Array.from(this.shipOwnerById.entries())) {
      if (!currentShipIds.has(sid)) {
        const homePortId = this.shipHomePortById.get(sid);
        if (homePortId !== undefined) {
          const port = this.mg
            .units(UnitType.Port)
            .find((p) => p.id() === homePortId && p.isActive());
          if (port && this.activeHomeSupplyCount(port) < perPort) {
            if (!this.replacementDueAt.has(homePortId)) {
              this.replacementDueAt.set(homePortId, ticks + delay);
            }
          }
        }
        this.shipOwnerById.delete(sid);
        this.shipHomePortById.delete(sid);
      }
    }

    // 2) Handle new ports: schedule initial supply if needed
    const currentPortIds = new Set<number>();
    for (const port of this.mg.units(UnitType.Port)) {
      if (!port.isActive()) continue;
      currentPortIds.add(port.id());
      // Detect ownership change of an existing port
      const prevOwner = this.portOwnerById.get(port.id());
      if (prevOwner && prevOwner !== port.owner()) {
        // Port captured: ensure new owner can reach per-port supply target
        if (this.activeHomeSupplyCount(port) < perPort) {
          if (!this.replacementDueAt.has(port.id())) {
            this.replacementDueAt.set(port.id(), ticks + delay);
          }
        }
      }
      // Track current owner
      this.portOwnerById.set(port.id(), port.owner());
      if (!this.knownPortIds.has(port.id())) {
        // New port detected
        if (this.activeHomeSupplyCount(port) < perPort) {
          if (!this.replacementDueAt.has(port.id())) {
            this.replacementDueAt.set(port.id(), ticks + delay);
          }
        }
        this.knownPortIds.add(port.id());
      }
    }
    // Clear ports that no longer exist
    for (const pid of Array.from(this.knownPortIds)) {
      if (!currentPortIds.has(pid)) {
        this.knownPortIds.delete(pid);
        this.portOwnerById.delete(pid);
      }
    }

    // 3) Spawn replacements that are due (but only if still below target supply)
    for (const [portID, due] of Array.from(this.replacementDueAt.entries())) {
      if (ticks < due) continue;
      const port = this.mg
        .units(UnitType.Port)
        .find((p) => p.id() === portID && p.isActive());
      if (!port) {
        this.replacementDueAt.delete(portID);
        continue;
      }
      // No adjacency restriction: ships will undock directly to the nearest ocean
      if (this.activeHomeSupplyCount(port) >= perPort) {
        // Supply already satisfied; drop schedule
        this.replacementDueAt.delete(portID);
        continue;
      }
      const owner = port.owner();
      const requested = port.tile();
      const spawn = owner.canBuild(UnitType.TradeShip, requested);
      if (spawn !== false) {
        const hasPortAtSpawn = this.mg
          .unitsAt(spawn)
          .some((u) => u.type() === UnitType.Port);
        if (hasPortAtSpawn) {
          const newShip = owner.buildUnit(UnitType.TradeShip, spawn, {
            targetUnit: port,
          });
          // Immediately clear target to mark the ship as idle/available at the port
          newShip.setTargetUnit(undefined);
          // Assign home to this port
          this.shipOwnerById.set(newShip.id(), newShip.owner());
          this.shipHomePortById.set(newShip.id(), portID);
        }
      }
      // Whether it succeeded or not, reset timer to avoid spamming
      this.replacementDueAt.delete(portID);
    }
  }

  private selectRandomPort(player: Player): Unit | null {
    const ports = player.units(UnitType.Port).filter((p) => p.isActive());
    if (ports.length === 0) return null;
    const idx = Math.floor(Math.random() * ports.length);
    return ports[idx];
  }

  private availableShips(): Unit[] {
    const ships: Unit[] = [];
    for (const ship of this.mg.units(UnitType.TradeShip)) {
      if (!ship.isActive()) continue;
      // Do not consider ships that are flagged as returning
      if (ship.returning()) continue;
      // Idle and docked: considered available
      if (ship.targetUnit() !== undefined) continue;
      // Consider available if docked at ANY port tile (regardless of owner)
      const isDockedAtAnyPort = this.mg
        .unitsAt(ship.tile())
        .some((u) => u.type() === UnitType.Port);
      if (!isDockedAtAnyPort) continue;
      ships.push(ship);
    }
    return ships;
  }

  private activeHomeSupplyCount(port: Unit): number {
    let count = 0;
    const pid = port.id();
    for (const ship of this.mg.units(UnitType.TradeShip)) {
      if (!ship.isActive()) continue;
      if (ship.owner() !== port.owner()) continue;
      if (this.shipHomePortById.get(ship.id()) === pid) count++;
    }
    return count;
  }

  private assignRoutes(): void {
    if (this.queue.length === 0) return;
    const available = this.availableShips();
    if (available.length === 0) return;

    // Assign as many routes as possible this tick while ships and routes are available
    while (this.queue.length > 0 && available.length > 0) {
      // Peek next route; if endpoints invalid, skip it (drop) to avoid blocking
      const next = this.queue[0];
      const startPort = this.selectRandomPort(next.from);
      const endPort = this.selectRandomPort(next.to);
      if (!startPort || !endPort) {
        // Can't satisfy this route right now (no ports); drop it
        this.queue.shift();
        continue;
      }

      // Pick a random available ship (uniform) and remove it from availability for this tick
      const idx = Math.floor(Math.random() * available.length);
      const [ship] = available.splice(idx, 1);

      // Assign: set target to start port if not already there; execution will handle moves
      this.queue.shift();
      this.mg.addExecution(
        new AssignedTradeRouteExecution(ship, startPort, endPort),
      );
    }
  }
}

export class AssignedTradeRouteExecution implements Execution {
  private mg!: Game;
  private path!: PathFinder;
  private active = true;
  private phase: "toStart" | "toEnd" = "toStart";
  private lastMoveTick = 0;
  private lastPort: Unit | null = null;

  constructor(
    private ship: Unit,
    private startPort: Unit,
    private endPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.path = PathFinder.Mini(mg, 2500);
    this.lastMoveTick = ticks;
    // Ensure ship is not in a stale 'returning' state from a prior turnaround
    this.ship.setReturning(false);
    // Store route owners on the ship for warship logic
    this.ship.setTradeRouteOwners(this.startPort.owner(), this.endPort.owner());
    // Load cargo equal to the route's fixed income; used if captured and returned
    this.ship.setCargoGold(this.mg.config().tradeIncomeFixed());
    // Record last port visited at assignment time (only if currently on a port tile)
    const dockPort = this.mg
      .unitsAt(this.ship.tile())
      .find((u) => u.type() === UnitType.Port) as Unit | undefined;
    this.lastPort = dockPort ?? null;

    // (removed) assignment-time debug logs
  }
  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  tick(ticks: number): void {
    if (!this.active) return;
    if (!this.ship.isActive()) {
      this.active = false;
      return;
    }
    // Determine where this ship should be heading this tick
    let expectedTargetUnit =
      this.phase === "toStart" ? this.startPort : this.endPort;
    if (this.ship.returning()) {
      expectedTargetUnit = this.lastPort ?? this.startPort;
    }
    // If the DESTINATION (expected target) was destroyed:
    // - If not already returning, turn around (return to last port if valid; else any domestic port).
    // - If already returning and that port is gone, pick a different domestic port.
    if (!expectedTargetUnit.isActive()) {
      const domesticFallback = this.selectRandomDomesticPort(this.ship.owner());
      if (!this.ship.returning()) {
        const fallback =
          this.lastPort && this.lastPort.isActive()
            ? this.lastPort
            : domesticFallback;
        if (fallback) {
          this.ship.setReturning(true);
          this.ship.setTargetUnit(fallback);
        } else {
          // Nowhere sensible to return to -> scuttle the ship
          this.ship.delete(false);
          this.active = false;
        }
      } else {
        if (domesticFallback) {
          this.ship.setTargetUnit(domesticFallback);
        } else {
          // Already returning but no valid fallback -> scuttle the ship
          this.ship.delete(false);
          this.active = false;
        }
      }
      return;
    }
    // If some external order changed the target while not returning, stop this assignment
    // Allow initial assignment where target is still undefined; we'll set it below.
    if (
      !this.ship.returning() &&
      this.ship.targetUnit() !== undefined &&
      this.ship.targetUnit() !== expectedTargetUnit
    ) {
      this.active = false;
      return;
    }
    // Ensure the ship's target matches the expected target we will navigate to
    if (this.ship.targetUnit() !== expectedTargetUnit) {
      this.ship.setTargetUnit(expectedTargetUnit);
    }

    // Move at default cadence (every tick)
    if (ticks - this.lastMoveTick < 1) return;
    this.lastMoveTick = ticks;

    const targetTile: TileRef = expectedTargetUnit.tile();

    // If adjacent to expected target port, dock onto the port tile and handle arrival
    if (this.mg.manhattanDist(this.ship.tile(), targetTile) === 1) {
      this.ship.move(targetTile);
      // Update lastPort upon docking
      const portHere = this.mg
        .unitsAt(targetTile)
        .find((u) => u.type() === UnitType.Port) as Unit | undefined;
      if (portHere) this.lastPort = portHere;
      // (removed) arrival logs for human-owned trade ships
      if (this.ship.returning()) {
        // Clear returning state upon successful return dock
        this.ship.setReturning(false);
        // Cancel route on return to last port
        this.ship.setTargetUnit(undefined);
        this.ship.setTradeRouteOwners(null, null);
        this.ship.setCargoGold(0n);
        this.active = false;
        return;
      }
      if (this.phase === "toStart") {
        // Arrived at start; proceed to end
        this.phase = "toEnd";
        this.ship.setTargetUnit(this.endPort);
        return;
      }
      // Arrived at end
      this.complete();
      return;
    }

    // Compute a navigable water target near the destination port
    const navTarget = this.navTargetForPort(targetTile);
    if (navTarget === null) {
      // Cannot navigate to this port (no adjacent ocean). End assignment.
      this.active = false;
      return;
    }

    // If on land (port tile), leave port directly onto ocean: prefer adjacent ocean; otherwise jump to nearest ocean within a small radius.
    if (!this.mg.isOcean(this.ship.tile())) {
      const here = this.ship.tile();
      // Must be docked at a port to undock
      const dockPort = this.mg
        .unitsAt(here)
        .find((u) => u.type() === UnitType.Port) as Unit | undefined;
      if (!dockPort) {
        // On land without a port; do not move. End assignment.
        this.active = false;
        return;
      }
      // Try an adjacent ocean step first
      const adjOcean = this.mg
        .neighbors(here)
        .filter((t) => this.mg.isOcean(t))
        .sort(
          (a, b) =>
            this.mg.manhattanDist(a, navTarget) -
            this.mg.manhattanDist(b, navTarget),
        );
      if (adjOcean.length > 0) {
        this.ship.move(adjOcean[0]);
        return;
      }
      // No adjacent ocean: do not jump; end assignment
      this.active = false;
      return;
    }

    if (this.ship.tile() === targetTile) {
      // Ensure lastPort is set if we're already on the port tile
      if (!this.lastPort) {
        const portHere = this.mg
          .unitsAt(targetTile)
          .find((u) => u.type() === UnitType.Port) as Unit | undefined;
        if (portHere) this.lastPort = portHere;
      }
      // (removed) arrival logs when already on port tile
      if (this.ship.returning()) {
        // Clear returning state upon successful return dock
        this.ship.setReturning(false);
        this.ship.setTargetUnit(undefined);
        this.active = false;
        return;
      }
      if (this.phase === "toStart") {
        this.phase = "toEnd";
        this.ship.setTargetUnit(this.endPort);
        return;
      }
      this.complete();
      return;
    }

    const res = this.path.nextTile(this.ship.tile(), navTarget);
    switch (res.type) {
      case PathFindResultType.Completed:
        this.ship.move(navTarget);
        break;
      case PathFindResultType.Pending:
        this.ship.move(this.ship.tile());
        break;
      case PathFindResultType.NextTile:
        this.ship.move(res.node);
        break;
      case PathFindResultType.PathNotFound:
        // Path cannot be found; end assignment
        this.active = false;
        break;
    }
  }

  private complete(): void {
    // Award fixed income split between traders and ship owner
    const total = this.mg.config().tradeIncomeFixed();
    const third = total / 3n;
    const remainder = total - third * 3n;
    const owner = this.ship.owner();
    const a = this.startPort.owner();
    const b = this.endPort.owner();
    a.addGold(third);
    b.addGold(third);
    owner.addGold(third + remainder);

    this.ship.setTargetUnit(undefined);
    this.ship.setTradeRouteOwners(null, null);
    this.ship.setCargoGold(0n);
    this.active = false;
  }

  // Pick an ocean tile adjacent to the port (targetTile) as navigation target
  private navTargetForPort(portTile: TileRef): TileRef | null {
    if (this.mg.isOcean(portTile)) return portTile;
    const candidates = this.mg
      .neighbors(portTile)
      .filter((t) => this.mg.isOcean(t));
    if (candidates.length === 0) return null;
    candidates.sort(
      (a, b) =>
        this.mg.manhattanDist(this.ship.tile(), a) -
        this.mg.manhattanDist(this.ship.tile(), b),
    );
    return candidates[0];
  }

  // Removed unused shoreline stepping helpers

  // Pick any active port owned by the given owner
  private selectRandomDomesticPort(owner: Player): Unit | null {
    const ports = this.mg
      .units(UnitType.Port)
      .filter((p) => p.isActive() && p.owner() === owner);
    if (ports.length === 0) return null;
    const idx = Math.floor(Math.random() * ports.length);
    return ports[idx];
  }

  // Abort this trade assignment: clear any route metadata and leave ship idle
  private abort(): void {
    this.ship.setTargetUnit(undefined);
    this.ship.setTradeRouteOwners(null, null);
    this.ship.setCargoGold(0n);
    this.ship.setReturning(false);
    this.active = false;
  }
}
