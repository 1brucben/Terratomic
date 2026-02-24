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

import { StraightPathFinder } from "../pathfinding/PathFinder.Straight";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

export class FighterJetExecution implements Execution {
  executionName = "FighterJetExecution";
  private fighterJet: Unit;
  private mg: GameImpl;
  private random: PseudoRandom;
  private lastAttackTick = 0;
  private pathFinder: StraightPathFinder;
  private nextScanTick = 0;

  // Cache scan results (even when no target found)
  private cachedScanResult: Unit | undefined = undefined;
  private cachedScanTick = -999; // Start old so first scan happens
  private readonly SCAN_INTERVAL = 10; // ticks

  // Track current angle for figure-eight patrol
  private patrolAngle: number = 0;
  private patrolAngleInitialized: boolean = false;
  private lastPatrolTile: TileRef | undefined = undefined;

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
      if (this.fighterJet.isActive()) {
        this.fighterJet.delete();
      }
      return;
    }

    const hasAirfield =
      this.fighterJet.owner().units(UnitType.Airfield).length > 0;
    if (hasAirfield) {
      this.fighterJet.modifyHealth(this.mg.config().fighterJetHealingAmount());
    }

    // Check if we need to rescan or if cached target is still valid
    const currentTick = this.mg.ticks();
    const shouldRescan =
      currentTick >= this.nextScanTick ||
      (this.cachedScanResult !== undefined &&
        !this.cachedScanResult.isActive());

    if (shouldRescan) {
      this.cachedScanResult = this.findTargetUnit();
      this.cachedScanTick = currentTick;
      this.nextScanTick = currentTick + this.SCAN_INTERVAL;
      this.fighterJet.setTargetUnit(this.cachedScanResult);
      this.fighterJet.touch();
    } else {
      // Use cached result (may be undefined)
      this.fighterJet.setTargetUnit(this.cachedScanResult);
    }

    if (this.fighterJet.targetUnit() !== undefined) {
      // Reset patrol angle when engaging in combat so we smoothly rejoin figure-eight after
      this.patrolAngleInitialized = false;
      this.attackTarget();
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
      UnitType.Paratrooper,
      UnitType.Artillery,
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
        case UnitType.Artillery:
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
        !unit.isTargetable() ||
        unit.isAtSourceAirfield()
      ) {
        continue;
      }

      // Only target units from players we are at war with
      if (unit.owner().isPlayer() && !owner.isAtWarWith(unit.owner())) {
        continue;
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
      this.mg.config().fighterJetSpeed(this.fighterJet.level?.() ?? 1),
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

  private patrol() {
    if (this.fighterJet.patrolTile() === undefined) {
      return;
    }

    const patrolCenter = this.fighterJet.patrolTile()!;

    // Reset angle if patrol area changed
    if (this.lastPatrolTile !== patrolCenter) {
      this.patrolAngleInitialized = false;
      this.lastPatrolTile = patrolCenter;
    }

    const radius = this.mg.config().fighterJetPatrolRange() / 2;
    const speed = this.mg
      .config()
      .fighterJetSpeed(this.fighterJet.level?.() ?? 1);

    // Check distance from patrol center
    const distToCenter = this.mg.euclideanDistSquared(
      this.fighterJet.tile(),
      patrolCenter,
    );

    // If not yet initialized, fly toward the center first
    if (!this.patrolAngleInitialized) {
      const result = this.pathFinder.nextTile(
        this.fighterJet.tile(),
        patrolCenter,
        speed,
      );

      if (result !== true) {
        this.fighterJet.move(result);
      }

      // Initialize angle when we're close to center
      if (distToCenter <= speed * speed * 4) {
        this.patrolAngle = Math.PI / 2; // Start at center crossing point
        this.patrolAngleInitialized = true;
      }

      this.fighterJet.touch();
      return;
    }

    // Increment angle at constant rate for smooth motion
    const angularSpeed = speed / radius;
    this.patrolAngle += angularSpeed;

    // Simple figure-eight: horizontal oscillation + double-frequency vertical
    // Only 2 trig calls + 2 multiplies - very cheap
    const newX = Math.round(
      this.mg.x(patrolCenter) + Math.cos(this.patrolAngle) * radius,
    );
    const newY = Math.round(
      this.mg.y(patrolCenter) + Math.sin(this.patrolAngle * 2) * (radius * 0.5),
    );

    // Clamp to map bounds
    const clampedX = Math.max(0, Math.min(this.mg.width() - 1, newX));
    const clampedY = Math.max(0, Math.min(this.mg.height() - 1, newY));

    const newTile = this.mg.map().ref(clampedX, clampedY);

    // Only move if we're actually on a different tile
    if (
      this.fighterJet.tile() === undefined ||
      this.mg.x(newTile) !== this.mg.x(this.fighterJet.tile()!) ||
      this.mg.y(newTile) !== this.mg.y(this.fighterJet.tile()!)
    ) {
      this.fighterJet.move(newTile);
    }

    this.fighterJet.touch();
  }

  // Legacy method - no longer used for patrol, but kept in case other code references it
  private randomTile(): TileRef | undefined {
    return this.fighterJet.patrolTile();
  }

  isActive(): boolean {
    return this.fighterJet?.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
