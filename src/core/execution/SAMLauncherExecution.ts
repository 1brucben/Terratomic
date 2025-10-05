import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";

export class SAMLauncherExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  // As MIRV go very fast we have to detect them very early but we only
  // shoot the one targeting very close (MIRVWarheadProtectionRadius)
  private MIRVWarheadSearchRadius = 400;
  private MIRVWarheadProtectionRadius = 50;

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

  private getSingleTarget(): Unit | null {
    if (this.sam === null) return null;
    const nukes = this.mg.nearbyUnits(
      this.sam.tile(),
      this.mg.config().defaultSamRange(),
      [UnitType.AtomBomb, UnitType.HydrogenBomb],
      ({ unit }) =>
        unit.owner() !== this.player &&
        !this.player.isFriendly(unit.owner()) &&
        unit.isTargetable(),
    );

    return (
      nukes.sort((a, b) => {
        const { unit: unitA, distSquared: distA } = a;
        const { unit: unitB, distSquared: distB } = b;

        // Prioritize Hydrogen Bombs
        if (
          unitA.type() === UnitType.HydrogenBomb &&
          unitB.type() !== UnitType.HydrogenBomb
        )
          return -1;
        if (
          unitA.type() !== UnitType.HydrogenBomb &&
          unitB.type() === UnitType.HydrogenBomb
        )
          return 1;

        // If both are the same type, sort by distance (lower `distSquared` means closer)
        return distA - distB;
      })[0]?.unit ?? null
    );
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

    let target: Unit | null = null;
    if (mirvWarheadTargets.length === 0) {
      target = this.getSingleTarget();
    }

    const cooldown = this.sam.ticksLeftInCooldown();
    if (typeof cooldown === "number" && cooldown >= 0) {
      this.sam.touch();
    }

    const isSingleTarget = target && !target.targetedBySAM();
    if (
      (isSingleTarget || mirvWarheadTargets.length > 0) &&
      !this.sam.isInCooldown() &&
      !isPeaceTimerActive
    ) {
      this.sam.launch();
      const type =
        mirvWarheadTargets.length > 0 ? UnitType.MIRVWarhead : target?.type();
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
      } else if (target !== null && hit) {
        target.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.sam.tile(),
            this.sam.owner(),
            this.sam,
            target,
          ),
        );
      } else if (target !== null) {
        // Do nothing, the missile missed
      } else {
        throw new Error("target is null");
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

    const potentialAirborneTargets = this.mg.nearbyUnits(
      this.sam!.tile(),
      this.cargoPlaneSearchRadius,
      [UnitType.CargoPlane, UnitType.Bomber, UnitType.FighterJet],
    );
    if (!this.sam) return;

    const validAirborneTargets = potentialAirborneTargets
      .filter(({ unit }) => {
        const unitOwner = unit.owner();
        const targetUnitOwner = unit.targetUnit()?.owner();

        if (unitOwner === this.player) return false;

        if (this.player.isFriendly(unitOwner)) return false;
        if (
          targetUnitOwner === this.player ||
          (targetUnitOwner && targetUnitOwner.isFriendly(this.player))
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
