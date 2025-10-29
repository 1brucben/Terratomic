import { UpgradeType } from "../../../src/core/game/Game";
import {
  applyTechCompletionEffects,
  RESEARCH_TECH_IDS,
} from "../../../src/core/tech/TechEffects";

describe("TechEffects", () => {
  it("removes Scorched Earth upgrade when Post-War Reconstruction completes", () => {
    const owned = new Set<UpgradeType>([UpgradeType.ScorchedEarth]);
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
      RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION,
    );

    expect(player.addUpgrade).toHaveBeenCalledWith(UpgradeType.Roads);
    expect(game.markPlayerNodesForReconnection).toHaveBeenCalledWith(player);
    expect(player.removeUpgrade).toHaveBeenCalledWith(
      UpgradeType.ScorchedEarth,
    );
    expect(owned.has(UpgradeType.ScorchedEarth)).toBe(false);
  });
});
