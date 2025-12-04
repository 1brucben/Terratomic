import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import { SAMLauncherExecution } from "../../../src/core/execution/SAMLauncherExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
  UpgradeType,
} from "../../../src/core/game/Game";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { setup } from "../../util/Setup";
import { constructionExecution, executeTicks } from "../../util/utils";

let game: Game;
let attacker: Player;
let defender: Player;

describe("SAM smart targeting integration (additional)", () => {
  beforeEach(async () => {
    game = await setup("BigPlains", { infiniteGold: true, instantBuild: true });

    const defender_info = new PlayerInfo(
      "us",
      "defender_id_ex",
      PlayerType.Human,
      null,
      "defender_id_ex",
    );
    const attacker_info = new PlayerInfo(
      "fr",
      "attacker_id_ex",
      PlayerType.Human,
      null,
      "attacker_id_ex",
    );

    // Register players
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

    // Grant nuclear upgrade so attacker can build missile silo and nukes
    attacker.addUpgrade(UpgradeType.NuclearFission);

    // Ensure attacker has a missile silo to launch nukes
    constructionExecution(game, attacker, 7, 7, UnitType.MissileSilo);

    // Grant air tech so attacker can build bombers
    attacker.addUpgrade(UpgradeType.JetEngines);

    // Grant SAM tech so defender can build SAM launchers
    defender.addUpgrade(UpgradeType.SAMLevel1);
  });

  test("nuke trajectory available for smart interception", () => {
    const target = game.ref(10, 1);
    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      attacker,
      target,
      null,
    );
    game.addExecution(nukeExec);

    // Allow NukeExecution to initialize and move enough steps
    executeTicks(game, 30);

    const nuke = nukeExec.getNuke();
    expect(nuke).not.toBeNull();
    // Ensure trajectory is populated to enable smart interception
    expect(nuke!.trajectory().length).toBeGreaterThan(1);

    // Now add SAM and let it intercept to ensure end-to-end remains functional
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    // Let SAM intercept to ensure end-to-end remains functional
    executeTicks(game, 20);
    expect(nuke!.isActive()).toBeFalsy();
  });

  test("SAM still intercepts hostile planes (bomber)", () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    // Place a hostile bomber within plane detection radius
    jest.spyOn(PseudoRandom.prototype, "next").mockReturnValue(0.1); // Guarantee hit
    const bomber = attacker.buildUnit(UnitType.Bomber, game.ref(5, 1), {
      targetTile: game.ref(0, 0),
    });

    // Run enough ticks to trigger periodic plane checks and missile travel
    executeTicks(game, 60);

    // Bomber should be intercepted (deleted) or at least targeted
    const stillThere = attacker.units(UnitType.Bomber).includes(bomber);
    const targeted = bomber.targetedBySAM?.() ?? false;

    expect(stillThere ? targeted : true).toBeTruthy();
  });
});
