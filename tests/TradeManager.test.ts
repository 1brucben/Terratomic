import { CapitalRecalculationExecution } from "../src/core/execution/CapitalRecalculationExecution";
import {
  AssignedTradeRouteExecution,
  TradeManagerExecution,
} from "../src/core/execution/TradeManagerExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Cell,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const coastX = 7;

let game: Game;
let a: Player; // trader A
let b: Player; // trader B
let c: Player; // third-party ship owner
let w: Player; // warship owner

function goldOf(p: Player): bigint {
  return p.gold();
}

function buildPort(p: Player, x: number, y: number): Unit {
  const port = p.buildUnit(UnitType.Port, game.ref(x, y), {});
  return port;
}

function findDockedShipAt(tile: number, owner: Player): Unit | undefined {
  return game
    .unitsAt(tile)
    .find((u) => u.type() === UnitType.TradeShip && u.owner() === owner);
}

describe("Trade Manager", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("us", "A", PlayerType.Human, null, "a"),
        new PlayerInfo("us", "B", PlayerType.Human, null, "b"),
        new PlayerInfo("us", "C", PlayerType.Human, null, "c"),
        new PlayerInfo("us", "W", PlayerType.Human, null, "w"),
      ],
    );

    while (game.inSpawnPhase()) game.executeNextTick();

    a = game.player("a");
    b = game.player("b");
    c = game.player("c");
    w = game.player("w");

    // Speed up trade system for tests
    game.config().tradeDemandTickInterval = () => 1;
    game.config().tradeGravityK = () => 1; // strong to enqueue quickly
    game.config().tradeShipPerPortSupply = () => 1;
    game.config().tradeIncomeFixed = () => 10_000n;
    game.config().tradeShipReplacementDelayTicks = () => 1;

    // Background systems necessary for trade manager
    game.addExecution(new CapitalRecalculationExecution());
    game.addExecution(new TradeManagerExecution());
  });

  test("completes trade, pays split, and docks ship available", async () => {
    const portA = buildPort(a, coastX, 10);
    const portB = buildPort(b, coastX + 5, 10);
    // Ensure capitals exist so gravity demand accumulates
    (a as any)._setCapital(new Cell(coastX, 10));
    (b as any)._setCapital(new Cell(coastX + 5, 10));
    (c as any)._setCapital(new Cell(coastX + 2, 10));
    // Provide initial ship supply (dock and available)
    const aShip = a.buildUnit(UnitType.TradeShip, portA.tile(), {
      targetUnit: portA,
    });
    aShip.setTargetUnit(undefined);
    const bShip = b.buildUnit(UnitType.TradeShip, portB.tile(), {
      targetUnit: portB,
    });
    bShip.setTargetUnit(undefined);
    executeTicks(game, 1);

    const goldA0 = goldOf(a);
    const goldB0 = goldOf(b);
    const goldC0 = goldOf(c);

    // Directly assign a route for determinism
    const assigned = aShip ?? bShip;
    expect(assigned).toBeDefined();
    if (!assigned) return;
    game.addExecution(new AssignedTradeRouteExecution(assigned, portA, portB));

    // Use generous ticks to allow move-to-start and then to end
    executeTicks(game, 200);

    const goldA1 = goldOf(a);
    const goldB1 = goldOf(b);
    const goldC1 = goldOf(c);

    const deltaA = Number(goldA1 - goldA0);
    const deltaB = Number(goldB1 - goldB0);
    const deltaC = Number(goldC1 - goldC0);

    const total = deltaA + deltaB + deltaC;
    expect(total).toBe(10_000);
    // Each trader should receive at least one share (3,333) but could receive two if also ship owner
    expect(deltaA).toBeGreaterThanOrEqual(3333);
    expect(deltaB).toBeGreaterThanOrEqual(3333);

    // Verify a ship is docked and available at one of the end ports
    const shipAtA = findDockedShipAt(portA.tile(), a);
    const shipAtB = findDockedShipAt(portB.tile(), b);
    const anyShip = shipAtA ?? shipAtB;
    expect(anyShip).toBeDefined();
    if (anyShip) {
      expect(anyShip.targetUnit()).toBeUndefined();
    }
  });

  test("neutral ship to enemy port is turned around; no payout; returns to last port (origin idling port)", async () => {
    const portA = buildPort(a, coastX, 10);
    const portB = buildPort(b, coastX + 5, 10);
    const portC = buildPort(c, coastX + 2, 10); // neutral ship owner supply
    // Ensure capitals exist so gravity demand accumulates
    (a as any)._setCapital(new Cell(coastX, 10));
    (b as any)._setCapital(new Cell(coastX + 5, 10));
    (c as any)._setCapital(new Cell(coastX + 2, 10));

    // Warship owner at war with B (destination), neutral with C (ship owner)
    w.setWarWith(b);

    // Provide only neutral (C) ship supply and remove A/B ones for determinism
    const cShip = c.buildUnit(UnitType.TradeShip, portC.tile(), {
      targetUnit: portC,
    });
    cShip.setTargetUnit(undefined);
    executeTicks(game, 1);
    game
      .units(UnitType.TradeShip)
      .filter((u) => u.owner() === a || u.owner() === b)
      .forEach((u) => u.delete(false));

    // Warship owner needs a port to engage trade ships per rules
    buildPort(w, coastX + 3, 10);
    // Patrol near middle so warship can intercept
    const patrol = game.ref(coastX + 3, 10);
    const warship = w.buildUnit(UnitType.Warship, patrol, {
      patrolTile: patrol,
    });
    game.addExecution(new WarshipExecution(warship));

    const goldA0 = goldOf(a);
    const goldB0 = goldOf(b);
    const goldC0 = goldOf(c);

    // Directly assign a route from A to B using neutral ship C
    game.addExecution(new AssignedTradeRouteExecution(cShip, portA, portB));

    // Run long enough for interception and return
    executeTicks(game, 250);

    const goldA1 = goldOf(a);
    const goldB1 = goldOf(b);
    const goldC1 = goldOf(c);

    // No payout should have occurred due to turnaround
    expect(goldA1).toBe(goldA0);
    expect(goldB1).toBe(goldB0);
    expect(goldC1).toBe(goldC0);

    // Ship should be docked back at the last port it was at before assignment (C's idling port)
    const dockedAtC = game
      .unitsAt(portC.tile())
      .some(
        (u) =>
          u.type() === UnitType.TradeShip &&
          u.owner() === c &&
          u.targetUnit() === undefined,
      );
    expect(dockedAtC).toBe(true);
  });

  test("neutral ship intercepted after reaching start returns to start port; no payout", async () => {
    const portA = buildPort(a, coastX, 10);
    const portB = buildPort(b, coastX + 5, 10);
    const portC = buildPort(c, coastX + 2, 10);

    // Capitals for demand (not strictly needed since we assign directly)
    (a as any)._setCapital(new Cell(coastX, 10));
    (b as any)._setCapital(new Cell(coastX + 5, 10));
    (c as any)._setCapital(new Cell(coastX + 2, 10));

    // Warship owner at war with B (destination), neutral with C (ship owner)
    w.setWarWith(b);

    // Provide only neutral (C) ship supply and remove A/B ones for determinism
    const cShip = c.buildUnit(UnitType.TradeShip, portC.tile(), {
      targetUnit: portC,
    });
    cShip.setTargetUnit(undefined);
    executeTicks(game, 1);
    game
      .units(UnitType.TradeShip)
      .filter((u) => u.owner() === a || u.owner() === b)
      .forEach((u) => u.delete(false));

    const goldA0 = goldOf(a);
    const goldB0 = goldOf(b);
    const goldC0 = goldOf(c);

    // Assign a route from A to B using neutral ship C
    game.addExecution(new AssignedTradeRouteExecution(cShip, portA, portB));

    // Advance until the ship reaches start port A (transition to heading to B)
    let guard = 0;
    while (cShip.targetUnit() !== portB && guard < 500) {
      executeTicks(game, 1);
      guard++;
    }
    // Sanity: should now be en route to end port
    expect(cShip.targetUnit()).toBe(portB);

    // Now spawn a warship to intercept after start
    buildPort(w, coastX + 3, 10);
    const patrol = game.ref(coastX + 3, 10);
    const warship = w.buildUnit(UnitType.Warship, patrol, {
      patrolTile: patrol,
    });
    game.addExecution(new WarshipExecution(warship));

    // Run long enough for interception and return
    executeTicks(game, 250);

    const goldA1 = goldOf(a);
    const goldB1 = goldOf(b);
    const goldC1 = goldOf(c);

    // No payout should have occurred due to turnaround
    expect(goldA1).toBe(goldA0);
    expect(goldB1).toBe(goldB0);
    expect(goldC1).toBe(goldC0);

    // Ship should be docked back at start port A (last visited port)
    const dockedAtA = game
      .unitsAt(portA.tile())
      .some(
        (u) =>
          u.type() === UnitType.TradeShip &&
          u.owner() === c &&
          u.targetUnit() === undefined,
      );
    expect(dockedAtA).toBe(true);
  });
});
