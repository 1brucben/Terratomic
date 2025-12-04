import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import { PlayerType, UnitType, UpgradeType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { PlayerImpl } from "../../../src/core/game/PlayerImpl";
import { RESEARCH_TECH_IDS } from "../../../src/core/tech/TechEffects";
import { playerInfo, setup } from "../../util/Setup";

describe("Economy tech integrations", () => {
  it("enables Roads after researching Post-War Reconstruction", async () => {
    const info = playerInfo("builder", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(false);
    player.addResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);
  });

  it("enables InternationalTrade after researching Port & Transport Modernization", async () => {
    const info = playerInfo("trader", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(false);
    player.addResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION);
    player.addResearchedTech(RESEARCH_TECH_IDS.PORT_TRANSPORT_MODERNIZATION);
    expect(player.hasUpgrade(UpgradeType.InternationalTrade)).toBe(true);
  });

  it("refunds 33% of a structure's cost on destruction with Infrastructure Recovery Fund", async () => {
    const info = playerInfo("insured", PlayerType.Human);
    const game = (await setup("ocean_and_land", { infiniteGold: true }, [
      info,
    ])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    player.addResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION);
    player.addResearchedTech(RESEARCH_TECH_IDS.INFRASTRUCTURE_RECOVERY_FUND);

    const cityCost = game.config().unitInfo(UnitType.City).cost(player);
    const city = player.buildUnit(UnitType.City, game.ref(1, 1), {});

    const initialGold = player.gold();
    city.delete();
    const expectedRefund = cityCost / 3n;

    expect(player.gold()).toBe(initialGold + expectedRefund);
  });

  it("refunds insured structures when conquered", async () => {
    const defenderInfo = playerInfo("defender", PlayerType.Human);
    const attackerInfo = playerInfo("attacker", PlayerType.Human);
    const game = (await setup("ocean_and_land", { infiniteGold: true }, [
      defenderInfo,
      attackerInfo,
    ])) as GameImpl;
    const defender = game.player(defenderInfo.id) as PlayerImpl;
    const attacker = game.player(attackerInfo.id) as PlayerImpl;

    const defenderExec = new PlayerExecution(defender);
    defenderExec.init(game, game.ticks());

    const tile = game.ref(0, 15);
    game.conquer(defender, tile);

    defender.addResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION);
    defender.addResearchedTech(RESEARCH_TECH_IDS.INFRASTRUCTURE_RECOVERY_FUND);
    const cityCost = game.config().unitInfo(UnitType.City).cost(defender);
    const city = defender.buildUnit(UnitType.City, tile, {});
    const initialGold = defender.gold();

    game.conquer(attacker, tile);
    defenderExec.tick(game.ticks());

    const expectedRefund = cityCost / 3n;
    expect(defender.gold()).toBe(initialGold + expectedRefund);
    expect(city.owner()).toBe(attacker);
  });

  it("enables HospitalResearch after researching National Health System", async () => {
    const info = playerInfo("health", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    // Need to research level 2 first (prerequisite)
    player.addResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION);
    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_HIGHWAY_EXPANSION);

    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(false);
    player.addResearchedTech(RESEARCH_TECH_IDS.NATIONAL_HEALTH_SYSTEM);
    expect(player.hasUpgrade(UpgradeType.HospitalResearch)).toBe(true);
  });

  it("revokes Roads when Post-War Reconstruction is revoked", async () => {
    const info = playerInfo("revoker", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    player.addResearchedTech(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(true);

    player.removeResearchedTechsByCategory("Economy");
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(false);
  });
});
