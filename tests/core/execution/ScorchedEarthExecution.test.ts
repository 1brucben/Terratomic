import { ScorchedEarthExecution } from "../../../src/core/execution/ScorchedEarthExecution";
import { Gold, Player, UpgradeType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";

describe("ScorchedEarthExecution", () => {
  let mockPlayer: jest.Mocked<Player>;
  let mockGame: jest.Mocked<GameImpl>;

  beforeEach(() => {
    mockPlayer = {
      gold: jest.fn(),
      hasUpgrade: jest.fn(),
      addUpgrade: jest.fn(),
      removeUpgrade: jest.fn(),
      removeGold: jest.fn(),
      hasResearchedTech: jest.fn(),
      removeResearchedTechsByCategory: jest.fn(),
      setRoadInvestmentRate: jest.fn(),
    } as unknown as jest.Mocked<Player>;
    (mockPlayer.hasResearchedTech as jest.Mock).mockReturnValue(true);

    mockGame = {
      config: jest.fn().mockReturnValue({
        scorchedEarthActivationCost: jest.fn().mockReturnValue(3_000_000n),
      }),
      destroyPlayerRoads: jest.fn(),
      markPlayerNodesForReconnection: jest.fn(),
    } as unknown as jest.Mocked<GameImpl>;
  });

  it("should do nothing if player already has ScorchedEarth", () => {
    mockPlayer.hasUpgrade.mockReturnValue(true);

    const exec = new ScorchedEarthExecution(mockPlayer);
    exec.init(mockGame, 0);

    expect(mockPlayer.removeGold).not.toHaveBeenCalled();
    expect(mockPlayer.addUpgrade).not.toHaveBeenCalled();
    expect(mockGame.destroyPlayerRoads).not.toHaveBeenCalled();
  });

  it("requires the Scorched Earth tech to be researched before activation", () => {
    (mockPlayer.hasResearchedTech as jest.Mock).mockReturnValue(false);
    mockPlayer.hasUpgrade.mockReturnValue(false);

    const exec = new ScorchedEarthExecution(mockPlayer);
    exec.init(mockGame, 0);

    expect(mockPlayer.removeGold).not.toHaveBeenCalled();
    expect(mockPlayer.addUpgrade).not.toHaveBeenCalled();
    expect(mockGame.destroyPlayerRoads).not.toHaveBeenCalled();
  });

  it("should fail if player does not have enough gold", () => {
    mockPlayer.gold.mockReturnValue(2_999_999n as Gold);
    mockPlayer.hasUpgrade.mockReturnValue(false);

    const exec = new ScorchedEarthExecution(mockPlayer);
    exec.init(mockGame, 0);

    expect(mockPlayer.removeGold).not.toHaveBeenCalled();
    expect(mockPlayer.addUpgrade).not.toHaveBeenCalled();
    expect(mockGame.destroyPlayerRoads).not.toHaveBeenCalled();
  });

  it("should activate Scorched Earth with sufficient gold and tech", () => {
    mockPlayer.gold.mockReturnValue(3_000_000n as Gold);
    mockPlayer.hasUpgrade.mockReturnValue(false);

    const exec = new ScorchedEarthExecution(mockPlayer);
    exec.init(mockGame, 0);

    expect(mockPlayer.removeGold).toHaveBeenCalledWith(3_000_000n);
    expect(mockPlayer.addUpgrade).toHaveBeenCalledWith(
      UpgradeType.ScorchedEarth,
    );
    expect(mockGame.destroyPlayerRoads).toHaveBeenCalledWith(mockPlayer);
    expect(mockPlayer.setRoadInvestmentRate).toHaveBeenCalledWith(0);
    expect(mockPlayer.removeUpgrade).toHaveBeenCalledWith(UpgradeType.Roads);
    expect(mockPlayer.removeUpgrade).toHaveBeenCalledWith(
      UpgradeType.InternationalTrade,
    );
    expect(mockPlayer.removeResearchedTechsByCategory).toHaveBeenCalledWith(
      "Economy",
    );
    expect(mockGame.markPlayerNodesForReconnection).toHaveBeenCalledWith(
      mockPlayer,
    );
  });
});
