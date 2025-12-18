import { PlayerType, UpgradeType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { PlayerImpl } from "../../../src/core/game/PlayerImpl";
import { RESEARCH_TECH_IDS } from "../../../src/core/tech/TechEffects";
import { playerInfo, setup } from "../../util/Setup";

describe("Land infrastructure tech integrations", () => {
  it("enables Roads after researching Roads & Hospitals", async () => {
    const info = playerInfo("builder", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(false);
    player.addResearchedTech(RESEARCH_TECH_IDS.LAND_ROADS_HOSPITALS);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
  });

  it("enables HospitalResearch after researching Modern Air Defense (Land-3)", async () => {
    const info = playerInfo("health", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(false);
    player.addResearchedTech(RESEARCH_TECH_IDS.LAND_SAM_SYSTEMS);
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(true);
  });

  it("removeResearchedTechsByCategory removes techs but not upgrades", async () => {
    const info = playerInfo("revoker", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    player.addResearchedTech(RESEARCH_TECH_IDS.LAND_ROADS_HOSPITALS);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);

    player.removeResearchedTechsByCategory("Land");
    // Techs are removed but upgrades remain
    expect(
      player.hasResearchedTech(RESEARCH_TECH_IDS.LAND_ROADS_HOSPITALS),
    ).toBe(false);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
  });
});
