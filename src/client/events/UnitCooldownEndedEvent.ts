import { UnitView } from "../../core/game/GameView";

export class UnitCooldownEndedEvent {
  constructor(public readonly unit: UnitView) {}
}
