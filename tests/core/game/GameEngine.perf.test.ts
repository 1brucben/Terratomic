/**
 * Game Engine Internals – Performance Micro-Benchmarks
 * =====================================================
 * Isolates the dominant costs inside `GameImpl` that bottleneck deep-push
 * PvP attacks (where AttackExecution V2 optimizations showed ~0% gain):
 *
 *   1. **conquer() throughput** — per-tile cost of ownership transfer
 *      (setOwnerID, Set.add/delete, productivity recalc, addUpdate ×2)
 *   2. **endBorderBatch() scaling** — border recalculation overhead as
 *      the number of dirty tiles grows (100 → 1k → 5k → 10k)
 *   3. **attackLogic() per-tile cost** — terrain lookup + defense post
 *      spatial query cost (with and without nearby defense posts)
 *   4. **addUpdate() overhead** — GameUpdate object creation rate
 *   5. **Batched vs unbatched conquer** — demonstrates why batching matters
 *
 * Reuses the same world-map infrastructure from AttackExecution.perf.test
 * (2000×1000, 651k land tiles) for realistic data.
 *
 * Compare CSV output across branches / PRs to detect regressions.
 */

import fsSync from "fs";
import path from "path";
import { DefaultConfig } from "../../../src/core/configuration/DefaultConfig";
import { AttackExecution } from "../../../src/core/execution/AttackExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Difficulty,
  Game,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  Tick,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import { TileRef } from "../../../src/core/game/GameMap";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { genTerrainFromBin } from "../../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig, PeaceTimerDuration } from "../../../src/core/Schemas";
import { TestServerConfig } from "../../util/TestServerConfig";

// ── Config ───────────────────────────────────────────────────────────────

class PerfTestConfig extends DefaultConfig {
  disableNavMesh(): boolean {
    return true;
  }
  spawnImmunityDuration(): Tick {
    return 0;
  }
}

// ── Map loader (shared with AttackExecution.perf.test) ───────────────────

function prependDimensionHeader(
  raw: Uint8Array,
  w: number,
  h: number,
): Uint8Array {
  const hdr = new Uint8Array(4);
  hdr[0] = w & 0xff;
  hdr[1] = (w >> 8) & 0xff;
  hdr[2] = h & 0xff;
  hdr[3] = (h >> 8) & 0xff;
  const out = new Uint8Array(4 + raw.length);
  out.set(hdr);
  out.set(raw, 4);
  return out;
}

function uint8ToBinStr(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
    );
  }
  return s;
}

async function setupPerf(
  mapName: string,
  overrides: Partial<GameConfig> = {},
): Promise<Game> {
  console.debug = () => {};
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[tick")) return;
    origLog(...args);
  };

  const dir = path.join(__dirname, "..", "..", "testdata", "maps", mapName);
  const manifest = JSON.parse(
    fsSync.readFileSync(path.join(dir, "manifest.json"), "utf-8"),
  );

  const mapBin = prependDimensionHeader(
    new Uint8Array(fsSync.readFileSync(path.join(dir, "map.bin"))),
    manifest.map.width,
    manifest.map.height,
  );
  const miniBin = prependDimensionHeader(
    new Uint8Array(fsSync.readFileSync(path.join(dir, "map4x.bin"))),
    manifest.map4x.width,
    manifest.map4x.height,
  );

  const gameMap = await genTerrainFromBin(uint8ToBinStr(mapBin));
  const miniMap = await genTerrainFromBin(uint8ToBinStr(miniBin));

  const cfg: GameConfig = {
    gameMap: GameMapType.Asia,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    disableNPCs: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    peaceTimerDurationMinutes: PeaceTimerDuration.None,
    startingGold: 0,
    goldMultiplier: 1,
    chatEnabled: false,
    ...overrides,
  };

  return createGame(
    [],
    [],
    gameMap,
    miniMap,
    new PerfTestConfig(new TestServerConfig(), cfg, new UserSettings(), false),
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface MicroResult {
  label: string;
  ops: number;
  totalMs: number;
  opsPerSec: number;
  usPerOp: number;
}

function microBench(label: string, ops: number, fn: () => void): MicroResult {
  // Warm up JIT
  for (let i = 0; i < Math.min(ops, 100); i++) fn();

  const t0 = performance.now();
  for (let i = 0; i < ops; i++) fn();
  const elapsed = performance.now() - t0;

  return {
    label,
    ops,
    totalMs: elapsed,
    opsPerSec: (ops / elapsed) * 1000,
    usPerOp: (elapsed / ops) * 1000,
  };
}

function fmtMicro(r: MicroResult): string {
  return [
    `  [${r.label}]`,
    `    ops:       ${r.ops.toLocaleString()}`,
    `    total:     ${r.totalMs.toFixed(1)} ms`,
    `    per-op:    ${r.usPerOp.toFixed(3)} µs`,
    `    throughput: ${(r.opsPerSec / 1000).toFixed(1)} k ops/sec`,
  ].join("\n");
}

/**
 * BFS to collect unowned land tiles reachable from a player's border.
 * Returns up to `count` tiles ordered by BFS distance.
 */
function collectUnownedLandBFS(
  game: Game,
  player: Player,
  count: number,
): TileRef[] {
  const map = game.map();
  const result: TileRef[] = [];
  const visited = new Set<TileRef>();
  const queue: TileRef[] = [];

  for (const bt of player.borderTiles()) {
    game.forEachNeighbor(bt, (n: TileRef) => {
      if (map.isLand(n) && !game.owner(n).isPlayer() && !visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    });
  }

  let head = 0;
  while (head < queue.length && result.length < count) {
    const tile = queue[head++];
    if (game.owner(tile).isPlayer()) continue;
    result.push(tile);
    game.forEachNeighbor(tile, (n: TileRef) => {
      if (map.isLand(n) && !visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    });
  }
  return result;
}

/**
 * BFS from attacker's border into defender territory.
 * Returns up to `count` defender tiles ordered by distance from shared border.
 */
function collectDefenderTilesBFS(
  game: Game,
  attacker: Player,
  defender: Player,
  count: number,
): TileRef[] {
  const result: TileRef[] = [];
  const visited = new Set<TileRef>();
  const queue: TileRef[] = [];

  for (const bt of attacker.borderTiles()) {
    game.forEachNeighbor(bt, (n: TileRef) => {
      if (game.owner(n) === defender && !visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    });
  }

  let head = 0;
  while (head < queue.length && result.length < count) {
    const t = queue[head++];
    result.push(t);
    game.forEachNeighbor(t, (n: TileRef) => {
      if (game.owner(n) === defender && !visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    });
  }
  return result;
}

/**
 * Deterministic BFS territory assignment (same as AttackExecution perf test).
 */
function assignTerritory(
  game: Game,
  players: Player[],
  tilesEach: number,
): void {
  const map = game.map();
  const queues: number[][] = players.map(() => []);
  const heads: number[] = players.map(() => 0);
  const visited = new Set<number>();

  for (let i = 0; i < players.length; i++) {
    for (const bt of players[i].borderTiles()) {
      game.forEachNeighbor(bt, (n: number) => {
        if (map.isLand(n) && !game.owner(n).isPlayer() && !visited.has(n)) {
          visited.add(n);
          queues[i].push(n);
        }
      });
    }
  }

  game.beginBorderBatch();
  const counts = players.map(() => 0);
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < players.length; i++) {
      if (counts[i] >= tilesEach) continue;
      while (heads[i] < queues[i].length) {
        const tile = queues[i][heads[i]++];
        if (game.owner(tile).isPlayer()) continue;
        game.conquer(players[i], tile);
        counts[i]++;
        progress = true;
        game.forEachNeighbor(tile, (n: number) => {
          if (map.isLand(n) && !visited.has(n)) {
            visited.add(n);
            queues[i].push(n);
          }
        });
        break;
      }
    }
  }
  game.endBorderBatch();
}

function growPlayer(
  game: Game,
  player: Player,
  targetTiles: number,
  maxTicks = 100_000,
): void {
  let t = 0;
  while (player.numTilesOwned() < targetTiles && t < maxTicks) {
    player.setTroops(10_000_000);
    if (player.outgoingAttacks().length === 0) {
      game.addExecution(
        new AttackExecution(
          5_000_000,
          player,
          game.terraNullius().id(),
          null,
          false,
        ),
      );
    }
    game.executeNextTick();
    t++;
  }
}

async function createWorldGame(
  spawns: [number, number][],
  tilesEach: number,
): Promise<{ game: Game; players: Player[] }> {
  const game = await setupPerf("world", {
    infiniteGold: true,
    infiniteTroops: true,
  });

  const codes = ["au", "nz", "pg", "fj"];
  const infos = spawns.map(
    (_, i) =>
      new PlayerInfo(codes[i], `P${i}`, PlayerType.Human, null, `pid_${i}`),
  );
  for (const info of infos) game.addPlayer(info);

  game.addExecution(
    ...infos.map(
      (info, i) =>
        new SpawnExecution(info, game.ref(spawns[i][0], spawns[i][1])),
    ),
  );
  while (game.inSpawnPhase()) game.executeNextTick();

  const players = infos.map((info) => game.player(info.id));
  assignTerritory(game, players, tilesEach);

  return { game, players };
}

// ── Tests ────────────────────────────────────────────────────────────────

jest.setTimeout(600_000);

describe("Game Engine Internals Performance", () => {
  const allResults: MicroResult[] = [];

  afterAll(() => {
    console.log(
      "\n╔══════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║          GAME ENGINE INTERNALS PERFORMANCE SUMMARY           ║",
    );
    console.log(
      "╚══════════════════════════════════════════════════════════════╝\n",
    );
    for (const r of allResults) console.log(fmtMicro(r) + "\n");
    console.log("--- CSV ---");
    console.log("label,ops,total_ms,us_per_op,k_ops_sec");
    for (const r of allResults) {
      console.log(
        [
          r.label,
          r.ops,
          r.totalMs.toFixed(3),
          r.usPerOp.toFixed(3),
          (r.opsPerSec / 1000).toFixed(1),
        ].join(","),
      );
    }
  });

  // ── 1. conquer() throughput ────────────────────────────────────────────

  describe("conquer() throughput", () => {
    test("batched conquer — 5000 TN tiles", async () => {
      const game = await setupPerf("world", {
        infiniteGold: true,
        infiniteTroops: true,
      });
      const info = new PlayerInfo(
        "us",
        "Conqueror",
        PlayerType.Human,
        null,
        "conq_id",
      );
      game.addPlayer(info);
      game.addExecution(new SpawnExecution(info, game.ref(375, 272)));
      while (game.inSpawnPhase()) game.executeNextTick();
      const player = game.player(info.id);
      growPlayer(game, player, 5_000);

      const tiles = collectUnownedLandBFS(game, player, 5_000);
      const n = tiles.length;
      expect(n).toBeGreaterThanOrEqual(1_000);

      console.log(
        `[Setup] conquer: ${player.numTilesOwned()} tiles, border ${player.borderTiles().size}`,
      );

      game.beginBorderBatch();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) game.conquer(player, tiles[i]);
      const conquerMs = performance.now() - t0;
      const t1 = performance.now();
      game.endBorderBatch();
      const borderMs = performance.now() - t1;

      const total = conquerMs + borderMs;
      const r: MicroResult = {
        label: `conquer() batched × ${n}`,
        ops: n,
        totalMs: total,
        opsPerSec: (n / total) * 1000,
        usPerOp: (total / n) * 1000,
      };
      allResults.push(r);
      console.log(fmtMicro(r));
      console.log(
        `  conquer: ${conquerMs.toFixed(1)} ms  border: ${borderMs.toFixed(1)} ms`,
      );
    });

    test("unbatched conquer — 1000 tiles", async () => {
      const game = await setupPerf("world", {
        infiniteGold: true,
        infiniteTroops: true,
      });
      const info = new PlayerInfo(
        "us",
        "Conqueror",
        PlayerType.Human,
        null,
        "unbatch_id",
      );
      game.addPlayer(info);
      game.addExecution(new SpawnExecution(info, game.ref(375, 272)));
      while (game.inSpawnPhase()) game.executeNextTick();
      const player = game.player(info.id);
      growPlayer(game, player, 5_000);

      const tiles = collectUnownedLandBFS(game, player, 1_000);
      const n = tiles.length;
      expect(n).toBeGreaterThanOrEqual(500);

      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        game.conquer(player, tiles[i]);
      }
      const elapsed = performance.now() - t0;

      const r: MicroResult = {
        label: `conquer() unbatched × ${n}`,
        ops: n,
        totalMs: elapsed,
        opsPerSec: (n / elapsed) * 1000,
        usPerOp: (elapsed / n) * 1000,
      };
      allResults.push(r);
      console.log(fmtMicro(r));
    });
  });

  // ── 2. endBorderBatch() scaling ────────────────────────────────────────

  describe("endBorderBatch() scaling", () => {
    const batchSizes = [100, 500, 1_000, 2_000, 5_000, 10_000];

    for (const size of batchSizes) {
      test(`endBorderBatch after ${size} conquests`, async () => {
        // Fresh game for each batch-size measurement
        const game = await setupPerf("world", {
          infiniteGold: true,
          infiniteTroops: true,
        });
        const info = new PlayerInfo(
          "us",
          "Scaler",
          PlayerType.Human,
          null,
          `scale_${size}`,
        );
        game.addPlayer(info);
        game.addExecution(new SpawnExecution(info, game.ref(375, 272)));
        while (game.inSpawnPhase()) game.executeNextTick();
        const player = game.player(info.id);
        growPlayer(game, player, 3_000);

        const tiles = collectUnownedLandBFS(game, player, size);
        const n = tiles.length;
        if (n < size * 0.5) {
          console.warn(
            `[WARN] Only found ${n}/${size} tiles — result may be under-representative`,
          );
        }

        // Conquer inside batch (don't measure this part)
        game.beginBorderBatch();
        for (let i = 0; i < n; i++) {
          game.conquer(player, tiles[i]);
        }

        // Measure only endBorderBatch
        const t0 = performance.now();
        game.endBorderBatch();
        const elapsed = performance.now() - t0;

        const r: MicroResult = {
          label: `endBorderBatch() @ ${n} dirty`,
          ops: n,
          totalMs: elapsed,
          opsPerSec: (n / elapsed) * 1000,
          usPerOp: (elapsed / n) * 1000,
        };
        allResults.push(r);
        console.log(fmtMicro(r));
        console.log(`  → ${elapsed.toFixed(3)} ms total for ${n} dirty tiles`);
      });
    }
  });

  // ── 3. attackLogic() per-tile cost ─────────────────────────────────────

  describe("attackLogic() per-tile cost", () => {
    test("TN attack logic — no defense posts (pure math)", async () => {
      const game = await setupPerf("world", {
        infiniteGold: true,
        infiniteTroops: true,
      });
      const info = new PlayerInfo(
        "us",
        "Attacker",
        PlayerType.Human,
        null,
        "atklogic_tn",
      );
      game.addPlayer(info);
      game.addExecution(new SpawnExecution(info, game.ref(375, 272)));
      while (game.inSpawnPhase()) game.executeNextTick();
      const player = game.player(info.id);
      growPlayer(game, player, 5_000);

      // Collect border tiles to call attackLogic on realistic tiles
      const borderArr = [...player.borderTiles()];
      const config = game.config();
      const tn = game.terraNullius();
      const count = Math.min(borderArr.length, 5_000);
      expect(count).toBeGreaterThan(100);

      const r = microBench(`attackLogic() vs TN × ${count}`, count, () => {
        for (let i = 0; i < count; i++) {
          config.attackLogic(
            game,
            1_000_000,
            player,
            tn,
            borderArr[i % borderArr.length],
          );
        }
      });
      // Each call of the outer fn does `count` attackLogic calls
      const adjusted: MicroResult = {
        label: r.label,
        ops: r.ops * count,
        totalMs: r.totalMs,
        opsPerSec: ((r.ops * count) / r.totalMs) * 1000,
        usPerOp: (r.totalMs / (r.ops * count)) * 1000,
      };
      allResults.push(adjusted);
      console.log(fmtMicro(adjusted));
    });

    test("PvP attack logic — with defense post scanning", async () => {
      const ctx = await createWorldGame(
        [
          [1620, 660],
          [1780, 660],
        ],
        15_000,
      );
      const { game, players } = ctx;
      const [attacker, defender] = players;

      attacker.setTroops(10_000_000);
      defender.setTroops(5_000_000);

      // Get tiles on the shared border for realistic samples
      const borderArr = [...attacker.borderTiles()];
      const config = game.config();
      const count = Math.min(borderArr.length, 5_000);
      expect(count).toBeGreaterThan(50);

      const r = microBench(
        `attackLogic() PvP (no defPosts) × ${count}`,
        count,
        () => {
          for (let i = 0; i < count; i++) {
            config.attackLogic(
              game,
              1_000_000,
              attacker,
              defender,
              borderArr[i % borderArr.length],
            );
          }
        },
      );
      const adjusted: MicroResult = {
        label: r.label,
        ops: r.ops * count,
        totalMs: r.totalMs,
        opsPerSec: ((r.ops * count) / r.totalMs) * 1000,
        usPerOp: (r.totalMs / (r.ops * count)) * 1000,
      };
      allResults.push(adjusted);
      console.log(fmtMicro(adjusted));
    });
  });

  // ── 4. addUpdate() overhead ────────────────────────────────────────────

  describe("addUpdate() overhead", () => {
    test("addUpdate() throughput — simulated conquer updates", async () => {
      const game = await setupPerf("world", {
        infiniteGold: true,
        infiniteTroops: true,
      });
      const info = new PlayerInfo(
        "us",
        "Updater",
        PlayerType.Human,
        null,
        "update_id",
      );
      game.addPlayer(info);
      game.addExecution(new SpawnExecution(info, game.ref(375, 272)));
      while (game.inSpawnPhase()) game.executeNextTick();
      const player = game.player(info.id);

      const OPS = 50_000;
      const playerId = player.id();

      // Measure raw addUpdate throughput
      const t0 = performance.now();
      for (let i = 0; i < OPS; i++) {
        game.addUpdate({
          type: GameUpdateType.TileOwnerChanged,
          tile: i as TileRef,
          newOwnerID: playerId,
        });
        game.addUpdate({
          type: GameUpdateType.Tile,
          update: BigInt(i),
        });
      }
      const elapsed = performance.now() - t0;

      const totalUpdates = OPS * 2;
      const r: MicroResult = {
        label: `addUpdate() × ${totalUpdates} (2 per faux-conquer)`,
        ops: totalUpdates,
        totalMs: elapsed,
        opsPerSec: (totalUpdates / elapsed) * 1000,
        usPerOp: (elapsed / totalUpdates) * 1000,
      };
      allResults.push(r);
      console.log(fmtMicro(r));
    });
  });

  // ── 5. Full conquer pipeline breakdown ─────────────────────────────────

  describe("full conquer pipeline breakdown (PvP)", () => {
    test("conquer pipeline — PvP 10k tiles", async () => {
      const ctx = await createWorldGame(
        [
          [1620, 660],
          [1780, 660],
        ],
        15_000,
      );
      const game = ctx.game;
      const [attacker, defender] = ctx.players;
      attacker.setTroops(10_000_000);
      defender.setTroops(500_000);

      const defTiles = collectDefenderTilesBFS(
        game,
        attacker,
        defender,
        10_000,
      );
      const n = defTiles.length;
      expect(n).toBeGreaterThanOrEqual(5_000);

      game.beginBorderBatch();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) game.conquer(attacker, defTiles[i]);
      const cqMs = performance.now() - t0;
      const t1 = performance.now();
      game.endBorderBatch();
      const brMs = performance.now() - t1;

      const total = cqMs + brMs;
      const r: MicroResult = {
        label: `PvP conquer() × ${n}`,
        ops: n,
        totalMs: total,
        opsPerSec: (n / total) * 1000,
        usPerOp: (total / n) * 1000,
      };
      allResults.push(r);
      console.log(fmtMicro(r));
      console.log(
        `  conquer: ${cqMs.toFixed(1)} ms  border: ${brMs.toFixed(1)} ms`,
      );
    });
  });

  // ── 6. Set operations profiling ────────────────────────────────────────

  describe("Set operations profiling (synthetic)", () => {
    test("Set.add / Set.delete / Set.has throughput at scale", () => {
      const sizes = [1_000, 10_000, 50_000, 100_000];

      for (const size of sizes) {
        const set = new Set<number>();
        // Pre-fill
        for (let i = 0; i < size; i++) set.add(i);

        const OPS = 100_000;

        // has()
        const t0 = performance.now();
        for (let i = 0; i < OPS; i++) set.has(i % size);
        const hasMs = performance.now() - t0;

        // add() existing
        const t1 = performance.now();
        for (let i = 0; i < OPS; i++) set.add(i % size);
        const addExistMs = performance.now() - t1;

        // delete() + add() (churn)
        const t2 = performance.now();
        for (let i = 0; i < OPS; i++) {
          set.delete(i % size);
          set.add(i % size);
        }
        const churnMs = performance.now() - t2;

        const rHas: MicroResult = {
          label: `Set.has() @ ${size.toLocaleString()} elems`,
          ops: OPS,
          totalMs: hasMs,
          opsPerSec: (OPS / hasMs) * 1000,
          usPerOp: (hasMs / OPS) * 1000,
        };
        const rAdd: MicroResult = {
          label: `Set.add(existing) @ ${size.toLocaleString()} elems`,
          ops: OPS,
          totalMs: addExistMs,
          opsPerSec: (OPS / addExistMs) * 1000,
          usPerOp: (addExistMs / OPS) * 1000,
        };
        const rChurn: MicroResult = {
          label: `Set.delete+add (churn) @ ${size.toLocaleString()} elems`,
          ops: OPS,
          totalMs: churnMs,
          opsPerSec: (OPS / churnMs) * 1000,
          usPerOp: (churnMs / OPS) * 1000,
        };
        allResults.push(rHas, rAdd, rChurn);
        console.log(fmtMicro(rHas));
        console.log(fmtMicro(rAdd));
        console.log(fmtMicro(rChurn));
      }
    });
  });
});
