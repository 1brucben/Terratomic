import { Execution, Game, Player, UnitType } from "../game/Game";

export class ParatrooperRetreatExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private unitID: number,
  ) {}

  init(mg: Game, ticks: number): void {
    const unit = this.player.units().find((u) => u.id() === this.unitID);
    if (unit && unit.type() === UnitType.Paratrooper) {
      unit.delete();
    }
    this.active = false;
  }

  tick(ticks: number): void {
    // No ongoing tick logic needed, as the unit is deleted in init
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
