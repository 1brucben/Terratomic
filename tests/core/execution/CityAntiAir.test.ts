import { BomberExecution } from "../../../src/core/execution/BomberExecution";
import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
  UpgradeType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

describe("CityAntiAir", () => {
  let game: Game;
  let attacker: Player;
  let defender: Player;

  beforeEach(async () => {
    game = await setup(
      "BigPlains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo(
          "us",
          "attacker",
          PlayerType.Human,
          "client_id1",
          "attacker_id",
        ),
        new PlayerInfo(
          "us",
          "defender",
          PlayerType.Human,
          "client_id2",
          "defender_id",
        ),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player("attacker_id");
    defender = game.player("defender_id");
  });

  it("should allow a city with the upgrade to intercept a nuke", () => {
    // Arrange: Defender gets the upgrade and a city
    defender.addUpgrade(UpgradeType.CityAntiAir);
    const city = defender.buildUnit(UnitType.City, game.ref(10, 10), {});

    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      attacker,
      city.tile(),
      game.ref(1, 1),
    );
    game.addExecution(nukeExec);

    // Act: Run enough ticks for the interception to occur
    executeTicks(game, 3);

    // Assert
    expect(game.isCitySamOnCooldown(city.id())).toBe(true);
  });

  it("should NOT allow a city without the upgrade to intercept a nuke", () => {
    // Arrange: Defender has a city but NO upgrade
    const city = defender.buildUnit(UnitType.City, game.ref(10, 10), {});

    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      attacker,
      city.tile(),
      game.ref(1, 1),
    );
    game.addExecution(nukeExec);

    // Act: Run a few ticks, not enough for the nuke to detonate
    executeTicks(game, 3);

    // Assert: Nuke is still active and city is not on cooldown
    expect(nukeExec.isActive()).toBe(true);
    expect(game.isCitySamOnCooldown(city.id())).toBe(false);
  });

  it("should respect the cooldown period", () => {
    // Arrange
    defender.addUpgrade(UpgradeType.CityAntiAir);
    const city = defender.buildUnit(UnitType.City, game.ref(10, 10), {});
    const nukeExec1 = new NukeExecution(
      UnitType.AtomBomb,
      attacker,
      city.tile(),
      game.ref(1, 1),
    );
    game.addExecution(nukeExec1);

    // Act: First nuke is intercepted
    executeTicks(game, 3);

    // Assert: Cooldown is active
    expect(game.isCitySamOnCooldown(city.id())).toBe(true);

    // Arrange: Launch a second nuke while cooldown is active
    const nukeExec2 = new NukeExecution(
      UnitType.AtomBomb,
      attacker,
      city.tile(),
      game.ref(1, 2),
    );
    game.addExecution(nukeExec2);

    // Act: Run a few more ticks
    executeTicks(game, 3);

    // Assert: Second nuke is NOT intercepted
    expect(nukeExec2.isActive()).toBe(true);
  });

  it("should allow a city with the upgrade to intercept a bomber", () => {
    // Arrange
    defender.addUpgrade(UpgradeType.CityAntiAir);
    const city = defender.buildUnit(UnitType.City, game.ref(10, 10), {});

    const airfield = attacker.buildUnit(UnitType.Airfield, game.ref(1, 1), {});

    const bomberExec = new BomberExecution(
      attacker,
      airfield,
      city.tile(),
      new Map(),
    );
    game.addExecution(bomberExec);

    // Act: Run enough ticks for interception to occur and be processed
    executeTicks(game, 10);

    // Assert
    expect(bomberExec.isActive()).toBe(false);
    expect(game.isCitySamOnCooldown(city.id())).toBe(true);
  });
});
