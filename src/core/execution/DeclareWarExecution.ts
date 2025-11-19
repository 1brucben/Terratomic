import { Execution, Game, Player, PlayerID } from "../game/Game";

export class DeclareWarExecution implements Execution {
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
    // If not already at war, declare war mutually
    if (!this.sender.isAtWarWith(recipient)) {
      this.sender.setWarWith(recipient);
      recipient.setWarWith(this.sender);
      // Record aggression for both sides
      this.sender.recordAggression(recipient);
      recipient.recordAggression(this.sender);
    }
    this.active = false;
  }

  tick(): void {
    // no-op
  }
}
