import { Execution, Player, UnitType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { TileRef } from "../game/GameMap";

/**
 * Handles the execution of a command to move a Fighter Jet to a new patrol location.
 * This execution sets the fighter jet's patrol tile and clears its current target tile.
 */
export class MoveFighterJetExecution implements Execution {
  private mg: GameImpl;

  /**
   * Initializes a new MoveFighterJetExecution instance.
   * @param owner The player who owns the fighter jet.
   * @param unitId The ID of the fighter jet unit to move.
   * @param position The new TileRef for the fighter jet's patrol location.
   */
  constructor(
    private owner: Player,
    private unitId: number,
    private position: TileRef,
  ) {}

  /**
   * Initializes the execution, finding the fighter jet and setting its new patrol tile.
   * @param mg The game instance.
   */
  init(mg: GameImpl): void {
    this.mg = mg;
    // Find the fighter jet unit by its ID.
    const fighterJet = this.owner
      .units(UnitType.FighterJet)
      .find((u) => u.id() === this.unitId);

    // If the fighter jet is not found or is not active, log a warning and do nothing.
    if (!fighterJet) {
      console.warn("MoveFighterJetExecution: fighter jet not found");
      return;
    }
    if (!fighterJet.isActive()) {
      console.warn("MoveFighterJetExecution: fighter jet is not active");
      return;
    }

    // Set the new patrol tile for the fighter jet.
    fighterJet.setPatrolTile(this.position);
    // Clear any existing target tile, so it starts patrolling immediately.
    fighterJet.setTargetTile(undefined);
  }

  /**
   * The tick method for this execution. It does nothing as the action is completed in init.
   */
  tick(): void {}

  /**
   * Indicates whether this execution is still active.
   * This execution completes immediately after initialization.
   * @returns Always false.
   */
  isActive(): boolean {
    return false;
  }

  /**
   * Indicates whether this execution should be active during the spawn phase.
   * @returns Always false.
   */
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
