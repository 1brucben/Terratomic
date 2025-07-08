import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";

/**
 * Manages the behavior and lifecycle of a Cargo Plane.
 * This includes spawning, flying between airfields, and facilitating trade.
 */
export class CargoPlaneExecution implements Execution {
  private active = true;
  private mg: Game;
  private cargoPlane: Unit | undefined;
  private pathFinder: StraightPathFinder;
  private tilesTraveled = 0;
  private isCaptured = false; // New flag to indicate capture

  /**
   * Initializes a new CargoPlaneExecution instance.
   * @param origOwner The player who owns/spawned this cargo plane.
   * @param sourceAirfield The Airfield unit where the cargo plane spawns.
   * @param destinationAirfield The Airfield unit that is the destination for the cargo plane.
   */
  constructor(
    private origOwner: Player,
    private sourceAirfield: Unit,
    private destinationAirfield: Unit,
  ) {}

  /**
   * Initializes the execution, setting up game references and the pathfinder.
   * @param mg The game instance.
   * @param ticks The current game tick.
   */
  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new StraightPathFinder(mg);
  }

  /**
   * Called every game tick to update the cargo plane's state and behavior.
   * Handles spawning, movement, and trade completion.
   * @param ticks The current game tick.
   */
  tick(ticks: number): void {
    // 1) SPAWN: Build the cargo plane unit if it hasn't been spawned yet.
    if (this.cargoPlane === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.CargoPlane,
        this.sourceAirfield.tile(),
      );
      if (spawn === false) {
        console.warn(`Cargo plane cannot be built`);
        this.active = false;
        return;
      }
      this.cargoPlane = this.origOwner.buildUnit(UnitType.CargoPlane, spawn, {
        targetUnit: this.destinationAirfield,
      });
    }

    // 2) STILL ALIVE: If the cargo plane is no longer active (e.g., destroyed), deactivate this execution.
    if (!this.cargoPlane.isActive()) {
      this.active = false;
      return;
    }

    // Handle capture: If the owner changes, redirect to the nearest friendly airfield.
    if (this.cargoPlane.owner().id() !== this.origOwner.id()) {
      this.isCaptured = true; // Set the captured flag
      this.origOwner = this.cargoPlane.owner(); // Update original owner to the new owner
      this.tilesTraveled = 0; // Reset tiles traveled for the new journey

      const friendlyAirfields = this.origOwner.units(UnitType.Airfield);
      if (friendlyAirfields.length > 0) {
        // Find the closest friendly airfield
        let closestAirfield: Unit | undefined;
        let minDistSquared = Infinity;

        for (const airfield of friendlyAirfields) {
          const distSquared = this.mg.euclideanDistSquared(
            this.cargoPlane.tile(),
            airfield.tile(),
          );
          if (distSquared < minDistSquared) {
            minDistSquared = distSquared;
            closestAirfield = airfield;
          }
        }

        if (closestAirfield) {
          this.destinationAirfield = closestAirfield;
          this.cargoPlane.setTargetUnit(closestAirfield);
          this.mg.displayMessage(
            `Cargo plane captured and redirected to ${closestAirfield.owner().displayName()}'s airfield!`,
            MessageType.CAPTURED_ENEMY_UNIT,
            this.origOwner.id(),
          );
        } else {
          // If no friendly airfield found, delete the cargo plane (it has nowhere to go).
          this.cargoPlane.delete(false);
          this.active = false;
          return;
        }
      } else {
        // If no friendly airfield found, delete the cargo plane (it has nowhere to go).
        this.cargoPlane.delete(false);
        this.active = false;
        return;
      }
    }

    // Only perform trade validation if the plane has not been captured.
    if (!this.isCaptured) {
      // 3) TRADE VALIDATION: If source and destination airfields are owned by the same player, delete the cargo plane.
      if (
        this.destinationAirfield.owner().id() ===
          this.sourceAirfield.owner().id() &&
        this.cargoPlane.owner().id() === this.sourceAirfield.owner().id() // Only if still owned by original trader
      ) {
        this.cargoPlane.delete(false);
        this.active = false;
        return;
      }

      // 4) TRADE VALIDATION: If destination airfield is inactive or trade is not possible, delete the cargo plane.
      if (
        !this.destinationAirfield.isActive() ||
        !this.cargoPlane.owner().canTrade(this.destinationAirfield.owner())
      ) {
        this.cargoPlane.delete(false);
        this.active = false;
        return;
      }
    }

    // 5) MOVEMENT: Calculate the next tile for the cargo plane's straight-line movement.
    const result = this.pathFinder.nextTile(
      this.cargoPlane.tile(),
      this.destinationAirfield.tile(),
      2,
    );

    // 6) ARRIVAL HANDLING: If the destination is reached, complete the trade.
    if (result === true) {
      this.complete();
      return;
    } else {
      // Move the cargo plane to the next tile and increment tiles traveled.
      this.cargoPlane.move(result);
      this.tilesTraveled++;
    }
  }

  /**
   * Completes the trade operation, transferring gold and deactivating the cargo plane.
   */
  private complete() {
    this.active = false;
    this.cargoPlane!.delete(false);

    if (this.isCaptured) {
      return;
    }

    // Calculate gold earned based on tiles traveled.
    const gold = this.mg.config().cargoPlaneGold(this.tilesTraveled);

    // Add gold to both source and destination airfield owners.
    this.sourceAirfield.owner().addGold(gold);
    this.destinationAirfield.owner().addGold(gold);

    // Display messages for trade completion.
    this.mg.displayMessage(
      `Received ${renderNumber(gold)} gold from trade using cargo plane with ${this.sourceAirfield.owner().displayName()}`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      this.destinationAirfield.owner().id(),
      gold,
    );
    this.mg.displayMessage(
      `Received ${renderNumber(gold)} gold from trade using cargo plane with ${this.destinationAirfield.owner().displayName()}`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      this.sourceAirfield.owner().id(),
      gold,
    );
    return;
  }

  /**
   * Checks if the CargoPlaneExecution is currently active.
   * @returns True if active, false otherwise.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Indicates whether this execution should be active during the spawn phase.
   * Cargo planes are not active during the spawn phase.
   * @returns Always false.
   */
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  /**
   * Returns the TileRef of the destination airfield.
   * @returns The TileRef of the destination airfield.
   */
  dstAirfield(): TileRef {
    return this.destinationAirfield.tile();
  }
}
