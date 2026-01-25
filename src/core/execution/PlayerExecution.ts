import { Config } from "../configuration/Config";
import {
  Cell,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerType,
  Unit,
  UnitType,
  UpgradeType,
} from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { getTechNodes, isTechAvailable } from "../tech/ResearchTree";
import { researchEffectivenessModifiers } from "../tech/TechEffects";
import { calculateBoundingBox, getMode, inscribed, simpleHash } from "../Util";

// Traversal state for cluster calculation to avoid repeated allocations
interface ClusterTraversalState {
  visited: Uint32Array;
  gen: number;
}

// Per-game traversal state used by calculateClusters() to avoid per-player buffers.
const traversalStates = new WeakMap<Game, ClusterTraversalState>();

export class PlayerExecution implements Execution {
  executionName = "PlayerExecution";
  private config: Config;
  private mg: GameImpl;
  private active = true;
  private random: PseudoRandom | null = null;
  // Accumulate research "intensity" allocation since last innovation calculation
  private _researchAccum: Map<string, number> = new Map();
  // Cluster encircling check fields
  private lastCalc: number = 0;
  private readonly ticksPerClusterCalc = 20;

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg as GameImpl;
    this.config = mg.config();
    this.random = new PseudoRandom(ticks + simpleHash(this.player.id()));
  }

  tick(ticks: number) {
    this.player.decayRelations();
    this.player.units().forEach((u) => {
      const tileOwner = this.mg!.owner(u.tile());
      if (u.info().territoryBound) {
        if (tileOwner.isPlayer()) {
          if (tileOwner !== this.player) {
            this.mg!.player(tileOwner.id()).captureUnit(u);
          }
        } else {
          if (u.isActive()) {
            u.delete();
          }
        }
      }
    });

    if (!this.player.isAlive()) {
      // Player has no tiles, delete any remaining units and gold
      const gold = this.player.gold();
      this.player.removeGold(gold);
      this.player.units().forEach((u) => {
        if (
          u.type() !== UnitType.AtomBomb &&
          u.type() !== UnitType.HydrogenBomb &&
          u.type() !== UnitType.MIRVWarhead &&
          u.type() !== UnitType.MIRV
        ) {
          if (u.isActive()) {
            u.delete();
          }
        }
      });
      this.active = false;
      return;
    }

    const popInc =
      this.config.populationIncreaseRate(this.player) +
      this.player.hospitalReturns();
    this.player.resetHospitalReturns();
    this.player.addWorkers(popInc * (1 - this.player.targetTroopRatio()));
    this.player.addTroops(popInc * this.player.targetTroopRatio());
    // Compute gross gold from config (pre-investment), then apply both investments
    const grossGoldDouble = this.config.grossGoldAdditionRate(this.player);
    const grossGold = BigInt(
      Math.floor(Number.isFinite(grossGoldDouble) ? grossGoldDouble : 0),
    );

    const prodInvest = this.player.investmentRate?.() ?? 0; // 0..0.5 (clamped in PlayerImpl)
    const roadInvest = this.player.hasUpgrade(UpgradeType.Roads)
      ? (this.player.roadInvestmentRate?.() ?? 0)
      : 0;
    const researchInvest = this.player.researchInvestmentRate?.() ?? 0; // 0..1 (no gating)
    let totalInvest = prodInvest + roadInvest + researchInvest; // can exceed 1

    // Allow up to 110% total when treasury is positive, else cap at 100%
    const hasTreasury = this.player.gold() > 0n;
    const maxTotal = hasTreasury ? 1.1 : 1.0;
    if (totalInvest > maxTotal) totalInvest = maxTotal;

    // Net gold added this tick (can be negative when totalInvest > 1)
    let netGoldDouble = grossGoldDouble * (1 - totalInvest);
    if (!Number.isFinite(netGoldDouble)) netGoldDouble = 0;
    let netGold = BigInt(Math.floor(netGoldDouble));
    // Prevent gold from going below zero (server-side safety)
    if (netGold < 0n) {
      const goldNow = this.player.gold();
      if (goldNow + netGold < 0n) {
        netGold = -goldNow; // drain treasury to zero at most
      }
    }
    this.player.addGold(netGold);
    this.player.updateProductivity();
    // Record stats
    // Track net income after investment in stats
    this.mg.stats().goldWork(this.player, netGold);

    const adjustRate = this.config.troopAdjustmentRate(this.player);
    this.player.addTroops(adjustRate);
    this.player.removeWorkers(adjustRate);

    const alliances = Array.from(this.player.alliances());
    for (const alliance of alliances) {
      if (
        this.mg.ticks() - alliance.createdAt() >
        this.mg.config().allianceDuration()
      ) {
        alliance.expire();
      }
    }

    const embargoes = this.player.getEmbargoes();
    for (const embargo of embargoes) {
      if (
        embargo.isTemporary &&
        this.mg.ticks() - embargo.createdAt >
          this.mg.config().temporaryEmbargoDuration()
      ) {
        this.player.stopEmbargo(embargo.target);
      }
    }

    // Regenerate health of damaged buildings
    this.player.units().forEach((u) => {
      if (u.hasHealth() && u.health() < u.effectiveMaxHealth()) {
        u.modifyHealth(0.5);
      }
    });

    // Check for encircled clusters (bot-only annexing)
    if (ticks - this.lastCalc > this.ticksPerClusterCalc) {
      if (this.player.lastTileChange() > this.lastCalc) {
        this.lastCalc = ticks;
        const start = performance.now();
        this.removeClusters();
        const end = performance.now();
        if (end - start > 1000) {
          console.log(`player ${this.player.name()}, took ${end - start}ms`);
        }
      }
    }

    // Cleanup bomber target tracking map
    this.cleanupBomberTargets();

    // --- Research system per-tick processing ---
    this.tickResearch();
  }

  /**
   * Remove entries from bombersOnTarget map for units that no longer exist or are invalid.
   * Runs once per player per tick (not once per bomber) for efficiency.
   */
  private cleanupBomberTargets(): void {
    const keysToDelete: TileRef[] = [];
    for (const [tile, _count] of this.player.bombersOnTarget) {
      const units = this.mg.unitsAt(tile);
      if (units.length === 0 || !this.isValidBomberTarget(units[0])) {
        keysToDelete.push(tile);
      }
    }
    for (const key of keysToDelete) {
      this.player.bombersOnTarget.delete(key);
    }
  }

  /**
   * Check if a unit is a valid bomber target.
   * Must be active and owned by a player the bomber owner is at war with.
   */
  private isValidBomberTarget(unit: Unit): boolean {
    if (!unit.isActive()) return false;
    const owner = unit.owner();
    if (!owner.isPlayer()) return false;
    return this.player.isAtWarWith(owner);
  }

  private tickResearch() {
    // Ensure RNG and config are ready
    if (!this.random) return;

    // Determine research investment (gold) this tick and transform via f(x) = A * investment^B
    const grossGold = this.config.grossGoldAdditionRate(this.player);
    const investRate = (this.player as any).researchInvestmentRate?.() ?? 0;
    if (investRate <= 0 || grossGold <= 0) return;

    const investment = Math.max(0, grossGold * investRate);
    const B = this.config.researchBeta();
    let xTotal = Math.pow(investment, B);
    if (!Number.isFinite(xTotal) || xTotal <= 0) return;

    // Apply Research Lab multiplier: +40% for first, +20% for second, halving thereafter
    // Upgrades count as multiples via effectiveUnits (level-weighted)
    const labsEff = Math.max(
      0,
      (this.player as any).effectiveUnits?.(UnitType.ResearchLab) ?? 0,
    );
    if (labsEff > 0) {
      const boostSum = (0.4 * (1 - Math.pow(0.5, labsEff))) / (1 - 0.5); // geometric series
      const multiplier = 1 + boostSum; // caps at 1.8 as labs -> infinity
      xTotal *= multiplier;
    }

    // Apply tech-based research effectiveness multiplier
    const researchMods = researchEffectivenessModifiers(this.player);
    xTotal *= researchMods.effectivenessMul;

    // Build researched set and available techs
    const nodes = getTechNodes();
    const researched = new Set<string>();
    for (const n of nodes) {
      if ((this.player as any).hasResearchedTech?.(n.id)) researched.add(n.id);
    }
    const available = nodes.filter(
      (n) => !researched.has(n.id) && isTechAvailable(n.id, researched),
    );
    if (available.length === 0) {
      if (this.player.researchInvestmentRate?.() ?? 0 > 0) {
        this.player.setResearchInvestmentRate(0);
        this.mg.addUpdate(this.player.toUpdate());
      }
      return;
    }

    // Get all priorities and check which are available
    const allPriorities: Set<string> =
      (this.player as any).researchPriorities?.() ?? new Set();
    const availablePriorities = available.filter((n) =>
      allPriorities.has(n.id),
    );

    const k = this.config.researchK();
    const bMin = this.config.researchBeakerMin();
    const bMax = this.config.researchBeakerMax();

    // Helper to get node by id and same-category filtering
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const sameCat = (a: string, b: string) =>
      (byId.get(a)?.category ?? "") === (byId.get(b)?.category ?? "");

    // Build prerequisite path set for a target within same category, including only missing techs
    const buildMissingPrereqPath = (targetId: string): Set<string> => {
      const path = new Set<string>();
      const seen = new Set<string>();
      const dfs = (tid: string) => {
        if (seen.has(tid)) return;
        seen.add(tid);
        const node = byId.get(tid);
        if (!node) return;
        // If already available given current researched, stop here
        // We collect missing prereqs only
        const reqAll = (node.requiresAllOf ?? []).filter((p) =>
          sameCat(p, tid),
        );
        const reqOne = (node.requiresOneOf ?? []).filter((p) =>
          sameCat(p, tid),
        );

        // Handle requiresAllOf: include those not yet researched
        for (const r of reqAll) {
          if (!researched.has(r)) {
            path.add(r);
            dfs(r);
          }
        }
        // Handle requiresOneOf: if none are researched, choose one deterministically
        if (reqOne.length > 0 && !reqOne.some((p) => researched.has(p))) {
          // Choose the lower-level option first; fallback to first listed
          const sorted = [...reqOne].sort(
            (a, b) => (byId.get(a)?.level ?? 0) - (byId.get(b)?.level ?? 0),
          );
          const choice = sorted[0];
          if (choice && !researched.has(choice)) {
            path.add(choice);
            dfs(choice);
          }
        }
      };
      dfs(targetId);
      return path;
    };

    const alloc: Record<string, number> = {};
    if (allPriorities.size > 0 && availablePriorities.length === 0) {
      // Has priorities but none available: allocate 60% to the frontier of their missing prereqs
      const allPathSets = new Set<string>();
      for (const priorityId of allPriorities) {
        const pathSet = buildMissingPrereqPath(priorityId);
        pathSet.forEach((id) => allPathSets.add(id));
      }
      const frontier = available.filter((n) => allPathSets.has(n.id));
      if (frontier.length > 0) {
        const priorityShare = 0.6 * xTotal;
        const shareFrontier = priorityShare / frontier.length;
        for (const n of frontier)
          alloc[n.id] = (alloc[n.id] ?? 0) + shareFrontier;
        const others = available.filter((n) => !allPathSets.has(n.id));
        const remaining = xTotal - priorityShare;
        const shareOthers = others.length > 0 ? remaining / others.length : 0;
        for (const n of others) alloc[n.id] = (alloc[n.id] ?? 0) + shareOthers;
      } else {
        // Fallback: even split if no frontier identified
        const share = xTotal / available.length;
        for (const n of available) alloc[n.id] = share;
      }
    } else if (
      availablePriorities.length > 0 &&
      available.length > availablePriorities.length
    ) {
      // Some priorities available: 60% split among priorities, 40% among others
      const priorityShare = 0.6 * xTotal;
      const sharePriority = priorityShare / availablePriorities.length;
      for (const n of availablePriorities) {
        alloc[n.id] = sharePriority;
      }
      const others = available.filter((n) => !allPriorities.has(n.id));
      const share =
        others.length > 0 ? (xTotal - priorityShare) / others.length : 0;
      for (const n of others) alloc[n.id] = (alloc[n.id] ?? 0) + share;
    } else {
      // No priorities or all available are prioritized: even split
      const share = xTotal / available.length;
      for (const n of available) alloc[n.id] = share;
    }

    // Accumulate allocated intensity for each available tech
    for (const n of available) {
      const x = alloc[n.id] ?? 0;
      if (x <= 0) continue;
      const prev = this._researchAccum.get(n.id) ?? 0;
      this._researchAccum.set(n.id, prev + x);
    }

    // Only calculate innovation probability on the configured cadence
    const interval = this.config.researchIntervalTicks();
    if (interval > 0 && this.mg.ticks() % interval === 0) {
      const isHuman = this.player.type() === PlayerType.Human;
      for (const [techId, X] of this._researchAccum.entries()) {
        if (!Number.isFinite(X) || X <= 0) continue;
        const p = 1 - Math.exp(-k * X);
        const roll = this.random.next();
        if (roll < p) {
          // Success: award uniform beakers between [bMin, bMax] inclusive
          const beakers = this.random.nextInt(bMin, bMax + 1);
          const cost = byId.get(techId)?.cost ?? 0;
          const result = (this.player as any).addResearchBeakers?.(
            techId,
            beakers,
            cost,
          );
          if (result?.completed) {
            // completed via addResearchBeakers -> addResearchedTech side-effects
          }
        }
      }
      // Reset accumulators after processing the cadence boundary
      this._researchAccum.clear();
    }
  }

  /**
   * Encircle and annex bot clusters that are surrounded by a single enemy player.
   * Only applicable when this.player is a Bot (PlayerType.Bot).
   * Any player type (Human, AI, Bot) can annex a surrounded Bot.
   */
  private removeClusters() {
    // Only Bots can be encircled and annexed
    if (this.player.type() !== PlayerType.Bot) {
      return;
    }

    const clusters = this.calculateClusters();
    if (clusters.length === 0) return;

    // Find the largest cluster with a single linear scan (O(n)).
    let largestIndex = 0;
    let largestSize = clusters[0].size;
    for (let i = 1; i < clusters.length; i++) {
      const size = clusters[i].size;
      if (size > largestSize) {
        largestSize = size;
        largestIndex = i;
      }
    }

    const largestCluster = clusters[largestIndex];
    const largestClusterBox = calculateBoundingBox(this.mg, largestCluster);
    const surroundedBy = this.surroundedBySamePlayer(
      largestCluster,
      largestClusterBox,
    );
    if (surroundedBy && !this.player.isFriendly(surroundedBy)) {
      this.removeCluster(largestCluster);
    }

    // Process remaining clusters
    for (let i = 0; i < clusters.length; i++) {
      if (i === largestIndex) continue;
      const cluster = clusters[i];
      if (this.isSurrounded(cluster)) {
        const surroundingPlayer = this.getCapturingPlayer(cluster);
        if (surroundingPlayer) {
          this.removeCluster(cluster);
        }
      }
    }
  }

  private surroundedBySamePlayer(
    cluster: Set<TileRef>,
    clusterBox: { min: Cell; max: Cell },
  ): false | Player {
    const enemies = new Set<number>();
    for (const tile of cluster) {
      // Check if this tile has water access (ocean or lake) - escape route via boat
      let hasWaterAccess = false;
      this.mg.forEachNeighbor(tile, (n) => {
        if (!this.mg.isLand(n)) {
          hasWaterAccess = true;
        }
      });

      // If any tile has water access or is on map edge, not surrounded
      if (hasWaterAccess || this.mg.isOnEdgeOfMap(tile)) {
        return false;
      }

      // Check if there are any unowned neighbors (neutral territory = escape)
      let hasUnownedNeighbor = false;
      this.mg.forEachNeighbor(tile, (n) => {
        if (!this.mg?.hasOwner(n)) {
          hasUnownedNeighbor = true;
        }
      });
      if (hasUnownedNeighbor) {
        return false;
      }

      this.mg.forEachNeighbor(tile, (n) => {
        if (this.mg?.ownerID(n) !== this.player?.smallID()) {
          enemies.add(this.mg.ownerID(n));
        }
      });
      if (enemies.size !== 1) {
        return false;
      }
    }
    if (enemies.size !== 1) {
      return false;
    }
    const enemy = this.mg.playerBySmallID(Array.from(enemies)[0]) as Player;
    const enemyBox = calculateBoundingBox(this.mg, enemy.borderTiles());
    if (inscribed(enemyBox, clusterBox)) {
      return enemy;
    }
    return false;
  }

  private isSurrounded(cluster: Set<TileRef>): boolean {
    let hasEnemy = false;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const tr of cluster) {
      // Check if this tile has water access (ocean or lake) - escape route via boat
      let hasWaterAccess = false;
      this.mg.forEachNeighbor(tr, (n) => {
        if (!this.mg.isLand(n)) {
          hasWaterAccess = true;
        }
      });

      // If any tile has water access or is on map edge, not surrounded
      if (hasWaterAccess || this.mg.isOnEdgeOfMap(tr)) {
        return false;
      }

      this.mg.forEachNeighbor(tr, (n) => {
        if (
          this.mg?.owner(n).isPlayer() &&
          this.mg?.ownerID(n) !== this.player?.smallID()
        ) {
          hasEnemy = true;
          const x = this.mg.x(n);
          const y = this.mg.y(n);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      });
    }
    if (!hasEnemy) {
      return false;
    }
    const clusterBox = calculateBoundingBox(this.mg, cluster);
    const enemyBox = { min: new Cell(minX, minY), max: new Cell(maxX, maxY) };
    return inscribed(enemyBox, clusterBox);
  }

  private removeCluster(cluster: Set<TileRef>) {
    for (const t of cluster) {
      if (this.mg?.ownerID(t) !== this.player?.smallID()) {
        // Other removeCluster operations could change tile owners,
        // so double check.
        return;
      }
    }

    const capturing = this.getCapturingPlayer(cluster);
    if (capturing === null) {
      return;
    }

    const firstTile = cluster.values().next().value;
    const tiles = this.floodFillWithGen(
      this.bumpGeneration(),
      this.traversalState().visited,
      [firstTile],
      (tile, cb) => this.mg.forEachNeighbor(tile, cb),
      (tile) => this.mg.ownerID(tile) === this.player.smallID(),
    );

    if (this.player.numTilesOwned() === tiles.size) {
      const gold = this.player.gold();
      this.mg.displayMessage(
        `Conquered ${this.player.displayName()} received ${gold.toString()} gold`,
        MessageType.CONQUERED_PLAYER,
        capturing.id(),
        gold,
      );
      capturing.addGold(gold);
      this.player.removeGold(gold);

      // Record stats
      this.mg.stats().goldWar(capturing, this.player, gold);
    }

    for (const tile of tiles) {
      capturing.conquer(tile);
    }
  }

  private getCapturingPlayer(cluster: Set<TileRef>): Player | null {
    const neighborsIDs = new Set<number>();
    for (const t of cluster) {
      this.mg.forEachNeighbor(t, (neighbor) => {
        if (this.mg.ownerID(neighbor) !== this.player.smallID()) {
          neighborsIDs.add(this.mg.ownerID(neighbor));
        }
      });
    }

    let largestNeighborAttack: Player | null = null;
    let largestTroopCount: number = 0;
    for (const id of neighborsIDs) {
      const neighbor = this.mg.playerBySmallID(id);
      if (!neighbor.isPlayer() || this.player.isFriendly(neighbor)) {
        continue;
      }
      for (const attack of neighbor.outgoingAttacks()) {
        if (attack.target() === this.player) {
          if (attack.troops() > largestTroopCount) {
            largestTroopCount = attack.troops();
            largestNeighborAttack = neighbor;
          }
        }
      }
    }
    if (largestNeighborAttack !== null) {
      return largestNeighborAttack;
    }

    // fall back to getting mode if no attacks
    const mode = getMode(neighborsIDs);
    if (!this.mg.playerBySmallID(mode).isPlayer()) {
      return null;
    }
    const capturing = this.mg.playerBySmallID(mode);
    if (!capturing.isPlayer()) {
      return null;
    }
    return capturing;
  }

  private calculateClusters(): Set<TileRef>[] {
    const borderTiles = this.player.borderTiles();
    if (borderTiles.size === 0) return [];

    const state = this.traversalState();
    const currentGen = this.bumpGeneration();
    const visited = state.visited;

    const clusters: Set<TileRef>[] = [];

    for (const startTile of borderTiles) {
      if (visited[startTile] === currentGen) continue;

      const cluster = this.floodFillWithGen(
        currentGen,
        visited,
        [startTile],
        (tile, cb) => this.mg.forEachNeighborWithDiag(tile, cb),
        (tile) => borderTiles.has(tile),
      );
      clusters.push(cluster);
    }
    return clusters;
  }

  private traversalState(): ClusterTraversalState {
    const totalTiles = this.mg.width() * this.mg.height();
    let state = traversalStates.get(this.mg);
    if (!state || state.visited.length < totalTiles) {
      state = {
        visited: new Uint32Array(totalTiles),
        gen: 0,
      };
      traversalStates.set(this.mg, state);
    }
    return state;
  }

  private bumpGeneration(): number {
    const state = this.traversalState();
    state.gen++;
    if (state.gen === 0xffffffff) {
      state.visited.fill(0);
      state.gen = 1;
    }
    return state.gen;
  }

  private floodFillWithGen(
    currentGen: number,
    visited: Uint32Array,
    startTiles: TileRef[],
    neighborFn: (tile: TileRef, callback: (neighbor: TileRef) => void) => void,
    includeFn: (tile: TileRef) => boolean,
  ): Set<TileRef> {
    const result = new Set<TileRef>();
    const stack: TileRef[] = [];

    for (const start of startTiles) {
      if (visited[start] === currentGen) continue;
      if (!includeFn(start)) continue;
      visited[start] = currentGen;
      result.add(start);
      stack.push(start);
    }

    while (stack.length > 0) {
      const tile = stack.pop()!;
      neighborFn(tile, (neighbor) => {
        if (visited[neighbor] === currentGen) {
          return;
        }
        if (!includeFn(neighbor)) {
          return;
        }
        visited[neighbor] = currentGen;
        result.add(neighbor);
        stack.push(neighbor);
      });
    }

    return result;
  }

  owner(): Player {
    if (this.player === null) {
      throw new Error("Not initialized");
    }
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }
}
