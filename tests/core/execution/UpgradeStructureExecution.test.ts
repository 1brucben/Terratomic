import { UpgradeStructureExecution } from "../../../src/core/execution/UpgradeStructureExecution";
import { Gold, Player, Unit, UnitType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";

describe("UpgradeStructureExecution", () => {
  const makeMocks = (unitType: UnitType) => {
    const mockPlayer = {
      gold: jest.fn().mockReturnValue(1_250_000n as Gold),
      removeGold: jest.fn(),
    } as unknown as jest.Mocked<Player>;

    const mockGame = {
      unitInfo: jest.fn().mockReturnValue({
        cost: jest.fn().mockReturnValue(1_250_000n as Gold),
      }),
      config: jest.fn().mockReturnValue({
        structureUpgradeCostMultiplier: jest.fn().mockImplementation(() => 0.8),
      }),
    } as unknown as jest.Mocked<GameImpl>;

    const mockUnit = {
      isUnit: jest.fn().mockReturnValue(true),
      type: jest.fn().mockReturnValue(unitType),
      owner: jest.fn().mockReturnValue(mockPlayer),
      upgradeStructure: jest.fn(),
    } as unknown as jest.Mocked<Unit & { upgradeStructure: () => void }>;

    return { mockPlayer, mockGame, mockUnit };
  };

  it("charges 80% of base cost and upgrades a City", () => {
    const { mockPlayer, mockGame, mockUnit } = makeMocks(UnitType.City);

    const exec = new UpgradeStructureExecution(mockPlayer, mockUnit);
    exec.init(mockGame, 0);

    // 80% of 1,250,000 = 1,000,000
    expect(mockPlayer.removeGold).toHaveBeenCalledWith(1_000_000n);
    expect(mockUnit.upgradeStructure).toHaveBeenCalled();
  });

  it("charges 80% of base cost and upgrades a Port", () => {
    const { mockPlayer, mockGame, mockUnit } = makeMocks(UnitType.Port);

    const exec = new UpgradeStructureExecution(mockPlayer, mockUnit);
    exec.init(mockGame, 0);

    // 80% of 1,250,000 = 1,000,000
    expect(mockPlayer.removeGold).toHaveBeenCalledWith(1_000_000n);
    expect(mockUnit.upgradeStructure).toHaveBeenCalled();
  });

  it("does nothing when funds are insufficient", () => {
    const { mockPlayer, mockGame, mockUnit } = makeMocks(UnitType.Port);
    (mockPlayer.gold as jest.Mock).mockReturnValue(999_999n as Gold);

    const exec = new UpgradeStructureExecution(mockPlayer, mockUnit);
    exec.init(mockGame, 0);

    expect(mockPlayer.removeGold).not.toHaveBeenCalled();
    expect(mockUnit.upgradeStructure).not.toHaveBeenCalled();
  });

  it("charges 20% of base cost and upgrades a Missile Silo", () => {
    const { mockPlayer, mockGame, mockUnit } = makeMocks(UnitType.MissileSilo);
    // Override config for silo to 0.2
    (mockGame.config as jest.Mock).mockReturnValue({
      structureUpgradeCostMultiplier: jest.fn().mockImplementation(() => 0.2),
    });

    const exec = new UpgradeStructureExecution(mockPlayer, mockUnit);
    exec.init(mockGame, 0);

    // 20% of 1,250,000 = 250,000
    expect(mockPlayer.removeGold).toHaveBeenCalledWith(250_000n);
    expect(mockUnit.upgradeStructure).toHaveBeenCalled();
  });

  it("does not charge or upgrade a Missile Silo at max level (3)", () => {
    const { mockPlayer, mockGame } = makeMocks(UnitType.MissileSilo);
    // Create a unit mock that reports level 3
    const mockUnit = {
      isUnit: jest.fn().mockReturnValue(true),
      type: jest.fn().mockReturnValue(UnitType.MissileSilo),
      owner: jest.fn().mockReturnValue(mockPlayer),
      level: jest.fn().mockReturnValue(3),
      upgradeStructure: jest.fn(),
    } as unknown as jest.Mocked<Unit & { upgradeStructure: () => void }>;

    const exec = new UpgradeStructureExecution(mockPlayer, mockUnit);
    exec.init(mockGame, 0);

    expect(mockPlayer.removeGold).not.toHaveBeenCalled();
    expect(mockUnit.upgradeStructure).not.toHaveBeenCalled();
  });
});
