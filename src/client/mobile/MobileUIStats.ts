import { MessageType } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import type { GameView } from "../../core/game/GameView";

export function getTradeIncomeAmountThisTick(params: {
  game: GameView | null;
  myPlayerSmallID: number;
}): bigint | null {
  const { game, myPlayerSmallID } = params;

  if (!game) {
    return null;
  }

  const updates = game.updatesSinceLastTick();
  const displayEvents = updates?.[GameUpdateType.DisplayEvent];

  if (!displayEvents || displayEvents.length === 0) {
    return null;
  }

  let total = 0n;
  let foundAny = false;

  for (const event of displayEvents) {
    if (event.messageType !== MessageType.RECEIVED_GOLD_FROM_TRADE) {
      continue;
    }

    if (event.playerID !== null && event.playerID !== myPlayerSmallID) {
      continue;
    }

    if (event.goldAmount !== undefined && event.goldAmount > 0n) {
      total += event.goldAmount;
      foundAny = true;
    }
  }

  return foundAny ? total : null;
}
