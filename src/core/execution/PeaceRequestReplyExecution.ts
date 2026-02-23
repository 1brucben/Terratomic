import { Execution, Game, Player, PlayerID } from "../game/Game";

export class PeaceRequestReplyExecution implements Execution {
  private active = true;
  private requestor: Player | null = null;

  constructor(
    private requestorID: PlayerID,
    private recipient: Player,
    private accept: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.requestorID)) {
      console.warn(
        `PeaceRequestReplyExecution requester ${this.requestorID} not found`,
      );
      this.active = false;
      return;
    }
    this.requestor = mg.player(this.requestorID);
  }

  tick(ticks: number): void {
    if (this.requestor === null) {
      throw new Error("Not initialized");
    }
    if (!this.requestor.isAtWarWith(this.recipient)) {
      console.warn("not at war, peace request irrelevant");
    } else {
      const request = this.requestor
        .outgoingPeaceRequests()
        .find((pr) => pr.recipient() === this.recipient);
      if (request === undefined) {
        console.warn("no peace request found");
      } else {
        if (this.accept) {
          request.accept();
        } else {
          request.reject();
        }
      }
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
