import { Execution, Game, Player } from "../game/Game";

export class SetRoadInvestmentExecution implements Execution {
  executionName = "SetRoadInvestmentExecution";
  private active = true;
  constructor(
    private player: Player,
    private rate: number, // 0..1
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    this.player.setRoadInvestmentRate(this.rate);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
