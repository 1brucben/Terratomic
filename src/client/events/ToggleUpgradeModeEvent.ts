import { GameEvent } from "../../core/EventBus";

export class ToggleUpgradeModeEvent implements GameEvent {
  constructor(public readonly enabled: boolean) {}
}

export class ToggleBomberUpgradeModeEvent implements GameEvent {
  constructor(public readonly enabled: boolean) {}
}
