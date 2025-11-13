import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import { SAMLauncherExecution } from "../../../src/core/execution/SAMLauncherExecution";
import { SAMMissileExecution } from "../../../src/core/execution/SAMMissileExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { setup } from "../../util/Setup";
import { constructionExecution, executeTicks } from "../../util/utils";

let game: Game;
let attacker: Player;
let defender: Player;

describe("SAM smart targeting edge cases", () => {
  beforeEach(async () => {
    game = await setup("BigPlains", { infiniteGold: true, instantBuild: true });

    const defender_info = new PlayerInfo(
      "us",
      "defender_edge",
      PlayerType.Human,
      null,
      "defender_edge",
    );
    const attacker_info = new PlayerInfo(
      "fr",
      "attacker_edge",
      PlayerType.Human,
      null,
      "attacker_edge",
    );

    game.addPlayer(defender_info);
    game.addPlayer(attacker_info);

    game.addExecution(
      new SpawnExecution(game.player(defender_info.id).info(), game.ref(1, 1)),
      new SpawnExecution(game.player(attacker_info.id).info(), game.ref(7, 7)),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player(attacker_info.id);
    defender = game.player(defender_info.id);
  });

  test("prioritizes Hydrogen Bomb over Atom Bomb when both reachable", () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    // Build two nukes with short, targetable trajectories within range
    const atom = attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 1), {
      targetTile: game.ref(3, 1),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(2, 1), targetable: true },
        { tile: game.ref(3, 1), targetable: true },
      ],
    });
    const h2 = attacker.buildUnit(UnitType.HydrogenBomb, game.ref(1, 2), {
      targetTile: game.ref(3, 2),
      trajectory: [
        { tile: game.ref(1, 2), targetable: true },
        { tile: game.ref(2, 2), targetable: true },
        { tile: game.ref(3, 2), targetable: true },
      ],
    });

    // Ensure hit roll succeeds so we see the target flag apply
    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1);

    executeTicks(game, 2);

    expect(h2.targetedBySAM()).toBe(true);
    expect(atom.targetedBySAM()).toBe(false);
  });

  test("respects plane cooldown between shots", () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    const addExecSpy = jest.spyOn(game, "addExecution");
    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1);

    attacker.buildUnit(UnitType.Airfield, game.ref(6, 1), {});
    attacker.buildUnit(UnitType.Bomber, game.ref(5, 1), {
      targetTile: game.ref(0, 0),
    });

    // First shot (plane checks run every 20 ticks with offset)
    executeTicks(game, 25);
    expect(addExecSpy).toHaveBeenCalledWith(expect.any(SAMMissileExecution));
    const callsAfterFirst = addExecSpy.mock.calls.length;

    // New target before plane cooldown elapses
    attacker.buildUnit(UnitType.Bomber, game.ref(6, 2), {
      targetTile: game.ref(0, 0),
    });
    // Ensure a plane check occurs but cooldown still blocks
    executeTicks(game, 20);
    expect(addExecSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  test("does not target returning bombers", () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    const addExecSpy = jest.spyOn(game, "addExecution");
    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1);

    const bomber = attacker.buildUnit(UnitType.Bomber, game.ref(5, 1), {
      targetTile: game.ref(0, 0),
    });
    bomber.setReturning(true);

    executeTicks(game, 40);

    expect(addExecSpy).not.toHaveBeenCalledWith(
      expect.any(SAMMissileExecution),
    );
    expect(bomber.targetedBySAM()).toBe(false);
  });

  test("does not launch at nukes with only out-of-range targetable segments", () => {
    // Build a SAM in the middle, with targetable nuke segments only near ends
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(50, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    // Ensure attacker has a missile silo to launch nukes
    constructionExecution(game, attacker, 7, 7, UnitType.MissileSilo);

    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      attacker,
      game.ref(100, 1),
      game.ref(1, 1),
    );
    game.addExecution(nukeExec);

    const addExecSpy = jest.spyOn(game, "addExecution");
    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1);

    // Run enough ticks for the nuke to pass near the SAM
    executeTicks(game, 80);

    // SAM should not have fired (no SAM missile launches) and did not enter cooldown due to nuke
    expect(addExecSpy).not.toHaveBeenCalledWith(
      expect.any(SAMMissileExecution),
    );
    expect(sam.isInCooldown()).toBe(false);
    // Nuke may have detonated by now depending on path speed; we only care SAM didn't fire
  });
});
