import { ScorchedEarthExecution } from "../../src/core/execution/ScorchedEarthExecution";
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
    player.addResearchedTech(RESEARCH_TECH_IDS.POST_WW2_MODERNIZATION);
    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    player.addResearchedTech(RESEARCH_TECH_IDS.INDUSTRIAL_DEVELOPMENT_STRATEGY);
    player.addResearchedTech(RESEARCH_TECH_IDS.TRADE_POLICY_FRAMEWORK);
    player.addResearchedTech(RESEARCH_TECH_IDS.INFRASTRUCTURE_PRIORITIZATION);

    // Allow the automatic road upgrade to build out the network
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
    }
    expect(game.roads().length).toBeGreaterThan(0);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(true);

    // Step 2: Research and activate Scorched Earth, verify network destruction
    player.addResearchedTech(RESEARCH_TECH_IDS.MECHANIZED_WARFARE_DOCTRINE);
    game.addExecution(new ScorchedEarthExecution(player));
    game.executeNextTick();
    expect(game.roads().length).toBe(0);
    // Scorched Earth only destroys roads, keeps upgrades and techs
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(true);
    expect(player.hasUpgrade(UpgradeType.ScorchedEarth)).toBe(true);
    expect(player.roadInvestmentRate()).toBe(0);
    expect(
      player.hasResearchedTech(
        RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM,
      ),
    ).toBe(true);
    expect(
      player.hasResearchedTech(
        RESEARCH_TECH_IDS.INDUSTRIAL_DEVELOPMENT_STRATEGY,
      ),
    ).toBe(true);

    // Step 3: Re-unlock roads and verify Scorched Earth deactivates
    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM);
    expect(player.hasUpgrade(UpgradeType.ScorchedEarth)).toBe(false);
    player.setRoadInvestmentRate(1);
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
    }
    expect(game.roads().length).toBeGreaterThan(0);
    expect(player.hasUpgrade(UpgradeType.ScorchedEarth)).toBe(false);
  });
});
