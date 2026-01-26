import { Execution, Game } from "../game/Game";

export class NoOpExecution implements Execution {
  executionName = "NoOpExecution";
  isActive(): boolean {
    return false;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  init(mg: Game, ticks: number): void {}
  tick(ticks: number): void {}
}
