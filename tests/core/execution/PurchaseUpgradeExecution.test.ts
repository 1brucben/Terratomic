import { PurchaseUpgradeExecution } from "../../../src/core/execution/PurchaseUpgradeExecution";
import { Gold, Player, UpgradeType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";

describe("PurchaseUpgradeExecution", () => {
  let mockPlayer: jest.Mocked<Player>;
  let mockGame: jest.Mocked<GameImpl>;

  beforeEach(() => {
    mockPlayer = {
      gold: jest.fn(),
      hasUpgrade: jest.fn(),
      addUpgrade: jest.fn(),
      removeUpgrade: jest.fn(),
      removeGold: jest.fn(),
    } as unknown as jest.Mocked<Player>;

    mockGame = {
      config: jest.fn().mockReturnValue({
        upgradeInfo: jest.fn().mockImplementation((type: UpgradeType) => {
          if (type === UpgradeType.ScorchedEarth) {
            return { cost: () => 3_000_000n };
          }
          return { cost: () => 1_000_000n };
        }),
      }),
      destroyPlayerRoads: jest.fn(),
      markPlayerNodesForReconnection: jest.fn(),
    } as unknown as jest.Mocked<GameImpl>;
  });

  it("should successfully purchase an upgrade with sufficient funds", () => {
    mockPlayer.gold.mockReturnValue(1_000_000n as Gold);
    mockPlayer.hasUpgrade.mockReturnValue(false);

    const exec = new PurchaseUpgradeExecution(mockPlayer, UpgradeType.Roads);
    exec.init(mockGame, 0);

    expect(mockPlayer.removeGold).toHaveBeenCalledWith(1_000_000n);
    expect(mockPlayer.addUpgrade).toHaveBeenCalledWith(UpgradeType.Roads);
  });

  it("should fail to purchase an upgrade with insufficient funds", () => {
    mockPlayer.gold.mockReturnValue(999_999n as Gold);
    mockPlayer.hasUpgrade.mockReturnValue(false);

    const exec = new PurchaseUpgradeExecution(mockPlayer, UpgradeType.Roads);
    exec.init(mockGame, 0);

    expect(mockPlayer.removeGold).not.toHaveBeenCalled();
    expect(mockPlayer.addUpgrade).not.toHaveBeenCalled();
  });

  it("should do nothing if the player already has the upgrade", () => {
    mockPlayer.hasUpgrade.mockReturnValue(true);

    const exec = new PurchaseUpgradeExecution(mockPlayer, UpgradeType.Roads);
    exec.init(mockGame, 0);

    expect(mockPlayer.removeGold).not.toHaveBeenCalled();
    expect(mockPlayer.addUpgrade).not.toHaveBeenCalled();
  });

  it("should handle the special case for purchasing ScorchedEarth", () => {
    mockPlayer.gold.mockReturnValue(3_000_000n as Gold);
    mockPlayer.hasUpgrade.mockReturnValue(false);

    const exec = new PurchaseUpgradeExecution(
      mockPlayer,
      UpgradeType.ScorchedEarth,
    );
    exec.init(mockGame, 0);

    expect(mockPlayer.addUpgrade).toHaveBeenCalledWith(
      UpgradeType.ScorchedEarth,
    );
    expect(mockGame.destroyPlayerRoads).toHaveBeenCalledWith(mockPlayer);
    expect(mockPlayer.removeUpgrade).toHaveBeenCalledWith(UpgradeType.Roads);
    expect(mockPlayer.removeUpgrade).toHaveBeenCalledWith(
      UpgradeType.ScorchedEarth,
    );
  });

  it("should handle the special case for purchasing Roads", () => {
    mockPlayer.gold.mockReturnValue(1_000_000n as Gold);
    mockPlayer.hasUpgrade.mockReturnValue(false);

    const exec = new PurchaseUpgradeExecution(mockPlayer, UpgradeType.Roads);
    exec.init(mockGame, 0);

    expect(mockGame.markPlayerNodesForReconnection).toHaveBeenCalledWith(
      mockPlayer,
    );
  });
});
