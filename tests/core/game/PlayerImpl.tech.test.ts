import { PlayerType, UpgradeType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { PlayerImpl } from "../../../src/core/game/PlayerImpl";
import { RESEARCH_TECH_IDS } from "../../../src/core/tech/TechEffects";
import { playerInfo, setup } from "../../util/Setup";

describe("PlayerImpl.removeResearchedTechsByCategory", () => {
  it("revokes land techs and clears associated progress", async () => {
    const game = (await setup("ocean_and_land")) as GameImpl;
    const info = playerInfo("Tester", PlayerType.Human);
    game.addPlayer(info);
    const player = game.player(info.id) as PlayerImpl;

    player.addResearchedTech(RESEARCH_TECH_IDS.LAND_ROADS_HOSPITALS);
    player.addResearchedTech(RESEARCH_TECH_IDS.LAND_MILITARY_ACADEMY);
    player.addResearchedTech(RESEARCH_TECH_IDS.LAND_SAM_SYSTEMS);
    player.addResearchedTech(RESEARCH_TECH_IDS.LAND_DOOMSDAY_DEVICE);
    player.addResearchBeakers("Land-4", 500, 1_000);
    player.setResearchPriority("Land-4");

    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(true);
    expect(player.researchBeakers("Land-4")).toBe(500);

    player.removeResearchedTechsByCategory("Land");

    expect(
      player.hasResearchedTech(RESEARCH_TECH_IDS.LAND_ROADS_HOSPITALS),
    ).toBe(false);
    expect(
      player.hasResearchedTech(RESEARCH_TECH_IDS.LAND_MILITARY_ACADEMY),
    ).toBe(false);
    expect(player.hasResearchedTech(RESEARCH_TECH_IDS.LAND_SAM_SYSTEMS)).toBe(
      false,
    );
    // Upgrades are NOT removed by removeResearchedTechsByCategory - only techs and progress
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(true);
    expect(player.researchBeakers("Land-4")).toBe(0);
    expect(player.researchPriority()).toBeNull();
  });
});
