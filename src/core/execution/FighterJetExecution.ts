import { Execution, OwnerComp, Unit, UnitParams, UnitType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { TileRef } from "../game/GameMap";
import { findClosest } from "../game/GameMapUtils";
import { StraightPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

import { MessageType } from "../game/Game";

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
        this.mg.displayMessage(
          `Failed to spawn fighter jet for ${this.input.owner.name()} at ${this.input.patrolTile}`,
          MessageType.WARN,
          this.input.owner.id(),
        );
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

    // Heal if we have a port
    const hasAirfield =
      this.fighterJet.owner().units(UnitType.Airfield).length > 0;
    if (hasAirfield) {
      this.fighterJet.modifyHealth(1);
    }

    this.fighterJet.setTargetUnit(this.findTargetUnit());
    if (this.fighterJet.targetUnit()?.type() === UnitType.TradeShip) {
      // We can only capture trade ships if we have a port
      if (!hasAirfield) {
        this.fighterJet.setTargetUnit(undefined);
      }
    }

    if (this.fighterJet.targetUnit() !== undefined) {
      // Attack
      this.attack();
    } else {
      // Patrol
      this.patrol();
    }
  }

  private findTargetUnit(): Unit | undefined {
    const hasAirfield =
      this.fighterJet.owner().units(UnitType.Airfield).length > 0;
    const patrolRangeSquared = this.mg.config().fighterJetPatrolRange() ** 2;

    const closest = findClosest(
      this.fighterJet.tile()!,
      this.mg.config().fighterJetTargettingRange(),
      [UnitType.Bomber, UnitType.FighterJet],
      this.mg,
      (unit) => {
        // Dont target our own units
        if (
          unit.owner() === this.fighterJet.owner() ||
          unit === this.fighterJet ||
          unit.owner().isFriendly(this.fighterJet.owner()) ||
          !unit.isTargetable()
        ) {
          return false;
        }

        return true;
      },
    );

    if (closest.length === 0) {
      return undefined;
    }

    // Sort by distance and then by priority
    closest.sort((a, b) => {
      const distA = this.mg.euclideanDistSquared(
        this.fighterJet.tile()!,
        a.tile()!,
      );
      const distB = this.mg.euclideanDistSquared(
        this.fighterJet.tile()!,
        b.tile()!,
      );

      // Prioritize FighterJets
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

    return closest[0];
  }

  private attack() {
    if (this.fighterJet.targetUnit() === undefined) {
      return;
    }

    const shellAttackRate = this.mg.config().fighterJetAttackRate();
    if (this.mg.ticks() % shellAttackRate !== 0) {
      return;
    }

    this.mg.addExecution(
      new ShellExecution(
        this.fighterJet.tile()!,
        this.fighterJet.owner(),
        this.fighterJet,
        this.fighterJet.targetUnit()!,
      ),
    );

    if (!this.fighterJet.targetUnit()!.hasHealth()) {
      // The target is already dead, so we can stop attacking it
      this.alreadySentShell.add(this.fighterJet.targetUnit()!);
      this.fighterJet.setTargetUnit(undefined);
      return;
    }

    const result = this.pathFinder.nextTile(
      this.fighterJet.tile(),
      this.fighterJet.targetUnit()!.tile(),
      2,
    );

    if (result === true) {
      // Reached target
    } else {
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
      2,
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
        -fighterJetPatrolRange / 2,
        fighterJetPatrolRange / 2,
      );
    const y =
      this.mg.y(this.fighterJet.patrolTile()!) +
      this.random.nextInt(
        -fighterJetPatrolRange / 2,
        fighterJetPatrolRange / 2,
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
