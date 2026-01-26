import { Execution, Game, Player, Unit, UnitType } from "../game/Game";

export class ParatrooperRetreatExecution implements Execution {
  executionName = "ParatrooperRetreatExecution";
  private active = true;
  private paratrooper: Unit | null = null;

  constructor(
    private player: Player,
    private unitID: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.paratrooper =
      this.player.units().find((u) => u.id() === this.unitID) ?? null;
    if (this.paratrooper && this.paratrooper.type() === UnitType.Paratrooper) {
      if (this.paratrooper.isActive()) {
        this.paratrooper.delete();
      }
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
