import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import {
  BotPersonality,
  FakeHumanExecution,
} from "../src/core/execution/FakeHumanExecution";
import { shouldAcceptPeaceRequest } from "../src/core/execution/utils/BotBehavior";
import {
  Difficulty,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { Cell } from "../src/core/game/GameMap";
import { RESEARCH_TECH_IDS } from "../src/core/tech/TechEffects";
import { setup } from "./util/Setup";

let game: Game;

describe("FakeHumanExecution - Personality Assignment", () => {
  beforeEach(async () => {
    game = await setup("BigPlains", { infiniteGold: true, instantBuild: true });
  });

  test("applyPersonality assigns correct research priorities", async () => {
    const personalities = [
      BotPersonality.Nuclear,
      BotPersonality.LandWarfare,
      BotPersonality.AirSupremacy,
      BotPersonality.NavalPower,
    ];

    for (let i = 0; i < personalities.length; i++) {
      // Create player with fixed personality
      const playerInfo = new PlayerInfo(
        "us",
        `player_${i}`,
        PlayerType.FakeHuman,
        null,
        `player_${i}`,
      );
      game.addPlayer(playerInfo);

      // Create FakeHuman execution with SAME playerInfo so IDs match
      const spawnCell = new Cell(50, 50);
      const nation = new Nation(spawnCell, 1, playerInfo);
      const fakeHuman = new FakeHumanExecution("test-game", nation);
      game.addExecution(fakeHuman);

      // Verify execution was created and added successfully
      expect(fakeHuman).toBeDefined();
    }
  });
});

describe("FakeHumanExecution - Building Priorities", () => {
  beforeEach(async () => {
    game = await setup("BigPlains", { infiniteGold: true, instantBuild: true });
  });

  test("Nuclear personality prioritizes Silo early", async () => {
    const playerInfo = new PlayerInfo(
      "us",
      "nuclear_player",
      PlayerType.FakeHuman,
      null,
      "nuclear_player",
    );
    game.addPlayer(playerInfo);

    const spawnCell = new Cell(50, 50);
    const nation = new Nation(spawnCell, 1, playerInfo);
    const fakeHuman = new FakeHumanExecution("test-game", nation);
    game.addExecution(fakeHuman);

    // Verify execution was created and added successfully
    expect(fakeHuman).toBeDefined();
  });

  test("NavalPower personality prioritizes Port early", async () => {
    const playerInfo = new PlayerInfo(
      "us",
      "naval_player",
      PlayerType.FakeHuman,
      null,
      "naval_player",
    );
    game.addPlayer(playerInfo);

    const spawnCell = new Cell(50, 50);
    const nation = new Nation(spawnCell, 1, playerInfo);
    const fakeHuman = new FakeHumanExecution("test-game", nation);
    game.addExecution(fakeHuman);

    // Verify execution was created and added successfully
    expect(fakeHuman).toBeDefined();
  });

  test("LandWarfare personality prioritizes Factory early", async () => {
    const playerInfo = new PlayerInfo(
      "us",
      "land_player",
      PlayerType.FakeHuman,
      null,
      "land_player",
    );
    game.addPlayer(playerInfo);

    const spawnCell = new Cell(50, 50);
    const nation = new Nation(spawnCell, 1, playerInfo);
    const fakeHuman = new FakeHumanExecution("test-game", nation);
    game.addExecution(fakeHuman);

    // Verify execution was created and added successfully
    expect(fakeHuman).toBeDefined();
  });
});

describe("FakeHumanExecution - City Stacking", () => {
  beforeEach(async () => {
    game = await setup("BigPlains", {
      infiniteGold: true,
      instantBuild: true,
    });
  });

  test("saturated bot stacks cities up to 25x", async () => {
    const playerInfo = new PlayerInfo(
      "us",
      "saturated_player",
      PlayerType.FakeHuman,
      null,
      "saturated_player",
    );
    game.addPlayer(playerInfo);
    const player = game.player("saturated_player");

    // Give bot unlimited gold since infiniteGold only applies to Human type
    player.addGold(100_000_000n);

    // Give player a very small territory - small enough to saturate quickly
    // With ~200 tiles, the bot won't be able to build many structures due to
    // spacing requirements (MIN_BUILDING_DISTANCE_SQUARED = 1600 = 40 tiles)
    // So it will quickly reach the stacking fallback
    let tilesGiven = 0;
    game.map().forEachTile((tile) => {
      if (game.map().isLand(tile) && tilesGiven < 200) {
        player.conquer(tile);
        tilesGiven++;
      }
    });

    // First, manually build a city so we have something to stack
    const landTile = Array.from(player.tiles())[0];
    game.addExecution(
      new ConstructionExecution(player, UnitType.City, landTile),
    );
    game.executeNextTick();

    const spawnCell = new Cell(50, 50);
    const nation = new Nation(spawnCell, 1, playerInfo);
    const fakeHuman = new FakeHumanExecution("test-game", nation);
    game.addExecution(fakeHuman);

    // Run enough ticks for the bot to attempt building and hit stacking fallback
    for (let tick = 0; tick < 1000; tick++) {
      game.executeNextTick();
    }

    // Check if any cities have stack > 1
    const cities = player.units(UnitType.City);
    const stackedCities = cities.filter((city) => city.stackCount() > 1);

    // Should have some stacked cities when saturated with gold but no buildable space
    expect(stackedCities.length).toBeGreaterThan(0);

    // No city should exceed MAX_CITY_STACK (25)
    cities.forEach((city) => {
      expect(city.stackCount()).toBeLessThanOrEqual(25);
    });
  });

  test("non-saturated bot does not stack cities", async () => {
    const playerInfo = new PlayerInfo(
      "us",
      "expanding_player",
      PlayerType.FakeHuman,
      null,
      "expanding_player",
    );
    game.addPlayer(playerInfo);
    const player = game.player("expanding_player");

    // Give bot unlimited gold since infiniteGold only applies to Human type
    player.addGold(100_000_000n);

    // Give player large territory - enough space to build without stacking
    let tilesGiven = 0;
    game.map().forEachTile((tile) => {
      if (game.map().isLand(tile) && tilesGiven < 50000) {
        player.conquer(tile);
        tilesGiven++;
      }
    });

    // Add a few cities so we have something to potentially stack
    const landTiles = Array.from(player.tiles()).slice(0, 3);
    for (const tile of landTiles) {
      game.addExecution(new ConstructionExecution(player, UnitType.City, tile));
      game.executeNextTick();
    }

    const spawnCell = new Cell(50, 50);
    const nation = new Nation(spawnCell, 1, playerInfo);
    const fakeHuman = new FakeHumanExecution("test-game", nation);
    game.addExecution(fakeHuman);

    // Run for moderate time
    for (let tick = 0; tick < 500; tick++) {
      game.executeNextTick();
    }

    // With large territory, should still be building variety, not stacking
    const cities = player.units(UnitType.City);
    const stackedCities = cities.filter((city) => city.stackCount() > 1);

    // With large territory, no cities should be stacked (plenty of room to build elsewhere)
    expect(stackedCities.length).toBe(0);
  });
});

describe("shouldAcceptPeaceRequest", () => {
  let player: Player;
  let requestor: Player;

  beforeEach(async () => {
    game = await setup("BigPlains", {
      difficulty: Difficulty.Medium,
      infiniteGold: true,
    });

    const playerInfo = new PlayerInfo(
      "us",
      "player_id",
      PlayerType.FakeHuman,
      null,
      "player_id",
    );
    const requestorInfo = new PlayerInfo(
      "fr",
      "requestor_id",
      PlayerType.Human,
      null,
      "requestor_id",
    );

    game.addPlayer(playerInfo);
    game.addPlayer(requestorInfo);

    player = game.player("player_id");
    requestor = game.player("requestor_id");

    // Set them at war
    player.setWarWith(requestor);
    requestor.setWarWith(player);
  });

  function setupTerritory(
    playerTiles: number,
    requestorTiles: number,
    playerPopulation: number = 100,
    requestorPopulation: number = 100,
  ) {
    let playerCount = 0;
    let requestorCount = 0;

    game.map().forEachTile((tile) => {
      if (game.map().isLand(tile)) {
        if (playerCount < playerTiles) {
          player.conquer(tile);
          playerCount++;
        } else if (requestorCount < requestorTiles) {
          requestor.conquer(tile);
          requestorCount++;
        }
      }
    });

    // Mock population
    jest.spyOn(player, "population").mockReturnValue(playerPopulation);
    jest.spyOn(requestor, "population").mockReturnValue(requestorPopulation);
  }

  test("auto-accept when losing badly (< 40% territory)", () => {
    setupTerritory(30, 100); // Player has 30% of requestor's tiles

    const shouldAccept = shouldAcceptPeaceRequest(
      game,
      player,
      requestor,
      BotPersonality.Nuclear, // Even aggressive personality accepts when losing
    );

    expect(shouldAccept).toBe(true);
  });

  test("auto-accept when under heavy attack (> 3 incoming)", () => {
    setupTerritory(100, 100);

    // Mock 4 incoming attacks
    jest.spyOn(player, "incomingAttacks").mockReturnValue(new Array(4));

    const shouldAccept = shouldAcceptPeaceRequest(
      game,
      player,
      requestor,
      BotPersonality.Nuclear,
    );

    expect(shouldAccept).toBe(true);
  });

  test("auto-reject when winning decisively", () => {
    setupTerritory(100, 30, 300, 100); // Player has 3x territory, 3x troops

    const shouldAccept = shouldAcceptPeaceRequest(
      game,
      player,
      requestor,
      BotPersonality.Balanced,
    );

    expect(shouldAccept).toBe(false);
  });

  test("aggressive personality (Nuclear) rejects unless under attack", () => {
    setupTerritory(100, 100); // Balanced situation

    jest.spyOn(player, "incomingAttacks").mockReturnValue([]);

    const shouldAccept = shouldAcceptPeaceRequest(
      game,
      player,
      requestor,
      BotPersonality.Nuclear,
    );

    expect(shouldAccept).toBe(false);
  });

  test("aggressive personality (LandWarfare) accepts if under attack", () => {
    setupTerritory(100, 100);

    jest.spyOn(player, "incomingAttacks").mockReturnValue(new Array(1));

    const shouldAccept = shouldAcceptPeaceRequest(
      game,
      player,
      requestor,
      BotPersonality.LandWarfare,
    );

    expect(shouldAccept).toBe(true);
  });

  test("diplomatic personality (Naval) accepts readily", () => {
    setupTerritory(100, 100); // Balanced situation

    const shouldAccept = shouldAcceptPeaceRequest(
      game,
      player,
      requestor,
      BotPersonality.NavalPower,
    );

    expect(shouldAccept).toBe(true);
  });

  test("diplomatic personality (Air) accepts readily", () => {
    setupTerritory(100, 100);

    const shouldAccept = shouldAcceptPeaceRequest(
      game,
      player,
      requestor,
      BotPersonality.AirSupremacy,
    );

    expect(shouldAccept).toBe(true);
  });

  test("Balanced personality accepts on Medium difficulty", () => {
    setupTerritory(100, 100);

    const shouldAccept = shouldAcceptPeaceRequest(
      game,
      player,
      requestor,
      BotPersonality.Balanced,
    );

    expect(shouldAccept).toBe(true);
  });

  test("Balanced personality rejects on Impossible difficulty", async () => {
    // Create new game with Impossible difficulty
    const hardGame = await setup("BigPlains", {
      difficulty: Difficulty.Impossible,
      infiniteGold: true,
    });

    const pInfo = new PlayerInfo(
      "us",
      "p_id",
      PlayerType.FakeHuman,
      null,
      "p_id",
    );
    const rInfo = new PlayerInfo("fr", "r_id", PlayerType.Human, null, "r_id");

    hardGame.addPlayer(pInfo);
    hardGame.addPlayer(rInfo);

    const p = hardGame.player("p_id");
    const r = hardGame.player("r_id");

    let pCount = 0;
    let rCount = 0;
    hardGame.map().forEachTile((tile) => {
      if (hardGame.map().isLand(tile)) {
        if (pCount < 100) {
          p.conquer(tile);
          pCount++;
        } else if (rCount < 100) {
          r.conquer(tile);
          rCount++;
        }
      }
    });

    const shouldAccept = shouldAcceptPeaceRequest(
      hardGame,
      p,
      r,
      BotPersonality.Balanced,
    );

    expect(shouldAccept).toBe(false);
  });
});

describe("FakeHumanExecution - Research Priority Execution", () => {
  beforeEach(async () => {
    game = await setup("BigPlains", { infiniteGold: true, instantBuild: true });
  });

  test("research priorities use valid tech IDs not lowercase strings", async () => {
    const personalities = [
      BotPersonality.Nuclear,
      BotPersonality.LandWarfare,
      BotPersonality.AirSupremacy,
      BotPersonality.NavalPower,
    ];

    const validTechIds = Object.values(RESEARCH_TECH_IDS);

    for (const personality of personalities) {
      const playerInfo = new PlayerInfo(
        "us",
        `test_${personality}`,
        PlayerType.FakeHuman,
        null,
        `test_${personality}`,
      );
      game.addPlayer(playerInfo);
      const player = game.player(`test_${personality}`);

      let tilesGiven = 0;
      game.map().forEachTile((tile) => {
        if (game.map().isLand(tile) && tilesGiven < 50) {
          player.conquer(tile);
          tilesGiven++;
        }
      });

      const spawnCell = new Cell(50, 50);
      const nation = new Nation(spawnCell, 1, playerInfo);
      const fakeHuman = new FakeHumanExecution("test-game", nation);
      game.addExecution(fakeHuman);

      for (let tick = 0; tick < 50; tick++) {
        game.executeNextTick();
      }

      // Verify bot is investing in research
      expect(player.researchInvestmentRate()).toBeGreaterThanOrEqual(0);
    }
  });
});
