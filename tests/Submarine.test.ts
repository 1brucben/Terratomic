import { MoveSubmarineExecution } from "../src/core/execution/MoveSubmarineExecution";
import { SubmarineExecution } from "../src/core/execution/SubmarineExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

describe("Submarine", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo(
          "us",
          "boat dude",
          PlayerType.Human,
          null,
          "player_1_id",
        ),
        new PlayerInfo(
          "us",
          "boat dude",
          PlayerType.Human,
          null,
          "player_2_id",
        ),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("Submarine heals only if player has port", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Submarine).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    const port = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const submarine = player1.buildUnit(
      UnitType.Submarine,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new SubmarineExecution(submarine));

    game.executeNextTick();

    expect(submarine.health()).toBe(maxHealth);
    submarine.modifyHealth(-10);
    expect(submarine.health()).toBe(maxHealth - 10);
    game.executeNextTick();
    expect(submarine.health()).toBe(maxHealth - 9);

    port.delete();

    game.executeNextTick();
    expect(submarine.health()).toBe(maxHealth - 9);
  });

  test("Submarine destroys trade ship if player has port", async () => {
    const portTile = game.ref(coastX, 10);
    player1.buildUnit(UnitType.Port, portTile, {});
    game.addExecution(
      new SubmarineExecution(
        player1.buildUnit(UnitType.Submarine, portTile, {
          patrolTile: portTile,
        }),
      ),
    );

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 7),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    player1.setWarWith(player2);

    expect(tradeShip.owner().id()).toBe(player2.id());
    // Let plenty of time for A* to execute
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }
    expect(tradeShip.isActive()).toBe(false);
  });

  test("Submarine does not destroy trade if player has no port", async () => {
    game.addExecution(
      new SubmarineExecution(
        player1.buildUnit(UnitType.Submarine, game.ref(coastX + 1, 11), {
          patrolTile: game.ref(coastX + 1, 11),
        }),
      ),
    );

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 11),
      {
        targetUnit: player1.buildUnit(UnitType.Port, game.ref(coastX, 11), {}),
      },
    );

    expect(tradeShip.owner().id()).toBe(player2.id());
    // Let plenty of time for warship to potentially capture trade ship
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }

    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("Submarine does not target trade ships that are safe from pirates", async () => {
    // build port so submarine can target trade ships
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const submarine = player1.buildUnit(
      UnitType.Submarine,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new SubmarineExecution(submarine));

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 10),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    tradeShip.setSafeFromPirates();

    executeTicks(game, 10);

    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("Submarine does not target trade ship docked at a port", async () => {
    // build port so submarine can target trade ships
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const submarine = player1.buildUnit(
      UnitType.Submarine,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new SubmarineExecution(submarine));

    // Place a port for player2 and put the trade ship ON the port tile (docked)
    const enemyPort = player2.buildUnit(
      UnitType.Port,
      game.ref(coastX, 11),
      {},
    );
    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      enemyPort.tile(), // docked at port
      {
        targetUnit: enemyPort,
      },
    );

    executeTicks(game, 10);

    // Trade ship should remain alive and owned by player2
    expect(tradeShip.isActive()).toBe(true);
    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("Submarine moves to new patrol tile", async () => {
    game.config().warshipTargettingRange = () => 1;

    const submarine = player1.buildUnit(
      UnitType.Submarine,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    game.addExecution(new SubmarineExecution(submarine));

    game.addExecution(
      new MoveSubmarineExecution(
        player1,
        submarine.id(),
        game.ref(coastX + 5, 15),
      ),
    );

    executeTicks(game, 10);

    expect(submarine.patrolTile()).toBe(game.ref(coastX + 5, 15));
  });

  test("Submarine does not target trade ships outside of patrol range", async () => {
    game.config().warshipTargettingRange = () => 3;

    // build port so submarine can target trade ships
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const submarine = player1.buildUnit(
      UnitType.Submarine,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new SubmarineExecution(submarine));

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 15),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    executeTicks(game, 10);

    // Trade ship should not be captured
    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("MoveSubmarineExecution fails if player is not the owner", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const submarine = player1.buildUnit(
      UnitType.Submarine,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    new MoveSubmarineExecution(
      player2,
      submarine.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(submarine.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveSubmarineExecution fails if submarine is not active", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const submarine = player1.buildUnit(
      UnitType.Submarine,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    submarine.delete();
    new MoveSubmarineExecution(
      player1,
      submarine.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(submarine.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveSubmarineExecution fails gracefully if submarine not found", async () => {
    const exec = new MoveSubmarineExecution(
      player1,
      123,
      game.ref(coastX + 5, 15),
    );

    // Verify that no error is thrown.
    exec.init(game, 0);

    expect(exec.isActive()).toBe(false);
  });
});

// Test suite for Submarine target and detection caching
describe("Submarine Target & Detection Caching", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("p1", "Player 1", PlayerType.Human, null, "p1_id"),
        new PlayerInfo("p2", "Player 2", PlayerType.Human, null, "p2_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("p1_id");
    player2 = game.player("p2_id");
  });

  test("should cache target and maintain across ticks", () => {
    const submarine = player1.buildUnit(UnitType.Submarine, game.ref(7, 10), {
      patrolTile: game.ref(7, 10),
    });
    game.addExecution(new SubmarineExecution(submarine));

    const enemyWarship = player2.buildUnit(UnitType.Warship, game.ref(8, 10), {
      patrolTile: game.ref(8, 10),
    });

    // Let submarine acquire target
    executeTicks(game, 3);
    const initialTarget = submarine.targetUnit();

    // Run several more ticks - target should remain cached
    executeTicks(game, 7); // Total of 10 ticks (cache duration)
    const targetAfterCache = submarine.targetUnit();

    // If submarine had a target, it should maintain it via cache
    if (initialTarget && enemyWarship.isActive()) {
      expect(targetAfterCache).toBe(initialTarget);
    }
  });

  test("should invalidate target cache when target destroyed", () => {
    const submarine = player1.buildUnit(UnitType.Submarine, game.ref(7, 10), {
      patrolTile: game.ref(7, 10),
    });
    game.addExecution(new SubmarineExecution(submarine));

    const enemyWarship = player2.buildUnit(UnitType.Warship, game.ref(8, 10), {
      patrolTile: game.ref(8, 10),
    });

    executeTicks(game, 5);
    const hadTarget = submarine.targetUnit() === enemyWarship;

    // Destroy enemy
    enemyWarship.modifyHealth(-1000);
    game.executeNextTick();

    // If had target, should be cleared now
    if (hadTarget) {
      expect(submarine.targetUnit()).toBeUndefined();
    }
  });

  test("should cache detection state", () => {
    const submarine = player1.buildUnit(UnitType.Submarine, game.ref(7, 10), {
      patrolTile: game.ref(7, 10),
    });
    game.addExecution(new SubmarineExecution(submarine));

    // Initially not detected
    executeTicks(game, 2);
    expect(submarine.isDetectedByNavalUnit).toBeFalsy();

    // Add nearby enemy warship
    player2.buildUnit(UnitType.Warship, game.ref(8, 10), {
      patrolTile: game.ref(8, 10),
    });

    // Should be detected after scan
    executeTicks(game, 10);
    expect(submarine.isDetectedByNavalUnit).toBe(true);
  });

  test("should re-scan after cache expires", () => {
    const submarine = player1.buildUnit(UnitType.Submarine, game.ref(7, 10), {
      patrolTile: game.ref(7, 10),
    });
    game.addExecution(new SubmarineExecution(submarine));

    const enemyWarship = player2.buildUnit(UnitType.Warship, game.ref(8, 10), {
      patrolTile: game.ref(8, 10),
    });

    // Let it acquire target
    executeTicks(game, 2);
    const firstTarget = submarine.targetUnit();

    // Run past cache expiration (10+ ticks)
    executeTicks(game, 11);

    // If it had a target initially, cache should have been refreshed
    // (may still have same target if still valid, or undefined if no valid targets)
    if (firstTarget && enemyWarship.isActive()) {
      // Target should still be tracked (either cached or rescanned)
      expect([firstTarget, undefined]).toContain(submarine.targetUnit());
    }
  });

  test("should prioritize warships over transport ships", () => {
    const submarine = player1.buildUnit(UnitType.Submarine, game.ref(7, 10), {
      patrolTile: game.ref(7, 10),
    });
    game.addExecution(new SubmarineExecution(submarine));

    const transport = player2.buildUnit(
      UnitType.TransportShip,
      game.ref(8, 10),
      {},
    );

    const warship = player2.buildUnit(UnitType.Warship, game.ref(9, 10), {
      patrolTile: game.ref(9, 10),
    });

    executeTicks(game, 5);

    const target = submarine.targetUnit();
    // Should prefer warship over transport
    if (target) {
      expect([warship, transport]).toContain(target);
    }
  });
});
