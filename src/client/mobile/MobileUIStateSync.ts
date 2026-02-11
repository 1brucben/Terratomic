import type { GameView } from "../../core/game/GameView";
import type { TopBarStats } from "./MobileTopBar";
import { getTradeIncomeAmountThisTick } from "./MobileUIStats";

type DisplayToggleTarget = {
  style: {
    display: string;
  };
};

type TradeIncomeIndicator = {
  clearTradeIncomeIndicator: () => void;
  showTradeIncomeIndicator: (amount: bigint) => void;
};

type TopBarUpdater = {
  updateStats: (stats: TopBarStats) => void;
};

type TradeIncomeResolver = (params: {
  game: GameView | null;
  myPlayerSmallID: number;
}) => bigint | null;

export function syncMobileUIStateFromGame(params: {
  game: GameView | null;
  lastGameTick: number;
  gameDurationSeconds: number;
  topBar: TopBarUpdater;
  economyTab: DisplayToggleTarget;
  intelTab: DisplayToggleTarget;
  researchTab: DisplayToggleTarget;
  attackBar: TradeIncomeIndicator;
  resolveTradeIncomeAmount?: TradeIncomeResolver;
}): {
  didProcessTick: boolean;
  lastGameTick: number;
  gameDurationSeconds: number;
} {
  const {
    game,
    lastGameTick,
    gameDurationSeconds,
    topBar,
    economyTab,
    intelTab,
    researchTab,
    attackBar,
    resolveTradeIncomeAmount = getTradeIncomeAmountThisTick,
  } = params;

  if (!game) {
    return {
      didProcessTick: false,
      lastGameTick,
      gameDurationSeconds,
    };
  }

  const myPlayer = game.myPlayer();
  if (!myPlayer) {
    return {
      didProcessTick: false,
      lastGameTick,
      gameDurationSeconds,
    };
  }

  const tick = game.ticks();
  if (tick === lastGameTick) {
    return {
      didProcessTick: false,
      lastGameTick,
      gameDurationSeconds,
    };
  }

  const gold = Number(myPlayer.gold());
  const population = myPlayer.population();
  const maxPopulation = game.config().maxPopulation(myPlayer);
  const populationGrowth = game.config().populationIncreaseRate(myPlayer) * 10;
  const goldIncome = Number(game.config().goldAdditionRate(myPlayer) * 10n);
  const inSpawnPhase = game.inSpawnPhase();

  if (inSpawnPhase) {
    attackBar.clearTradeIncomeIndicator();
  }

  const displayStyle = inSpawnPhase ? "none" : "";
  if (economyTab.style.display !== displayStyle) {
    economyTab.style.display = displayStyle;
    intelTab.style.display = displayStyle;
    researchTab.style.display = displayStyle;
  }

  topBar.updateStats({
    population,
    maxPopulation,
    gold,
    populationGrowth,
    goldIncome,
    gameDurationSeconds,
    inSpawnPhase,
  });

  if (!inSpawnPhase && myPlayer.isAlive()) {
    const tradeIncomeAmount = resolveTradeIncomeAmount({
      game,
      myPlayerSmallID: myPlayer.smallID(),
    });
    if (tradeIncomeAmount !== null && tradeIncomeAmount > 0n) {
      attackBar.showTradeIncomeIndicator(tradeIncomeAmount);
    }
  }

  const nextGameDurationSeconds = inSpawnPhase
    ? 0
    : tick % 10 === 0
      ? gameDurationSeconds + 1
      : gameDurationSeconds;

  return {
    didProcessTick: true,
    lastGameTick: tick,
    gameDurationSeconds: nextGameDurationSeconds,
  };
}
