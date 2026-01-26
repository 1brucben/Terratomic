import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveSubmarineExecution implements Execution {
  executionName = "MoveSubmarineExecution";
  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly position: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    const submarine = this.owner
      .units(UnitType.Submarine)
      .find((u) => u.id() === this.unitId);
    if (!submarine) {
      console.warn("MoveSubmarineExecution: submarine not found");
      return;
    }
    if (!submarine.isActive()) {
      console.warn("MoveSubmarineExecution: submarine is not active");
      return;
    }
    // Move intent should immediately head toward the clicked tile, while
    // also updating the patrol anchor so future roaming centers there.
    submarine.setPatrolTile(this.position);
    submarine.setTargetTile(this.position);
    // Clear any current target unit so movement isn't preempted by combat.
    submarine.setTargetUnit(undefined);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
