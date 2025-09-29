import { BomberExecution } from "../../../src/core/execution/BomberExecution";
import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import { WarshipExecution } from "../../../src/core/execution/WarshipExecution";
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

describe("FighterJet Naval Targeting", () => {
  let game: Game;
  let attacker: Player;
  let defender: Player;

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
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

    // Attacker and Defender need an airfield to use fighters and bombers
    attacker.buildUnit(UnitType.Airfield, game.ref(1, 1), {});
    defender.buildUnit(UnitType.Airfield, game.ref(10, 1), {});
  });

  test("should NOT target ships without the upgrade", () => {
    const fighter = attacker.buildUnit(UnitType.FighterJet, game.ref(1, 2), {
      patrolTile: game.ref(1, 2),
    });
    const warship = defender.buildUnit(UnitType.Warship, game.ref(1, 5), {
      patrolTile: game.ref(1, 5),
    });
    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new FighterJetExecution(fighter));

    executeTicks(game, 15);

    expect(fighter.targetUnit()).toBeUndefined();
  });

  test("should target and one-shot a TransportShip with the upgrade", () => {
    attacker.addUpgrade(UpgradeType.FighterJetNavalTargeting);
    const fighter = attacker.buildUnit(UnitType.FighterJet, game.ref(1, 2), {
      patrolTile: game.ref(1, 2),
    });
    const transportShip = defender.buildUnit(
      UnitType.TransportShip,
      game.ref(1, 5),
      {},
    );
    game.addExecution(new FighterJetExecution(fighter));

    executeTicks(game, 25); // 10 for scan + 15 for attack

    expect(transportShip.isActive()).toBe(false);
  });

  test("should damage a Warship with the upgrade", () => {
    attacker.addUpgrade(UpgradeType.FighterJetNavalTargeting);
    const fighter = attacker.buildUnit(UnitType.FighterJet, game.ref(1, 2), {
      patrolTile: game.ref(1, 2),
    });
    const warship = defender.buildUnit(UnitType.Warship, game.ref(1, 5), {
      patrolTile: game.ref(1, 5),
    });
    game.addExecution(new WarshipExecution(warship));
    const initialHealth = warship.health();
    game.addExecution(new FighterJetExecution(fighter));

    executeTicks(game, 25);

    expect(warship.health()).toBe(initialHealth - 250);
  });

  test("should prioritize aircraft over ships", () => {
    attacker.addUpgrade(UpgradeType.FighterJetNavalTargeting);
    const fighter = attacker.buildUnit(UnitType.FighterJet, game.ref(1, 2), {
      patrolTile: game.ref(1, 2),
    });
    const warship = defender.buildUnit(UnitType.Warship, game.ref(1, 5), {
      patrolTile: game.ref(1, 5),
    });
    game.addExecution(new WarshipExecution(warship));
    const bomber = defender.buildUnit(UnitType.Bomber, game.ref(1, 6), {
      targetTile: game.ref(1, 1),
    });
    const airfield = defender.units(UnitType.Airfield)[0];
    game.addExecution(
      new BomberExecution(defender, airfield, game.ref(1, 1), new Map()),
    );
    game.addExecution(new FighterJetExecution(fighter));

    executeTicks(game, 15);

    expect(fighter.targetUnit()?.id()).toBe(bomber.id());
  });
});
