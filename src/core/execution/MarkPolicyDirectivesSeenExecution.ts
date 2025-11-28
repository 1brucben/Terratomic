import { Execution, Game, Player } from "../game/Game";

/**
 * Execution to mark all policy directives as seen for the player.
 */
export class MarkPolicyDirectivesSeenExecution implements Execution {
  private _active = true;

  constructor(private readonly player: Player) {}

  isActive(): boolean {
    return this._active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  init(_mg: Game, _ticks: number): void {}

  tick(_ticks: number): void {
    this.player.markPolicyDirectivesSeen();
    this._active = false;
  }
}
