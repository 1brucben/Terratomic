import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AirPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { NukeType } from "../StatsSchemas";

/**
 * Manages the behavior and lifecycle of a SAM (Surface-to-Air Missile).
 * SAM missiles are launched from SAM Launchers to intercept specific airborne targets.
 */
export class SAMMissileExecution implements Execution {
  private active = true;
  private pathFinder: AirPathFinder;
  private SAMMissile: Unit | undefined;
  private mg: Game;

  /**
   * Initializes a new SAMMissileExecution instance.
   * @param spawn The TileRef where the SAM missile is spawned.
   * @param _owner The player who owns the SAM missile.
   * @param ownerUnit The SAM Launcher unit that launched this missile.
   * @param target The target unit to intercept.
   * @param speed The movement speed of the SAM missile (default is 12).
   */
  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private speed: number = 12,
  ) {}

  /**
   * Initializes the execution, setting up game references and the pathfinder.
   * @param mg The game instance.
   * @param ticks The current game tick.
   */
  init(mg: Game, ticks: number): void {
    // Use AirPathFinder for direct movement in the air.
    this.pathFinder = new AirPathFinder(mg, new PseudoRandom(mg.ticks()));
    this.mg = mg;
  }

  /**
   * Called every game tick to update the SAM missile's state and behavior.
   * The missile moves towards its target and intercepts it if reached.
   * @param ticks The current game tick.
   */
  tick(ticks: number): void {
    // Spawn the SAM missile unit if it hasn't been spawned yet.
    if (this.SAMMissile === undefined) {
      this.SAMMissile = this._owner.buildUnit(
        UnitType.SAMMissile,
        this.spawn,
        {},
      );
    }
    // If the SAM missile is no longer active, deactivate this execution.
    if (!this.SAMMissile.isActive()) {
      this.active = false;
      return;
    }

    // Whitelist of unit types that SAM missiles can intercept.
    // MIRV warheads are too fast and MIRVs should not be stopped by SAMs.
    const nukesWhitelist = [
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.CargoPlane,
      UnitType.Bomber,
      UnitType.FighterJet,
    ];

    // Check if the target is valid for interception.
    if (
      !this.target.isActive() || // Target is no longer active
      !this.ownerUnit.isActive() || // Launching SAM unit is no longer active
      this.target.owner() === this.SAMMissile.owner() || // Target is owned by the same player
      !nukesWhitelist.includes(this.target.type()) // Target type is not in the whitelist
    ) {
      // If the target is invalid, delete the SAM missile and deactivate this execution.
      this.SAMMissile.delete(false);
      this.active = false;
      return;
    }

    // Move the SAM missile towards its target.
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.nextTile(
        this.SAMMissile.tile(),
        this.target.tile(),
      );

      // If the target is reached (result is true).
      if (result === true) {
        // If the target is a nuke, display an interception message and record stats.
        if (
          this.target.type() === UnitType.AtomBomb ||
          this.target.type() === UnitType.HydrogenBomb
        ) {
          this.mg.displayMessage(
            `Missile intercepted ${this.target.type()}`,
            MessageType.SAM_HIT,
            this._owner.id(),
          );

          this.mg
            .stats()
            .bombIntercept(this._owner, this.target.type() as NukeType, 1);
        }
        // Deactivate this execution, delete the target and the SAM missile.
        this.active = false;
        this.target.delete(true, this._owner);
        this.SAMMissile.delete(false);

        return;
      } else {
        // Move the SAM missile to the next tile in its path.
        this.SAMMissile.move(result);
      }
    }
  }

  /**
   * Checks if the SAM missile execution is currently active.
   * @returns True if active, false otherwise.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Indicates whether this execution should be active during the spawn phase.
   * @returns Always false.
   */
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
