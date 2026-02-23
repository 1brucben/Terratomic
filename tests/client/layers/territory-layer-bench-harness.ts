/**
 * TerritoryLayer Performance Benchmark Harness
 * ==============================================
 * Implementation-agnostic harness for benchmarking any Layer that renders
 * territory. Exports mock game state, attack simulation, stats utilities,
 * and a `runTerritoryBenchSuite()` function that works with any factory
 * producing a `Layer`.
 *
 * Usage in a test file:
 *
 *   import { runTerritoryBenchSuite } from "./territory-layer-bench-harness";
 *   import { MyTerritoryLayer } from "...";
 *
 *   runTerritoryBenchSuite("MyTerritoryLayer", (game, eventBus, transform) =>
 *     new MyTerritoryLayer(game, eventBus, transform),
 *   );
 *
 * Each implementation gets identical scenarios and the results table is
 * printed at the end so you can compare side-by-side.
 */

import { colord, type Colord } from "colord";
import type { Layer } from "../../../src/client/graphics/layers/Layer";
import type { TransformHandler } from "../../../src/client/graphics/TransformHandler";
import type { EventBus } from "../../../src/core/EventBus";
import { PlayerType } from "../../../src/core/game/Game";
import type { TileRef } from "../../../src/core/game/GameMap";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import type { GameView } from "../../../src/core/game/GameView";
import { PlayerView } from "../../../src/core/game/GameView";

// ═══════════════════════════════════════════════════════════════════════════
// Map / player constants
// ═══════════════════════════════════════════════════════════════════════════

export const MAP_WIDTH = 600;
export const MAP_HEIGHT = 400;
export const TOTAL_TILES = MAP_WIDTH * MAP_HEIGHT;
export const NUM_PLAYERS = 4;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface BenchmarkResult {
  scenario: string;
  samples: number;
  /** Mean wall-clock time in ms */
  meanMs: number;
  /** Median wall-clock time in ms */
  medianMs: number;
  /** 95th percentile in ms */
  p95Ms: number;
  /** Standard deviation in ms */
  stdMs: number;
  /** Minimum in ms */
  minMs: number;
  /** Maximum in ms */
  maxMs: number;
  /** Total putImageData calls during measured samples */
  putImageDataCalls: number;
  /** Total drawImage calls during measured samples */
  drawImageCalls: number;
  /** Sum of dirty-rect pixel areas across all putImageData calls */
  totalDirtyPixels: number;
}

export interface GpuCounters {
  putImageDataCalls: number;
  drawImageCalls: number;
  totalDirtyPixels: number;
}

/** Rectangular region of tiles assigned to a player (simple partition). */
export interface PlayerRegion {
  id: string;
  smallID: number;
  startTile: number;
  tileCount: number;
}

export interface MockGameState {
  ownerMap: Int32Array;
  borderMap: Uint8Array;
  regions: PlayerRegion[];
  players: PlayerView[];
  recentTiles: TileRef[];
  tileOwnerChangedUpdates: { type: number; tile: TileRef }[];
  currentTick: number;
}

/**
 * Factory signature: given the mocked dependencies, return a Layer.
 * The factory may also return a cleanup function called after each sample.
 */
export type LayerFactory = (
  game: GameView,
  eventBus: EventBus,
  transformHandler: TransformHandler,
) => Layer;

// ═══════════════════════════════════════════════════════════════════════════
// Stats helpers
// ═══════════════════════════════════════════════════════════════════════════

export function computeStats(
  label: string,
  timings: number[],
  gpuMetrics: GpuCounters,
): BenchmarkResult {
  const sorted = [...timings].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const median =
    n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
  const p95 = sorted[Math.min(Math.ceil(n * 0.95) - 1, n - 1)];
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return {
    scenario: label,
    samples: n,
    meanMs: +mean.toFixed(3),
    medianMs: +median.toFixed(3),
    p95Ms: +p95.toFixed(3),
    stdMs: +std.toFixed(3),
    minMs: +sorted[0].toFixed(3),
    maxMs: +sorted[n - 1].toFixed(3),
    putImageDataCalls: gpuMetrics.putImageDataCalls,
    drawImageCalls: gpuMetrics.drawImageCalls,
    totalDirtyPixels: gpuMetrics.totalDirtyPixels,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas / context instrumented mock
// ═══════════════════════════════════════════════════════════════════════════

export function resetGpuCounters(c: GpuCounters) {
  c.putImageDataCalls = 0;
  c.drawImageCalls = 0;
  c.totalDirtyPixels = 0;
}

export function createInstrumentedContext(
  width: number,
  height: number,
  counters: GpuCounters,
): CanvasRenderingContext2D {
  return {
    putImageData: (
      _imageData: ImageData,
      _dx: number,
      _dy: number,
      dirtyX?: number,
      dirtyY?: number,
      dirtyW?: number,
      dirtyH?: number,
    ) => {
      counters.putImageDataCalls++;
      if (dirtyW !== undefined && dirtyH !== undefined) {
        counters.totalDirtyPixels += dirtyW * dirtyH;
      } else {
        counters.totalDirtyPixels += width * height;
      }
    },
    drawImage: () => {
      counters.drawImageCalls++;
    },
    clearRect: () => {},
    fillRect: () => {},
    fillStyle: "",
    canvas: { width, height },
  } as unknown as CanvasRenderingContext2D;
}

/**
 * Monkey-patch `document.createElement("canvas")` to return instrumented
 * canvases that track GPU-proxy calls.
 */
export function installCanvasMock(
  width: number,
  height: number,
  counters: GpuCounters,
) {
  const origCreateElement = document.createElement.bind(document);
  jest
    .spyOn(document, "createElement")
    .mockImplementation((tag: string, options?: ElementCreationOptions) => {
      if (tag === "canvas") {
        const fakeCanvas = {
          width,
          height,
          getContext: (_id: string, _opts?: any) =>
            createInstrumentedContext(width, height, counters),
          toDataURL: () => "",
          style: {},
        } as unknown as HTMLCanvasElement;
        return fakeCanvas;
      }
      return origCreateElement(tag, options);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Game state mock
// ═══════════════════════════════════════════════════════════════════════════

const PLAYER_COLORS: Colord[] = [
  colord("#e63946"),
  colord("#457b9d"),
  colord("#2a9d8f"),
  colord("#e9c46a"),
];

export function buildPlayerRegions(): PlayerRegion[] {
  const tilesPerPlayer = Math.floor(TOTAL_TILES / NUM_PLAYERS);
  const regions: PlayerRegion[] = [];
  for (let i = 0; i < NUM_PLAYERS; i++) {
    regions.push({
      id: `player-${i}`,
      smallID: i + 1,
      startTile: i * tilesPerPlayer,
      tileCount: tilesPerPlayer,
    });
  }
  return regions;
}

export function buildOwnerMap(regions: PlayerRegion[]): Int32Array {
  const map = new Int32Array(TOTAL_TILES).fill(-1);
  for (const r of regions) {
    for (let t = r.startTile; t < r.startTile + r.tileCount; t++) {
      map[t] = r.smallID;
    }
  }
  return map;
}

export function computeBorders(
  ownerMap: Int32Array,
  w: number,
  h: number,
): Uint8Array {
  const borders = new Uint8Array(w * h);
  for (let t = 0; t < w * h; t++) {
    if (ownerMap[t] === -1) continue;
    const x = t % w;
    const y = Math.floor(t / w);
    const oid = ownerMap[t];
    let isBorder = false;
    if (x > 0 && ownerMap[t - 1] !== oid) isBorder = true;
    if (x < w - 1 && ownerMap[t + 1] !== oid) isBorder = true;
    if (y > 0 && ownerMap[t - w] !== oid) isBorder = true;
    if (y < h - 1 && ownerMap[t + w] !== oid) isBorder = true;
    borders[t] = isBorder ? 1 : 0;
  }
  return borders;
}

export function neighborsOf(tile: TileRef, w: number, h: number): Uint32Array {
  const x = tile % w;
  const y = Math.floor(tile / w);
  const result: number[] = [];
  if (x > 0) result.push(tile - 1);
  if (x < w - 1) result.push(tile + 1);
  if (y > 0) result.push(tile - w);
  if (y < h - 1) result.push(tile + w);
  return new Uint32Array(result);
}

export function createMockPlayerView(
  region: PlayerRegion,
  color: Colord,
): PlayerView {
  return {
    id: () => region.id,
    smallID: () => region.smallID,
    type: () => PlayerType.Human,
    isPlayer: () => true,
    isFriendly: () => false,
    isAtWarWith: () => false,
    isAlliedWith: () => false,
    nameLocation: () => ({
      x: ((region.startTile % MAP_WIDTH) + MAP_WIDTH / NUM_PLAYERS / 2) | 0,
      y: (Math.floor(region.startTile / MAP_WIDTH) + MAP_HEIGHT / 2) | 0,
    }),
    borderTiles: () =>
      Promise.resolve({ borderTiles: [], innerBorderTiles: [] }),
    numTilesOwned: () => region.tileCount,
    _color: color,
  } as unknown as PlayerView;
}

function createMockTheme() {
  return {
    territoryColor: (pv: any) => (pv as any)._color ?? colord("#888888"),
    borderColor: (pv: any) =>
      ((pv as any)._color ?? colord("#888888")).darken(0.2),
    defendedBorderColors: (pv: any) => ({
      light: ((pv as any)._color ?? colord("#888888")).lighten(0.1),
      dark: ((pv as any)._color ?? colord("#888888")).darken(0.3),
    }),
    focusedBorderColor: () => colord("#ffffff"),
    falloutColor: () => colord("#333333"),
    selfColor: () => colord("#00ff00"),
    allyColor: () => colord("#0000ff"),
    enemyColor: () => colord("#ff0000"),
    spawnHighlightColor: () => colord("#ffff00"),
  };
}

export function createMockGameView(state: MockGameState): GameView {
  const theme = createMockTheme();

  const playersBySmallID = new Map<number, PlayerView>();
  const playersById = new Map<string, PlayerView>();
  for (const p of state.players) {
    playersBySmallID.set(p.smallID(), p);
    playersById.set(p.id(), p);
  }

  const game: Partial<GameView> = {
    width: () => MAP_WIDTH,
    height: () => MAP_HEIGHT,
    config: () =>
      ({
        theme: () => theme,
        defensePostRange: () => 3,
      }) as any,
    ref: (x: number, y: number) => y * MAP_WIDTH + x,
    x: (t: TileRef) => t % MAP_WIDTH,
    y: (t: TileRef) => Math.floor(t / MAP_WIDTH),
    isValidCoord: (x: number, y: number) =>
      x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT,
    hasOwner: (t: TileRef) => state.ownerMap[t] !== -1,
    ownerID: (t: TileRef) => state.ownerMap[t],
    owner: (t: TileRef) => {
      const sid = state.ownerMap[t];
      if (sid === -1) return { isPlayer: () => false } as any;
      return playersBySmallID.get(sid) ?? ({ isPlayer: () => false } as any);
    },
    isBorder: (t: TileRef) => state.borderMap[t] === 1,
    hasFallout: (_t: TileRef) => false,
    neighbors: (t: TileRef) => neighborsOf(t, MAP_WIDTH, MAP_HEIGHT),
    forEachTile: (fn: (t: TileRef) => void) => {
      for (let t = 0; t < TOTAL_TILES; t++) fn(t);
    },
    ticks: () => state.currentTick,
    inSpawnPhase: () => false,
    myPlayer: () => null,
    focusedPlayer: () => null,
    playerViews: () => state.players,
    playerBySmallID: (id: number) =>
      playersBySmallID.get(id) ?? ({ isPlayer: () => false } as any),
    hasUnitNearby: () => false,
    recentlyUpdatedTiles: () => state.recentTiles,
    updatesSinceLastTick: () => {
      const updates: any = {};
      for (const key of Object.values(GameUpdateType)) {
        if (typeof key === "number") updates[key] = [];
      }
      updates[GameUpdateType.TileOwnerChanged] = state.tileOwnerChangedUpdates;
      return updates;
    },
  };

  return game as GameView;
}

export function createMockEventBus(): EventBus {
  return {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
  } as unknown as EventBus;
}

export function createMockTransformHandler(): TransformHandler {
  return {
    screenToWorldCoordinates: () => ({ x: 0, y: 0 }),
  } as unknown as TransformHandler;
}

// ═══════════════════════════════════════════════════════════════════════════
// Attack simulation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulate an attack: BFS-flip `count` tiles at the boundary between two
 * player regions from `fromSmallID` to `toSmallID`.
 * Returns the list of changed tile refs.
 */
export function simulateAttack(
  state: MockGameState,
  fromSmallID: number,
  toSmallID: number,
  count: number,
): TileRef[] {
  const changed: TileRef[] = [];
  const candidates: TileRef[] = [];
  for (let t = 0; t < TOTAL_TILES; t++) {
    if (state.ownerMap[t] !== fromSmallID) continue;
    const ns = neighborsOf(t, MAP_WIDTH, MAP_HEIGHT);
    for (let i = 0; i < ns.length; i++) {
      if (state.ownerMap[ns[i]] === toSmallID) {
        candidates.push(t);
        break;
      }
    }
  }

  const visited = new Set<TileRef>();
  const queue = [...candidates];
  for (const c of candidates) visited.add(c);

  while (changed.length < count && queue.length > 0) {
    const t = queue.shift()!;
    if (state.ownerMap[t] !== fromSmallID) continue;
    state.ownerMap[t] = toSmallID;
    changed.push(t);
    const ns = neighborsOf(t, MAP_WIDTH, MAP_HEIGHT);
    for (let i = 0; i < ns.length; i++) {
      if (!visited.has(ns[i]) && state.ownerMap[ns[i]] === fromSmallID) {
        visited.add(ns[i]);
        queue.push(ns[i]);
      }
    }
  }

  // Recompute borders for affected + neighboring tiles
  const affectedSet = new Set(changed);
  for (const t of changed) {
    const ns = neighborsOf(t, MAP_WIDTH, MAP_HEIGHT);
    for (let i = 0; i < ns.length; i++) affectedSet.add(ns[i]);
  }
  for (const t of affectedSet) {
    if (state.ownerMap[t] === -1) {
      state.borderMap[t] = 0;
      continue;
    }
    const x = t % MAP_WIDTH;
    const y = Math.floor(t / MAP_WIDTH);
    const oid = state.ownerMap[t];
    let border = false;
    if (x > 0 && state.ownerMap[t - 1] !== oid) border = true;
    if (x < MAP_WIDTH - 1 && state.ownerMap[t + 1] !== oid) border = true;
    if (y > 0 && state.ownerMap[t - MAP_WIDTH] !== oid) border = true;
    if (y < MAP_HEIGHT - 1 && state.ownerMap[t + MAP_WIDTH] !== oid)
      border = true;
    state.borderMap[t] = border ? 1 : 0;
  }

  return changed;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fresh state builder
// ═══════════════════════════════════════════════════════════════════════════

export function freshState(): MockGameState {
  const regions = buildPlayerRegions();
  const players = regions.map((r, i) =>
    createMockPlayerView(r, PLAYER_COLORS[i]),
  );
  const ownerMap = buildOwnerMap(regions);
  const borderMap = computeBorders(ownerMap, MAP_WIDTH, MAP_HEIGHT);
  return {
    ownerMap,
    borderMap,
    regions,
    players,
    recentTiles: [],
    tileOwnerChangedUpdates: [],
    currentTick: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Generic benchmark runner
// ═══════════════════════════════════════════════════════════════════════════

function hrtime(): number {
  return performance.now();
}

interface BenchCtx {
  layer: Layer;
  renderCtx: CanvasRenderingContext2D;
  gpuCounters: GpuCounters;
  state: MockGameState;
}

function runBenchmark(
  label: string,
  warmup: number,
  iterations: number,
  setup: () => BenchCtx,
  action: (ctx: BenchCtx) => void,
): BenchmarkResult {
  const timings: number[] = [];
  const totalGpu: GpuCounters = {
    putImageDataCalls: 0,
    drawImageCalls: 0,
    totalDirtyPixels: 0,
  };
  const totalRuns = warmup + iterations;

  for (let i = 0; i < totalRuns; i++) {
    const ctx = setup();
    resetGpuCounters(ctx.gpuCounters);

    const t0 = hrtime();
    action(ctx);
    const t1 = hrtime();

    if (i >= warmup) {
      timings.push(t1 - t0);
      totalGpu.putImageDataCalls += ctx.gpuCounters.putImageDataCalls;
      totalGpu.drawImageCalls += ctx.gpuCounters.drawImageCalls;
      totalGpu.totalDirtyPixels += ctx.gpuCounters.totalDirtyPixels;
    }
  }

  return computeStats(label, timings, totalGpu);
}

// ═══════════════════════════════════════════════════════════════════════════
// Public: run the full benchmark suite for any Layer implementation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registers a Jest `describe` block with 6 standard scenarios for the given
 * Layer implementation.  Call this from a `*.test.ts` file.
 *
 * @param suiteName  Label for the describe block (e.g. "Canvas2D TerritoryLayer")
 * @param factory    Creates the Layer under test from mock dependencies.
 * @param options    Optional tuning knobs.
 */
export function runTerritoryBenchSuite(
  suiteName: string,
  factory: LayerFactory,
  options: { warmup?: number; iterations?: number } = {},
) {
  const WARMUP = options.warmup ?? 3;
  const ITERATIONS = options.iterations ?? 10;

  describe(suiteName, () => {
    const allResults: BenchmarkResult[] = [];

    // Suppress noisy console.log from implementations (e.g. "redrew territory layer")
    const origLog = console.log;
    beforeAll(() => {
      console.log = (...args: any[]) => {
        if (
          typeof args[0] === "string" &&
          args[0].includes("redrew territory layer")
        )
          return;
        origLog(...args);
      };
    });

    afterAll(() => {
      console.log = origLog;

      // Print comparison table
      console.log(
        `\n╔══════════════════════════════════════════════════════════════╗`,
      );
      console.log(`║  ${suiteName.padEnd(56)}  ║`);
      console.log(
        `╚══════════════════════════════════════════════════════════════╝\n`,
      );
      console.table(
        allResults.map((r) => ({
          Scenario: r.scenario,
          Samples: r.samples,
          "Mean (ms)": r.meanMs,
          "Median (ms)": r.medianMs,
          "P95 (ms)": r.p95Ms,
          "Std (ms)": r.stdMs,
          "Min (ms)": r.minMs,
          "Max (ms)": r.maxMs,
          putImageData: r.putImageDataCalls,
          drawImage: r.drawImageCalls,
          "Dirty px (M)": +(r.totalDirtyPixels / 1_000_000).toFixed(2),
        })),
      );
    });

    // ---- helpers ----

    function makeLayer(
      state: MockGameState,
      gpuCounters: GpuCounters,
    ): BenchCtx {
      installCanvasMock(MAP_WIDTH, MAP_HEIGHT, gpuCounters);
      const gameView = createMockGameView(state);
      const eventBus = createMockEventBus();
      const transformHandler = createMockTransformHandler();
      const layer = factory(gameView, eventBus, transformHandler);
      const renderCtx = createInstrumentedContext(
        MAP_WIDTH,
        MAP_HEIGHT,
        gpuCounters,
      );
      return { layer, renderCtx, gpuCounters, state };
    }

    function newGpuCounters(): GpuCounters {
      return { putImageDataCalls: 0, drawImageCalls: 0, totalDirtyPixels: 0 };
    }

    // ---- Scenario 1: Full redraw ----

    it("Scenario 1 — Full redraw (baseline)", () => {
      const result = runBenchmark(
        "1. Full redraw (240k tiles)",
        WARMUP,
        ITERATIONS,
        () => makeLayer(freshState(), newGpuCounters()),
        ({ layer }) => {
          layer.redraw!();
        },
      );
      allResults.push(result);
      expect(result.meanMs).toBeDefined();
    });

    // ---- Scenario 2: Large single attack (5k tiles) ----

    it("Scenario 2 — Large single attack (5 000 tiles)", () => {
      const result = runBenchmark(
        "2. Large attack (5k tiles)",
        WARMUP,
        ITERATIONS,
        () => {
          const state = freshState();
          const ctx = makeLayer(state, newGpuCounters());
          ctx.layer.init?.();
          ctx.layer.redraw!();
          resetGpuCounters(ctx.gpuCounters);

          const changed = simulateAttack(
            state,
            state.regions[0].smallID,
            state.regions[1].smallID,
            5_000,
          );
          state.recentTiles = changed;
          state.tileOwnerChangedUpdates = changed.map((t) => ({
            type: GameUpdateType.TileOwnerChanged,
            tile: t,
          }));
          state.currentTick++;
          return ctx;
        },
        ({ layer, renderCtx }) => {
          layer.tick!();
          layer.renderLayer!(renderCtx);
        },
      );
      allResults.push(result);
      expect(result.meanMs).toBeDefined();
    });

    // ---- Scenario 3: Multiple simultaneous attacks (3 × 3k tiles) ----

    it("Scenario 3 — Multiple simultaneous attacks (3 × 3k tiles)", () => {
      const result = runBenchmark(
        "3. Multi-attack (3×3k tiles)",
        WARMUP,
        ITERATIONS,
        () => {
          const state = freshState();
          const ctx = makeLayer(state, newGpuCounters());
          ctx.layer.init?.();
          ctx.layer.redraw!();
          resetGpuCounters(ctx.gpuCounters);

          const allChanged: TileRef[] = [];
          allChanged.push(
            ...simulateAttack(
              state,
              state.regions[0].smallID,
              state.regions[1].smallID,
              3_000,
            ),
          );
          allChanged.push(
            ...simulateAttack(
              state,
              state.regions[1].smallID,
              state.regions[2].smallID,
              3_000,
            ),
          );
          allChanged.push(
            ...simulateAttack(
              state,
              state.regions[2].smallID,
              state.regions[3].smallID,
              3_000,
            ),
          );
          state.recentTiles = allChanged;
          state.tileOwnerChangedUpdates = allChanged.map((t) => ({
            type: GameUpdateType.TileOwnerChanged,
            tile: t,
          }));
          state.currentTick++;
          return ctx;
        },
        ({ layer, renderCtx }) => {
          layer.tick!();
          layer.renderLayer!(renderCtx);
        },
      );
      allResults.push(result);
      expect(result.meanMs).toBeDefined();
    });

    // ---- Scenario 4: Sustained incremental (200 tiles/tick × 50 ticks) ----

    it("Scenario 4 — Sustained incremental (200 tiles/tick × 50 ticks)", () => {
      const NUM_TICKS = 50;
      const TILES_PER_TICK = 200;

      const result = runBenchmark(
        "4. Sustained (200/tick × 50)",
        WARMUP,
        ITERATIONS,
        () => {
          const state = freshState();
          const ctx = makeLayer(state, newGpuCounters());
          ctx.layer.init?.();
          ctx.layer.redraw!();
          resetGpuCounters(ctx.gpuCounters);
          return ctx;
        },
        ({ layer, renderCtx, state }) => {
          for (let tick = 0; tick < NUM_TICKS; tick++) {
            const changed = simulateAttack(
              state,
              state.regions[0].smallID,
              state.regions[1].smallID,
              TILES_PER_TICK,
            );
            state.recentTiles = changed;
            state.tileOwnerChangedUpdates = changed.map((t) => ({
              type: GameUpdateType.TileOwnerChanged,
              tile: t,
            }));
            state.currentTick++;
            layer.tick!();
            layer.renderLayer!(renderCtx);
          }
        },
      );
      allResults.push(result);
      expect(result.meanMs).toBeDefined();
    });

    // ---- Scenario 5: renderLayer only (queue already loaded) ----

    it("Scenario 5 — renderLayer only (5k tiles queued)", () => {
      const result = runBenchmark(
        "5. renderLayer only (5k queued)",
        WARMUP,
        ITERATIONS,
        () => {
          const state = freshState();
          const ctx = makeLayer(state, newGpuCounters());
          ctx.layer.init?.();
          ctx.layer.redraw!();

          const changed = simulateAttack(
            state,
            state.regions[0].smallID,
            state.regions[1].smallID,
            5_000,
          );
          state.recentTiles = changed;
          state.tileOwnerChangedUpdates = changed.map((t) => ({
            type: GameUpdateType.TileOwnerChanged,
            tile: t,
          }));
          state.currentTick++;
          ctx.layer.tick!();

          // Reset — measure only renderLayer
          resetGpuCounters(ctx.gpuCounters);
          state.recentTiles = [];
          state.tileOwnerChangedUpdates = [];
          return ctx;
        },
        ({ layer, renderCtx }) => {
          layer.renderLayer!(renderCtx);
        },
      );
      allResults.push(result);
      expect(result.meanMs).toBeDefined();
    });

    // ---- Scenario 6: tick() only (no render) ----

    it("Scenario 6 — tick() only (5k ownership changes)", () => {
      const result = runBenchmark(
        "6. tick() only (5k changes)",
        WARMUP,
        ITERATIONS,
        () => {
          const state = freshState();
          const ctx = makeLayer(state, newGpuCounters());
          ctx.layer.init?.();
          ctx.layer.redraw!();
          resetGpuCounters(ctx.gpuCounters);

          const changed = simulateAttack(
            state,
            state.regions[0].smallID,
            state.regions[1].smallID,
            5_000,
          );
          state.recentTiles = changed;
          state.tileOwnerChangedUpdates = changed.map((t) => ({
            type: GameUpdateType.TileOwnerChanged,
            tile: t,
          }));
          state.currentTick++;
          return ctx;
        },
        ({ layer }) => {
          layer.tick!();
        },
      );
      allResults.push(result);
      expect(result.meanMs).toBeDefined();
    });
  });
}
