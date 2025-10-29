import { PurchaseUpgradeExecution } from "../../src/core/execution/PurchaseUpgradeExecution";
import { PlayerType, UnitType, UpgradeType } from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import { PlayerImpl } from "../../src/core/game/PlayerImpl";
import { RESEARCH_TECH_IDS } from "../../src/core/tech/TechEffects";
import { playerInfo, setup } from "../util/Setup";

describe("Scorched Earth Full Cycle Integration Test", () => {
  it("should allow a player to build, destroy, and rebuild their road network", async () => {
    // Given: A game with a player having several cities and enough gold
    const game = (await setup("ocean_and_land", {
      instantBuild: true,
    })) as GameImpl;
    const pInfo = playerInfo("Player A", PlayerType.Human);
    game.addPlayer(pInfo);
    const player = game.player(pInfo.id);
    player.addGold(10_000_000n);
    // Allocate income to road building so construction progresses in tests
    player.setRoadInvestmentRate(1);
    (player as any).addWorkers(10000000);
    const city1 = player.buildUnit(UnitType.City, game.ref(0, 10), {});
    const city2 = player.buildUnit(UnitType.City, game.ref(0, 12), {});

    // Conquer a path between the cities
    for (let i = 10; i <= 12; i++) {
      const tile = game.ref(0, i);
      if (game.owner(tile) !== player) {
        game.conquer(player as PlayerImpl, tile);
      }
    }

    // Research core economy techs to unlock and test revocation behavior
    player.addResearchedTech(RESEARCH_TECH_IDS.WWII_LESSONS);
    player.addResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION);
    player.addResearchedTech(RESEARCH_TECH_IDS.INTERNATIONAL_TRADE);
    player.addResearchedTech(RESEARCH_TECH_IDS.STRUCTURE_INSURANCE);
    player.addResearchedTech(RESEARCH_TECH_IDS.AUTOMATION);

    // Allow the automatic road upgrade to build out the network
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
    }
    expect(game.roads().length).toBeGreaterThan(0);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.StructureInsurance)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.Automation)).toBe(true);

    // Step 2: Research and activate Scorched Earth, verify network destruction and tech rollback
    player.addResearchedTech(RESEARCH_TECH_IDS.SCORCHED_EARTH);
    game.addExecution(
      new PurchaseUpgradeExecution(player, UpgradeType.ScorchedEarth),
    );
    game.executeNextTick();
    expect(game.roads().length).toBe(0);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(false);
    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(false);
    expect(player.hasUpgrade(UpgradeType.StructureInsurance)).toBe(false);
    expect(player.hasUpgrade(UpgradeType.Automation)).toBe(false);
    expect(player.hasUpgrade(UpgradeType.ScorchedEarth)).toBe(true);
    expect(player.roadInvestmentRate()).toBe(0);
    expect(
      player.hasResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION),
    ).toBe(false);
    expect(
      player.hasResearchedTech(RESEARCH_TECH_IDS.INTERNATIONAL_TRADE),
    ).toBe(false);

    // Step 3: Re-unlock roads and verify Scorched Earth deactivates
    player.addResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION);
    expect(player.hasUpgrade(UpgradeType.ScorchedEarth)).toBe(false);
    player.setRoadInvestmentRate(1);
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
    }
    expect(game.roads().length).toBeGreaterThan(0);
    expect(player.hasUpgrade(UpgradeType.ScorchedEarth)).toBe(false);
  });
});
