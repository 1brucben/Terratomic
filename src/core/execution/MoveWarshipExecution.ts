import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveWarshipExecution implements Execution {
  executionName = "MoveWarshipExecution";
  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly position: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    const warship = this.owner
      .units(UnitType.Warship)
      .find((u) => u.id() === this.unitId);
    if (!warship) {
      console.warn("MoveWarshipExecution: warship not found");
      return;
    }
    if (!warship.isActive()) {
      console.warn("MoveWarshipExecution: warship is not active");
      return;
    }
    // Move intent should immediately head toward the clicked tile, while
    // also updating the patrol anchor so future roaming centers there.
    warship.setPatrolTile(this.position);
    warship.setTargetTile(this.position);
    // Clear any current target unit so movement isn't preempted by combat.
    warship.setTargetUnit(undefined);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
