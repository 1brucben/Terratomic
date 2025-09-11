import {
  Player,
  PlayerType,
  UnitType,
  UpgradeType,
} from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { PlayerImpl } from "../../../src/core/game/PlayerImpl";
import { RoadManager } from "../../../src/core/game/RoadManager";
import { playerInfo, setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

describe("RoadManager", () => {
  let game: GameImpl;
  let playerA: Player;
  let roadManager: RoadManager;

  beforeEach(async () => {
    game = (await setup("ocean_and_land", { instantBuild: true })) as GameImpl;
    const pInfo = playerInfo("Player A", PlayerType.Human);
    game.addPlayer(pInfo);
    playerA = game.player(pInfo.id);
    roadManager = (game as any).roadManager;
  });

  it("should form a road between two cities for a player with the Roads upgrade", () => {
    playerA.addUpgrade(UpgradeType.Roads);

    const tile1 = game.ref(0, 10);
    const tile2 = game.ref(0, 15);

    // Explicitly conquer a path of tiles for the player to ensure pathfinding works
    for (let i = 10; i <= 15; i++) {
      const tile = game.ref(0, i);
      if (game.owner(tile) !== playerA) {
        game.conquer(playerA as PlayerImpl, tile);
      }
    }

    const city1 = playerA.buildUnit(UnitType.City, tile1, {});
    const city2 = playerA.buildUnit(UnitType.City, tile2, {});
    executeTicks(game, 15);

    const roads = (roadManager as any).roads;
    expect(roads.size).toBeGreaterThan(0);

    const segment = (roadManager as any).getCanonicalSegment(
      city1.tile(),
      city2.tile(),
    );
    expect((roadManager as any).existingRoadSegments.has(segment)).toBe(true);
  });

  it("should NOT form a road if the player does not have the Roads upgrade", () => {
    const tile1 = game.ref(0, 10);
    const tile2 = game.ref(0, 15);
    game.conquer(playerA as PlayerImpl, tile1);
    game.conquer(playerA as PlayerImpl, tile2);

    playerA.buildUnit(UnitType.City, tile1, {});
    playerA.buildUnit(UnitType.City, tile2, {});
    executeTicks(game, 15);

    const roads = (roadManager as any).roads;
    expect(roads.size).toBe(0);
  });

  it("destroyPlayerRoads should clear all road state for a player", () => {
    playerA.addUpgrade(UpgradeType.Roads);
    const tile1 = game.ref(0, 10);
    const tile2 = game.ref(0, 15);
    for (let i = 10; i <= 15; i++) {
      game.conquer(playerA as PlayerImpl, game.ref(0, i));
    }

    const city1 = playerA.buildUnit(UnitType.City, tile1, {});
    const city2 = playerA.buildUnit(UnitType.City, tile2, {});
    executeTicks(game, 15);
    expect((roadManager as any).roads.size).toBeGreaterThan(0);

    const segment = (roadManager as any).getCanonicalSegment(
      city1.tile(),
      city2.tile(),
    );

    roadManager.destroyPlayerRoads(playerA);

    expect((roadManager as any).roads.size).toBe(0);
    expect((roadManager as any).roadsByOwner.has(playerA.id())).toBe(false);
    expect((roadManager as any).existingRoadSegments.has(segment)).toBe(false);
    expect((roadManager as any).pathCache.size).toBe(0);
    const graph = (roadManager as any).structureGraph;
    const edge = graph.getEdge(city1, city2);
    expect(edge).toBeUndefined();
  });

  it("should rebuild the road network after using markPlayerNodesForReconnection", () => {
    playerA.addUpgrade(UpgradeType.Roads);
    const tile1 = game.ref(0, 10);
    const tile2 = game.ref(0, 15);
    for (let i = 10; i <= 15; i++) {
      game.conquer(playerA as PlayerImpl, game.ref(0, i));
    }

    playerA.buildUnit(UnitType.City, tile1, {});
    playerA.buildUnit(UnitType.City, tile2, {});
    executeTicks(game, 15);
    expect((roadManager as any).roads.size).toBeGreaterThan(0);

    roadManager.destroyPlayerRoads(playerA);
    expect((roadManager as any).roads.size).toBe(0);

    // Re-add the upgrade before marking for reconnection
    playerA.addUpgrade(UpgradeType.Roads);
    roadManager.markPlayerNodesForReconnection(playerA);
    executeTicks(game, 15);

    expect((roadManager as any).roads.size).toBeGreaterThan(0);
  });
});
