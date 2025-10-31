import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitParams,
  UnitType,
  UpgradeType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";
import { ShellExecution } from "./ShellExecution";

export class WarshipExecution implements Execution {
  private random: PseudoRandom;
  private warship: Unit;
  private mg: Game;
  private pathfinder: PathFinder;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();
  private nextAAScanTick = 0;
  private nextAAMissileFireTick = 0;
  private pseudoRandom: PseudoRandom;

  constructor(
    private input: (UnitParams<UnitType.Warship> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = PathFinder.Mini(mg, 10_000, true, 100);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.warship = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Warship,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn warship for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.warship = this.input.owner.buildUnit(UnitType.Warship, spawn, {
        patrolTile: this.input.patrolTile,
      });
    }
    this.pseudoRandom = new PseudoRandom(this.warship.id());
  }

  tick(ticks: number): void {
    if (this.warship.health() <= 0) {
      this.warship.delete();
      return;
    }
    const hasPort = this.warship.owner().unitCount(UnitType.Port) > 0;
    if (hasPort) {
      this.warship.modifyHealth(1);
    }

    this.scanAndEngageAircraft();

    this.warship.setTargetUnit(this.findTargetUnit());
    if (this.warship.targetUnit()?.type() === UnitType.TradeShip) {
      this.huntDownTradeShip();
      return;
    }

    this.patrol();

    if (this.warship.targetUnit() !== undefined) {
      this.shootTarget();
      return;
    }
  }

  private findTargetUnit(): Unit | undefined {
    const hasPort = this.warship.owner().unitCount(UnitType.Port) > 0;
    const patrolRangeSquared = this.mg.config().warshipPatrolRange() ** 2;

    const ships = this.mg.nearbyUnits(
      this.warship.tile()!,
      this.mg.config().warshipTargettingRange(),
      [
        UnitType.TransportShip,
        UnitType.Warship,
        UnitType.TradeShip,
        UnitType.Submarine,
      ],
    );
    const potentialTargets: { unit: Unit; distSquared: number }[] = [];
    for (const { unit, distSquared } of ships) {
      if (
        unit.owner() === this.warship.owner() ||
        unit === this.warship ||
        unit.owner().isFriendly(this.warship.owner()) ||
        this.alreadySentShell.has(unit)
      ) {
        continue;
      }
      // Only engage if at war with the target's owner
      if (!this.warship.owner().isAtWarWith(unit.owner())) {
        continue;
      }
      if (unit.type() === UnitType.TradeShip) {
        if (
          !hasPort ||
          unit.isSafeFromPirates() ||
          unit.targetUnit()?.owner() === this.warship.owner() || // trade ship is coming to my port
          unit.targetUnit()?.owner().isFriendly(this.warship.owner()) // trade ship is coming to my ally
        ) {
          continue;
        }
        if (
          this.mg.euclideanDistSquared(
            this.warship.patrolTile()!,
            unit.tile(),
          ) > patrolRangeSquared
        ) {
          // Prevent warship from chasing trade ship that is too far away from
          // the patrol tile to prevent warships from wandering around the map.
          continue;
        }
      }
      if (unit.type() === UnitType.Submarine) {
        const isVisible =
          (unit.isAttacking ?? false) ||
          (unit.isDetectedByNavalUnit ?? false) ||
          this.mg.ticks() - (unit.lastVisibleTick ?? -Infinity) < 30;
        if (!isVisible) {
          continue; // Don't target stealthed submarines
        }
      }
      potentialTargets.push({ unit: unit, distSquared });
    }

    return potentialTargets.sort((a, b) => {
      const { unit: unitA, distSquared: distA } = a;
      const { unit: unitB, distSquared: distB } = b;

      // Prioritize Submarines
      if (
        unitA.type() === UnitType.Submarine &&
        unitB.type() !== UnitType.Submarine
      )
        return -1;
      if (
        unitA.type() !== UnitType.Submarine &&
        unitB.type() === UnitType.Submarine
      )
        return 1;

      // Then Warships
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
      this.warship.setTargetUnit(undefined);
      return; // Block attack
    }

    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new ShellExecution(
          this.warship.tile(),
          this.warship.owner(),
          this.warship,
          this.warship.targetUnit()!,
        ),
      );
      if (!this.warship.targetUnit()!.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.warship.targetUnit()!);
        this.warship.setTargetUnit(undefined);
        return;
      }
    }
  }

  private huntDownTradeShip() {
    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;

    if (isPeaceTimerActive) {
      this.warship.setTargetUnit(undefined);
      this.patrol(); // Continue patrolling
      return; // Block capture
    }

    for (let i = 0; i < 2; i++) {
      // target is trade ship so capture it.
      const result = this.pathfinder.nextTile(
        this.warship.tile(),
        this.warship.targetUnit()!.tile(),
        5,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.warship.owner().captureUnit(this.warship.targetUnit()!);
          this.warship.setTargetUnit(undefined);
          this.warship.move(this.warship.tile());
          return;
        case PathFindResultType.NextTile:
          this.warship.move(result.node);
          break;
        case PathFindResultType.Pending:
          this.warship.touch();
          break;
        case PathFindResultType.PathNotFound:
          console.log(`path not found to target`);
          break;
      }
    }
  }

  private patrol() {
    if (this.warship.targetTile() === undefined) {
      this.warship.setTargetTile(this.randomTile());
      if (this.warship.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.nextTile(
      this.warship.tile(),
      this.warship.targetTile()!,
    );
    switch (result.type) {
      case PathFindResultType.Completed:
        this.warship.setTargetTile(undefined);
        this.warship.move(result.node);
        break;
      case PathFindResultType.NextTile:
        this.warship.move(result.node);
        break;
      case PathFindResultType.Pending:
        this.warship.touch();
        return;
      case PathFindResultType.PathNotFound:
        console.warn(`path not found to target tile`);
        this.warship.setTargetTile(undefined);
        break;
    }
  }

  isActive(): boolean {
    return this.warship?.isActive();
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
        this.mg.x(this.warship.patrolTile()!) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      const y =
        this.mg.y(this.warship.patrolTile()!) +
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
      `Failed to find random tile for warship for ${this.warship.owner().name()}`,
    );
    if (!allowShoreline) {
      // If we failed to find a tile on the ocean, try again but allow shoreline
      return this.randomTile(true);
    }
    return undefined;
  }

  private scanAndEngageAircraft(): void {
    // Guard Clause: Check for the upgrade first.
    if (!this.warship.owner().hasUpgrade(UpgradeType.WarshipAntiAir)) {
      return;
    }

    // Throttling: Only scan periodically to save performance.
    if (this.mg.ticks() < this.nextAAScanTick) {
      return;
    }
    this.nextAAScanTick =
      this.mg.ticks() + this.mg.config().warshipAAScanInterval();

    // Target Scan & Squared Distance: Use squared values to avoid expensive sqrt operations.
    const rangeSq = this.mg.config().warshipAARange() ** 2;
    const nearbyAircraft = this.mg.nearbyUnits(
      this.warship.tile(),
      this.mg.config().warshipAARange(),
      [
        UnitType.Bomber,
        UnitType.FighterJet,
        UnitType.CargoPlane,
        UnitType.Paratrooper,
      ],
      ({ unit, distSquared }) =>
        !unit.owner().isFriendly(this.warship.owner()) &&
        !unit.targetedBySAM() &&
        distSquared <= rangeSq,
    );

    if (nearbyAircraft.length === 0) {
      return;
    }

    // Optimized Prioritization (No Sorting): Loop once to find the best target.
    const priority = {
      [UnitType.Paratrooper]: 1,
      [UnitType.Bomber]: 2,
      [UnitType.FighterJet]: 3,
      [UnitType.CargoPlane]: 4,
    };
    let bestTarget: Unit | null = null;
    let bestPriority = 4; // Start with a value higher than any valid priority

    for (const { unit } of nearbyAircraft) {
      const unitPriority = priority[unit.type()];
      if (unitPriority < bestPriority) {
        bestPriority = unitPriority;
        bestTarget = unit;
      }
    }

    // Firing Logic (Decoupled Cooldown)
    if (bestTarget) {
      if (this.mg.ticks() < this.nextAAMissileFireTick) {
        return;
      }

      const healthPercent =
        this.warship.health() / (this.warship.info().maxHealth ?? 1);
      const hit =
        this.pseudoRandom.next() <
        this.mg.config().warshipAAHittingChance() * healthPercent;

      if (hit) {
        this.mg.addExecution(
          new SAMMissileExecution(
            this.warship.tile(),
            this.warship.owner(),
            this.warship,
            bestTarget,
          ),
        );
        bestTarget.setTargetedBySAM(true);
      }

      this.nextAAMissileFireTick =
        this.mg.ticks() + this.mg.config().warshipAACooldown();
    }
  }
}
