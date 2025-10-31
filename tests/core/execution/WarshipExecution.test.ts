import { SAMMissileExecution } from "../../../src/core/execution/SAMMissileExecution";
import { WarshipExecution } from "../../../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
  UpgradeType,
} from "../../../src/core/game/Game";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

// Test suite for the Warship's new Anti-Air capability
describe("WarshipExecution AA Capability", () => {
  let game: Game;
  let player1: Player; // Our warship owner
  let player2: Player; // Our aircraft owner
  let warship: Unit;

  // This block runs before each test to create a clean game world
  beforeEach(async () => {
    // Use the existing 'setup' helper to create the game
    game = await setup(
      "half_land_half_ocean", // A map with water
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("p1", "Player 1", PlayerType.Human, null, "p1_id"),
        new PlayerInfo("p2", "Player 2", PlayerType.Human, null, "p2_id"),
      ],
    );

    // Fast-forward through the spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Get references to our players
    player1 = game.player("p1_id");
    player2 = game.player("p2_id");

    // Create the warship for player1 at a known valid sea coordinate
    warship = player1.buildUnit(UnitType.Warship, game.ref(7, 10), {
      patrolTile: game.ref(7, 10),
    });

    // Add the WarshipExecution to the game's execution loop
    game.addExecution(new WarshipExecution(warship));
  });

  // Test Case: No Upgrade
  test("should not engage aircraft without the AA upgrade", () => {
    const addExecutionSpy = jest.spyOn(game, "addExecution");
    player2.buildUnit(UnitType.Bomber, game.ref(11, 11), {
      targetTile: game.ref(0, 0),
    });
    executeTicks(game, 10);
    expect(addExecutionSpy).not.toHaveBeenCalledWith(
      expect.any(SAMMissileExecution),
    );
  });

  // Test Case: With Upgrade
  test("should engage a bomber with the AA upgrade", () => {
    player1.addUpgrade(UpgradeType.WarshipAntiAir);
    const addExecutionSpy = jest.spyOn(game, "addExecution");
    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1); // Guarantee hit
    player2.buildUnit(UnitType.Bomber, game.ref(11, 11), {
      targetTile: game.ref(0, 0),
    });
    executeTicks(game, 10);
    expect(addExecutionSpy).toHaveBeenCalledWith(
      expect.any(SAMMissileExecution),
    );
  });

  // Test Case: Range Check
  test("should not engage aircraft outside of AA range", () => {
    player1.addUpgrade(UpgradeType.WarshipAntiAir);
    const addExecutionSpy = jest.spyOn(game, "addExecution");

    // Mock the AA range to be a very small, controllable value
    jest.spyOn(game.config(), "warshipAARange").mockReturnValue(5);

    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1);

    // Place bomber at a safe coordinate outside the mocked range of 5
    player2.buildUnit(UnitType.Bomber, game.ref(0, 0), {
      targetTile: game.ref(0, 0),
    });

    executeTicks(game, 10);

    expect(addExecutionSpy).not.toHaveBeenCalledWith(
      expect.any(SAMMissileExecution),
    );
  });

  // Test Case: Cooldown Check
  test("should respect the AA cooldown", () => {
    player1.addUpgrade(UpgradeType.WarshipAntiAir);
    const addExecutionSpy = jest.spyOn(game, "addExecution");
    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1); // Guarantee hits
    player2.buildUnit(UnitType.Bomber, game.ref(11, 11), {
      targetTile: game.ref(0, 0),
    });

    // Fire the first shot
    executeTicks(game, 10);
    expect(addExecutionSpy).toHaveBeenCalledTimes(1);

    // Create a new target immediately. Cooldown is 50 ticks.
    player2.buildUnit(UnitType.Bomber, game.ref(12, 12), {
      targetTile: game.ref(0, 0),
    });
    executeTicks(game, 40); // Not enough time for cooldown

    // Assert it hasn't fired again
    expect(addExecutionSpy).toHaveBeenCalledTimes(1);
  });

  // Test Case: Target Priority
  test("should prioritize a Paratrooper over a Bomber", () => {
    player1.addUpgrade(UpgradeType.WarshipAntiAir);
    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1); // Guarantee hit

    const bomber = player2.buildUnit(UnitType.Bomber, game.ref(11, 11), {
      targetTile: game.ref(0, 0),
    });
    const paratrooper = player2.buildUnit(
      UnitType.Paratrooper,
      game.ref(12, 12),
      { troops: 100, targetTile: game.ref(1, 1) },
    );

    executeTicks(game, 10);

    expect(paratrooper.targetedBySAM()).toBe(true);
    expect(bomber.targetedBySAM()).toBe(false);
  });

  // Test Case: No Nuke Targeting
  test("should ignore nuke units", () => {
    player1.addUpgrade(UpgradeType.WarshipAntiAir);
    const addExecutionSpy = jest.spyOn(game, "addExecution");
    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1);
    player2.buildUnit(UnitType.AtomBomb, game.ref(11, 11), {});
    executeTicks(game, 10);
    expect(addExecutionSpy).not.toHaveBeenCalledWith(
      expect.any(SAMMissileExecution),
    );
  });

  // Test Case: Anti-Overkill
  test("should not fire at a target already targeted by another SAM", () => {
    player1.addUpgrade(UpgradeType.WarshipAntiAir);
    const addExecutionSpy = jest.spyOn(game, "addExecution");
    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1);

    const bomber = player2.buildUnit(UnitType.Bomber, game.ref(11, 11), {
      targetTile: game.ref(0, 0),
    });
    bomber.setTargetedBySAM(true); // Simulate another SAM locking on

    executeTicks(game, 10);

    expect(addExecutionSpy).not.toHaveBeenCalledWith(
      expect.any(SAMMissileExecution),
    );
  });
});
