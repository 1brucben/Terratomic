import { GameEvent } from "../../core/EventBus";

export class ToggleBomberUpgradeModeEvent implements GameEvent {
  constructor(public readonly enabled: boolean) {}
}
