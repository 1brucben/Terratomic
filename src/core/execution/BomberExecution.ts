import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";

/**
 * Handles the lifecycle of a Bomber: spawning, flying out, dropping bombs, and returning.
 */
export class BomberExecution implements Execution {
  private active = true; // Whether this execution is still running.
  private mg: Game; // Reference to the game engine.
  private bomber!: Unit; // The Bomber unit once it’s spawned.
  private bombsLeft!: number; // How many bombs remain in its payload.
  private returning = false; // False while heading outbound, true on the way home.
  private pathFinder: StraightPathFinder; // For straight-line path calculations.
  private dropTicker = 0; // Tick counter to enforce drop cadence.

  /**
   * Initializes a new BomberExecution instance.
   * @param origOwner The player who owns/spawned this bomber.
   * @param sourceAirfield The Airfield unit where the bomber spawns and returns.
   * @param targetTile The intended target tile for bomb drops.
   */
  constructor(
    private origOwner: Player, // The player who owns/spawned this bomber
    private sourceAirfield: Unit, // The Airfield unit where the bomber spawns and returns
    private targetTile: TileRef, // The intended target tile for bomb drops
  ) {}

  /**
   * Called once when the execution is started.
   * @param mg The game instance.
   * @param ticks The current game tick.
   */
  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new StraightPathFinder(mg);
    // Initialize payload from the game’s config.
    this.bombsLeft = mg.config().bomberPayload();
  }

  /**
   * Called every game-tick to advance the bomber’s state.
   * @param _ticks The current game tick (unused in this method).
   */
  tick(_ticks: number): void {
    // 1) SPAWN: Build the unit the first time tick() runs.
    if (!this.bomber) {
      const spawn = this.origOwner.canBuild(
        UnitType.Bomber,
        this.sourceAirfield.tile(),
      );
      if (!spawn) {
        // If spawning fails, terminate execution.
        this.active = false;
        return;
      }
      // Build with a targetTile param so the UI can show its destination.
      this.bomber = this.origOwner.buildUnit(UnitType.Bomber, spawn, {
        targetTile: this.targetTile,
      });
    }

    // 2) STILL ALIVE: If someone shot down the bomber, stop executing.
    if (!this.bomber.isActive()) {
      this.active = false;
      return;
    }

    // 3) DROP CADENCE: Only drop bombs at the configured rate when within range.
    if (!this.returning && this.bombsLeft > 0) {
      this.dropTicker++;
      if (
        this.dropTicker >= this.mg.config().bomberDropCadence() &&
        this.mg.euclideanDistSquared(this.bomber.tile(), this.targetTile) <= 1
      ) {
        this.dropBomb(); // Drop one bomb.
        this.dropTicker = 0; // Reset cadence counter.
        return; // Skip movement this tick.
      }
    }

    // 4) CHOOSE DESTINATION: Determine current destination: either heading back to the airfield or proceeding toward the target.
    //    - If we’ve used up all bombs, we’re returning to the airfield.
    //    - Otherwise continue toward the original target.
    const destination = this.returning
      ? this.sourceAirfield.tile() // If all bombs dropped, return to source airfield.
      : this.targetTile; // Otherwise, fly toward the target tile.

    // 5) PATHFINDING: Compute the next step along a straight line.
    const step = this.pathFinder.nextTile(
      this.bomber.tile(), // Current position of the bomber.
      destination, // Where we want to go.
      2, // Max distance to move in one tick.
    );

    // 6) ARRIVAL HANDLING:
    // If nextTile returned `true`, we've arrived at the destination.
    if (step === true) {
      if (!this.returning && this.bombsLeft > 0) {
        // If we're arriving at the target and still have bombs, drop one immediately.
        this.dropBomb();
      } else if (this.returning) {
        // If we're returning and arrived back at the airfield, end the execution.
        this.bomber.delete(true);
        this.active = false;
      }
      return; // Skip the move() call when we've already handled arrival.
    }

    // 7) MOVE: Advance the bomber one tile toward its destination.
    this.bomber.move(step);
  }

  /**
   * Drops a bomb at the bomber’s current tile.
   * Decrements the bomb count and handles returning logic.
   */
  private dropBomb(): void {
    // Trigger an immediate explosion at the bomber's current tile.
    this.mg.nukeExplosion(
      this.bomber.tile(),
      this.mg.config().bomberExplosionRadius(),
      this.origOwner,
    );
    this.bombsLeft--;
    // If all bombs are used, set the bomber to return to its airfield.
    if (this.bombsLeft === 0) this.returning = true;
  }

  /**
   * Checks if the BomberExecution is currently active.
   * @returns True if active, false otherwise.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Indicates whether this execution should be active during the spawn phase.
   * Bombers should not spawn during the initial “placement” phase.
   * @returns Always false.
   */
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
