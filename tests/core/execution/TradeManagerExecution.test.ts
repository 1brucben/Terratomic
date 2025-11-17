import {
  AssignedTradeRouteExecution,
  TradeManagerExecution,
} from "../../../src/core/execution/TradeManagerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

// We reuse the shoreline used by other naval tests on the half_land_half_ocean map
const coastX = 7;

describe("TradeManagerExecution", () => {
  let game: Game;
  let p1: Player;
  let p2: Player;
  let p1Port: Unit;
  let p2Port: Unit;

  beforeEach(() => {
    // Prevent background setInterval logs from outliving tests
    jest.useFakeTimers();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true, startingGold: 0 },
      [
        new PlayerInfo("us", "P1", PlayerType.Human, null, "p1_id"),
        new PlayerInfo("us", "P2", PlayerType.Human, null, "p2_id"),
      ],
    );

    // Exit spawn phase to start normal ticks
    while (game.inSpawnPhase()) game.executeNextTick();

    p1 = game.player("p1_id");
    p2 = game.player("p2_id");

    // Place two ports on adjacent shoreline tiles; their adjacent ocean tiles are connected
    p1Port = p1.buildUnit(UnitType.Port, game.ref(coastX, 10), {} as any);
    p2Port = p2.buildUnit(UnitType.Port, game.ref(coastX, 11), {} as any);

    // Ensure players are considered alive (TradeManager deletes ships of eliminated players)
    game.conquer(p1, p1Port.tile());
    game.conquer(p2, p2Port.tile());
    // Demand accumulation path is bypassed; no need to mock randomness/GDP/intervals

    // Freeze per-tick income so gold deltas come only from trade
    jest.spyOn(game.config(), "grossGoldAdditionRate").mockReturnValue(0);
    // Keep per-tick net gold isolated to trade; gross rate mocked above is sufficient

    // Make trade income deterministic and small
    jest.spyOn(game.config(), "tradeIncomeFixed").mockReturnValue(1000n);
  });

  test("assigns a route when demand accumulates and a ship is available", () => {
    // Create an idle trade ship docked at p1's port (idle = no targetUnit)
    const ship = p1.buildUnit(UnitType.TradeShip, p1Port.tile(), {} as any);

    // Sanity: ship is on a port tile and idle
    expect(game.unitsAt(p1Port.tile()).some((u) => u.id() === ship.id())).toBe(
      true,
    );
    expect(ship.targetUnit()).toBeUndefined();

    const addExecSpy = jest.spyOn(game, "addExecution");
    const mgr = new TradeManagerExecution();
    game.addExecution(mgr);
    // Directly enqueue a route to avoid relying on gravity demand randomness
    mgr.requeueRoute(p1, p2);

    // Advance several ticks to allow demand -> queue -> assignment
    executeTicks(game, 10);

    // A trade route execution should have been scheduled for the ship
    expect(addExecSpy).toHaveBeenCalledWith(
      expect.any(AssignedTradeRouteExecution),
    );
  });

  test("completes a trade and awards income to both traders and ship owner", () => {
    // Build one idle ship at p1's port
    const ship = p1.buildUnit(UnitType.TradeShip, p1Port.tile(), {} as any);

    const goldBeforeP1 = p1.gold();
    const goldBeforeP2 = p2.gold();

    const mgr = new TradeManagerExecution();
    game.addExecution(mgr);
    // Directly enqueue a route to avoid relying on gravity demand randomness
    mgr.requeueRoute(p1, p2);

    // Run enough ticks for assignment and completion
    executeTicks(game, 200);

    // Income split: total=1000, each trader gets 333, ship owner gets 334 (remainder)
    const p1Delta = p1.gold() - goldBeforeP1;
    const p2Delta = p2.gold() - goldBeforeP2;

    // p1 is both a trader (start owner) and ship owner -> 333 + 334 = 667
    expect(p1Delta).toBe(667n);
    // p2 is the other trader -> 333
    expect(p2Delta).toBe(333n);
  });
});
