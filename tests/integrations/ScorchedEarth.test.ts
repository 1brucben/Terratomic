import { PurchaseUpgradeExecution } from "../../src/core/execution/PurchaseUpgradeExecution";
import { PlayerType, UnitType, UpgradeType } from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import { PlayerImpl } from "../../src/core/game/PlayerImpl";
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
    const city1 = player.buildUnit(UnitType.City, game.ref(0, 10), {});
    const city2 = player.buildUnit(UnitType.City, game.ref(0, 12), {});

    // Conquer a path between the cities
    for (let i = 10; i <= 12; i++) {
      const tile = game.ref(0, i);
      if (game.owner(tile) !== player) {
        game.conquer(player as PlayerImpl, tile);
      }
    }

    // Step 1: Buy Roads and verify network creation
    game.addExecution(new PurchaseUpgradeExecution(player, UpgradeType.Roads));
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
    }
    expect(game.roads().length).toBeGreaterThan(0);

    // Step 2: Buy Scorched Earth and verify network destruction
    game.addExecution(
      new PurchaseUpgradeExecution(player, UpgradeType.ScorchedEarth),
    );
    game.executeNextTick();
    expect(game.roads().length).toBe(0);
    expect(player.hasUpgrade(UpgradeType.Roads)).toBe(false);

    // Step 3: Re-buy Roads and verify network reformation
    game.addExecution(new PurchaseUpgradeExecution(player, UpgradeType.Roads));
    for (let i = 0; i < 20; i++) {
      game.executeNextTick();
    }
    expect(game.roads().length).toBeGreaterThan(0);
  });
});
