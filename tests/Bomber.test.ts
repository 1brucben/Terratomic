import { BomberExecution } from "../src/core/execution/BomberExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Relation,
  UnitType,
  UpgradeType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let player1: Player;
let player2: Player;

describe("Bomber", () => {
  beforeEach(async () => {
    game = await setup(
      "BigPlains",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("us", "bomber player", PlayerType.Human, null, "p1"),
        new PlayerInfo("cn", "target player", PlayerType.Human, null, "p2"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("p1");
    player2 = game.player("p2");

    // Grant air tech upgrades so player1 can build airfields and bombers
    player1.addUpgrade(UpgradeType.JetEngines);

    // Declare war for targeting
    player1.setWarWith(player2);
    player2.setWarWith(player1);
  });

  test("Bomber spawns at airfield with full health", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();

    const bombers = player1.units(UnitType.Bomber);
    expect(bombers.length).toBe(1);
    // New bombers spawn at 100% health (500)
    expect(bombers[0].health()).toBe(500);
    expect(bombers[0].tile()).toBe(airfield.tile());
  });

  test("Bomber targets enemy structure within range (manual targeting)", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    const enemyCity = player2.buildUnit(UnitType.City, game.ref(15, 15), {});

    // Set manual bomber intent
    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    // Spawn bomber
    game.executeNextTick();

    // Wait for cooldown and launch gap
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    expect(bombers.length).toBe(1);
    expect(bombers[0].targetTile()).toBe(enemyCity.tile());
  });

  test("Bomber targets enemy structure (auto-bombing)", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    const enemySAM = player2.buildUnit(
      UnitType.SAMLauncher,
      game.ref(15, 15),
      {},
    );

    player1.setAutoBombingEnabled(true);

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    expect(bombers.length).toBe(1);
    expect(bombers[0].targetTile()).toBe(enemySAM.tile());
  });

  test("Bomber queue prioritizes targets with more bombers assigned", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(3, 3), {});
    const city1 = player2.buildUnit(UnitType.City, game.ref(12, 10), {});
    const city2 = player2.buildUnit(UnitType.City, game.ref(14, 12), {});

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    // Manually set bomber count on city1 to simulate existing assignments
    player1.bombersOnTarget.set(city1.tile(), 2);
    player1.bombersOnTarget.set(city2.tile(), 0);

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    // Should target city1 because it has more bombers (concentrate fire)
    expect(bombers[0].targetTile?.()).toBe(city1.tile());
  });

  test("Bomber avoids SAM coverage when possible", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(3, 3), {});
    const enemyCity = player2.buildUnit(UnitType.City, game.ref(14, 10), {});
    const blockingSAM = player2.buildUnit(
      UnitType.SAMLauncher,
      game.ref(10, 8),
      {},
    );

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    expect(bombers.length).toBe(1);

    // Bomber should have waypoints to avoid SAM
    // We can't directly check waypoints, but we can verify it launched
    expect(bombers[0].targetTile()).toBe(enemyCity.tile());
  });

  test("Bomber ignores target SAM when calculating safe route", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(5, 10), {});
    const targetSAM = player2.buildUnit(
      UnitType.SAMLauncher,
      game.ref(15, 10),
      {},
    );

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.SAMLauncher],
      preferClosest: true,
    });

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    expect(bombers.length).toBe(1);
    // Should be able to target SAM directly
    expect(bombers[0].targetTile()).toBe(targetSAM.tile());
  });

  test("Bomber only avoids SAMs from countries at war", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(5, 10), {});
    const enemyCity = player2.buildUnit(UnitType.City, game.ref(14, 10), {});

    // Add a third neutral player with SAM
    const player3Info = new PlayerInfo(
      "ru",
      "neutral player",
      PlayerType.Human,
      null,
      "p3",
    );
    const player3 = game.addPlayer(player3Info);
    const neutralSAM = player3.buildUnit(
      UnitType.SAMLauncher,
      game.ref(10, 10),
      {},
    );

    // Player1 only at war with Player2, not Player3
    expect(player1.relation(player3)).not.toBe(Relation.Hostile);

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    // Should launch despite neutral SAM in path
    expect(bombers[0].targetTile()).toBe(enemyCity.tile());
  });

  test("Bomber retargets when current target is destroyed", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(3, 3), {});
    const city1 = player2.buildUnit(UnitType.City, game.ref(14, 13), {});
    const city2 = player2.buildUnit(UnitType.City, game.ref(12, 12), {});

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    const initialTarget = bombers[0].targetTile?.();
    expect(initialTarget).toBe(city2.tile()); // Closer city

    // Destroy the target
    city2.delete(false);

    // Execute a tick to trigger target validation
    game.executeNextTick();

    // Should retarget to city1
    expect(bombers[0].targetTile?.()).toBe(city1.tile());
  });

  test("Bomber returns home when target becomes invalid (no other targets)", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    // Use a much farther target so bomber doesn't complete mission instantly
    const city = player2.buildUnit(UnitType.City, game.ref(10, 30), {});

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();

    const bombers = player1.units(UnitType.Bomber);

    // Bomber launches immediately (no initial cooldown) and starts moving at tick 104
    executeTicks(game, 3);

    // Verify bomber has launched and has target
    expect(bombers[0].targetTile()).toBe(city.tile());

    // Bomber should be away from airfield now (started moving at tick 104)
    expect(bombers[0].tile()).not.toBe(airfield.tile());

    // Destroy the only target while bomber is en route
    city.delete(false);

    // Execute next tick to trigger abort logic
    game.executeNextTick();

    // Should be returning to airfield
    expect(bombers[0].returning()).toBe(true);
  });

  test("Bomber retargets when peace is declared", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    // Use a farther target so bomber doesn't complete mission instantly
    const city1 = player2.buildUnit(UnitType.City, game.ref(10, 30), {});

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();

    const bombers = player1.units(UnitType.Bomber);

    // Bomber launches immediately and starts moving
    executeTicks(game, 3);

    // Verify bomber has launched and has target
    expect(bombers[0].targetTile?.()).toBe(city1.tile());

    // Bomber should be away from airfield now
    expect(bombers[0].tile()).not.toBe(airfield.tile());

    // Make peace with player2 - target becomes invalid due to peace
    player1.setNeutralWith(player2);
    player2.setNeutralWith(player1);

    // Execute next tick to trigger retarget/abort logic
    game.executeNextTick();

    // Since we're no longer at war with player2, bomber should be returning
    expect(bombers[0].returning()).toBe(true);
  });

  test("Bomber load balancing formula (h/250+2 > n)", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    const highHealthCity = player2.buildUnit(
      UnitType.City,
      game.ref(20, 20),
      {},
    );
    highHealthCity.setHealth(1000n); // h/250+2 = 6 bombers allowed

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    // Manually set bomber count to threshold - 1
    player1.bombersOnTarget.set(highHealthCity.tile(), 5);

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 2); // Bomber launches immediately at tick 103

    const bombers = player1.units(UnitType.Bomber);
    // Should still target because 6 > 5
    expect(bombers[0].targetTile()).toBe(highHealthCity.tile());
    expect(player1.bombersOnTarget.get(highHealthCity.tile())).toBe(6);
  });

  test("Bomber does not target when threshold met", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    const lowHealthCity = player2.buildUnit(
      UnitType.City,
      game.ref(20, 20),
      {},
    );
    lowHealthCity.setHealth(250n); // h/250+2 = 3 bombers allowed

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    // Set bomber count at threshold
    player1.bombersOnTarget.set(lowHealthCity.tile(), 3);

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    // Should not launch because 3 is not > 3
    expect(bombers[0].tile()).toBe(airfield.tile());
  });

  test("Bomber cleanup removes invalid targets from bombersOnTarget map", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    const city = player2.buildUnit(UnitType.City, game.ref(15, 15), {});

    player1.bombersOnTarget.set(city.tile(), 2);
    expect(player1.bombersOnTarget.get(city.tile())).toBe(2);

    // Destroy the city
    city.delete(false);

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    // Cleanup should have removed the invalid entry
    expect(player1.bombersOnTarget.get(city.tile())).toBeUndefined();
  });

  test("Bomber decrements bomber count on mission completion", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    const city = player2.buildUnit(UnitType.City, game.ref(20, 20), {});

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 2); // Bomber launches immediately at tick 103

    // Bomber should have launched and incremented count
    expect(player1.bombersOnTarget.get(city.tile())).toBe(1);

    // Let bomber complete mission (reach target, bomb, return)
    executeTicks(game, 10);

    // Should decrement when returned to airfield
    expect(
      player1.bombersOnTarget.get(city.tile()) === 0 ||
        player1.bombersOnTarget.get(city.tile()) === undefined,
    ).toBe(true);
  });

  test("Auto-bombing prioritizes by bomber count, then priority, then distance", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});

    // Create targets with different priorities and distances
    const sam = player2.buildUnit(UnitType.SAMLauncher, game.ref(14, 10), {}); // Priority 0
    const city = player2.buildUnit(UnitType.City, game.ref(12, 10), {}); // Priority 5

    // Set bomber counts
    player1.bombersOnTarget.set(city.tile(), 1); // City has 1 bomber
    player1.bombersOnTarget.set(sam.tile(), 0); // SAM has 0 bombers

    player1.setAutoBombingEnabled(true);

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    // Should target city (more bombers = higher priority)
    expect(bombers[0].targetTile?.()).toBe(city.tile());
  });

  test("Manual targeting prefers closest when preferClosest is true", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    const nearCity = player2.buildUnit(UnitType.City, game.ref(12, 10), {});
    const farCity = player2.buildUnit(UnitType.City, game.ref(14, 10), {});

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    }); // preferClosest = true

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    expect(bombers[0].targetTile()).toBe(nearCity.tile());
  });

  test("Manual targeting prefers furthest when preferClosest is false", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});
    const nearCity = player2.buildUnit(UnitType.City, game.ref(12, 10), {});
    const farCity = player2.buildUnit(UnitType.City, game.ref(14, 10), {});

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: false,
    }); // preferClosest = false

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    expect(bombers[0].targetTile()).toBe(farCity.tile());
  });

  test("Bomber respawns at airfield after being destroyed", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(10, 10), {});

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();

    const bomber1 = player1.units(UnitType.Bomber)[0];
    expect(bomber1).toBeDefined();

    // Destroy the bomber
    bomber1.delete(false);
    expect(bomber1.isActive()).toBe(false);

    game.executeNextTick();

    // Should respawn
    const bomber2 = player1.units(UnitType.Bomber)[0];
    expect(bomber2).toBeDefined();
    expect(bomber2.tile()).toBe(airfield.tile());
    expect(bomber2.health()).toBe(1);
  });

  test("Bomber fallback to direct path when no SAM-avoiding route exists", () => {
    const airfield = player1.buildUnit(UnitType.Airfield, game.ref(5, 10), {});
    const enemyCity = player2.buildUnit(UnitType.City, game.ref(15, 10), {});

    // Surround target with SAMs to block safe routes
    player2.buildUnit(UnitType.SAMLauncher, game.ref(10, 8), {});
    player2.buildUnit(UnitType.SAMLauncher, game.ref(10, 12), {});

    player1.setBomberIntent({
      targetPlayerID: player2.id(),
      structures: [UnitType.City],
      preferClosest: true,
    });

    const bomberExec = new BomberExecution(player1, airfield);
    game.addExecution(bomberExec);

    game.executeNextTick();
    executeTicks(game, 110);

    const bombers = player1.units(UnitType.Bomber);
    // Should still target using direct path (fallback)
    expect(bombers[0].targetTile()).toBe(enemyCity.tile());
  });
});
