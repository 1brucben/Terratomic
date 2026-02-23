/**
 * AttackExecution Performance Benchmark
 * ======================================
 * Systematic benchmarks for AttackExecution covering the hot-path:
 *   init → tick loop (dequeue from heap, neighbor checks, conquer, border batch)
 *
 * Uses DefaultConfig's real attackLogic / attackTilesPerTick so the
 * benchmark reflects production hot-paths (thousands of tiles per tick),
 * not the simplified TestConfig stubs (1 tile/tick).
 *
 * Two measurement approaches:
 *   1. **Full-attack**: launch an attack, measure every tick until it
 *      finishes. Reports per-tick stats over the attack's actual lifespan.
 *   2. **Sustained-expansion**: measure ongoing TN expansion where the
 *      attack runs indefinitely. Reports steady-state tick cost.
 *
 * Scenarios:
 *   1. Large TN expansion (sustained) — single player expanding on Eurasia
 *   2a. PvP 500k troops — moderate attack on Australia (full lifecycle)
 *   2b. PvP 5M deep push — heavy attack consuming all enemy tiles
 *   2c. Parallel TN expansions — 3 concurrent TN attacks (multi-execution overhead)
 *   3. Paired PvP — 2 independent A→B + C→D attacks simultaneously
 *   4. Baseline: small map (isolated overhead)
 *
 * Territory setup uses deterministic BFS via game.conquer() — no
 * attack-based growth — ensuring reliable, reproducible tile counts.
 *
 * The "world" map (2000×1000, 651k land tiles) produces realistic
 * territory sizes and 1000+ tile borders. PvP tests use Australia
 * (isolated landmass) for predictable territory partitioning.
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
import { genTerrainFromBin } from "../../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig, PeaceTimerDuration } from "../../../src/core/Schemas";
import { TestServerConfig } from "../../util/TestServerConfig";

// ── Perf config (production attack math, test-safe elsewhere) ────────────

class PerfTestConfig extends DefaultConfig {
  disableNavMesh(): boolean {
    return true;
  }
  spawnImmunityDuration(): Tick {
    return 0;
  }
}

// ── Map loader (mirrors tests/util/Setup.ts) ────────────────────────────

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
  // Suppress noisy engine log output during test setup
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

// ── Benchmark types and helpers ──────────────────────────────────────────

interface BenchResult {
  label: string;
  /** ms for each tick measured */
  samples: number[];
  meanMs: number;
  stddevMs: number;
  medianMs: number;
  p95Ms: number;
  totalMs: number;
  tilesConquered: number;
  /** Border size of the primary attacker at the end */
  borderSize: number;
  /** How many ticks it took (may differ from samples.length if warmup used) */
  ticksMeasured: number;
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const variance =
    samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
  return {
    meanMs: mean,
    stddevMs: Math.sqrt(variance),
    medianMs: pct(sorted, 50),
    p95Ms: pct(sorted, 95),
    totalMs: samples.reduce((s, v) => s + v, 0),
  };
}

/**
 * Measure ticks of an ongoing attack until **all** of `attacker`'s
 * outgoing attacks complete (or `maxTicks` reached).
 *
 * Great for PvP attacks that finish in a bounded number of ticks.
 */
function benchFullAttack(
  label: string,
  game: Game,
  attacker: Player,
  maxTicks = 200,
): BenchResult {
  const tilesBefore = attacker.numTilesOwned();

  // Run one init tick (the execution init runs on the first executeNextTick
  // after addExecution; we don't count this toward samples because it also
  // includes the init cost for other executions)
  game.executeNextTick();

  const samples: number[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const t0 = performance.now();
    game.executeNextTick();
    samples.push(performance.now() - t0);

    if (attacker.outgoingAttacks().length === 0) break;
  }

  const st = stats(samples);
  return {
    label,
    samples,
    ...st,
    tilesConquered: attacker.numTilesOwned() - tilesBefore,
    borderSize: attacker.borderTiles().size,
    ticksMeasured: samples.length,
  };
}

/**
 * Measure `sampleTicks` ticks of an ongoing attack that is expected to
 * persist across all measured ticks (e.g. TN expansion with huge troops).
 * `warmupTicks` are executed first but not measured.
 */
function benchSustained(
  label: string,
  game: Game,
  attacker: Player,
  warmupTicks = 3,
  sampleTicks = 30,
): BenchResult {
  const tilesBefore = attacker.numTilesOwned();

  for (let i = 0; i < warmupTicks; i++) game.executeNextTick();

  const samples: number[] = [];
  for (let i = 0; i < sampleTicks; i++) {
    const t0 = performance.now();
    game.executeNextTick();
    samples.push(performance.now() - t0);
  }

  const st = stats(samples);
  return {
    label,
    samples,
    ...st,
    tilesConquered: attacker.numTilesOwned() - tilesBefore,
    borderSize: attacker.borderTiles().size,
    ticksMeasured: samples.length,
  };
}

function fmt(r: BenchResult): string {
  return [
    `  [${r.label}]`,
    `    ticks:  ${r.ticksMeasured}`,
    `    mean:   ${r.meanMs.toFixed(3)} ms/tick  ± ${r.stddevMs.toFixed(3)}`,
    `    median: ${r.medianMs.toFixed(3)} ms/tick`,
    `    p95:    ${r.p95Ms.toFixed(3)} ms/tick`,
    `    total:  ${r.totalMs.toFixed(1)} ms`,
    `    tiles conquered: ${r.tilesConquered}`,
    `    border size:     ${r.borderSize}`,
  ].join("\n");
}

// ── Territory growth ─────────────────────────────────────────────────────

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

/**
 * Deterministic BFS territory builder.
 *
 * Does a round-robin BFS from each player's current border, assigning
 * unowned land tiles directly via `game.conquer()`. This guarantees every
 * player gets exactly `tilesEach` new tiles (or whatever the island can
 * supply) and that adjacent players **share a border**.
 *
 * Much more reliable than attack-based growth for test setup because
 * there's no race condition — no player can "run away" with all the land.
 */
function assignTerritory(
  game: Game,
  players: Player[],
  tilesEach: number,
): void {
  const map = game.map();

  // BFS queues (array + head pointer to avoid shift() cost)
  const queues: number[][] = players.map(() => []);
  const heads: number[] = players.map(() => 0);
  const visited = new Set<number>();

  // Seed queues from each player's existing border tiles' unowned neighbours
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

  // Round-robin: give each player one tile per cycle
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < players.length; i++) {
      if (counts[i] >= tilesEach) continue;

      while (heads[i] < queues[i].length) {
        const tile = queues[i][heads[i]++];
        if (game.owner(tile).isPlayer()) continue; // already claimed

        game.conquer(players[i], tile);
        counts[i]++;
        progress = true;

        // enqueue unvisited land neighbours
        game.forEachNeighbor(tile, (n: number) => {
          if (map.isLand(n) && !visited.has(n)) {
            visited.add(n);
            queues[i].push(n);
          }
        });
        break; // one tile per player per cycle
      }
    }
  }

  game.endBorderBatch();
}

// ── Tests ────────────────────────────────────────────────────────────────

jest.setTimeout(600_000);

/**
 * Helper: create a world game, spawn N players on Australia, and
 * deterministically assign territory via BFS.
 */
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

describe("AttackExecution Performance", () => {
  const results: BenchResult[] = [];

  afterAll(() => {
    console.log(
      "\n╔══════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║           ATTACK EXECUTION PERFORMANCE SUMMARY              ║",
    );
    console.log(
      "╚══════════════════════════════════════════════════════════════╝\n",
    );
    for (const r of results) console.log(fmt(r) + "\n");
    console.log("--- CSV ---");
    console.log(
      "label,ticks,mean_ms,stddev_ms,median_ms,p95_ms,total_ms,tiles_conquered,border_size",
    );
    for (const r of results) {
      console.log(
        [
          r.label,
          r.ticksMeasured,
          r.meanMs.toFixed(3),
          r.stddevMs.toFixed(3),
          r.medianMs.toFixed(3),
          r.p95Ms.toFixed(3),
          r.totalMs.toFixed(1),
          r.tilesConquered,
          r.borderSize,
        ].join(","),
      );
    }
  });

  // ── Scenario 1: Sustained TN expansion ─────────────────────────────────

  describe("vs TerraNullius (sustained expansion)", () => {
    let game: Game;
    let attacker: Player;

    beforeAll(async () => {
      game = await setupPerf("world", {
        infiniteGold: true,
        infiniteTroops: true,
      });

      const info = new PlayerInfo(
        "us",
        "Attacker",
        PlayerType.Human,
        null,
        "attacker_id",
      );
      game.addPlayer(info);
      game.addExecution(new SpawnExecution(info, game.ref(375, 272)));
      while (game.inSpawnPhase()) game.executeNextTick();

      attacker = game.player(info.id);
      growPlayer(game, attacker, 10_000);

      console.log(
        `[Setup] TN: ${attacker.numTilesOwned()} tiles, border: ${attacker.borderTiles().size}`,
      );
    });

    test("sustained TN expansion (10k+ tiles, real config)", () => {
      attacker.setTroops(10_000_000);
      game.addExecution(
        new AttackExecution(
          100_000_000,
          attacker,
          game.terraNullius().id(),
          null,
          false,
        ),
      );

      const r = benchSustained(
        "Sustained TN expansion (10k+ tiles)",
        game,
        attacker,
        5,
        30,
      );
      results.push(r);
      console.log(fmt(r));
      expect(r.tilesConquered).toBeGreaterThan(0);
    });
  });

  // ── Scenario 2a: PvP attack — 500k troops ─────────────────────────────

  describe("PvP attack — 500k troops", () => {
    let game: Game;
    let playerA: Player;
    let playerB: Player;

    beforeAll(async () => {
      const ctx = await createWorldGame(
        [
          [1620, 660],
          [1780, 660],
        ],
        15_000,
      );
      game = ctx.game;
      [playerA, playerB] = ctx.players;

      console.log(
        `[Setup] PvP-500k: A=${playerA.numTilesOwned()} (border ${playerA.borderTiles().size}), ` +
          `B=${playerB.numTilesOwned()} (border ${playerB.borderTiles().size}), ` +
          `shared=${playerA.sharedBorderLength(playerB)}`,
      );
    });

    test("full PvP attack — A conquers B (500k troops)", () => {
      playerA.setTroops(10_000_000);
      playerB.setTroops(500_000);

      game.addExecution(
        new AttackExecution(500_000, playerA, playerB.id(), null, false),
      );

      const r = benchFullAttack(
        "PvP attack: 500k troops, 15k tiles each",
        game,
        playerA,
      );
      results.push(r);
      console.log(fmt(r));
      expect(r.tilesConquered).toBeGreaterThan(0);
      expect(r.ticksMeasured).toBeGreaterThan(0);
    });
  });

  // ── Scenario 2b: PvP attack — 5M troops (deep push) ───────────────────

  describe("PvP attack — 5M troops (deep push)", () => {
    let game: Game;
    let playerA: Player;
    let playerB: Player;

    beforeAll(async () => {
      const ctx = await createWorldGame(
        [
          [1620, 660],
          [1780, 660],
        ],
        15_000,
      );
      game = ctx.game;
      [playerA, playerB] = ctx.players;

      console.log(
        `[Setup] PvP-5M: A=${playerA.numTilesOwned()}, B=${playerB.numTilesOwned()}, ` +
          `shared=${playerA.sharedBorderLength(playerB)}`,
      );
    });

    test("full PvP attack — A conquers B (5M troops, deep push)", () => {
      playerA.setTroops(10_000_000);
      playerB.setTroops(500_000);

      game.addExecution(
        new AttackExecution(5_000_000, playerA, playerB.id(), null, false),
      );

      const r = benchFullAttack(
        "PvP attack: 5M troops (deep push)",
        game,
        playerA,
        500,
      );
      results.push(r);
      console.log(fmt(r));
      expect(r.tilesConquered).toBeGreaterThan(0);
    });
  });

  // ── Scenario 2c: Parallel TN expansions (multi-attack overhead) ─────────

  describe("Parallel TN expansions (3 players)", () => {
    let game: Game;
    let players: Player[];

    beforeAll(async () => {
      const ctx = await createWorldGame(
        [
          [1630, 660],
          [1760, 660],
          [1700, 700],
        ],
        5_000,
      );
      game = ctx.game;
      players = ctx.players;

      console.log(
        `[Setup] ParallelTN: ${players.map((p, i) => `P${i}=${p.numTilesOwned()}`).join(", ")}`,
      );
    });

    test("3 concurrent TN expansions — multi-attack overhead", () => {
      for (const p of players) {
        p.setTroops(10_000_000);
        game.addExecution(
          new AttackExecution(
            50_000_000,
            p,
            game.terraNullius().id(),
            null,
            false,
          ),
        );
      }

      const r = benchSustained(
        "3× parallel TN expansion (5k tiles each)",
        game,
        players[0],
        3,
        30,
      );
      results.push(r);
      console.log(fmt(r));
      expect(r.tilesConquered).toBeGreaterThan(0);
    });
  });

  // ── Scenario 3: Paired PvP (2 independent attacks simultaneously) ─────

  describe("Paired PvP (A→B + C→D)", () => {
    let game: Game;
    let pA: Player;
    let pB: Player;
    let pC: Player;
    let pD: Player;

    beforeAll(async () => {
      const ctx = await createWorldGame(
        [
          [1620, 650],
          [1690, 650],
          [1730, 680],
          [1790, 680],
        ],
        5_000,
      );
      game = ctx.game;
      [pA, pB, pC, pD] = ctx.players;

      console.log(
        `[Setup] PairedPvP: A=${pA.numTilesOwned()}, B=${pB.numTilesOwned()}, ` +
          `C=${pC.numTilesOwned()}, D=${pD.numTilesOwned()}, ` +
          `AB-shared=${pA.sharedBorderLength(pB)}, CD-shared=${pC.sharedBorderLength(pD)}`,
      );
    });

    test("2 independent PvP attacks running simultaneously", () => {
      pA.setTroops(10_000_000);
      pB.setTroops(500_000);
      pC.setTroops(10_000_000);
      pD.setTroops(500_000);

      game.addExecution(new AttackExecution(500_000, pA, pB.id(), null, false));
      game.addExecution(new AttackExecution(500_000, pC, pD.id(), null, false));

      const r = benchFullAttack("Paired PvP: A→B + C→D (500k each)", game, pA);
      results.push(r);
      console.log(fmt(r));
      expect(r.ticksMeasured).toBeGreaterThan(0);
    });
  });

  // ── Scenario 4: Baseline (small map) ───────────────────────────────────

  describe("baseline: small map", () => {
    let game: Game;
    let attacker: Player;

    beforeAll(async () => {
      const { setup } = await import("../../util/Setup");
      game = await setup("Plains", {
        infiniteGold: true,
        infiniteTroops: true,
      });

      const info = new PlayerInfo(
        "us",
        "Micro",
        PlayerType.Human,
        null,
        "micro_id",
      );
      game.addPlayer(info);
      game.addExecution(new SpawnExecution(info, game.ref(10, 10)));
      while (game.inSpawnPhase()) game.executeNextTick();

      attacker = game.player(info.id);
      attacker.setTroops(1_000_000);
      growPlayer(game, attacker, 200);
    });

    test("small TN attack — baseline tick cost", () => {
      attacker.setTroops(1_000_000);
      game.addExecution(
        new AttackExecution(
          10_000,
          attacker,
          game.terraNullius().id(),
          null,
          false,
        ),
      );

      const r = benchSustained(
        "Small TN baseline (Plains, ~200 tiles)",
        game,
        attacker,
        3,
        50,
      );
      results.push(r);
      console.log(fmt(r));
      expect(r.tilesConquered).toBeGreaterThan(0);
    });
  });
});
