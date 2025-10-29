import { PlayerType, UpgradeType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { PlayerImpl } from "../../../src/core/game/PlayerImpl";
import { RESEARCH_TECH_IDS } from "../../../src/core/tech/TechEffects";
import { playerInfo, setup } from "../../util/Setup";

describe("PlayerImpl.removeResearchedTechsByCategory", () => {
  it("revokes economy techs and clears associated progress", async () => {
    const game = (await setup("ocean_and_land")) as GameImpl;
    const info = playerInfo("Tester", PlayerType.Human);
    game.addPlayer(info);
    const player = game.player(info.id) as PlayerImpl;

    player.addResearchedTech(RESEARCH_TECH_IDS.WWII_LESSONS);
    player.addResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION);
    player.addResearchedTech(RESEARCH_TECH_IDS.INTERNATIONAL_TRADE);
    player.addResearchedTech(RESEARCH_TECH_IDS.STRUCTURE_INSURANCE);
    player.addResearchedTech(RESEARCH_TECH_IDS.AUTOMATION);
    player.addResearchBeakers("Economy-3", 500, 1_000);
    player.setResearchPriority("Economy-3");

    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.StructureInsurance)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.Automation)).toBe(true);
    expect(player.researchBeakers("Economy-3")).toBe(500);

    player.removeResearchedTechsByCategory("Economy");

    expect(player.hasResearchedTech(RESEARCH_TECH_IDS.WWII_LESSONS)).toBe(true);
    expect(
      player.hasResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION),
    ).toBe(false);
    expect(
      player.hasResearchedTech(RESEARCH_TECH_IDS.INTERNATIONAL_TRADE),
    ).toBe(false);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(false);
    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(false);
    expect(player.hasUpgrade(UpgradeType.StructureInsurance)).toBe(false);
    expect(player.hasUpgrade(UpgradeType.Automation)).toBe(false);
    expect(player.researchBeakers("Economy-3")).toBe(0);
    expect(player.researchPriority()).toBeNull();
  });
});
