import { Execution, Game, Player } from "../game/Game";

export class SetResearchInvestmentExecution implements Execution {
  executionName = "SetResearchInvestmentExecution";
  private active = true;
  constructor(
    private player: Player,
    private rate: number, // 0..1
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    this.player.setResearchInvestmentRate(this.rate);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
