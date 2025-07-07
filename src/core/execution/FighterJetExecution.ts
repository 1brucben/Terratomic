import { Execution, OwnerComp, Unit, UnitParams, UnitType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { TileRef } from "../game/GameMap";
import { findClosest } from "../game/GameMapUtils";
import { StraightPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

import { MessageType } from "../game/Game";

/**
 * Manages the behavior and lifecycle of a Fighter Jet unit.
 * This includes spawning, movement (patrolling and attacking), and targeting.
 */
export class FighterJetExecution implements Execution {
  private fighterJet: Unit;
  private mg: GameImpl;
  private random: PseudoRandom;
  private alreadySentShell: Set<Unit> = new Set();
  private pathFinder: StraightPathFinder;

  /**
   * Initializes a new FighterJetExecution instance.
   * @param input Either an existing Unit object for the fighter jet, or parameters to build a new one.
   */
  constructor(
    private input: (UnitParams<UnitType.FighterJet> & OwnerComp) | Unit,
  ) {}

  /**
   * Initializes the execution, setting up game references and spawning the fighter jet if necessary.
   * @param mg The game instance.
   */
  init(mg: GameImpl): void {
    this.mg = mg;
    this.random = new PseudoRandom(this.mg.ticks());
    // Use StraightPathFinder for direct, unrestricted movement (air units can fly anywhere).
    this.pathFinder = new StraightPathFinder(mg);
    if ("isUnit" in this.input) {
      this.fighterJet = this.input;
    } else {
      // Attempt to build the fighter jet at the specified patrol tile.
      const spawn = this.input.owner.canBuild(
        UnitType.FighterJet,
        this.input.patrolTile,
      );
      if (!spawn) {
        // If spawning fails, display a warning message.
        this.mg.displayMessage(
          `Failed to spawn fighter jet for ${this.input.owner.name()} at ${this.input.patrolTile}`,
          MessageType.WARN,
          this.input.owner.id(),
        );
        return;
      }
      // Build the fighter jet unit.
      this.fighterJet = this.input.owner.buildUnit(UnitType.FighterJet, spawn, {
        patrolTile: this.input.patrolTile,
      });
    }
  }

  /**
   * Called every game tick to update the fighter jet's state and behavior.
   */
  tick(): void {
    // If the fighter jet is destroyed, remove it from the game.
    if (this.fighterJet.health() <= 0) {
      this.fighterJet.delete();
      return;
    }

    // Heal the fighter jet if its owner has an airfield.
    const hasAirfield =
      this.fighterJet.owner().units(UnitType.Airfield).length > 0;
    if (hasAirfield) {
      // Heal the fighter jet by the configured healing amount.
      this.fighterJet.modifyHealth(this.mg.config().fighterJetHealingAmount());
    }

    // Determine the target unit for the fighter jet.
    this.fighterJet.setTargetUnit(this.findTargetUnit());
    // If the target is a TradeShip and there's no airfield, clear the target (cannot capture without airfield).
    if (this.fighterJet.targetUnit()?.type() === UnitType.TradeShip) {
      if (!hasAirfield) {
        this.fighterJet.setTargetUnit(undefined);
      }
    }

    // Execute attack or patrol behavior based on whether a target is present.
    if (this.fighterJet.targetUnit() !== undefined) {
      this.attack();
    } else {
      this.patrol();
    }
  }

  /**
   * Finds the closest valid target unit for the fighter jet.
   * Targets include Bombers and other Fighter Jets, prioritizing Fighter Jets.
   * @returns The closest target unit, or undefined if no valid target is found.
   */
  private findTargetUnit(): Unit | undefined {
    // Check if the owner has an airfield (though not directly used in targeting logic here, it's a common check).
    const hasAirfield =
      this.fighterJet.owner().units(UnitType.Airfield).length > 0;
    // Get the patrol range from game configuration.
    const patrolRangeSquared = this.mg.config().fighterJetPatrolRange() ** 2;

    // Find closest Bomber or Fighter Jet within targeting range.
    const closest = findClosest(
      this.fighterJet.tile()!,
      this.mg.config().fighterJetTargettingRange(),
      [UnitType.Bomber, UnitType.FighterJet],
      this.mg,
      (unit) => {
        // Do not target own units, friendly units, or units that are not targetable.
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

    // Sort targets by distance and then by unit type (prioritize Fighter Jets).
    closest.sort((a, b) => {
      const distA = this.mg.euclideanDistSquared(
        this.fighterJet.tile()!,
        a.tile()!,
      );
      const distB = this.mg.euclideanDistSquared(
        this.fighterJet.tile()!,
        b.tile()!,
      );

      // Prioritize FighterJets over Bombers.
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

  /**
   * Executes the attack behavior of the fighter jet.
   * Launches shells at the target unit and moves towards it.
   */
  private attack() {
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

    // If within dogfight distance, circle the target.
    if (distToTargetSquared <= dogfightDistanceSquared) {
      const dogfightRange = this.mg.config().fighterJetDogfightDistance();
      let newX: number;
      let newY: number;
      let attempts = 0;
      const maxAttempts = 10; // Prevent infinite loops

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
        // Ensure the new point is not too close to the target
      } while (
        (newX === this.mg.x(targetUnit.tile()) &&
          newY === this.mg.y(targetUnit.tile())) || // Ensure not on the exact target tile
        !this.mg.isValidCoord(newX, newY) || // Ensure valid coordinates
        (this.mg.euclideanDistSquared(
          this.mg.map().ref(newX, newY),
          targetUnit.tile(),
        ) < minDogfightDistanceSquared && // Ensure minimum distance
          attempts < maxAttempts)
      );

      if (this.mg.isValidCoord(newX, newY)) {
        targetTileForMovement = this.mg.map().ref(newX, newY);
      } else {
        // Fallback to direct movement if a valid circling point cannot be found after attempts.
        targetTileForMovement = targetUnit.tile();
      }
    } else {
      // Otherwise, move directly towards the target.
      targetTileForMovement = targetUnit.tile();
    }

    // Move the fighter jet towards its calculated movement target.
    const result = this.pathFinder.nextTile(
      this.fighterJet.tile(),
      targetTileForMovement,
      this.mg.config().fighterJetSpeed(),
    );

    if (result === true) {
      // Target reached (no further movement needed in this tick).
    } else {
      this.fighterJet.move(result);
    }
    this.fighterJet.touch(); // Mark the unit as active.

    // If the target is destroyed, clear the target.
    if (
      distToTargetSquared <=
      this.mg.config().fighterJetTargetReachedDistance() ** 2
    ) {
      // The target is already dead, so we can stop attacking it
      this.alreadySentShell.add(targetUnit);
      this.fighterJet.setTargetUnit(undefined);
      return;
    }

    // Determine if it's time to launch a shell based on attack rate.
    const shellAttackRate = this.mg.config().fighterJetAttackRate();
    if (this.mg.ticks() % shellAttackRate === 0) {
      // Add a ShellExecution to the game to simulate an attack.
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

  /**
   * Executes the patrolling behavior of the fighter jet.
   * Moves towards a random patrol tile within its range.
   */
  private patrol() {
    // If no target patrol tile is set, find a new random one.
    if (this.fighterJet.targetTile() === undefined) {
      this.fighterJet.setTargetTile(this.randomTile());
      if (this.fighterJet.targetTile() === undefined) {
        return;
      }
    }

    // Move the fighter jet directly towards its patrol target.
    const result = this.pathFinder.nextTile(
      this.fighterJet.tile(),
      this.fighterJet.targetTile()!,
      this.mg.config().fighterJetSpeed(),
    );

    if (result === true) {
      // If the patrol target is reached, clear it to find a new one next tick.
      this.fighterJet.setTargetTile(undefined);
    } else {
      this.fighterJet.move(result);
    }
    this.fighterJet.touch(); // Mark the unit as active.
  }

  /**
   * Generates a random tile within the fighter jet's patrol range.
   * This tile can be anywhere on the map (no terrain restrictions).
   * @returns A random TileRef, or undefined if a valid tile cannot be found after attempts.
   */
  private randomTile(): TileRef | undefined {
    // If no patrol origin is set, return undefined.
    if (this.fighterJet.patrolTile() === undefined) {
      return undefined;
    }

    // Get the patrol range from game configuration.
    const fighterJetPatrolRange = this.mg.config().fighterJetPatrolRange();
    // Calculate random coordinates within the patrol range around the patrol origin.
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
    // If the generated coordinates are outside the map, return undefined.
    if (!this.mg.isValidCoord(x, y)) {
      return undefined;
    }
    // Return the TileRef for the generated coordinates.
    return this.mg.map().ref(x, y);
  }

  /**
   * Checks if the fighter jet is currently active.
   * @returns True if the fighter jet unit is active, false otherwise.
   */
  isActive(): boolean {
    return this.fighterJet?.isActive();
  }

  /**
   * Indicates whether this execution should be active during the spawn phase.
   * Fighter jets are not active during the spawn phase.
   * @returns Always false.
   */
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
