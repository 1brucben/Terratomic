import { PlayerExecution } from "../../src/core/execution/PlayerExecution";
import { PlayerType, UnitType, UpgradeType } from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import { PlayerImpl } from "../../src/core/game/PlayerImpl";
import { playerInfo, setup } from "../util/Setup";

describe("EconomyUpgrades", () => {
  it("should increase max population by 25% with Urban Planning upgrade", async () => {
    const player1Info = playerInfo("player1", PlayerType.Human);
    const game = await setup("ocean_and_land", {}, [player1Info]);
    const player = game.player("player1");

    const initialMaxPopulation = game.config().maxPopulation(player);

    player.addUpgrade(UpgradeType.UrbanPlanning);

    const newMaxPopulation = game.config().maxPopulation(player);

    expect(newMaxPopulation).toBe(Math.floor((initialMaxPopulation * 5) / 4));
  });

  it("should refund 33% of a structure's cost upon destruction with Structure Insurance upgrade", async () => {
    const player1Info = playerInfo("player1", PlayerType.Human);
    const game = await setup("ocean_and_land", { infiniteGold: true }, [
      player1Info,
    ]);
    const player = game.player("player1");

    player.addUpgrade(UpgradeType.StructureInsurance);

    const cityCost = game.config().unitInfo(UnitType.City).cost(player);
    const city = player.buildUnit(UnitType.City, game.ref(1, 1), {});

    const initialGold = player.gold();

    city.delete();

    const finalGold = player.gold();
    const expectedRefund = cityCost / 3n; // BigInt division

    expect(finalGold).toBe(initialGold + expectedRefund);
  });

  it("should refund 33% of a structure's cost upon conquest", async () => {
    const defenderInfo = playerInfo("defender", PlayerType.Human);
    const attackerInfo = playerInfo("attacker", PlayerType.Human);
    const game = (await setup("ocean_and_land", { infiniteGold: true }, [
      defenderInfo,
      attackerInfo,
    ])) as GameImpl;
    const defender = game.player("defender") as PlayerImpl;
    const attacker = game.player("attacker") as PlayerImpl;

    const defenderPlayerExecution = new PlayerExecution(defender);
    defenderPlayerExecution.init(game, game.ticks());

    const defenderTile = game.ref(0, 15);
    game.conquer(defender, defenderTile);

    defender.addUpgrade(UpgradeType.StructureInsurance);

    const cityCost = game.config().unitInfo(UnitType.City).cost(defender);
    const city = defender.buildUnit(UnitType.City, defenderTile, {});

    const initialGold = defender.gold();

    // Attacker conquers the tile, but not the unit yet
    game.conquer(attacker, defenderTile);

    // The defender's PlayerExecution will detect the ownership change and capture the unit
    defenderPlayerExecution.tick(game.ticks());

    const finalGold = defender.gold();
    const expectedRefund = cityCost / 3n; // BigInt division

    expect(city.owner()).toBe(attacker);
    expect(finalGold).toBe(initialGold + expectedRefund);
  });

  it("should decrease troop regeneration by 20% with Automation upgrade", async () => {
    const player1Info = playerInfo("player1", PlayerType.Human);
    const game = await setup("ocean_and_land", {}, [player1Info]);
    const player = game.player("player1");

    const initialRegenRate = game.config().populationIncreaseRate(player);

    player.addUpgrade(UpgradeType.Automation);

    const newRegenRate = game.config().populationIncreaseRate(player);

    // Use toBeCloseTo for floating point comparisons
    expect(newRegenRate).toBeCloseTo((initialRegenRate * 4) / 5);
  });

  it("should double internal trade income with Automation upgrade", async () => {
    const player1Info = playerInfo("player1", PlayerType.Human);
    const game = (await setup("ocean_and_land", { infiniteGold: true }, [
      player1Info,
    ])) as GameImpl;
    const player = game.player("player1") as PlayerImpl;

    player.addUpgrade(UpgradeType.Automation);

    const cargoManager = (game as any).cargoManager;

    const path = [game.ref(0, 0), game.ref(0, 1)];
    game.conquer(player, path[0]);
    game.conquer(player, path[1]);

    const mockTruck = {
      id: 0,
      owner: player,
      path: path,
      progress: path.length - 1, // Arrives on next tick
      position: [0, 0],
    };

    // Manually add the truck to the cargo manager
    (cargoManager as any).trucks.set(mockTruck.id, mockTruck);

    const initialGold = player.gold();

    cargoManager.tick([]);

    const finalGold = player.gold();
    const normalGold = game.config().cargoTruckGold(path.length);
    const expectedGold = normalGold * 2n; // Automation doubles it

    expect(finalGold).toBe(initialGold + expectedGold);
  });
});
