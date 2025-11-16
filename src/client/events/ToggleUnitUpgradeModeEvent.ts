import { GameEvent } from "../../core/EventBus";

export class ToggleUnitUpgradeModeEvent implements GameEvent {
  constructor(public readonly enabled: boolean) {}
}
