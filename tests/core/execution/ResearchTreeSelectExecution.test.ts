import { ResearchTreeSelectExecution } from "../../../src/core/execution/ResearchTreeSelectExecution";
import {
  Game,
  Player,
  PlayerType,
  UpgradeType,
} from "../../../src/core/game/Game";
import { RESEARCH_TECH_IDS } from "../../../src/core/tech/TechEffects";

describe("ResearchTreeSelectExecution", () => {
  let mockPlayer: jest.Mocked<Player> & {
    addResearchedTech?: (id: string) => void;
  };
  let mockGame: jest.Mocked<Game>;

  beforeEach(() => {
    mockPlayer = {
      type: jest.fn().mockReturnValue(PlayerType.Human),
      hasUpgrade: jest.fn().mockReturnValue(false),
      addUpgrade: jest.fn(),
      // addResearchedTech is duck-typed; the execution checks at runtime
      addResearchedTech: jest.fn(),
    } as any;

    mockGame = {
      config: jest.fn().mockReturnValue({
        gameConfig: jest
          .fn()
          .mockReturnValue({ instantResearchHumanOnly: true }),
      }),
      markPlayerNodesForReconnection: jest.fn(),
    } as any;

    // Simulate PlayerImpl side-effects when research completes
    (mockPlayer.addResearchedTech as jest.Mock).mockImplementation(
      (id: string) => {
        if (id === RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM) {
          const alreadyHas = (mockPlayer.hasUpgrade as jest.Mock)(
            UpgradeType.Roads,
          );
          if (!alreadyHas) {
            mockPlayer.addUpgrade(UpgradeType.Roads);
            mockGame.markPlayerNodesForReconnection(mockPlayer as any);
          }
        }
      },
    );
  });

  it("adds researched tech ID to the player's set", () => {
    const exec = new ResearchTreeSelectExecution(
      mockPlayer as any,
      RESEARCH_TECH_IDS.POST_WW2_GROUND_FORCES_MODERNIZATION,
    );
    exec.init(mockGame as any, 0);
    exec.tick(0);

    expect(mockPlayer.addResearchedTech as jest.Mock).toHaveBeenCalledWith(
      RESEARCH_TECH_IDS.POST_WW2_GROUND_FORCES_MODERNIZATION,
    );
  });

  it("grants Roads and reconnects when Economy-1 is selected", () => {
    const exec = new ResearchTreeSelectExecution(
      mockPlayer as any,
      RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM,
    );
    exec.init(mockGame as any, 0);
    exec.tick(0);

    expect(mockPlayer.addUpgrade).toHaveBeenCalledWith(UpgradeType.Roads);
    expect(mockGame.markPlayerNodesForReconnection).toHaveBeenCalledWith(
      mockPlayer,
    );
  });

  it("does not double-grant Roads if already owned", () => {
    (mockPlayer.hasUpgrade as jest.Mock).mockReturnValue(true);
    const exec = new ResearchTreeSelectExecution(
      mockPlayer as any,
      RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM,
    );
    exec.init(mockGame as any, 0);
    exec.tick(0);

    // No additional addUpgrade call for Roads when already owned
    expect(mockPlayer.addUpgrade).not.toHaveBeenCalled();
    // Still acceptable to avoid reconnection in this case; ensure it's not called
    expect(mockGame.markPlayerNodesForReconnection).not.toHaveBeenCalled();
  });
});
