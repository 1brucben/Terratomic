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

    player.addResearchedTech(RESEARCH_TECH_IDS.POST_WW2_MODERNIZATION);
    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    player.addResearchedTech(RESEARCH_TECH_IDS.INDUSTRIAL_DEVELOPMENT_STRATEGY);
    player.addResearchedTech(RESEARCH_TECH_IDS.TRADE_POLICY_FRAMEWORK);
    player.addResearchedTech(RESEARCH_TECH_IDS.INFRASTRUCTURE_PRIORITIZATION);
    player.addResearchBeakers("Economy-3A", 500, 1_000);
    player.setResearchPriority("Economy-3A");

    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(true);
    expect(player.researchBeakers("Economy-3A")).toBe(500);

    player.removeResearchedTechsByCategory("Economy");

    expect(
      player.hasResearchedTech(RESEARCH_TECH_IDS.POST_WW2_MODERNIZATION),
    ).toBe(true);
    expect(
      player.hasResearchedTech(
        RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM,
      ),
    ).toBe(false);
    expect(
      player.hasResearchedTech(
        RESEARCH_TECH_IDS.INDUSTRIAL_DEVELOPMENT_STRATEGY,
      ),
    ).toBe(false);
    // Upgrades are NOT removed by removeResearchedTechsByCategory - only techs and progress
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(true);
    expect(player.researchBeakers("Economy-3A")).toBe(0);
    expect(player.researchPriority()).toBeNull();
  });
});
