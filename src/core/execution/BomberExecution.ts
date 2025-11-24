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
        this.startMission(target);
      }
      return;
    }

    // Execute mission
    if (this.onMission && this.currentTargetTile) {
      this.executeMission();
    }
  }

  private startMission(targetTile: TileRef): void {
    this.onMission = true;
    this.currentTargetTile = targetTile;
    this.bombsLeft = this.mg.config().bomberPayload();
    this.dropTicker = 0;
    this.bomber.setTargetTile(targetTile);
    this.bomber.setReturning(false);
    this.eligibleCities = findEligibleCitiesForBomber(this.bomber, this.mg);
  }

  private executeMission(): void {
    const returning = this.bombsLeft === 0;
    if (!returning && !this.currentTargetTile) return;

    const destination = returning
      ? this.sourceAirfield.tile()
      : this.currentTargetTile!;

    const speed = this.mg.config().bomberSpeed();
    for (let i = 0; i < speed; i++) {
      const step = this.pathFinder.nextTile(this.bomber.tile(), destination, 1);

      if (step === true) {
        // Reached destination
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
          if (this.currentTargetTile) {
            this.origOwner.bombersOnTarget.set(
              this.currentTargetTile,
              Math.max(
                0,
                (this.origOwner.bombersOnTarget.get(this.currentTargetTile) ??
                  1) - 1,
              ),
            );
          }

          this.onMission = false;
          this.bombsLeft = 0;
          this.currentTargetTile = null;
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

  private findTarget(): TileRef | null {
    const intent = this.origOwner.getBomberIntent?.();
    if (
      intent?.targetPlayerID &&
      intent?.structures &&
      intent.structures.length > 0
    ) {
      const targetPlayer = this.mg.player(intent.targetPlayerID);
      if (targetPlayer && !this.origOwner.isFriendly(targetPlayer)) {
        // Gather all targets of specified structure types
        const allTargets: { unit: Unit; dist2: number }[] = [];
        for (const structureType of intent.structures) {
          const units = targetPlayer.units(structureType);
          for (const unit of units) {
            const dist2 = this.mg.euclideanDistSquared(
              this.sourceAirfield.tile(),
              unit.tile(),
            );
            allTargets.push({ unit, dist2 });
          }
        }

        if (allTargets.length > 0) {
          // Sort by distance based on preference
          allTargets.sort((a, b) => {
            return intent.preferClosest ? a.dist2 - b.dist2 : b.dist2 - a.dist2;
          });

          // Try each target in order using new load balancing formula
          // h/250+2 > n where h is health and n is bombers assigned
          for (const { unit } of allTargets) {
            const bombersOnTarget =
              this.origOwner.bombersOnTarget.get(unit.tile()) ?? 0;
            const health = Number(unit.health());
            const threshold = health / 250 + 2;

            if (threshold > bombersOnTarget) {
              this.origOwner.bombersOnTarget.set(
                unit.tile(),
                bombersOnTarget + 1,
              );
              return unit.tile();
            }
          }
        }
      }
    }

    // Default targeting logic
    if (!this.origOwner.isAutoBombingEnabled()) {
      return null;
    }

    const range = this.mg.config().bomberTargetRange();
    const enemies = this.mg
      .nearbyUnits(this.sourceAirfield.tile(), range, [
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
      ])
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

    const sortedEnemies = enemies.sort((a, b) => {
      const priorityA = priority.indexOf(a.unit.type());
      const priorityB = priority.indexOf(b.unit.type());
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return a.dist2 - b.dist2;
    });

    // Find target with fewest bombers
    for (const { unit } of sortedEnemies) {
      const bombersOnTarget =
        this.origOwner.bombersOnTarget.get(unit.tile()) ?? 0;
      if (bombersOnTarget < 6) {
        this.origOwner.bombersOnTarget.set(unit.tile(), bombersOnTarget + 1);
        return unit.tile();
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
    }
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
