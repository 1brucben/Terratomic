import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Player,
  Unit,
  UnitParams,
  UnitType,
  UpgradeType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";
import { ShellExecution } from "./ShellExecution";

export class WarshipExecution implements Execution {
  executionName = "WarshipExecution";
  private random: PseudoRandom;
  private warship: Unit;
  private mg: Game;
  private pathfinder: SteppingPathFinder<TileRef>;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();
  private nextAAScanTick = 0;
  private nextAAMissileFireTick = 0;
  private pseudoRandom: PseudoRandom;

  // Target caching to reduce nearbyUnits() calls
  private cachedTarget: Unit | undefined = undefined;
  private cachedTargetTick = -999; // Start old so first scan happens
  private readonly TARGET_CACHE_DURATION = 10; // ticks

  constructor(
    private input: (UnitParams<UnitType.Warship> & OwnerComp) | Unit,
    private desiredLevel: number = 1,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = PathFinding.Water(mg);
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
      const lvl = Math.max(1, this.desiredLevel | 0);
      if (lvl > 1) {
        (this.warship as any)._level = lvl;
        // Apply per-level max health boost
        const base =
          this.mg.config().unitInfo(UnitType.Warship).maxHealth ?? 1000;
        const desired = this.mg.config().warshipLevelMaxHealth(lvl);
        const bonus = Math.max(0, desired - base);
        (this.warship as any)._bonusMaxHealth = bonus;
        (this.warship as any)._health = BigInt(desired);
        this.mg.addUpdate(this.warship.toUpdate());
      }
    }
    this.pseudoRandom = new PseudoRandom(this.warship.id());
  }

  tick(ticks: number): void {
    if (this.warship.health() <= 0) {
      if (this.warship.isActive()) {
        this.warship.delete();
      }
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
    const currentTick = this.mg.ticks();

    // Check if cache is still valid (even if result was "no target")
    if (currentTick - this.cachedTargetTick < this.TARGET_CACHE_DURATION) {
      // If we cached a target, verify it's still valid
      if (this.cachedTarget !== undefined) {
        if (
          this.cachedTarget.isActive() &&
          this.isValidTarget(this.cachedTarget)
        ) {
          return this.cachedTarget;
        }
        // Cached target became invalid, fall through to rescan
      } else {
        // We cached "no target found" - return that result without rescanning
        return undefined;
      }
    }

    // Cache expired or cached target invalid - do full scan
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
        UnitType.Artillery,
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
      // Decide engagement rules per unit type
      if (unit.type() === UnitType.TradeShip) {
        const shipOwner = unit.owner();
        const myOwner = this.warship.owner();
        const startOwner = unit.tradeRouteStartOwner();
        const endOwner = unit.tradeRouteEndOwner();
        const atWarWithAnyEndpoint = [startOwner, endOwner]
          .filter((p): p is Player => !!p)
          .some((p) => myOwner.isAtWarWith(p));

        const embargoAgainstAnyEndpoint = [startOwner, endOwner]
          .filter((p): p is Player => !!p)
          .some(
            (p) => myOwner.hasEmbargoAgainst(p) || p.hasEmbargoAgainst(myOwner),
          );

        const canTargetTrade =
          myOwner.isAtWarWith(shipOwner) ||
          ((atWarWithAnyEndpoint || embargoAgainstAnyEndpoint) &&
            !myOwner.isFriendly(shipOwner));
        if (!canTargetTrade) {
          continue;
        }
      } else {
        // Non-trade ships: only target if at war with owner
        const atWar = this.warship.owner().isAtWarWith(unit.owner());
        let allow = atWar;
        if (!allow && unit.type() === UnitType.TransportShip) {
          // Treat incoming transport headed to us as hostile even if not formally at war
          const targetPID = (unit as any).boatTargetPlayerID?.();
          const incomingToMe =
            targetPID === this.warship.owner().id() &&
            !this.warship.owner().isFriendly(unit.owner());
          allow = incomingToMe;
        }
        if (!allow) {
          continue;
        }
      }
      if (unit.type() === UnitType.TradeShip) {
        if (!hasPort || unit.isSafeFromPirates() || this.isDockedAtPort(unit)) {
          continue;
        }
        // Keep patrol range constraint for trade ships
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

    const bestTarget = potentialTargets.sort((a, b) => {
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

      // Then Artillery (coastal land-based threat)
      if (
        unitA.type() === UnitType.Artillery &&
        unitB.type() !== UnitType.Artillery
      )
        return -1;
      if (
        unitA.type() !== UnitType.Artillery &&
        unitB.type() === UnitType.Artillery
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

    // Update cache
    this.cachedTarget = bestTarget;
    this.cachedTargetTick = currentTick;

    return bestTarget;
  }

  private isValidTarget(target: Unit): boolean {
    if (!target.isActive()) return false;
    if (target.health() <= 0) return false;
    if (target.owner() === this.warship.owner()) return false;
    if (target.owner().isFriendly(this.warship.owner())) return false;
    if (this.alreadySentShell.has(target)) return false;

    // Check if at war (for non-trade ships), with exception for incoming transport ships
    if (target.type() !== UnitType.TradeShip) {
      if (!this.warship.owner().isAtWarWith(target.owner())) {
        if (target.type() === UnitType.TransportShip) {
          const targetPID = (target as any).boatTargetPlayerID?.();
          const incomingToMe =
            targetPID === this.warship.owner().id() &&
            !this.warship.owner().isFriendly(target.owner());
          if (!incomingToMe) return false;
        } else {
          return false;
        }
      }
    }

    // Check submarine visibility
    if (target.type() === UnitType.Submarine) {
      const isVisible =
        (target.isAttacking ?? false) ||
        (target.isDetectedByNavalUnit ?? false) ||
        this.mg.ticks() - (target.lastVisibleTick ?? -Infinity) < 30;
      if (!isVisible) return false;
    }

    // Check range
    const dist = this.mg.euclideanDistSquared(
      this.warship.tile()!,
      target.tile(),
    );
    const maxRange = this.mg.config().warshipTargettingRange();
    if (dist > maxRange * maxRange) return false;

    return true;
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
      const result = this.pathfinder.next(
        this.warship.tile(),
        this.warship.targetUnit()!.tile(),
        5,
      );
      switch (result.status) {
        case PathStatus.COMPLETE:
          this.warship.owner().captureUnit(this.warship.targetUnit()!);
          this.warship.setTargetUnit(undefined);
          this.warship.move(this.warship.tile());
          return;
        case PathStatus.NEXT:
          this.warship.move(result.node);
          break;
        case PathStatus.PENDING:
          this.warship.touch();
          break;
        case PathStatus.NOT_FOUND: {
          console.log(`path not found to target`);
          break;
        }
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

    const result = this.pathfinder.next(
      this.warship.tile(),
      this.warship.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.warship.setTargetTile(undefined);
        this.warship.move(result.node);
        break;
      case PathStatus.NEXT:
        this.warship.move(result.node);
        break;
      case PathStatus.PENDING:
        this.warship.touch();
        return;
      case PathStatus.NOT_FOUND: {
        console.log(`path not found to target`);
        break;
      }
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

    // Get warship's water component for connectivity check
    const warshipComponent = this.mg.getWaterComponent(this.warship.tile());

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
      // Check water component connectivity
      if (
        warshipComponent !== null &&
        !this.mg.hasWaterComponent(tile, warshipComponent)
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
        distSquared <= rangeSq &&
        this.canEngageAircraft(unit.owner() as Player, unit as Unit),
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
            bestTarget.tile(),
          ),
        );
        bestTarget.setTargetedBySAM(true);
      }

      this.nextAAMissileFireTick =
        this.mg.ticks() + this.mg.config().warshipAACooldown();
    }
  }

  private canEngageAircraft(aircraftOwner: Player, aircraft: Unit): boolean {
    if (this.warship.owner().isAtWarWith(aircraftOwner)) {
      return true;
    }

    // Neutral behavior: only defend against incoming bomber/paratrooper attacks.
    if (
      aircraft.type() !== UnitType.Bomber &&
      aircraft.type() !== UnitType.Paratrooper
    ) {
      return false;
    }

    const targetTile = aircraft.targetTile();
    if (targetTile === undefined) {
      return false;
    }

    return this.mg.owner(targetTile) === this.warship.owner();
  }

  /** Returns true when a trade ship is sitting on a port tile (docked). */
  private isDockedAtPort(tradeShip: Unit): boolean {
    return this.mg
      .unitsAt(tradeShip.tile())
      .some((u) => u.type() === UnitType.Port);
  }
}
