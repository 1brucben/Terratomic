import { Execution, Game, Player } from "../game/Game";

export class SetAutoBombingExecution implements Execution {
  executionName = "SetAutoBombingExecution";
  constructor(
    private readonly player: Player,
    private readonly enabled: boolean,
  ) {}

  init(_mg: Game, _ticks: number): void {
    this.player.setAutoBombingEnabled(this.enabled);
  }

  tick(): void {
    // No-op
  }

  isActive(): boolean {
    return false; // immediately completed
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
