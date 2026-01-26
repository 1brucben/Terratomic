import { Execution, Game, Player, PlayerID, PlayerType } from "../game/Game";
import { BotPersonality } from "./FakeHumanExecution";
import { shouldAcceptPeaceRequest } from "./utils/BotBehavior";

export class PeaceRequestExecution implements Execution {
  executionName = "PeaceRequestExecution";
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
    // If they are at war, decide whether to accept peace request
    if (this.sender.isAtWarWith(recipient)) {
      // Humans always accept peace requests
      if (recipient.type() === PlayerType.Human) {
        this.sender.setNeutralWith(recipient);
        recipient.setNeutralWith(this.sender);
      } else {
        // Bots use strategic decision-making
        const personalityValue = recipient.botPersonality?.();
        const recipientPersonality =
          (personalityValue as BotPersonality | undefined) ??
          BotPersonality.Balanced;
        const shouldAccept = shouldAcceptPeaceRequest(
          this.mg,
          recipient,
          this.sender,
          recipientPersonality,
        );
        if (shouldAccept) {
          this.sender.setNeutralWith(recipient);
          recipient.setNeutralWith(this.sender);
        }
        // If rejected, peace request is ignored (war continues)
      }
    }
    this.active = false;
  }

  tick(): void {
    // no-op
  }
}
