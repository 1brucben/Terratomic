import { Execution, Game, Player } from "../game/Game";

export class SetRoadInvestmentExecution implements Execution {
  private active = true;

  constructor(
    private readonly player: Player,
    private readonly rate: number,
  ) {}

  init(game: Game, tick: number): void {
    this.player.setRoadInvestmentRate(this.rate);
    this.active = false;
  }

  tick(tick: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
