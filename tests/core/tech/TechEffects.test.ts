import { UpgradeType } from "../../../src/core/game/Game";
import {
  applyTechCompletionEffects,
  RESEARCH_TECH_IDS,
} from "../../../src/core/tech/TechEffects";

describe("TechEffects", () => {
  it("grants Roads when Land-1 (Road Network) completes", () => {
    const owned = new Set<UpgradeType>();
    const player = {
      hasUpgrade: jest.fn((upgrade: UpgradeType) => owned.has(upgrade)),
      addUpgrade: jest.fn((upgrade: UpgradeType) => owned.add(upgrade)),
      removeUpgrade: jest.fn((upgrade: UpgradeType) => owned.delete(upgrade)),
    } as any;
    const game = {
      markPlayerNodesForReconnection: jest.fn(),
    } as any;

    applyTechCompletionEffects(
      player,
      game,
      RESEARCH_TECH_IDS.LAND_ROADS_HOSPITALS,
    );

    expect(player.addUpgrade).toHaveBeenCalledWith(UpgradeType.Roads);
    expect(game.markPlayerNodesForReconnection).toHaveBeenCalledWith(player);
  });
});
