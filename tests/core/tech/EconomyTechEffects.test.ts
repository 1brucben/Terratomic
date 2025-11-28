import { PlayerType, UpgradeType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { PlayerImpl } from "../../../src/core/game/PlayerImpl";
import { RESEARCH_TECH_IDS } from "../../../src/core/tech/TechEffects";
import { playerInfo, setup } from "../../util/Setup";

describe("Economy tech integrations", () => {
  it("enables Roads after researching National Reconstruction Program", async () => {
    const info = playerInfo("builder", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(false);
    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
  });

  it("enables InternationalTrade after researching Trade Policy Framework", async () => {
    const info = playerInfo("trader", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(false);
    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    player.addResearchedTech(RESEARCH_TECH_IDS.TRADE_POLICY_FRAMEWORK);
    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(true);
  });

  // TEMPORARILY DISABLED: Structure insurance tests
  // it("refunds 33% of a structure's cost on destruction with Infrastructure Recovery Fund", ...)
  // it("refunds insured structures when conquered", ...)

  it("enables HospitalResearch after researching Infrastructure Prioritization", async () => {
    const info = playerInfo("health", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    // Need to research level 1 and 2 first (prerequisites)
    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    player.addResearchedTech(RESEARCH_TECH_IDS.INDUSTRIAL_DEVELOPMENT_STRATEGY);
    player.addResearchedTech(RESEARCH_TECH_IDS.TRADE_POLICY_FRAMEWORK);

    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(false);
    player.addResearchedTech(RESEARCH_TECH_IDS.INFRASTRUCTURE_PRIORITIZATION);
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(true);
  });

  it("revokes Roads when National Reconstruction Program is revoked", async () => {
    const info = playerInfo("revoker", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);

    player.removeResearchedTechsByCategory("Economy");
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(false);
  });
});
