import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

export class SubmarineExecution implements Execution {
  private random: PseudoRandom;
  private submarine: Unit;
  private mg: GameImpl;
  private pathfinder: PathFinder;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();

  constructor(
    private input: (UnitParams<UnitType.Submarine> & OwnerComp) | Unit,
    private desiredLevel: number = 1,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg as GameImpl;
    this.pathfinder = PathFinder.Mini(mg, 10_000, true, 100);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.submarine = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Submarine,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn submarine for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.submarine = this.input.owner.buildUnit(UnitType.Submarine, spawn, {
        patrolTile: this.input.patrolTile,
      });
      const lvl = Math.max(1, this.desiredLevel | 0);
      if (lvl > 1) {
        (this.submarine as any)._level = lvl;
        this.mg.addUpdate(this.submarine.toUpdate());
      }
    }
  }

  tick(ticks: number) {
    if (this.submarine.health() <= 0) {
      this.submarine.delete();
      return;
    }

    this.updateDetectionState();
    this.submarine.isAttacking = false;

    const hasPort = this.submarine.owner().unitCount(UnitType.Port) > 0;
    if (hasPort) {
      this.submarine.modifyHealth(1);
    }

    this.submarine.setTargetUnit(this.findTargetUnit());

    this.patrol();

    if (this.submarine.targetUnit() !== undefined) {
      this.submarine.isAttacking = true;
      this.submarine.touch();
      this.shootTarget();
      return;
    }
  }

  private updateDetectionState(): void {
    const nearbyNavalUnits = this.mg.nearbyUnits(
      this.submarine.tile()!,
      this.mg.config().warshipTargettingRange(), // Using warship's range for detection
      [UnitType.Warship, UnitType.Submarine],
      ({ unit }) =>
        unit.owner() !== this.submarine.owner() &&
        !unit.owner().isFriendly(this.submarine.owner() as any),
    );

    if (nearbyNavalUnits.length > 0) {
      this.submarine.isDetectedByNavalUnit = true;
    } else {
      this.submarine.isDetectedByNavalUnit = false;
    }
  }

  private findTargetUnit(): Unit | undefined {
    const hasPort = this.submarine.owner().unitCount(UnitType.Port) > 0;
    const patrolRangeSquared = this.mg.config().warshipPatrolRange() ** 2;

    const ships = this.mg.nearbyUnits(
      this.submarine.tile()!,
      this.mg.config().warshipTargettingRange(),
      [
        UnitType.TransportShip,
        UnitType.Warship,
        UnitType.Submarine,
        UnitType.TradeShip,
      ],
    );
    const potentialTargets: { unit: Unit; distSquared: number }[] = [];
    for (const { unit, distSquared } of ships) {
      if (
        unit.owner() === this.submarine.owner() ||
        unit === this.submarine ||
        unit.owner().isFriendly(this.submarine.owner() as any) ||
        this.alreadySentShell.has(unit)
      ) {
        continue;
      }
      // Only engage if at war with the target's owner
      if (!this.submarine.owner().isAtWarWith(unit.owner())) {
        continue;
      }
      if (unit.type() === UnitType.TradeShip) {
        if (
          !hasPort ||
          unit.isSafeFromPirates() ||
          unit.targetUnit()?.owner() === this.submarine.owner() || // trade ship is coming to my port
          unit
            .targetUnit()
            ?.owner()
            .isFriendly(this.submarine.owner() as any) // trade ship is coming to my ally
        ) {
          continue;
        }
        if (
          this.mg.euclideanDistSquared(
            this.submarine.patrolTile()!,
            unit.tile(),
          ) > patrolRangeSquared
        ) {
          // Prevent warship from chasing trade ship that is too far away from
          // the patrol tile to prevent warships from wandering around the map.
          continue;
        }
      }
      potentialTargets.push({ unit: unit, distSquared });
    }

    return potentialTargets.sort((a, b) => {
      const { unit: unitA, distSquared: distA } = a;
      const { unit: unitB, distSquared: distB } = b;

      // Prioritize Warships
      if (
        unitA.type() === UnitType.Warship &&
        unitB.type() !== UnitType.Warship
      )
        return -1;
      if (
        unitA.type() !== UnitType.Warship &&
        unitB.type() === UnitType.Warship
      )
        return 1;

      // Then favor Transport Ships over Trade Ships
      if (
        unitA.type() === UnitType.TransportShip &&
        unitB.type() !== UnitType.TransportShip
      )
        return -1;
      if (
        unitA.type() !== UnitType.TransportShip &&
        unitB.type() === UnitType.TransportShip
      )
        return 1;

      // If both are the same type, sort by distance (lower `distSquared` means closer)
      return distA - distB;
    })[0]?.unit;
  }

  private shootTarget() {
    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;

    if (isPeaceTimerActive) {
      this.submarine.setTargetUnit(undefined);
      return; // Block attack
    }

    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new ShellExecution(
          this.submarine.tile(),
          this.submarine.owner(),
          this.submarine,
          this.submarine.targetUnit()!,
        ),
      );
      if (!this.submarine.targetUnit()!.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.submarine.targetUnit()!);
        this.submarine.setTargetUnit(undefined);
        return;
      }
    }
  }

  private patrol() {
    if (this.submarine.targetTile() === undefined) {
      this.submarine.setTargetTile(this.randomTile());
      if (this.submarine.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.nextTile(
      this.submarine.tile(),
      this.submarine.targetTile()!,
    );
    switch (result.type) {
      case PathFindResultType.Completed:
        this.submarine.setTargetTile(undefined);
        this.submarine.move(result.node);
        break;
      case PathFindResultType.NextTile:
        this.submarine.move(result.node);
        break;
      case PathFindResultType.Pending:
        this.submarine.touch();
        return;
      case PathFindResultType.PathNotFound:
        console.warn(`path not found to target tile`);
        this.submarine.setTargetTile(undefined);
        break;
    }
  }

  isActive(): boolean {
    return this.submarine?.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(allowShoreline: boolean = false): TileRef | undefined {
    let warshipPatrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand: number = 500;
    let attempts: number = 0;
    let expandCount: number = 0;
    while (expandCount < 3) {
      const x =
        this.mg.x(this.submarine.patrolTile()!) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      const y =
        this.mg.y(this.submarine.patrolTile()!) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        !this.mg.isOcean(tile) ||
        (!allowShoreline && this.mg.isShoreline(tile))
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    console.warn(
      `Failed to find random tile for warship for ${this.submarine.owner().name()}`,
    );
    if (!allowShoreline) {
      // If we failed to find a tile on the ocean, try again but allow shoreline
      return this.randomTile(true);
    }
    return undefined;
  }
}
