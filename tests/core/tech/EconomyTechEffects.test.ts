import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import { PlayerType, UnitType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { PlayerImpl } from "../../../src/core/game/PlayerImpl";
import { RESEARCH_TECH_IDS } from "../../../src/core/tech/TechEffects";
import { playerInfo, setup } from "../../util/Setup";

describe("Economy tech integrations", () => {
  it("boosts max population after researching Urban Planning", async () => {
    const info = playerInfo("planner", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    const baseMax = game.config().maxPopulation(player);
    player.addResearchedTech(RESEARCH_TECH_IDS.URBAN_PLANNING);
    const boostedMax = game.config().maxPopulation(player);

    expect(boostedMax).toBe(Math.floor((baseMax * 5) / 4));
  });

  it("refunds 33% of a structure's cost on destruction with Structure Insurance", async () => {
    const info = playerInfo("insured", PlayerType.Human);
    const game = (await setup("ocean_and_land", { infiniteGold: true }, [
      info,
    ])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    player.addResearchedTech(RESEARCH_TECH_IDS.STRUCTURE_INSURANCE);

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

    defender.addResearchedTech(RESEARCH_TECH_IDS.STRUCTURE_INSURANCE);
    const cityCost = game.config().unitInfo(UnitType.City).cost(defender);
    const city = defender.buildUnit(UnitType.City, tile, {});
    const initialGold = defender.gold();

    game.conquer(attacker, tile);
    defenderExec.tick(game.ticks());

    const expectedRefund = cityCost / 3n;
    expect(defender.gold()).toBe(initialGold + expectedRefund);
    expect(city.owner()).toBe(attacker);
  });

  it("reduces troop regeneration after researching Automation", async () => {
    const info = playerInfo("auto", PlayerType.Human);
    const game = (await setup("ocean_and_land", {}, [info])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    const baseRate = game.config().populationIncreaseRate(player);
    player.addResearchedTech(RESEARCH_TECH_IDS.AUTOMATION);
    const adjustedRate = game.config().populationIncreaseRate(player);

    expect(adjustedRate).toBeCloseTo((baseRate * 4) / 5);
  });

  it("doubles domestic cargo truck gold with Automation", async () => {
    const info = playerInfo("hauler", PlayerType.Human);
    const game = (await setup("ocean_and_land", { infiniteGold: true }, [
      info,
    ])) as GameImpl;
    const player = game.player(info.id) as PlayerImpl;

    player.addResearchedTech(RESEARCH_TECH_IDS.AUTOMATION);

    const cargoManager = (game as any).cargoManager;
    const path = [game.ref(0, 0), game.ref(0, 1)];
    game.conquer(player, path[0]);
    game.conquer(player, path[1]);

    const truck = {
      id: 0,
      owner: player,
      path,
      progress: path.length - 1,
      position: [0, 0] as [number, number],
    };

    (cargoManager as any).trucks.set(truck.id, truck);
    const initialGold = player.gold();
    cargoManager.tick([]);
    const finalGold = player.gold();

    const baseGold = game.config().cargoTruckGold(path.length);
    expect(finalGold).toBe(initialGold + baseGold * 2n);
  });
});
