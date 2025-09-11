import { PurchaseUpgradeExecution } from "../../../src/core/execution/PurchaseUpgradeExecution";
import {
  Player,
  PlayerType,
  UnitType,
  UpgradeType,
} from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import {
  CargoTrucksUpdate,
  GameUpdateType,
} from "../../../src/core/game/GameUpdates";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { simpleHash } from "../../../src/core/Util";
import { playerInfo, setup } from "../../util/Setup";

describe("CargoManager", () => {
  let game: GameImpl;
  let player: Player;

  // Helper to accumulate cargo updates for convenience
  function collectCargo(updates: any) {
    const cargoEvents = updates[
      GameUpdateType.CargoTrucks
    ] as CargoTrucksUpdate[];
    const added = cargoEvents.flatMap((e) => e.added);
    const removed = cargoEvents.flatMap((e) => e.removed);
    const updated = cargoEvents.flatMap((e) => e.updated);
    return { added, removed, updated };
  }

  beforeEach(async () => {
    game = (await setup("ocean_and_land", { instantBuild: true })) as GameImpl;
    const pInfo = playerInfo("Player A", PlayerType.Human);
    game.addPlayer(pInfo);
    player = game.player(pInfo.id);
    player.addGold(10_000_000n);

    // Build two nearby cities and conquer the path between them
    player.buildUnit(UnitType.City, game.ref(0, 10), {});
    player.buildUnit(UnitType.City, game.ref(0, 12), {});
    for (let y = 10; y <= 12; y++) {
      const tile = game.ref(0, y);
      if (game.owner(tile) !== player) {
        // PlayerImpl has conquer via GameImpl; using PlayerImpl as in other tests
        (player as any).conquer(tile);
      }
    }

    // Buy Roads via execution so RoadManager reconnects nodes immediately
    game.addExecution(new PurchaseUpgradeExecution(player, UpgradeType.Roads));

    // Let roads form
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
    }
    expect(game.roads().length).toBeGreaterThan(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("spawns, moves, and completes domestic cargo trucks once roads exist", () => {
    // Force deterministic spawning and selection
    jest.spyOn(PseudoRandom.prototype, "chance").mockReturnValue(true);
    jest
      .spyOn(PseudoRandom.prototype, "randElement")
      .mockImplementation((arr: any[]) => arr[0]);

    // Align with player's spawn bucket (deterministic based on player id)
    const bucket = simpleHash(player.id()) % 10;
    while (game.ticks() % 10 !== bucket) {
      game.executeNextTick();
    }

    const goldBefore = player.gold();

    // This tick should spawn at least one truck
    let updates = game.executeNextTick();
    const { added } = collectCargo(updates);
    expect(added.length).toBeGreaterThan(0);
    const truckId = added[0].id;

    // Next tick: truck should move (progress increases)
    updates = game.executeNextTick();
    const { updated } = collectCargo(updates);
    const moved = updated.find((u) => u.id === truckId);
    expect(moved).toBeDefined();
    expect(moved!.progress).toBeGreaterThan(0);

    // Keep ticking until the truck arrives and is removed
    let removedSeen = false;
    for (let i = 0; i < 100 && !removedSeen; i++) {
      updates = game.executeNextTick();
      const { removed } = collectCargo(updates);
      removedSeen = removed.includes(truckId);
    }
    expect(removedSeen).toBe(true);

    const goldAfter = player.gold();
    expect(goldAfter > goldBefore).toBe(true);
  });

  it("emits periodic domestic trade summary messages with accumulated gold", () => {
    // Force deterministic spawning and selection
    jest.spyOn(PseudoRandom.prototype, "chance").mockReturnValue(true);
    jest
      .spyOn(PseudoRandom.prototype, "randElement")
      .mockImplementation((arr: any[]) => arr[0]);

    // Run enough ticks to cross a summary interval boundary
    // and ensure some trucks have completed by then.
    let sawSummary = false;
    for (let i = 0; i < 400 && !sawSummary; i++) {
      const updates = game.executeNextTick();
      const messages = updates[GameUpdateType.DisplayEvent] as any[];
      if (
        messages.some(
          (m) =>
            m.message === "messages.domestic_trade_summary" &&
            m.goldAmount > 0n,
        )
      ) {
        sawSummary = true;
      }
    }
    expect(sawSummary).toBe(true);
  });
});
