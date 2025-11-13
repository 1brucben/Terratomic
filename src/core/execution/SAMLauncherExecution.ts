import {
  Execution,
  Game,
  isUnit,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";

type Target = {
  unit: Unit;
  tile: TileRef;
};

/**
 * Smart SAM targeting system preshoting nukes so its range is strictly enforced
 */
class SAMTargetingSystem {
  // Store unreachable nukes so the SAM won't compute an interception point for them every frame
  private nukesToIgnore: Set<number> = new Set();

  constructor(
    private mg: Game,
    private player: Player,
    private sam: Unit,
  ) {}

  updateUnreachableNukes(nearbyUnits: { unit: Unit; distSquared: number }[]) {
    const nearbyUnitSet = new Set(nearbyUnits.map((u) => u.unit.id()));
    for (const nukeId of this.nukesToIgnore) {
      if (!nearbyUnitSet.has(nukeId)) {
        this.nukesToIgnore.delete(nukeId);
      }
    }
  }

  private storeUnreachableNukes(nukeId: number) {
    this.nukesToIgnore.add(nukeId);
  }

  private effectiveSamRange(): number {
    const base = this.mg.config().defaultSamRange();
    const bonus = this.mg.config().samRangeUpgradePercent();
    const lvl = this.sam.level?.() ?? 1;
    if (lvl <= 1) return base;
    // Apply per-upgrade multiplicative increase
    const factor = Math.pow(1 + bonus, lvl - 1);
    return Math.round(base * factor);
  }

  private isInRange(tile: TileRef) {
    const samTile = this.sam.tile();
    const rangeSquared = this.effectiveSamRange() ** 2;
    return this.mg.euclideanDistSquared(samTile, tile) <= rangeSquared;
  }

  private tickToReach(currentTile: TileRef, tile: TileRef): number {
    const missileSpeed = this.mg.config().defaultSamMissileSpeed();
    return Math.ceil(this.mg.manhattanDist(currentTile, tile) / missileSpeed);
  }

  private computeInterceptionTile(unit: Unit): TileRef | undefined {
    const trajectory = unit.trajectory();
    const samTile = this.sam.tile();
    const currentIndex = unit.trajectoryIndex();
    const explosionTick: number = trajectory.length - currentIndex;
    for (let i = unit.trajectoryIndex(); i < trajectory.length; i++) {
      const trajectoryTile = trajectory[i];
      if (trajectoryTile.targetable && this.isInRange(trajectoryTile.tile)) {
        const nukeTickToReach = i - currentIndex;
        const samTickToReach = this.tickToReach(samTile, trajectoryTile.tile);
        const reachableOnTime = Math.abs(nukeTickToReach - samTickToReach) <= 1;
        if (reachableOnTime && samTickToReach < explosionTick) {
          return trajectoryTile.tile;
        }
      }
    }
    return undefined;
  }

  public getSingleTarget(): Target | null {
    // Look beyond the SAM range so it can preshot nukes
    const detectionRange = this.effectiveSamRange() * 1.5;
    const nukes = this.mg.nearbyUnits(
      this.sam.tile(),
      detectionRange,
      [UnitType.AtomBomb, UnitType.HydrogenBomb],
      ({ unit }) => {
        return (
          unit.owner() !== this.player && !this.player.isFriendly(unit.owner())
        );
      },
    );

    // Clear unreachable nukes that went out of range
    this.updateUnreachableNukes(nukes);

    const targets: Array<Target> = [];
    for (const nuke of nukes) {
      if (this.nukesToIgnore.has(nuke.unit.id())) {
        continue;
      }
      const interceptionTile = this.computeInterceptionTile(nuke.unit);
      if (interceptionTile !== undefined) {
        targets.push({ unit: nuke.unit, tile: interceptionTile });
      } else {
        // Store unreachable nukes in order to prevent useless interception computation
        this.storeUnreachableNukes(nuke.unit.id());
      }
    }

    return (
      targets.sort((a: Target, b: Target) => {
        // Prioritize Hydrogen Bombs
        if (
          a.unit.type() === UnitType.HydrogenBomb &&
          b.unit.type() !== UnitType.HydrogenBomb
        )
          return -1;
        if (
          a.unit.type() !== UnitType.HydrogenBomb &&
          b.unit.type() === UnitType.HydrogenBomb
        )
          return 1;

        return 0;
      })[0] ?? null
    );
  }
}

export class SAMLauncherExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  // As MIRV go very fast we have to detect them very early but we only
  // shoot the one targeting very close (MIRVWarheadProtectionRadius)
  private MIRVWarheadSearchRadius = 400;
  private MIRVWarheadProtectionRadius = 50;
  private targetingSystem: SAMTargetingSystem;

  private cargoPlaneSearchRadius = 150;
  private cargoPlaneCheckOffset: number = 0;

  private pseudoRandom: PseudoRandom | undefined;

  constructor(
    private player: Player,
    private tile: TileRef | null,
    private sam: Unit | null = null,
  ) {
    if (sam !== null) {
      this.tile = sam.tile();
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.cargoPlaneCheckOffset = mg.ticks() % 20;
  }
  private isHit(type: UnitType, random: number): boolean {
    if (!this.sam) return false; // Should not happen
    const healthPercentage = this.sam.hasHealth()
      ? Number(this.sam.health()) / (this.sam.info().maxHealth ?? 1)
      : 1;

    if (type === UnitType.AtomBomb || type === UnitType.HydrogenBomb) {
      return (
        random < this.mg.config().samNukeHittingChance() * healthPercentage
      );
    }

    if (type === UnitType.MIRVWarhead) {
      return random < this.mg.config().samWarheadHittingChance();
    }

    // For planes (CargoPlane, Bomber, FighterJet)
    return random < this.mg.config().samPlaneHittingChance() * healthPercentage;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.player === null) {
      throw new Error("Not initialized");
    }

    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;

    if (this.sam === null) {
      if (this.tile === null) {
        throw new Error("tile is null");
      }
      const spawnTile = this.player.canBuild(UnitType.SAMLauncher, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build SAM Launcher");
        this.active = false;
        return;
      }
      this.sam = this.player.buildUnit(UnitType.SAMLauncher, spawnTile, {});
    }
    this.targetingSystem ??= new SAMTargetingSystem(
      this.mg,
      this.player,
      this.sam,
    );

    if (this.sam.isInCooldown()) {
      return;
    }

    if (!this.sam.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.sam.owner()) {
      this.player = this.sam.owner();
    }

    this.pseudoRandom ??= new PseudoRandom(this.sam.id());

    const mirvWarheadTargets = this.mg.nearbyUnits(
      this.sam.tile(),
      this.MIRVWarheadSearchRadius,
      UnitType.MIRVWarhead,
      ({ unit }) => {
        if (!isUnit(unit)) return false;
        if (unit.owner() === this.player) return false;
        if (this.player.isFriendly(unit.owner())) return false;
        const dst = unit.targetTile();
        return (
          this.sam !== null &&
          dst !== undefined &&
          this.mg.manhattanDist(dst, this.sam.tile()) <
            this.MIRVWarheadProtectionRadius
        );
      },
    );

    let target: Target | null = null;
    if (mirvWarheadTargets.length === 0) {
      target = this.targetingSystem.getSingleTarget();
    }

    const cooldown = this.sam.ticksLeftInCooldown();
    if (typeof cooldown === "number" && cooldown >= 0) {
      this.sam.touch();
    }

    const isSingleTarget = !!(target && !target.unit.targetedBySAM());
    if (
      (isSingleTarget || mirvWarheadTargets.length > 0) &&
      !isPeaceTimerActive
    ) {
      this.sam.launch();
      const type =
        mirvWarheadTargets.length > 0
          ? UnitType.MIRVWarhead
          : target?.unit.type();
      if (type === undefined) throw new Error("Unknown unit type");
      const random = this.pseudoRandom.next();
      const hit = this.isHit(type, random);
      if (!hit) {
        this.mg.displayMessage(
          `Missile failed to intercept ${type}`,
          MessageType.SAM_MISS,
          this.sam.owner().id(),
        );
      } else if (mirvWarheadTargets.length > 0) {
        const samOwner = this.sam.owner();

        // Message
        this.mg.displayMessage(
          `${mirvWarheadTargets.length} MIRV warheads intercepted`,
          MessageType.SAM_HIT,
          samOwner.id(),
        );

        mirvWarheadTargets.forEach(({ unit: u }) => {
          // Delete warheads
          u.delete();
        });

        // Record stats
        this.mg
          .stats()
          .bombIntercept(
            samOwner,
            UnitType.MIRVWarhead,
            mirvWarheadTargets.length,
          );
      } else if (target !== null) {
        target.unit.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.sam.tile(),
            this.sam.owner(),
            this.sam,
            target.unit,
            target.tile,
          ),
        );
      } else {
        // No valid target to engage (should not happen when firing)
      }
    }
    if ((this.mg.ticks() + this.cargoPlaneCheckOffset) % 20 === 0) {
      this.interceptPlanes();
    }
  }

  private interceptPlanes() {
    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;

    const effectiveRange = (() => {
      const base = this.mg.config().defaultSamRange();
      const bonus = this.mg.config().samRangeUpgradePercent();
      const lvl = this.sam!.level?.() ?? 1;
      if (lvl <= 1) return base;
      const factor = Math.pow(1 + bonus, lvl - 1);
      return Math.round(base * factor);
    })();

    const potentialAirborneTargets = this.mg.nearbyUnits(
      this.sam!.tile(),
      effectiveRange,
      [
        UnitType.CargoPlane,
        UnitType.Bomber,
        UnitType.FighterJet,
        UnitType.Paratrooper,
      ],
    );
    if (!this.sam) return;

    const validAirborneTargets = potentialAirborneTargets
      .filter(({ unit }) => {
        const unitOwner = unit.owner();
        const targetUnitOwner = unit.targetUnit()?.owner();

        if (unitOwner === this.player) return false;

        if (this.player.isFriendly(unitOwner as Player)) return false;
        if (
          targetUnitOwner === this.player ||
          (targetUnitOwner &&
            (targetUnitOwner as Player).isFriendly(this.player))
        ) {
          return false;
        }

        // Exclude returning bombers
        if (unit.type() === UnitType.Bomber && unit.returning()) {
          return false;
        }

        return !unit.targetedBySAM();
      })
      .sort((a, b) => {
        // Prioritize by unit type: Bomber > FighterJet > CargoPlane
        const typeOrder = {
          [UnitType.Bomber]: 0,
          [UnitType.FighterJet]: 1,
          [UnitType.CargoPlane]: 2,
        };
        const typeA = typeOrder[a.unit.type() as UnitType];
        const typeB = typeOrder[b.unit.type() as UnitType];

        if (typeA !== typeB) {
          return typeA - typeB;
        }

        // For same type, prioritize by distance (closer first)
        return a.distSquared - b.distSquared;
      });

    if (
      validAirborneTargets.length > 0 &&
      !this.sam.isInCooldown(this.mg.config().SAMPlaneCooldown()) &&
      !isPeaceTimerActive
    ) {
      this.sam.launch(this.mg.config().SAMPlaneCooldown());
      const samOwner = this.sam!.owner();
      const targetPlane = validAirborneTargets[0].unit;
      const random = this.pseudoRandom!.next();
      const hit = this.isHit(targetPlane.type(), random);

      if (hit) {
        this.mg.displayMessage(
          "messages.airplane_intercepted",
          MessageType.SAM_HIT,
          samOwner.id(),
        );

        targetPlane.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.sam!.tile(),
            this.sam!.owner(),
            this.sam!,
            targetPlane,
            targetPlane.tile(),
          ),
        );
      } else {
        this.mg.displayMessage(
          "messages.missile_failed_intercept",
          MessageType.SAM_MISS,
          this.sam.owner().id(),
        );
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
