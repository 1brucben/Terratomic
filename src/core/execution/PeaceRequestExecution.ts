import { Execution, Game, Player, PlayerID } from "../game/Game";

export class PeaceRequestExecution implements Execution {
  executionName = "PeaceRequestExecution";
  private active = true;
  private recipient: Player | null = null;

  constructor(
    private requestor: Player,
    private recipientID: PlayerID,
  ) {}

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `PeaceRequestExecution recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }
    this.recipient = mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    if (this.recipient === null) {
      throw new Error("Not initialized");
    }
    if (!this.requestor.isAtWarWith(this.recipient)) {
      console.warn("not at war");
    } else if (!this.requestor.canSendPeaceRequest(this.recipient)) {
      console.warn("recent or pending peace request");
    } else {
      this.requestor.createPeaceRequest(this.recipient);
    }
    this.active = false;
  }
}
