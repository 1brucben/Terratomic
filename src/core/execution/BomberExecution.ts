import {
  Execution,
  Game,
  Player,
  PlayerType,
  Relation,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import {
  attemptInterception,
  findEligibleCitiesForBomber,
} from "./utils/CityAntiAirUtils";

export class BomberExecution implements Execution {
  private active = true;
  private mg: Game;
  private bomber!: Unit;
  private bombsLeft = 0;
  private onMission = false;
  private pathFinder: StraightPathFinder;
  private dropTicker = 0;
  private eligibleCities: Unit[] = [];
  private random: PseudoRandom;
  private cooldownEndsAtTick = 0;
  private currentTargetTile: TileRef | null = null;
  private currentTargetUnit: Unit | null = null;
  private waypoints: TileRef[] = [];
  private currentWaypointIndex = 0;

  constructor(
    private origOwner: Player,
    private sourceAirfield: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new StraightPathFinder(mg);
    this.random = new PseudoRandom(ticks);

    // Create the bomber at the airfield
    const spawn = this.origOwner.canBuild(
      UnitType.Bomber,
      this.sourceAirfield.tile(),
    );
    if (!spawn) {
      console.warn(
        `Failed to create bomber at airfield ${this.sourceAirfield.tile()}`,
      );
      this.active = false;
      return;
    }
    this.bomber = this.origOwner.buildUnit(UnitType.Bomber, spawn, {
      targetTile: this.sourceAirfield.tile(),
      sourceAirfield: this.sourceAirfield,
    });
    this.bomber.setHealth(1n);
  }

  tick(ticks: number): void {
    // Log bomber health every 10 ticks
    if (ticks % 10 === 0 && this.bomber && this.bomber.isActive()) {
      console.log(
        `[Tick ${ticks}] Bomber health: ${this.bomber.health()} / 500 (Owner: ${this.origOwner.name()}, OnMission: ${this.onMission})`,
      );
    }

    // Respawn bomber if destroyed
    if (!this.bomber || !this.bomber.isActive()) {
      // Check if source airfield still exists
      if (!this.sourceAirfield.isActive()) {
        // Try to rebase to nearest airfield
        const nearestAirfield = this.findNearestOwnedAirfield();
        if (nearestAirfield) {
          this.sourceAirfield = nearestAirfield;
        } else {
          // No airfields left - bomber execution is done
          this.active = false;
          return;
        }
      }

      // Respawn bomber at airfield with health=1
      const spawn = this.origOwner.canBuild(
        UnitType.Bomber,
        this.sourceAirfield.tile(),
      );
      if (!spawn) {
        this.active = false;
        return;
      }
      this.bomber = this.origOwner.buildUnit(UnitType.Bomber, spawn, {
        targetTile: this.sourceAirfield.tile(),
        sourceAirfield: this.sourceAirfield,
      });
      this.bomber.setHealth(1n);
      this.onMission = false;
      this.bombsLeft = 0;
      this.currentTargetTile = null;
      this.currentTargetUnit = null;
      this.waypoints = [];
      this.currentWaypointIndex = 0;
      this.cooldownEndsAtTick = ticks + 100; // 100-tick cooldown after respawn
      this.eligibleCities = [];
      return;
    }

    // Check if source airfield was destroyed or captured
    if (
      !this.sourceAirfield.isActive() ||
      this.sourceAirfield.owner() !== this.origOwner
    ) {
      // If bomber is at the airfield when it's destroyed/captured, destroy the bomber
      if (this.bomber.tile() === this.sourceAirfield.tile()) {
        this.bomber.delete(false);
        this.active = false;
        return;
      }

      // Bomber is on mission - try to find another owned airfield
      const nearestAirfield = this.findNearestOwnedAirfield();
      if (nearestAirfield) {
        this.sourceAirfield = nearestAirfield;
        this.bomber.setSourceAirfield(nearestAirfield);
        // Bomber will continue its mission and return to the new airfield
        // No need to abort - just let it complete normally
      } else {
        // No airfields left - bomber is destroyed
        this.bomber.delete(false);
        this.active = false;
        return;
      }
    }

    // If bomber is at airfield and not on mission, check cooldown and find target
    if (!this.onMission && this.bomber.tile() === this.sourceAirfield.tile()) {
      if (ticks < this.cooldownEndsAtTick) {
        return; // Still on cooldown
      }

      // Check if another bomber took off recently from this airfield
      const timeSinceLastTakeoff =
        ticks - this.sourceAirfield.lastBomberTakeoffTick();
      const launchGap = this.mg.config().bomberLaunchGapTicks();
      if (timeSinceLastTakeoff < launchGap) {
        return; // Wait for launch gap
      }

      // Reserve this takeoff slot immediately to prevent race conditions
      this.sourceAirfield.setLastBomberTakeoffTick(ticks);

      // Check for a new target
      const target = this.findTarget();
      if (target) {
        this.startMission(target.tile, target.unit);
      }
      return;
    }

    // Execute mission
    if (this.onMission && this.currentTargetTile) {
      // Check if current target is still valid
      if (
        this.currentTargetUnit &&
        !this.isTargetValid(this.currentTargetUnit)
      ) {
        // Target is no longer valid, find a new one
        this.decrementBomberCount(this.currentTargetUnit);
        this.currentTargetUnit = null;
        this.currentTargetTile = null;

        const newTarget = this.findTarget();
        if (newTarget) {
          this.startMission(newTarget.tile, newTarget.unit);
        } else {
          // No valid targets, return home
          this.bomber.setReturning(true);
          const routeResult = this.findSafeRoute(
            this.bomber.tile(),
            this.sourceAirfield.tile(),
            null,
          );
          this.waypoints = routeResult.waypoints;
          this.currentWaypointIndex = 0;
        }
      }

      this.executeMission();
    }
  }

  private startMission(targetTile: TileRef, targetUnit: Unit | null): void {
    this.onMission = true;
    this.currentTargetTile = targetTile;
    this.currentTargetUnit = targetUnit;
    this.bombsLeft = this.mg.config().bomberPayload();
    this.dropTicker = 0;
    this.bomber.setTargetTile(targetTile);
    this.bomber.setReturning(false);
    this.eligibleCities = findEligibleCitiesForBomber(this.bomber, this.mg);

    // Generate waypoints to avoid SAM coverage
    const routeResult = this.findSafeRoute(
      this.sourceAirfield.tile(),
      targetTile,
      targetTile,
    );
    this.waypoints = routeResult.waypoints;
    this.currentWaypointIndex = 0;
  }

  private executeMission(): void {
    const returning = this.bombsLeft === 0;
    if (!returning && !this.currentTargetTile) return;

    // Determine destination based on waypoint system
    let destination: TileRef;
    if (returning) {
      // Navigate through return waypoints
      if (this.currentWaypointIndex < this.waypoints.length) {
        destination = this.waypoints[this.currentWaypointIndex];
      } else {
        destination = this.sourceAirfield.tile();
      }
    } else {
      // Navigate through outbound waypoints
      if (this.currentWaypointIndex < this.waypoints.length) {
        destination = this.waypoints[this.currentWaypointIndex];
      } else {
        destination = this.currentTargetTile!;
      }
    }

    const speed = this.mg.config().bomberSpeed();
    for (let i = 0; i < speed; i++) {
      const step = this.pathFinder.nextTile(this.bomber.tile(), destination, 1);

      if (step === true) {
        // Reached current waypoint/destination
        if (this.currentWaypointIndex < this.waypoints.length - 1) {
          // Move to next waypoint
          this.currentWaypointIndex++;
          return; // Continue next tick toward next waypoint
        }

        // Reached final destination
        if (!returning && this.bombsLeft > 0) {
          this.dropBomb();
        } else if (returning) {
          // Bomber returned to airfield
          this.bomber.move(this.sourceAirfield.tile());

          // Check if there's another bomber from this airfield
          const otherBomber = this.origOwner
            .units(UnitType.Bomber)
            .find(
              (b) =>
                b !== this.bomber &&
                b.sourceAirfield?.() === this.sourceAirfield &&
                b.isActive(),
            );

          if (
            otherBomber &&
            otherBomber.tile() === this.sourceAirfield.tile()
          ) {
            // Another bomber is at the airfield
            if (this.bomber.health() > otherBomber.health()) {
              // Replace the weaker bomber
              otherBomber.delete(false);
            } else {
              // This bomber is weaker, destroy it
              this.bomber.delete(false);
              this.active = false;
              return;
            }
          } else if (otherBomber) {
            // Other bomber is on mission, destroy this one
            this.bomber.delete(false);
            this.active = false;
            return;
          }

          // Clear from bombersOnTarget since mission is complete
          if (this.currentTargetUnit) {
            this.decrementBomberCount(this.currentTargetUnit);
          }

          this.onMission = false;
          this.bombsLeft = 0;
          this.currentTargetTile = null;
          this.currentTargetUnit = null;
          this.waypoints = [];
          this.currentWaypointIndex = 0;
          this.cooldownEndsAtTick = this.mg.ticks() + 100; // 100-tick cooldown
          this.bomber.setReturning(false);
        }
        return;
      }

      this.bomber.move(step);

      if (!this.bomber.isActive() || this.bomber.targetedBySAM()) return;

      // Check for city SAM interception
      const currentBomber = this.bomber;
      const readyInterceptors = this.eligibleCities.filter(
        (city) =>
          (city.ticksLeftInCooldown() ?? 0) <= 0 &&
          this.mg.euclideanDistSquared(currentBomber.tile(), city.tile()) <=
            this.mg.config().citySamLaunchRange() *
              this.mg.config().citySamLaunchRange(),
      );

      if (readyInterceptors.length > 0) {
        readyInterceptors.sort(
          (a, b) =>
            this.mg.euclideanDistSquared(currentBomber.tile(), a.tile()) -
            this.mg.euclideanDistSquared(currentBomber.tile(), b.tile()),
        );

        const closestInterceptor = readyInterceptors[0];
        attemptInterception(currentBomber, this.mg, closestInterceptor);
      }

      // Drop bomb if at target
      if (
        !returning &&
        this.bombsLeft > 0 &&
        this.currentTargetTile &&
        ++this.dropTicker >= this.mg.config().bomberDropCadence() &&
        this.mg.euclideanDistSquared(
          this.bomber.tile(),
          this.currentTargetTile,
        ) <= 1
      ) {
        this.dropBomb();
        this.dropTicker = 0;
        return;
      }
    }
  }

  private findTarget(): { tile: TileRef; unit: Unit | null } | null {
    // Clean up invalid targets from bombersOnTarget map
    this.cleanupBomberTargets();
    const intent = this.origOwner.getBomberIntent?.();

    // Manual targeting mode
    if (
      intent?.targetPlayerID &&
      intent?.structures &&
      intent.structures.length > 0
    ) {
      const targetPlayer = this.mg.player(intent.targetPlayerID);
      if (
        targetPlayer &&
        this.origOwner.relation(targetPlayer) === Relation.Hostile
      ) {
        return this.findTargetFromQueue(
          targetPlayer,
          intent.structures,
          intent.preferClosest,
        );
      }
    } // Auto-bombing mode
    if (!this.origOwner.isAutoBombingEnabled()) {
      return null;
    }

    const range = this.mg.config().bomberTargetRange();
    const priority: UnitType[] = [
      UnitType.SAMLauncher,
      UnitType.Airfield,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.DefensePost,
      UnitType.City,
      UnitType.Academy,
      UnitType.Hospital,
      UnitType.DoomsdayDevice,
      UnitType.Factory,
      UnitType.ResearchLab,
    ];

    // Gather all eligible enemies within range
    const enemies = this.mg
      .nearbyUnits(this.sourceAirfield.tile(), range, priority)
      .filter(({ unit }) => {
        const o = this.mg.owner(unit.tile());
        return (
          o.isPlayer() &&
          o.id() !== this.origOwner.id() &&
          (this.origOwner.type() === PlayerType.FakeHuman
            ? this.origOwner.relation(o) <= Relation.Hostile
            : !this.origOwner.isFriendly(o))
        );
      })
      .map(({ unit, distSquared }) => ({ unit, dist2: distSquared }));

    if (enemies.length === 0) return null;

    // Sort by bombers assigned first, then priority, then distance
    const sortedEnemies = enemies.sort((a, b) => {
      const bombersA = this.getBomberCount(a.unit);
      const bombersB = this.getBomberCount(b.unit);
      if (bombersA !== bombersB) {
        return bombersB - bombersA; // More bombers = higher priority (concentrate fire)
      }

      const priorityA = priority.indexOf(a.unit.type());
      const priorityB = priority.indexOf(b.unit.type());
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return a.dist2 - b.dist2;
    });

    // Try each target in order using load balancing formula with SAM avoidance
    for (const { unit } of sortedEnemies) {
      const bombersOnTarget = this.getBomberCount(unit);
      const health = Number(unit.health());
      const threshold = health / 250 + 2;

      if (threshold > bombersOnTarget) {
        // Check if we can reach this target while avoiding SAMs
        const routeResult = this.findSafeRoute(
          this.sourceAirfield.tile(),
          unit.tile(),
          unit.tile(),
        );

        if (routeResult.reachable) {
          this.incrementBomberCount(unit);
          return { tile: unit.tile(), unit };
        }
        // Target unreachable while avoiding SAMs, try next target
      }
    }

    // All targets exhausted and none reachable with SAM avoidance, try again with direct paths
    for (const { unit } of sortedEnemies) {
      const bombersOnTarget = this.getBomberCount(unit);
      const health = Number(unit.health());
      const threshold = health / 250 + 2;

      if (threshold > bombersOnTarget) {
        this.incrementBomberCount(unit);
        return { tile: unit.tile(), unit };
      }
    }

    return null;
  }

  private findTargetFromQueue(
    targetPlayer: Player,
    structures: UnitType[],
    preferClosest: boolean,
  ): { tile: TileRef; unit: Unit | null } | null {
    // Gather all targets of specified structure types
    const allTargets: { unit: Unit; dist2: number }[] = [];
    for (const structureType of structures) {
      const units = targetPlayer.units(structureType);
      for (const unit of units) {
        const dist2 = this.mg.euclideanDistSquared(
          this.sourceAirfield.tile(),
          unit.tile(),
        );
        allTargets.push({ unit, dist2 });
      }
    }

    if (allTargets.length === 0) return null;

    // Sort by bombers assigned first, then by distance preference
    allTargets.sort((a, b) => {
      const bombersA = this.getBomberCount(a.unit);
      const bombersB = this.getBomberCount(b.unit);
      if (bombersA !== bombersB) {
        return bombersB - bombersA; // More bombers = higher priority (concentrate fire)
      }
      return preferClosest ? a.dist2 - b.dist2 : b.dist2 - a.dist2;
    });

    // Try each target in order using load balancing formula
    // h/250+2 > n where h is health and n is bombers assigned
    for (const { unit } of allTargets) {
      const bombersOnTarget = this.getBomberCount(unit);
      const health = Number(unit.health());
      const threshold = health / 250 + 2;

      if (threshold > bombersOnTarget) {
        // Check if we can reach this target while avoiding SAMs
        const routeResult = this.findSafeRoute(
          this.sourceAirfield.tile(),
          unit.tile(),
          unit.tile(),
        );

        if (routeResult.reachable) {
          this.incrementBomberCount(unit);
          return { tile: unit.tile(), unit };
        }
        // Target unreachable while avoiding SAMs, try next target
      }
    }

    // All targets exhausted and none reachable, try again with direct path
    for (const { unit } of allTargets) {
      const bombersOnTarget = this.getBomberCount(unit);
      const health = Number(unit.health());
      const threshold = health / 250 + 2;

      if (threshold > bombersOnTarget) {
        this.incrementBomberCount(unit);
        return { tile: unit.tile(), unit };
      }
    }

    return null;
  }

  private dropBomb(): void {
    this.mg.bomberExplosion(
      this.bomber.tile(),
      this.mg.config().bomberExplosionRadius(),
      this.origOwner,
    );
    this.bombsLeft--;
    if (this.bombsLeft === 0) {
      this.bomber.setReturning(true);
      // Generate return waypoints to avoid SAMs on the way back
      const routeResult = this.findSafeRoute(
        this.bomber.tile(),
        this.sourceAirfield.tile(),
        null,
      );
      this.waypoints = routeResult.waypoints;
      this.currentWaypointIndex = 0;
    }
  }

  private isTargetValid(unit: Unit): boolean {
    if (!unit.isActive()) return false;
    const owner = unit.owner();
    if (!owner || owner === this.origOwner) return false;
    if (this.origOwner.relation(owner) !== Relation.Hostile) return false;
    return true;
  }

  private cleanupBomberTargets(): void {
    // Remove entries for units that no longer exist or are invalid
    const keysToDelete: TileRef[] = [];
    for (const [tile, _count] of this.origOwner.bombersOnTarget) {
      const units = this.mg.unitsAt(tile);
      if (units.length === 0 || !this.isTargetValid(units[0])) {
        keysToDelete.push(tile);
      }
    }
    for (const key of keysToDelete) {
      this.origOwner.bombersOnTarget.delete(key);
    }
  }

  private decrementBomberCount(unit: Unit): void {
    const tile = unit.tile();
    const count = this.origOwner.bombersOnTarget.get(tile) ?? 0;
    if (count <= 1) {
      this.origOwner.bombersOnTarget.delete(tile);
    } else {
      this.origOwner.bombersOnTarget.set(tile, count - 1);
    }
  }

  private getBomberCount(unit: Unit): number {
    return this.origOwner.bombersOnTarget.get(unit.tile()) ?? 0;
  }

  private incrementBomberCount(unit: Unit): void {
    const tile = unit.tile();
    this.origOwner.bombersOnTarget.set(tile, this.getBomberCount(unit) + 1);
  }

  private getEffectiveSAMRange(sam: Unit): number {
    const base = this.mg.config().defaultSamRange();
    const bonus = this.mg.config().samRangeUpgradePercent();
    const lvl = sam.level?.() ?? 1;
    if (lvl <= 1) return base;
    // Apply per-upgrade multiplicative increase
    const factor = Math.pow(1 + bonus, lvl - 1);
    return Math.round(base * factor);
  }

  private findSafeRoute(
    start: TileRef,
    end: TileRef,
    targetTile: TileRef | null,
  ): { reachable: boolean; waypoints: TileRef[] } {
    // Get all hostile SAM launchers with their actual ranges, excluding the target if it's a SAM
    const hostileSAMs = this.mg
      .players()
      .filter(
        (p) =>
          p.id() !== this.origOwner.id() &&
          this.origOwner.relation(p) === Relation.Hostile,
      )
      .flatMap((p) => p.units(UnitType.SAMLauncher))
      .filter((sam) => !targetTile || sam.tile() !== targetTile)
      .map((sam) => ({
        sam,
        range: this.getEffectiveSAMRange(sam),
      }));

    if (hostileSAMs.length === 0) {
      return { reachable: true, waypoints: [end] }; // No SAMs to avoid, fly direct
    }

    const startX = this.mg.x(start);
    const startY = this.mg.y(start);
    const endX = this.mg.x(end);
    const endY = this.mg.y(end);

    // Calculate perpendicular offset direction
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 10) {
      // Check if direct path is safe
      if (this.isPathSafe(start, [end], hostileSAMs)) {
        return { reachable: true, waypoints: [end] };
      }
      return { reachable: false, waypoints: [end] };
    }

    // Perpendicular vector (rotate 90 degrees)
    const perpX = -dy / distance;
    const perpY = dx / distance;

    // Try offset distance large enough to clear SAM ranges
    const maxSamRange = Math.max(...hostileSAMs.map((s) => s.range));
    const offsetDistance = maxSamRange * 1.5;

    for (const direction of [-1, 1]) {
      const offsetX = perpX * offsetDistance * direction;
      const offsetY = perpY * offsetDistance * direction;

      // Create waypoint at 1/3 and 2/3 along the path, offset perpendicular
      const waypoint1X = Math.round(startX + dx * 0.33 + offsetX);
      const waypoint1Y = Math.round(startY + dy * 0.33 + offsetY);
      const waypoint2X = Math.round(startX + dx * 0.67 + offsetX);
      const waypoint2Y = Math.round(startY + dy * 0.67 + offsetY);

      const wp1 = this.mg.ref(waypoint1X, waypoint1Y);
      const wp2 = this.mg.ref(waypoint2X, waypoint2Y);

      // Check if this route completely avoids all SAM ranges
      if (this.isPathSafe(start, [wp1, wp2, end], hostileSAMs)) {
        return { reachable: true, waypoints: [wp1, wp2, end] };
      }
    }

    // Check if direct path is safe
    if (this.isPathSafe(start, [end], hostileSAMs)) {
      return { reachable: true, waypoints: [end] };
    }

    // No safe route found
    return { reachable: false, waypoints: [end] };
  }

  private isPathSafe(
    start: TileRef,
    waypoints: TileRef[],
    sams: { sam: Unit; range: number }[],
  ): boolean {
    let current = start;
    for (const waypoint of waypoints) {
      // Sample points along the segment
      const x1 = this.mg.x(current);
      const y1 = this.mg.y(current);
      const x2 = this.mg.x(waypoint);
      const y2 = this.mg.y(waypoint);
      const segmentDist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      const samples = Math.max(10, Math.floor(segmentDist / 5));

      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const px = Math.round(x1 + (x2 - x1) * t);
        const py = Math.round(y1 + (y2 - y1) * t);
        const point = this.mg.ref(px, py);

        // Check if any SAM can reach this point
        for (const { sam, range } of sams) {
          const dist = Math.sqrt(
            this.mg.euclideanDistSquared(sam.tile(), point),
          );
          if (dist <= range) {
            return false; // Path enters SAM range, not safe
          }
        }
      }

      current = waypoint;
    }

    return true; // Path completely avoids all SAM ranges
  }

  private findNearestOwnedAirfield(): Unit | null {
    const ownedAirfields = this.origOwner
      .units(UnitType.Airfield)
      .filter((a) => a.isActive());

    if (ownedAirfields.length === 0) {
      return null;
    }

    let nearest: Unit | null = null;
    let minDist = Infinity;

    for (const airfield of ownedAirfields) {
      const dist = this.mg.euclideanDistSquared(
        this.bomber.tile(),
        airfield.tile(),
      );
      if (dist < minDist) {
        minDist = dist;
        nearest = airfield;
      }
    }

    return nearest;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
