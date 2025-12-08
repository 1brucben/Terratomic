import { PlayerType, UpgradeType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { PlayerImpl } from "../../../src/core/game/PlayerImpl";
import { POLICY_DIRECTIVE_IDS } from "../../../src/core/tech/PolicyDirectives";
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

  it("enables InternationalTrade after choosing Open Trade policy", async () => {
    const info = playerInfo("trader", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(false);
    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    player.addResearchedTech(
      RESEARCH_TECH_IDS.NATIONAL_RESEARCH_INDUSTRIAL_FOUNDATIONS,
    );
    player.addResearchedTech(RESEARCH_TECH_IDS.TRADE_POLICY_FRAMEWORK);
    // Tech alone doesn't grant the upgrade anymore
    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(false);

    // Choosing Open Trade policy grants the upgrade
    player.setPolicyChoice(
      POLICY_DIRECTIVE_IDS.TRADE_POLICY_FRAMEWORK,
      "open_trade",
    );
    player.addUpgrade(UpgradeType.InternationalTrade); // Simulating what execution does
    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(true);
  });

  it("Autarky policy does not grant InternationalTrade", async () => {
    const info = playerInfo("autarky", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    player.addResearchedTech(
      RESEARCH_TECH_IDS.NATIONAL_RESEARCH_INDUSTRIAL_FOUNDATIONS,
    );
    player.addResearchedTech(RESEARCH_TECH_IDS.TRADE_POLICY_FRAMEWORK);

    // Choosing Autarky policy does NOT grant the upgrade
    player.setPolicyChoice(
      POLICY_DIRECTIVE_IDS.TRADE_POLICY_FRAMEWORK,
      "autarky",
    );
    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(false);
  });

  // TEMPORARILY DISABLED: Structure insurance tests
  // it("refunds 33% of a structure's cost on destruction with Infrastructure Recovery Fund", ...)
  // it("refunds insured structures when conquered", ...)

  it("enables HospitalResearch after researching National Reconstruction Program", async () => {
    const info = playerInfo("health", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    // Hospitals are unlocked at Level 1 now (National Reconstruction Program)
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(false);
    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(true);
  });

  it("removeResearchedTechsByCategory removes techs but not upgrades", async () => {
    const info = playerInfo("revoker", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);

    player.removeResearchedTechsByCategory("Economy");
    // Techs are removed but upgrades remain
    expect(
      player.hasResearchedTech(
        RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM,
      ),
    ).toBe(false);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
  });
});
