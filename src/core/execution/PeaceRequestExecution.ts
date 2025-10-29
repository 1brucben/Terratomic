import { Execution, Game, Player, PlayerID } from "../game/Game";

export class PeaceRequestExecution implements Execution {
  private mg: Game;
  private active = true;

  constructor(
    private sender: Player,
    private recipientId: PlayerID,
  ) {}

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game): void {
    this.mg = mg;
    const recipient = this.mg
      .players()
      .find((p) => p.id() === this.recipientId);
    if (!recipient) {
      this.active = false;
      return;
    }
    if (recipient === this.sender) {
      this.active = false;
      return;
    }
    // If they are at war, set both to neutral now (immediate accept). Otherwise no-op.
    if (this.sender.isAtWarWith(recipient)) {
      this.sender.setNeutralWith(recipient);
      recipient.setNeutralWith(this.sender);
    }
    this.active = false;
  }

  tick(): void {
    // no-op
  }
}
