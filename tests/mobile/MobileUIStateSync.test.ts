import { syncMobileUIStateFromGame } from "../../src/client/mobile/MobileUIStateSync";

describe("MobileUIStateSync", () => {
  function createDisplayTarget(initialDisplay: string) {
    return {
      style: {
        display: initialDisplay,
      },
    };
  }

  test("hides tabs and clears trade indicator during spawn phase", () => {
    const updateStats = jest.fn();
    const clearTradeIncomeIndicator = jest.fn();
    const showTradeIncomeIndicator = jest.fn();

    const game = {
      myPlayer: () => ({
        gold: () => 12n,
        population: () => 8,
        isAlive: () => true,
        smallID: () => 3,
      }),
      ticks: () => 7,
      inSpawnPhase: () => true,
      config: () => ({
        maxPopulation: () => 20,
        populationIncreaseRate: () => 2,
        goldAdditionRate: () => 4n,
      }),
    };

    const economyTab = createDisplayTarget("");
    const intelTab = createDisplayTarget("");
    const researchTab = createDisplayTarget("");

    const result = syncMobileUIStateFromGame({
      game: game as any,
      lastGameTick: -1,
      gameDurationSeconds: 25,
      topBar: { updateStats },
      economyTab,
      intelTab,
      researchTab,
      attackBar: {
        clearTradeIncomeIndicator,
        showTradeIncomeIndicator,
      },
      resolveTradeIncomeAmount: () => 999n,
    });

    expect(result).toEqual({
      didProcessTick: true,
      lastGameTick: 7,
      gameDurationSeconds: 0,
    });
    expect(economyTab.style.display).toBe("none");
    expect(intelTab.style.display).toBe("none");
    expect(researchTab.style.display).toBe("none");
    expect(clearTradeIncomeIndicator).toHaveBeenCalledTimes(1);
    expect(showTradeIncomeIndicator).not.toHaveBeenCalled();
    expect(updateStats).toHaveBeenCalledWith(
      expect.objectContaining({
        inSpawnPhase: true,
        gameDurationSeconds: 25,
      }),
    );
  });

  test("shows trade income and increments game duration every 10 ticks", () => {
    const updateStats = jest.fn();
    const clearTradeIncomeIndicator = jest.fn();
    const showTradeIncomeIndicator = jest.fn();
    const resolveTradeIncomeAmount = jest.fn(() => 42n);

    const game = {
      myPlayer: () => ({
        gold: () => 55n,
        population: () => 9,
        isAlive: () => true,
        smallID: () => 8,
      }),
      ticks: () => 20,
      inSpawnPhase: () => false,
      config: () => ({
        maxPopulation: () => 50,
        populationIncreaseRate: () => 3,
        goldAdditionRate: () => 7n,
      }),
    };

    const economyTab = createDisplayTarget("none");
    const intelTab = createDisplayTarget("none");
    const researchTab = createDisplayTarget("none");

    const result = syncMobileUIStateFromGame({
      game: game as any,
      lastGameTick: 19,
      gameDurationSeconds: 11,
      topBar: { updateStats },
      economyTab,
      intelTab,
      researchTab,
      attackBar: {
        clearTradeIncomeIndicator,
        showTradeIncomeIndicator,
      },
      resolveTradeIncomeAmount,
    });

    expect(result).toEqual({
      didProcessTick: true,
      lastGameTick: 20,
      gameDurationSeconds: 12,
    });
    expect(economyTab.style.display).toBe("");
    expect(intelTab.style.display).toBe("");
    expect(researchTab.style.display).toBe("");
    expect(clearTradeIncomeIndicator).not.toHaveBeenCalled();
    expect(showTradeIncomeIndicator).toHaveBeenCalledWith(42n);
    expect(resolveTradeIncomeAmount).toHaveBeenCalledWith({
      game,
      myPlayerSmallID: 8,
    });
    expect(updateStats).toHaveBeenCalledWith(
      expect.objectContaining({
        inSpawnPhase: false,
        gameDurationSeconds: 11,
      }),
    );
  });

  test("skips processing when game tick has not changed", () => {
    const updateStats = jest.fn();
    const clearTradeIncomeIndicator = jest.fn();
    const showTradeIncomeIndicator = jest.fn();

    const game = {
      myPlayer: () => ({
        gold: () => 1n,
        population: () => 1,
        isAlive: () => true,
        smallID: () => 1,
      }),
      ticks: () => 99,
      inSpawnPhase: () => false,
      config: () => ({
        maxPopulation: () => 10,
        populationIncreaseRate: () => 1,
        goldAdditionRate: () => 1n,
      }),
    };

    const result = syncMobileUIStateFromGame({
      game: game as any,
      lastGameTick: 99,
      gameDurationSeconds: 5,
      topBar: { updateStats },
      economyTab: createDisplayTarget(""),
      intelTab: createDisplayTarget(""),
      researchTab: createDisplayTarget(""),
      attackBar: {
        clearTradeIncomeIndicator,
        showTradeIncomeIndicator,
      },
    });

    expect(result).toEqual({
      didProcessTick: false,
      lastGameTick: 99,
      gameDurationSeconds: 5,
    });
    expect(updateStats).not.toHaveBeenCalled();
    expect(clearTradeIncomeIndicator).not.toHaveBeenCalled();
    expect(showTradeIncomeIndicator).not.toHaveBeenCalled();
  });
});
