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
