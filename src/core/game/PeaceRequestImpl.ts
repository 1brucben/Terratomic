import { PeaceRequest, Player, Tick } from "./Game";
import { GameImpl } from "./GameImpl";
import { GameUpdateType, PeaceRequestUpdate } from "./GameUpdates";

export class PeaceRequestImpl implements PeaceRequest {
  constructor(
    private requestor_: Player,
    private recipient_: Player,
    private tickCreated: number,
    private game: GameImpl,
  ) {}

  requestor(): Player {
    return this.requestor_;
  }

  recipient(): Player {
    return this.recipient_;
  }

  createdAt(): Tick {
    return this.tickCreated;
  }

  accept(): void {
    this.game.acceptPeaceRequest(this);
  }
  reject(): void {
    this.game.rejectPeaceRequest(this);
  }

  toUpdate(): PeaceRequestUpdate {
    return {
      type: GameUpdateType.PeaceRequest,
      requestorID: this.requestor_.smallID(),
      recipientID: this.recipient_.smallID(),
      createdAt: this.tickCreated,
    };
  }
}
