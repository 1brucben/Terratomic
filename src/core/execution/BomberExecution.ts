import type { Execution, Game, Player, Unit } from "../game/Game";
import { UnitType } from "../game/Game";
import type { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";
import { roadEffectModifiers } from "../tech/TechEffects";

export class BomberExecution implements Execution {
  executionName = "BomberExecution";
  private active = true;
  private mg: Game;
  private bomber: Unit | null = null;
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
  private cachedTarget:
    | { tile: TileRef; unit: Unit | null }
    | null
    | undefined = undefined;
  private cachedTargetTick = -999;
  private static readonly TARGET_CACHE_DURATION = 10;

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
    // roadEffectMul further amplifies/dampens the road bonus (e.g., Transport Priority policy)
    const roadMods = roadEffectModifiers(this.origOwner);
    const reductionFactor = 0.2 * (roadQuality / 100) * roadMods.effectMul;
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
    // Bomber starts on cooldown, will be created when first mission launches
    this.cooldownEndsAtTick = ticks + this.mg.config().bomberCooldownTicks();
  }

  tick(ticks: number): void {
    // Check if source airfield was destroyed or captured
    if (
      !this.sourceAirfield.isActive() ||
      this.sourceAirfield.owner() !== this.origOwner
    ) {
      // If bomber exists and is on mission, handle it
      if (this.bomber?.isActive()) {
        // Bomber is on mission - try to find another owned airfield
        const nearestAirfield = this.findNearestOwnedAirfield();
        if (nearestAirfield) {
          this.sourceAirfield = nearestAirfield;
          this.bomber.setSourceAirfield(nearestAirfield);
          this.hasRebasedToNewAirfield = true;
        } else {
          // No airfields left - bomber is destroyed
          this.bomber.delete(false);
          this.bomber = null;
          this.active = false;
          return;
        }
      } else {
        // Airfield destroyed, no active bomber - execution is done
        this.active = false;
        return;
      }
    }

    // Handle bomber on mission
    if (this.bomber?.isActive()) {
      // Execute the mission
      if (
        this.onMission &&
        (this.currentTargetTile || this.bomber.returning())
      ) {
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
              this.onMission = true;
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
      return;
    }

    // No bomber exists - check if we should launch one
    if (!this.onMission) {
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

      // Check for a new target
      const target = this.findTarget();
      if (target) {
        // Create bomber for this mission
        const spawn = this.origOwner.canBuild(
          UnitType.Bomber,
          this.sourceAirfield.tile(),
        );
        if (!spawn) {
          return; // Can't spawn, will try next tick
        }
        this.bomber = this.origOwner.buildUnit(UnitType.Bomber, spawn, {
          targetTile: this.sourceAirfield.tile(),
          sourceAirfield: this.sourceAirfield,
        });
        // Apply level-based bonus health
        this.applyBomberLevelStats();
        this.bomber.setHealth(BigInt(this.getMaxHealth()));

        // Reserve this takeoff slot
        this.sourceAirfield.setLastBomberTakeoffTick(ticks);
        this.startMission(target.tile, target.unit);
      }
      return;
    }
  }

  private startMission(targetTile: TileRef, targetUnit: Unit | null): void {
    if (!this.bomber) return;
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
    if (!this.bomber) return;
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
          // Bomber returned to airfield - delete it
          this.bomber.delete(false);

          // Clear from bombersOnTarget since mission is complete
          if (this.currentTargetUnit) {
            this.decrementBomberCount(this.currentTargetUnit);
          }

          // If this bomber rebased, end execution
          if (this.hasRebasedToNewAirfield) {
            this.active = false;
            return;
          }

          this.bomber = null;
          this.resetMissionState(this.getEffectiveCooldownTicks());
        }
        return;
      }

      this.bomber.move(step);

      if (!this.bomber.isActive() || this.bomber.targetedBySAM()) return;
    }
  }

  private findTarget(): { tile: TileRef; unit: Unit | null } | null {
    // Trigger cleanup if PlayerExecution isn't running (e.g., in tests)
    // PlayerExecution will handle this in normal gameplay
    const playerExecExists = (this.mg as any).execs?.some?.(
      (e: any) =>
        e.constructor.name === "PlayerExecution" &&
        (e as any).player === this.origOwner,
    );
    if (!playerExecExists) {
      this.cleanupBomberTargetsIfNeeded();
    }

    const intent = this.origOwner.getBomberIntent?.();

    // Check cache validity
    const currentTick = this.mg.ticks();
    if (
      currentTick - this.cachedTargetTick <
      BomberExecution.TARGET_CACHE_DURATION
    ) {
      // Validate cached target is still valid
      if (
        this.cachedTarget &&
        this.cachedTarget.unit &&
        !this.isTargetValid(this.cachedTarget.unit)
      ) {
        // Cached target became invalid, invalidate cache
        this.cachedTarget = undefined;
        this.cachedTargetTick = -999;
      } else {
        // Return cached result (may be null/undefined)
        return this.cachedTarget ?? null;
      }
    }

    // Manual targeting mode
    if (
      intent?.targetPlayerID &&
      intent?.structures &&
      intent.structures.length > 0
    ) {
      const targetPlayer = this.mg.player(intent.targetPlayerID);
      if (targetPlayer && this.origOwner.isAtWarWith(targetPlayer)) {
        const target = this.findTargetFromQueue(
          targetPlayer,
          intent.structures,
          intent.preferClosest,
        );
        // If we found a target in manual mode, use it
        if (target) {
          // Cache the result
          this.cachedTarget = target;
          this.cachedTargetTick = this.mg.ticks();
          return target;
        }
        // If no targets remain, clear the manual intent and fall through to auto-bombing
        this.origOwner.setBomberIntent(null);
        // Invalidate cache since intent changed
        this.cachedTarget = undefined;
        this.cachedTargetTick = -999;
      }
    } // Auto-bombing mode
    if (!this.origOwner.isAutoBombingEnabled()) {
      // Cache the null result
      this.cachedTarget = null;
      this.cachedTargetTick = this.mg.ticks();
      return null;
    }

    const range = this.mg.config().bomberTargetRange(this.getBomberLevel());
    const priority: UnitType[] = [
      UnitType.Artillery,
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
    const result =
      this.trySelectTarget(sortedEnemies, true) ??
      this.trySelectTarget(sortedEnemies, false);

    // Cache the result
    this.cachedTarget = result;
    this.cachedTargetTick = this.mg.ticks();
    return result;
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
    if (!this.bomber) return;
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

  /**
   * Fallback cleanup for tests without PlayerExecution.
   * In production, PlayerExecution.cleanupBomberTargets() handles this.
   */
  private cleanupBomberTargetsIfNeeded(): void {
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

  private findSafeRoute(
    start: TileRef,
    end: TileRef,
    targetTile: TileRef | null,
  ): { reachable: boolean; waypoints: TileRef[] } {
    // Direct path - SAM avoidance removed for performance
    return { reachable: true, waypoints: [end] };
  }

  private resetMissionState(cooldownTicks: number): void {
    this.onMission = false;
    this.bombsLeft = 0;
    this.currentTargetTile = null;
    this.currentTargetUnit = null;
    this.waypoints = [];
    this.currentWaypointIndex = 0;
    this.cooldownEndsAtTick = this.mg.ticks() + cooldownTicks;
    if (this.bomber) {
      this.bomber.setReturning(false);
    }
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
    if (!this.bomber) return null;
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
