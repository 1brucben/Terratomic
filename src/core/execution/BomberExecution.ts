import type { Execution, Game, Player, Unit } from "../game/Game";
import { UnitType } from "../game/Game";
import type { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";

export class BomberExecution implements Execution {
  private active = true;
  private mg: Game;
  private bomber!: Unit;
  private bombsLeft = 0;
  private onMission = false;
  private pathFinder: StraightPathFinder;
  private dropTicker = 0;
  private cooldownEndsAtTick = 0;
  private currentTargetTile: TileRef | null = null;
  private currentTargetUnit: Unit | null = null;
  private waypoints: TileRef[] = [];
  private currentWaypointIndex = 0;
  private hasRebasedToNewAirfield = false; // Track if bomber rebased due to home airfield destruction
  private lastHealthLogTick = 0; // For health logging

  constructor(
    private origOwner: Player,
    private sourceAirfield: Unit,
  ) {}

  /** Get the bomber level from the source airfield */
  private getBomberLevel(): number {
    return this.sourceAirfield.bomberLevel?.() ?? 1;
  }

  /**
   * Get the effective bomber cooldown ticks, reduced by road connection bonus.
   * If the source airfield is connected to the road network, cooldown is reduced
   * by up to 20%, scaled by road quality.
   */
  private getEffectiveCooldownTicks(): number {
    const baseCooldown = this.mg.config().bomberCooldownTicks();

    // Check if the source airfield is connected to the road network
    if (!this.mg.isStructureConnectedToRoadNetwork(this.sourceAirfield)) {
      return baseCooldown;
    }

    // Get road quality (0-150, with 100 being baseline)
    const roadQuality = this.origOwner.roadNetworkQuality();
    // Road bonus: at 100% quality = 20% reduction, at 50% = 10%, at 150% = 30%
    const reductionFactor = 0.2 * (roadQuality / 100);
    const effectiveCooldown = baseCooldown * (1 - reductionFactor);

    return Math.max(1, Math.floor(effectiveCooldown));
  }

  /** Get the minimum bomber damage across all of this player's airfields */
  private getMinBomberDamage(): number {
    const airfields = this.origOwner.units(UnitType.Airfield);
    if (airfields.length === 0) {
      return this.mg.config().bomberDamage(1); // Fallback to level 1 damage
    }
    let minDamage = Infinity;
    for (const airfield of airfields) {
      const level = airfield.bomberLevel?.() ?? 1;
      const damage = this.mg.config().bomberDamage(level);
      if (damage < minDamage) {
        minDamage = damage;
      }
    }
    return minDamage;
  }

  /** Get level-based max health for this bomber */
  private getMaxHealth(): number {
    return this.mg.config().bomberMaxHealth(this.getBomberLevel());
  }

  /** Set bomber's bonus max health based on airfield's bomber level */
  private applyBomberLevelStats(): void {
    const baseHealth = this.mg.unitInfo(UnitType.Bomber).maxHealth ?? 500;
    const levelHealth = this.getMaxHealth();
    const bonus = levelHealth - baseHealth;
    if (bonus > 0) {
      (this.bomber as any)._bonusMaxHealth = bonus;
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new StraightPathFinder(mg);

    // Create the bomber at the airfield
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
    // Apply level-based bonus health before setting full health
    this.applyBomberLevelStats();
    // New bombers start at 100% health based on airfield's bomber level
    this.bomber.setHealth(BigInt(this.getMaxHealth()));
  }

  tick(ticks: number): void {
    // Log bomber health every 5 seconds (50 ticks)
    if (
      this.bomber &&
      this.bomber.isActive() &&
      ticks - this.lastHealthLogTick >= 50
    ) {
      this.lastHealthLogTick = ticks;
    }

    // Respawn bomber if destroyed
    if (!this.bomber?.isActive()) {
      // Decrement bomber count for the target we were attacking (if any)
      if (this.currentTargetUnit) {
        this.decrementBomberCount(this.currentTargetUnit);
        this.currentTargetUnit = null;
      }

      // Check if source airfield still exists and is owned by us
      if (
        !this.sourceAirfield.isActive() ||
        this.sourceAirfield.owner() !== this.origOwner
      ) {
        // Airfield destroyed or captured - this bomber execution is done
        // (the nearest airfield should already have its own bomber)
        this.active = false;
        return;
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
      // Apply level-based bonus health before setting respawn health
      this.applyBomberLevelStats();
      this.bomber.setHealth(1n);
      this.resetMissionState(this.getEffectiveCooldownTicks());
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
        this.hasRebasedToNewAirfield = true; // Mark that this bomber rebased
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

      // Check if bomber has reached health threshold before allowing takeoff
      const healthThreshold = this.mg.config().bomberTakeoffHealthThreshold();
      const maxHealth = this.getMaxHealth();
      const currentHealth = Number(this.bomber.health());
      if (currentHealth < maxHealth * healthThreshold) {
        return; // Wait for bomber to heal to threshold
      }

      // Check if another bomber took off recently from this airfield
      const timeSinceLastTakeoff =
        ticks - this.sourceAirfield.lastBomberTakeoffTick();
      const launchGap = this.mg.config().bomberLaunchGapTicks();
      if (timeSinceLastTakeoff < launchGap) {
        return; // Wait for launch gap
      }

      // Check for a new target
      const target = this.findTarget();
      if (target) {
        // Reserve this takeoff slot only when actually taking off
        this.sourceAirfield.setLastBomberTakeoffTick(ticks);
        this.startMission(target.tile, target.unit);
      }
      return;
    }

    // Execute mission
    if (this.onMission && (this.currentTargetTile || this.bomber.returning())) {
      // Check if current target is still valid (only retarget if not already returning)
      if (
        this.currentTargetUnit &&
        !this.isTargetValid(this.currentTargetUnit) &&
        !this.bomber.returning()
      ) {
        // Target is no longer valid, find a new one
        this.decrementBomberCount(this.currentTargetUnit);
        this.currentTargetUnit = null;
        this.currentTargetTile = null;

        const newTarget = this.findTarget();
        if (newTarget) {
          this.startMission(newTarget.tile, newTarget.unit);
        } else {
          // No valid targets, abort mission and return to airfield
          this.bomber.setTargetTile(this.sourceAirfield.tile());
          if (this.bomber.tile() !== this.sourceAirfield.tile()) {
            // Already away from airfield, need to return
            this.bomber.setReturning(true);
            const routeResult = this.findSafeRoute(
              this.bomber.tile(),
              this.sourceAirfield.tile(),
              null,
            );
            this.onMission = true; // Keep mission active for return journey
            this.bombsLeft = 0;
            this.currentTargetTile = null;
            this.currentTargetUnit = null;
            this.waypoints = routeResult.waypoints;
            this.currentWaypointIndex = 0;
          } else {
            this.resetMissionState(0);
          }
          return;
        }
      }

      this.executeMission();
    }
  }

  private startMission(targetTile: TileRef, targetUnit: Unit | null): void {
    const wasAlreadyOnMission = this.onMission;
    this.onMission = true;
    this.currentTargetTile = targetTile;
    this.currentTargetUnit = targetUnit;
    // Only load bombs when starting a fresh mission, not when retargeting
    if (!wasAlreadyOnMission) {
      this.bombsLeft = this.mg.config().bomberPayload();
    }
    this.dropTicker = 0;
    this.bomber.setTargetTile(targetTile);
    this.bomber.setReturning(false);

    // Generate waypoints to avoid SAM coverage
    // Use bomber's current position if already on mission, otherwise use airfield
    const startPosition = wasAlreadyOnMission
      ? this.bomber.tile()
      : this.sourceAirfield.tile();
    const routeResult = this.findSafeRoute(
      startPosition,
      targetTile,
      targetTile,
    );
    this.waypoints = routeResult.waypoints;
    this.currentWaypointIndex = 0;
  }

  private executeMission(): void {
    const returning = this.bomber.returning();
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

    const speed = this.mg.config().bomberSpeed(this.getBomberLevel());
    for (let i = 0; i < speed; i++) {
      const bomberTile = this.bomber.tile();
      const step = this.pathFinder.nextTile(bomberTile, destination, 1);

      if (step === true) {
        // Reached current waypoint/destination
        if (this.currentWaypointIndex < this.waypoints.length - 1) {
          // Move to next waypoint
          this.currentWaypointIndex++;
          return; // Continue next tick toward next waypoint
        }

        // Reached final destination
        if (!returning && this.bombsLeft > 0) {
          if (++this.dropTicker >= this.mg.config().bomberDropCadence()) {
            this.dropBomb();
            this.dropTicker = 0;
            return; // Stop movement for this tick after dropping bomb
          }
        } else if (returning) {
          // Bomber returned to airfield
          this.bomber.move(this.sourceAirfield.tile());

          // If this bomber rebased due to home airfield destruction, delete it
          if (this.hasRebasedToNewAirfield) {
            this.bomber.delete(false);
            this.active = false;
            return;
          }

          // Clear from bombersOnTarget since mission is complete
          if (this.currentTargetUnit) {
            this.decrementBomberCount(this.currentTargetUnit);
          }

          this.resetMissionState(this.getEffectiveCooldownTicks());
        }
        return;
      }

      this.bomber.move(step);

      if (!this.bomber.isActive() || this.bomber.targetedBySAM()) return;
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
      if (targetPlayer && this.origOwner.isAtWarWith(targetPlayer)) {
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

    const range = this.mg.config().bomberTargetRange(this.getBomberLevel());
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
        const o = unit.owner();
        return (
          o.isPlayer() &&
          o.id() !== this.origOwner.id() &&
          this.origOwner.isAtWarWith(o)
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

    // Try with SAM avoidance first, then fall back to direct paths
    return (
      this.trySelectTarget(sortedEnemies, true) ??
      this.trySelectTarget(sortedEnemies, false)
    );
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
        if (!unit.isActive()) continue;
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

    // Try with SAM avoidance first, then fall back to direct paths
    return (
      this.trySelectTarget(allTargets, true) ??
      this.trySelectTarget(allTargets, false)
    );
  }

  private dropBomb(): void {
    this.mg.bomberExplosion(
      this.bomber.tile(),
      this.mg.config().bomberExplosionRadius(),
      this.mg.config().bomberDamage(this.getBomberLevel()),
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
    if (!unit.isActive()) {
      return false;
    }
    const owner = unit.owner();
    if (!owner || owner === this.origOwner) {
      return false;
    }
    if (!this.origOwner.isAtWarWith(owner)) {
      return false;
    }
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
    const oldCount = this.origOwner.bombersOnTarget.get(tile) ?? 0;
    const newCount = oldCount + 1;
    this.origOwner.bombersOnTarget.set(tile, newCount);
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
        (p) => p.id() !== this.origOwner.id() && this.origOwner.isAtWarWith(p),
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

    const mapWidth = this.mg.width();
    const mapHeight = this.mg.height();

    for (const direction of [-1, 1]) {
      const offsetX = perpX * offsetDistance * direction;
      const offsetY = perpY * offsetDistance * direction;

      // Create waypoint at 1/3 and 2/3 along the path, offset perpendicular
      // Clamp to map bounds to prevent invalid coordinates
      const waypoint1X = Math.max(
        0,
        Math.min(mapWidth - 1, Math.round(startX + dx * 0.33 + offsetX)),
      );
      const waypoint1Y = Math.max(
        0,
        Math.min(mapHeight - 1, Math.round(startY + dy * 0.33 + offsetY)),
      );
      const waypoint2X = Math.max(
        0,
        Math.min(mapWidth - 1, Math.round(startX + dx * 0.67 + offsetX)),
      );
      const waypoint2Y = Math.max(
        0,
        Math.min(mapHeight - 1, Math.round(startY + dy * 0.67 + offsetY)),
      );

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
    const mapWidth = this.mg.width();
    const mapHeight = this.mg.height();
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
        // Clamp sampled points to map bounds
        const px = Math.max(
          0,
          Math.min(mapWidth - 1, Math.round(x1 + (x2 - x1) * t)),
        );
        const py = Math.max(
          0,
          Math.min(mapHeight - 1, Math.round(y1 + (y2 - y1) * t)),
        );
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

  private resetMissionState(cooldownTicks: number): void {
    this.onMission = false;
    this.bombsLeft = 0;
    this.currentTargetTile = null;
    this.currentTargetUnit = null;
    this.waypoints = [];
    this.currentWaypointIndex = 0;
    this.cooldownEndsAtTick = this.mg.ticks() + cooldownTicks;
    this.bomber.setReturning(false);
  }

  private trySelectTarget(
    candidates: { unit: Unit; dist2: number }[],
    requireSafeRoute: boolean,
  ): { tile: TileRef; unit: Unit } | null {
    for (const { unit } of candidates) {
      const bombersOnTarget = this.getBomberCount(unit);
      const health = Number(unit.health());
      // Use minimum bomber damage across player's airfields for threshold calculation
      const minBomberDamage = this.getMinBomberDamage();
      const threshold = health / minBomberDamage + 2;

      if (threshold > bombersOnTarget) {
        if (requireSafeRoute) {
          const routeResult = this.findSafeRoute(
            this.sourceAirfield.tile(),
            unit.tile(),
            unit.tile(),
          );
          if (!routeResult.reachable) {
            continue; // Try next target
          }
        }
        this.incrementBomberCount(unit);
        return { tile: unit.tile(), unit };
      }
    }
    return null;
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
