import {
  Execution,
  Game,
  isStructureType,
  isUnit,
  OwnerComp,
  TerrainType,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { TileRef } from "../game/GameMap";
import { PriorityQueue } from "../game/PriorityQueue";
import { getArtilleryLevelData } from "../game/UnitUpgrades";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

export class ArtilleryExecution implements Execution {
  private random: PseudoRandom;
  private artillery: Unit;
  private mg: GameImpl;
  private allowedOwners: Set<number>;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();
  private lastTargetScan = 0;
  private lastMove = 0; // Track last movement tick for 50% speed reduction
  private shellsFiredInBarrage = 0; // Track shells fired in current barrage (0-3)
  private barrageStartTick = 0; // Track when current barrage started

  // Path caching to avoid A* every move tick
  private cachedPath: TileRef[] = [];
  private cachedPathTarget: TileRef | null = null;

  constructor(
    private input: (UnitParams<UnitType.Artillery> & OwnerComp) | Unit,
    private desiredLevel: number = 1,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg as GameImpl;
    this.random = new PseudoRandom(mg.ticks());
    this.allowedOwners = new Set<number>();
    if (isUnit(this.input)) {
      this.artillery = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Artillery,
        this.input.patrolTile,
      );
      if (spawn === false) {
        return;
      }
      this.artillery = this.input.owner.buildUnit(UnitType.Artillery, spawn, {
        patrolTile: this.input.patrolTile,
      });
      const lvl = Math.max(1, this.desiredLevel | 0);
      if (lvl > 1) {
        (this.artillery as any)._level = lvl;
        // Apply per-level max health boost
        const base =
          this.mg.config().unitInfo(UnitType.Artillery).maxHealth ?? 1000;
        const desired = this.mg.config().artilleryLevelMaxHealth(lvl);
        const bonus = Math.max(0, desired - base);
        (this.artillery as any)._bonusMaxHealth = bonus;
        (this.artillery as any)._health = BigInt(desired);
        this.mg.addUpdate(this.artillery.toUpdate());
      }
    }
    // Build allowed owner set (own + friendly) like road pathing
    const owner = this.artillery.owner();
    this.allowedOwners.add(owner.smallID());
    for (const p of this.mg.players()) {
      if (p.smallID() !== owner.smallID() && owner.isFriendly(p)) {
        this.allowedOwners.add(p.smallID());
      }
    }
  }

  tick(ticks: number): void {
    if (this.artillery.health() <= 0) {
      this.artillery.delete();
      return;
    }

    // Destroy artillery if its tile is conquered by another player
    const tileOwner = this.mg.owner(this.artillery.tile());
    if (tileOwner !== this.artillery.owner()) {
      // Set health to 0 to trigger deletion in next tick
      this.artillery.modifyHealth(-this.artillery.health());
      return;
    }

    // Healing: +1 HP per tick if owner has at least one factory
    const hasFactory = this.artillery.owner().unitCount(UnitType.Factory) > 0;
    if (hasFactory) {
      this.artillery.modifyHealth(1);
    }

    // Target scanning with interval optimization (every 10 ticks)
    if (ticks - this.lastTargetScan > 10) {
      this.lastTargetScan = ticks;
      this.artillery.setTargetUnit(this.findTargetStructure());
    }

    // Skip patrol when firing at a target
    if (this.artillery.targetUnit() === undefined) {
      this.patrol();
    }

    if (this.artillery.targetUnit() !== undefined) {
      this.shootTarget();
      return;
    }
  }

  private findTargetStructure(): Unit | undefined {
    const level = this.artillery.level ? this.artillery.level() : 1;
    const levelData = getArtilleryLevelData(level);
    const targetingRange = levelData.targetRange;

    // Get all structure types for filtering
    const structureTypes = Object.values(UnitType).filter((type) =>
      isStructureType(type),
    );

    const structures = this.mg.nearbyUnits(
      this.artillery.tile()!,
      targetingRange,
      structureTypes,
    );

    // Also check for nearby enemy artillery
    const allArtillery = this.mg.units(UnitType.Artillery);
    const nearbyArtillery = allArtillery.filter((art) => {
      if (art === this.artillery || art.owner() === this.artillery.owner()) {
        return false;
      }
      if (art.owner().isFriendly(this.artillery.owner())) {
        return false;
      }
      if (!this.artillery.owner().isAtWarWith(art.owner())) {
        return false;
      }
      const distSquared = this.mg.euclideanDistSquared(
        this.artillery.tile(),
        art.tile(),
      );
      return distSquared <= targetingRange * targetingRange;
    });

    const enemyArtillery: { unit: Unit; distSquared: number }[] = [];
    const defensePosts: { unit: Unit; distSquared: number }[] = [];
    const otherTargets: { unit: Unit; distSquared: number }[] = [];

    for (const { unit, distSquared } of structures) {
      if (
        unit.owner() === this.artillery.owner() ||
        unit === this.artillery ||
        unit.owner().isFriendly(this.artillery.owner()) ||
        this.alreadySentShell.has(unit)
      ) {
        continue;
      }

      // Only target enemy structures
      if (!this.artillery.owner().isAtWarWith(unit.owner())) {
        continue;
      }

      // Must have health to target
      if (!unit.hasHealth()) {
        continue;
      }

      // Prioritize enemy artillery (highest priority)
      if (unit.type() === UnitType.Artillery) {
        enemyArtillery.push({ unit, distSquared });
      }
      // Then defense posts
      else if (unit.type() === UnitType.DefensePost) {
        defensePosts.push({ unit, distSquared });
      } else {
        otherTargets.push({ unit, distSquared });
      }
    }

    // Add nearby artillery to enemy artillery list
    for (const art of nearbyArtillery) {
      const distSquared = this.mg.euclideanDistSquared(
        this.artillery.tile(),
        art.tile(),
      );
      enemyArtillery.push({ unit: art, distSquared });
    }

    // Priority 1: Enemy artillery (closest first)
    if (enemyArtillery.length > 0) {
      return enemyArtillery.sort((a, b) => a.distSquared - b.distSquared)[0]
        .unit;
    }

    // Priority 2: Defense posts (closest first)
    if (defensePosts.length > 0) {
      return defensePosts.sort((a, b) => a.distSquared - b.distSquared)[0].unit;
    }

    // Priority 3: Other structures (closest first)
    return otherTargets.sort((a, b) => a.distSquared - b.distSquared)[0]?.unit;
  }

  private shootTarget() {
    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;

    if (isPeaceTimerActive) {
      this.artillery.setTargetUnit(undefined);
      return; // Block attack
    }

    const shellAttackRate = this.mg.config().artilleryShellAttackRate();

    // Check if we're starting a new barrage (enough time has passed since last barrage)
    if (this.mg.ticks() - this.lastShellAttack >= shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.shellsFiredInBarrage = 0;
      this.barrageStartTick = this.mg.ticks();
    }

    // Fire one shell every 2 ticks if we haven't fired all 3 yet
    const ticksSinceBarrageStart = this.mg.ticks() - this.barrageStartTick;
    const shellsToFire = Math.floor(ticksSinceBarrageStart / 2) + 1;

    if (
      shellsToFire > this.shellsFiredInBarrage &&
      this.shellsFiredInBarrage < 3
    ) {
      this.mg.addExecution(
        new ShellExecution(
          this.artillery.tile(),
          this.artillery.owner(),
          this.artillery,
          this.artillery.targetUnit()!,
        ),
      );
      this.shellsFiredInBarrage++;

      if (!this.artillery.targetUnit()!.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.artillery.targetUnit()!);
        this.artillery.setTargetUnit(undefined);
      }
    }
  }

  private patrol() {
    if (this.artillery.targetTile() === undefined) {
      this.artillery.setTargetTile(this.randomTile());
      this.clearCachedPath(); // New target, need fresh path
      if (this.artillery.targetTile() === undefined) {
        return;
      }
    }

    // Use level-based move interval
    const level = this.artillery.level ? this.artillery.level() : 1;
    const levelData = getArtilleryLevelData(level);
    const moveInterval = levelData.moveInterval;

    if (this.mg.ticks() - this.lastMove < moveInterval) {
      this.artillery.touch();
      return;
    }

    const step = this.getNextStep();
    if (step === null) {
      this.artillery.setTargetTile(undefined);
      this.clearCachedPath();
      return;
    }
    if (step === this.artillery.tile()) {
      this.artillery.setTargetTile(undefined);
      this.clearCachedPath();
      return;
    }
    this.artillery.move(step);
    this.lastMove = this.mg.ticks();
  }

  /** Clear cached path when target changes or path becomes invalid */
  private clearCachedPath(): void {
    this.cachedPath = [];
    this.cachedPathTarget = null;
  }

  /** Get next step from cached path, computing new path only when needed */
  private getNextStep(): TileRef | null {
    const currentTile = this.artillery.tile();
    const targetTile = this.artillery.targetTile()!;

    // Check if we need to recompute path:
    // 1. No cached path
    // 2. Target changed
    // 3. We're not on the expected position (got displaced somehow)
    const needsRecompute =
      this.cachedPath.length === 0 ||
      this.cachedPathTarget !== targetTile ||
      (this.cachedPath.length > 0 &&
        this.cachedPath[this.cachedPath.length - 1] !== currentTile);

    if (needsRecompute) {
      const fullPath = this.computeFullPath(currentTile, targetTile);
      if (fullPath === null) {
        this.clearCachedPath();
        return null;
      }
      this.cachedPath = fullPath;
      this.cachedPathTarget = targetTile;
    }

    // Pop and return the next step (path is stored destination->source, so pop from end)
    if (this.cachedPath.length <= 1) {
      // Already at destination or path exhausted
      return currentTile;
    }

    // Remove current position from path and return next step
    this.cachedPath.pop(); // Remove current tile
    return this.cachedPath[this.cachedPath.length - 1]; // Return next tile
  }

  isActive(): boolean {
    return this.artillery?.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(): TileRef | undefined {
    let artilleryPatrolRange = this.mg.config().artilleryPatrolRange();
    const maxAttemptBeforeExpand: number = 500;
    let attempts: number = 0;
    let expandCount: number = 0;
    while (expandCount < 3) {
      const x =
        this.mg.x(this.artillery.patrolTile()!) +
        this.random.nextInt(
          -artilleryPatrolRange / 2,
          artilleryPatrolRange / 2,
        );
      const y =
        this.mg.y(this.artillery.patrolTile()!) +
        this.random.nextInt(
          -artilleryPatrolRange / 2,
          artilleryPatrolRange / 2,
        );
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      // Artillery must patrol on owned land only (not ocean, not water, not barrier, must be owned by player)
      if (
        this.mg.isOcean(tile) ||
        this.mg.isWater(tile) ||
        this.mg.terrainType(tile) === TerrainType.Barrier ||
        this.mg.owner(tile) !== this.artillery.owner()
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          artilleryPatrolRange =
            artilleryPatrolRange + Math.floor(artilleryPatrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    return undefined;
  }

  // A* over friendly/own land; water/shore allowed (like roads), barrier blocked
  // Returns full path from dst to src (reversed order for easy pop), or null if no path
  private computeFullPath(src: TileRef, dst: TileRef): TileRef[] | null {
    if (src === dst) return [src];

    const ok = (t: TileRef) => {
      if (this.mg.terrainType(t) === TerrainType.Barrier) return false;
      // Artillery is land-only: block ocean and water tiles
      if (this.mg.isOcean(t) || this.mg.isWater(t)) return false;
      const oid = this.mg.ownerID(t);
      if (oid === 0) return false;
      return this.allowedOwners.has(oid);
    };

    if (!ok(src) || !ok(dst)) return null;

    const DX = [0, 0, -1, 1, -1, 1, -1, 1];
    const DY = [-1, 1, 0, 0, -1, -1, 1, 1];
    const SCALE = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];
    const pq = new PriorityQueue<TileRef>();
    const cameFrom = new Map<TileRef, TileRef>();
    const g = new Map<TileRef, number>();

    const gx = this.mg.x(dst);
    const gy = this.mg.y(dst);
    const h = (t: TileRef) => {
      const dx = Math.abs(this.mg.x(t) - gx);
      const dy = Math.abs(this.mg.y(t) - gy);
      const m = Math.min(dx, dy);
      return dx + dy - m + m * 1.4142; // octile
    };

    const enqueue = (t: TileRef, cost: number) => {
      g.set(t, cost);
      pq.enqueue(cost + h(t), t);
    };

    enqueue(src, 0);
    let expansions = 0;
    const MAX_EXP = 10000;

    while (pq.size > 0) {
      const current = pq.dequeue()!;
      if (current === dst) break;
      if (++expansions > MAX_EXP) return null;

      const cx = this.mg.x(current);
      const cy = this.mg.y(current);
      for (let dir = 0; dir < 8; dir++) {
        const nx = cx + DX[dir];
        const ny = cy + DY[dir];
        if (!this.mg.isValidCoord(nx, ny)) continue;
        const nt = this.mg.ref(nx, ny);
        if (!ok(nt)) continue;
        const step = this.mg.cost(nt) * SCALE[dir];
        const tentative = (g.get(current) ?? Infinity) + step;
        if (tentative < (g.get(nt) ?? Infinity)) {
          cameFrom.set(nt, current);
          enqueue(nt, tentative);
        }
      }
    }

    if (!cameFrom.has(dst)) return null;

    // Reconstruct path back to src (stored as dst->src for easy pop from end)
    const path: TileRef[] = [dst];
    let cur = dst;
    while (cameFrom.has(cur)) {
      cur = cameFrom.get(cur)!;
      path.push(cur);
      if (cur === src) break;
    }
    if (path[path.length - 1] !== src) return null;
    return path;
  }
}
