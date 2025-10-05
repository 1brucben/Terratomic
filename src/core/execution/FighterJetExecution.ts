import { Execution, OwnerComp, Unit, UnitParams, UnitType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { TileRef } from "../game/GameMap";

import { StraightPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

export class FighterJetExecution implements Execution {
  private fighterJet: Unit;
  private mg: GameImpl;
  private random: PseudoRandom;
  private alreadySentShell: Set<Unit> = new Set();
  private pathFinder: StraightPathFinder;

  constructor(
    private input: (UnitParams<UnitType.FighterJet> & OwnerComp) | Unit,
  ) {}

  init(mg: GameImpl): void {
    this.mg = mg;
    this.random = new PseudoRandom(this.mg.ticks());
    this.pathFinder = new StraightPathFinder(mg);
    if ("isUnit" in this.input) {
      this.fighterJet = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.FighterJet,
        this.input.patrolTile,
      );
      if (!spawn) {
        return;
      }
      this.fighterJet = this.input.owner.buildUnit(UnitType.FighterJet, spawn, {
        patrolTile: this.input.patrolTile,
      });
    }
  }

  tick(): void {
    if (this.fighterJet.health() <= 0) {
      this.fighterJet.delete();
      return;
    }

    const hasAirfield =
      this.fighterJet.owner().units(UnitType.Airfield).length > 0;
    if (hasAirfield) {
      this.fighterJet.modifyHealth(this.mg.config().fighterJetHealingAmount());
    }

    this.fighterJet.setTargetUnit(this.findTargetUnit());

    if (this.fighterJet.targetUnit() !== undefined) {
      if (this.fighterJet.targetUnit()?.type() === UnitType.CargoPlane) {
        this.captureCargoPlane();
      } else {
        this.attackTarget();
      }
    } else {
      this.patrol();
    }
  }

  private findTargetUnit(): Unit | undefined {
    const hasAirfield =
      this.fighterJet.owner().units(UnitType.Airfield).length > 0;
    const patrolRangeSquared = this.mg.config().fighterJetPatrolRange() ** 2;
    const closest = this._findClosest(
      this.fighterJet.tile()!,
      this.mg.config().fighterJetTargettingRange(),
      [UnitType.Bomber, UnitType.FighterJet, UnitType.CargoPlane],
      (unit) => {
        if (
          unit.owner() === this.fighterJet.owner() ||
          unit === this.fighterJet ||
          unit.owner().isFriendly(this.fighterJet.owner()) ||
          !unit.isTargetable()
        ) {
          return false;
        }
        if (unit.type() === UnitType.CargoPlane) {
          if (!hasAirfield) {
            return false;
          }
          const cargoPlaneDestinationAirfield = unit.targetUnit();
          if (cargoPlaneDestinationAirfield) {
            const destinationOwner = cargoPlaneDestinationAirfield.owner();
            if (
              destinationOwner === this.fighterJet.owner() ||
              destinationOwner.isFriendly(this.fighterJet.owner())
            ) {
              return false;
            }
          }
        }
        return true;
      },
    );

    if (closest.length === 0) {
      return undefined;
    }

    closest.sort((a, b) => {
      const distA = this.mg.euclideanDistSquared(
        this.fighterJet.tile()!,
        a.tile()!,
      );
      const distB = this.mg.euclideanDistSquared(
        this.fighterJet.tile()!,
        b.tile()!,
      );

      if (a.type() === UnitType.FighterJet && b.type() !== UnitType.FighterJet)
        return -1;
      if (a.type() !== UnitType.FighterJet && b.type() === UnitType.FighterJet)
        return 1;
      if (a.type() === UnitType.Bomber && b.type() === UnitType.CargoPlane)
        return -1;
      if (a.type() === UnitType.CargoPlane && b.type() === UnitType.Bomber)
        return 1;

      return distA - distB;
    });

    return closest[0];
  }

  private attackTarget() {
    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;

    if (isPeaceTimerActive) {
      this.fighterJet.setTargetUnit(undefined);
      return; // Block attack
    }

    if (this.fighterJet.targetUnit() === undefined) {
      return;
    }

    const targetUnit = this.fighterJet.targetUnit()!;
    const distToTargetSquared = this.mg.euclideanDistSquared(
      this.fighterJet.tile(),
      targetUnit.tile(),
    );
    const dogfightDistanceSquared =
      this.mg.config().fighterJetDogfightDistance() ** 2;
    const minDogfightDistanceSquared =
      this.mg.config().fighterJetMinDogfightDistance() ** 2;

    let targetTileForMovement: TileRef;

    if (distToTargetSquared <= dogfightDistanceSquared) {
      const dogfightRange = this.mg.config().fighterJetDogfightDistance();
      let newX: number;
      let newY: number;
      let attempts = 0;
      const maxAttempts = 10;

      do {
        newX =
          this.mg.x(targetUnit.tile()) +
          this.random.nextInt(
            Math.floor(-dogfightRange / 2),
            Math.floor(dogfightRange / 2),
          );
        newY =
          this.mg.y(targetUnit.tile()) +
          this.random.nextInt(
            Math.floor(-dogfightRange / 2),
            Math.floor(dogfightRange / 2),
          );
        attempts++;
      } while (
        (newX === this.mg.x(targetUnit.tile()) &&
          newY === this.mg.y(targetUnit.tile())) ||
        !this.mg.isValidCoord(newX, newY) ||
        (this.mg.euclideanDistSquared(
          this.mg.map().ref(newX, newY),
          targetUnit.tile(),
        ) < minDogfightDistanceSquared &&
          attempts < maxAttempts)
      );

      if (this.mg.isValidCoord(newX, newY)) {
        targetTileForMovement = this.mg.map().ref(newX, newY);
      } else {
        targetTileForMovement = targetUnit.tile();
      }
    } else {
      targetTileForMovement = targetUnit.tile();
    }

    const result = this.pathFinder.nextTile(
      this.fighterJet.tile(),
      targetTileForMovement,
      this.mg.config().fighterJetSpeed(),
    );

    if (result !== true) {
      this.fighterJet.move(result);
    }
    this.fighterJet.touch();

    if (
      distToTargetSquared <=
      this.mg.config().fighterJetTargetReachedDistance() ** 2
    ) {
      this.alreadySentShell.add(targetUnit);
      this.fighterJet.setTargetUnit(undefined);
      return;
    }

    const shellAttackRate = this.mg.config().fighterJetAttackRate();
    if (this.mg.ticks() % shellAttackRate === 0) {
      this.mg.addExecution(
        new ShellExecution(
          this.fighterJet.tile()!,
          this.fighterJet.owner(),
          this.fighterJet,
          targetUnit,
        ),
      );
    }
  }

  private captureCargoPlane() {
    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;

    if (isPeaceTimerActive) {
      this.fighterJet.setTargetUnit(undefined);
      return; // Block capture
    }

    if (this.fighterJet.targetUnit() === undefined) {
      return;
    }

    const targetUnit = this.fighterJet.targetUnit()!;
    const distToTargetSquared = this.mg.euclideanDistSquared(
      this.fighterJet.tile(),
      targetUnit.tile(),
    );
    const targetReachedDistanceSquared =
      this.mg.config().fighterJetTargetReachedDistance() ** 2;

    if (distToTargetSquared <= targetReachedDistanceSquared) {
      this.fighterJet.owner().captureUnit(targetUnit);
      this.fighterJet.setTargetUnit(undefined);
      return;
    }

    const result = this.pathFinder.nextTile(
      this.fighterJet.tile(),
      targetUnit.tile(),
      4,
    );

    if (result !== true) {
      this.fighterJet.move(result);
    }
    this.fighterJet.touch();
  }

  private patrol() {
    if (this.fighterJet.targetTile() === undefined) {
      this.fighterJet.setTargetTile(this.randomTile());
      if (this.fighterJet.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathFinder.nextTile(
      this.fighterJet.tile(),
      this.fighterJet.targetTile()!,
      this.mg.config().fighterJetSpeed(),
    );

    if (result === true) {
      this.fighterJet.setTargetTile(undefined);
    } else {
      this.fighterJet.move(result);
    }
    this.fighterJet.touch();
  }

  private randomTile(): TileRef | undefined {
    if (this.fighterJet.patrolTile() === undefined) {
      return undefined;
    }

    const fighterJetPatrolRange = this.mg.config().fighterJetPatrolRange();
    const x =
      this.mg.x(this.fighterJet.patrolTile()!) +
      this.random.nextInt(
        Math.floor(-fighterJetPatrolRange / 2),
        Math.floor(fighterJetPatrolRange / 2),
      );
    const y =
      this.mg.y(this.fighterJet.patrolTile()!) +
      this.random.nextInt(
        Math.floor(-fighterJetPatrolRange / 2),
        Math.floor(fighterJetPatrolRange / 2),
      );
    if (!this.mg.isValidCoord(x, y)) {
      return undefined;
    }
    return this.mg.map().ref(x, y);
  }

  private _findClosest(
    startTile: TileRef,
    range: number,
    unitTypes: UnitType[],
    predicate: (unit: Unit) => boolean,
  ): Unit[] {
    const nearbyUnits = this.mg.nearbyUnits(startTile, range, unitTypes);
    const validUnits: Unit[] = [];

    for (const { unit } of nearbyUnits) {
      if (predicate(unit)) {
        validUnits.push(unit);
      }
    }

    validUnits.sort((a, b) => {
      const distA = this.mg.euclideanDistSquared(startTile, a.tile());
      const distB = this.mg.euclideanDistSquared(startTile, b.tile());

      if (
        a.type() === UnitType.FighterJet &&
        b.type() !== UnitType.FighterJet
      ) {
        return -1;
      }
      if (
        a.type() !== UnitType.FighterJet &&
        b.type() === UnitType.FighterJet
      ) {
        return 1;
      }

      return distA - distB;
    });

    return validUnits;
  }

  isActive(): boolean {
    return this.fighterJet?.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
