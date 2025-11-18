import {
  Execution,
  OwnerComp,
  Unit,
  UnitParams,
  UnitType,
  UpgradeType,
} from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { TileRef } from "../game/GameMap";

import { StraightPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

export class FighterJetExecution implements Execution {
  private fighterJet: Unit;
  private mg: GameImpl;
  private random: PseudoRandom;
  private lastAttackTick = 0;
  private pathFinder: StraightPathFinder;
  private nextScanTick = 0;

  constructor(
    private input: (UnitParams<UnitType.FighterJet> & OwnerComp) | Unit,
    private desiredLevel: number = 1,
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
      const lvl = Math.max(1, this.desiredLevel | 0);
      if (lvl > 1) {
        (this.fighterJet as any)._level = lvl;
        // Apply per-level max health using config
        const base =
          this.mg.config().unitInfo(UnitType.FighterJet).maxHealth ?? 750;
        const desired = this.mg.config().fighterJetLevelMaxHealth(lvl);
        const bonus = Math.max(0, desired - base);
        (this.fighterJet as any)._bonusMaxHealth = bonus;
        (this.fighterJet as any)._health = BigInt(desired);
        this.mg.addUpdate(this.fighterJet.toUpdate());
      }
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

    if (
      this.mg.ticks() >= this.nextScanTick ||
      !this.fighterJet.targetUnit()?.isActive()
    ) {
      this.fighterJet.setTargetUnit(this.findTargetUnit());
      this.fighterJet.touch();
      this.nextScanTick = this.mg.ticks() + 10;
    }

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
    const owner = this.fighterJet.owner();
    const ownerHasUpgrade = owner.hasUpgrade(
      UpgradeType.FighterJetNavalTargeting,
    );

    const targetableUnitTypes: UnitType[] = [
      UnitType.Bomber,
      UnitType.FighterJet,
      UnitType.CargoPlane,
      UnitType.Paratrooper,
    ];

    if (ownerHasUpgrade) {
      targetableUnitTypes.push(
        UnitType.TransportShip,
        UnitType.Warship,
        UnitType.TradeShip,
      );
    }

    const nearbyUnits = this.mg.nearbyUnits(
      this.fighterJet.tile()!,
      this.mg.config().fighterJetTargettingRange(),
      targetableUnitTypes,
    );

    let bestTarget: Unit | undefined = undefined;
    let bestPriority = 999;
    let bestDistSquared = Infinity;

    const getPriority = (type: UnitType): number => {
      switch (type) {
        case UnitType.FighterJet:
          return 1;
        case UnitType.Bomber:
          return 2;
        case UnitType.Paratrooper:
          return 3;
        case UnitType.CargoPlane:
          return 4;
        case UnitType.TransportShip:
          return 5;
        case UnitType.Warship:
          return 6;
        case UnitType.TradeShip:
          return 7;
        default:
          return 99;
      }
    };

    for (const { unit, distSquared } of nearbyUnits) {
      if (
        unit.owner() === owner ||
        unit === this.fighterJet ||
        unit.owner().isFriendly(owner) ||
        !unit.isTargetable()
      ) {
        continue;
      }

      if (unit.type() === UnitType.CargoPlane) {
        if (owner.units(UnitType.Airfield).length === 0) {
          continue;
        }
        const cargoPlaneDestinationAirfield = unit.targetUnit();
        if (cargoPlaneDestinationAirfield) {
          const destinationOwner = cargoPlaneDestinationAirfield.owner();
          if (
            destinationOwner === owner ||
            destinationOwner.isFriendly(owner)
          ) {
            continue;
          }
        }
      }

      if (ownerHasUpgrade && unit.type() === UnitType.TradeShip) {
        if (
          owner.units(UnitType.Port).length === 0 ||
          unit.isSafeFromPirates() ||
          unit.targetUnit()?.owner() === owner ||
          unit.targetUnit()?.owner().isFriendly(owner)
        ) {
          continue;
        }
      }

      const priority = getPriority(unit.type());

      if (priority < bestPriority) {
        bestTarget = unit;
        bestPriority = priority;
        bestDistSquared = distSquared;
      } else if (priority === bestPriority) {
        if (distSquared < bestDistSquared) {
          bestTarget = unit;
          bestDistSquared = distSquared;
        }
      }
    }

    return bestTarget;
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

    if (this.mg.ticks() - this.lastAttackTick < 20) {
      return;
    }
    this.lastAttackTick = this.mg.ticks();

    switch (targetUnit.type()) {
      case UnitType.TransportShip:
      case UnitType.TradeShip:
      case UnitType.Warship:
        this.mg.addExecution(
          new ShellExecution(
            this.fighterJet.tile()!,
            this.fighterJet.owner(),
            this.fighterJet,
            targetUnit,
          ),
        );
        break;
      default: //FighterJet and Bomber
        this.mg.addExecution(
          new ShellExecution(
            this.fighterJet.tile()!,
            this.fighterJet.owner(),
            this.fighterJet,
            targetUnit,
          ),
        );
        break;
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

  isActive(): boolean {
    return this.fighterJet?.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
