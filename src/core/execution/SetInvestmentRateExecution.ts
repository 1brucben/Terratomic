import { Execution, Game, Player } from "../game/Game";

export class SetInvestmentRateExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private rate: number,
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    if (this.rate < 0 || this.rate > 1) {
      console.warn(
        `investment rate ${this.rate} for player ${this.player} invalid`,
      );
    } else {
      this.player.setInvestmentRate(this.rate);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
