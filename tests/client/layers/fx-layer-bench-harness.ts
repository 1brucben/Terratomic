/**
 * FxLayer Performance Benchmark Harness
 * ======================================
 * Implementation-agnostic harness for benchmarking any Layer that renders
 * visual effects (explosions, shockwaves, debris particles, etc.).
 *
 * Exports mock game state, FX-event simulation, stats utilities, and a
 * `runFxBenchSuite()` function that works with any factory producing a
 * `Layer`.
 *
 * Usage:
 *
 *   import { runFxBenchSuite } from "./fx-layer-bench-harness";
 *   import { FxLayer } from "...";
 *
 *   runFxBenchSuite("FxLayer", (game, transformHandler) =>
 *     new FxLayer(game, transformHandler),
 *   );
 *
 * Scenarios:
 *  1. Single nuke explosion (heavy — shockwave + debris sprites)
 *  2. Burst: 10 simultaneous shell impacts (mini-explosions)
 *  3. Sustained: 30 ticks of mixed unit events
 *  4. updateFx only (pure update loop, no new spawns)
 *  5. renderLayer only (PIXI render + position update path)
 *  6. Nuke + camera pan (position recalculation under load)
 *  7. Doomsday explosion (max debris density)
 *  8. FX churn: spawn + expire cycle over 50 ticks
 */

import { colord, type Colord } from "colord";
import type { Layer } from "../../../src/client/graphics/layers/Layer";
import type { TransformHandler } from "../../../src/client/graphics/TransformHandler";
import { Cell, PlayerType, UnitType } from "../../../src/core/game/Game";
import type { TileRef } from "../../../src/core/game/GameMap";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import type {
  GameView,
  PlayerView,
  UnitView,
} from "../../../src/core/game/GameView";

// ═══════════════════════════════════════════════════════════════════════════
// Map / config constants
// ═══════════════════════════════════════════════════════════════════════════

export const MAP_WIDTH = 400;
export const MAP_HEIGHT = 300;
export const TOTAL_TILES = MAP_WIDTH * MAP_HEIGHT;
export const SCREEN_W = 1920;
export const SCREEN_H = 1080;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface BenchmarkResult {
  scenario: string;
  samples: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  stdMs: number;
  minMs: number;
  maxMs: number;
  /** PIXI render() calls intercepted */
  pixiRenderCalls: number;
  /** PIXI Graphics.clear() calls — shockwave redraws */
  graphicsClearCalls: number;
  /** addChild calls — new display objects added to stage */
  addChildCalls: number;
  /** removeChild calls — expired FX cleaned up */
  removeChildCalls: number;
}

export interface GpuCounters {
  pixiRenderCalls: number;
  graphicsClearCalls: number;
  addChildCalls: number;
  removeChildCalls: number;
}

/**
 * Factory: given mocked dependencies, return a Layer.
 */
export type FxLayerFactory = (
  game: GameView,
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
    pixiRenderCalls: gpuMetrics.pixiRenderCalls,
    graphicsClearCalls: gpuMetrics.graphicsClearCalls,
    addChildCalls: gpuMetrics.addChildCalls,
    removeChildCalls: gpuMetrics.removeChildCalls,
  };
}

export function resetGpuCounters(c: GpuCounters) {
  c.pixiRenderCalls = 0;
  c.graphicsClearCalls = 0;
  c.addChildCalls = 0;
  c.removeChildCalls = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// PIXI mock classes (same approach as UnitLayer harness)
// ═══════════════════════════════════════════════════════════════════════════

let _globalGpuCounters: GpuCounters | null = null;

export function setGlobalGpuCounters(c: GpuCounters) {
  _globalGpuCounters = c;
}

export class MockTexture {
  source: any = { uid: 1 };
  frame: any = { x: 0, y: 0, width: 16, height: 16 };
  constructor(opts?: any) {
    if (opts?.frame) this.frame = opts.frame;
    if (opts?.source) this.source = opts.source;
  }
  static from(_src: any): MockTexture {
    return new MockTexture();
  }
  static EMPTY = new MockTexture();
}

export class MockContainer {
  children: any[] = [];
  x = 0;
  y = 0;
  alpha = 1;
  visible = true;
  scale = {
    x: 1,
    y: 1,
    set(v: number, v2?: number) {
      this.x = v;
      this.y = v2 ?? v;
    },
  };
  position = {
    x: 0,
    y: 0,
    set(x: number, y: number) {
      this.x = x;
      this.y = y;
    },
  };
  addChild(child: any) {
    this.children.push(child);
    if (_globalGpuCounters) _globalGpuCounters.addChildCalls++;
    return child;
  }
  removeChild(child: any) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    if (_globalGpuCounters) _globalGpuCounters.removeChildCalls++;
    return child;
  }
  destroy() {}
}

export class MockGraphics extends MockContainer {
  clear() {
    if (_globalGpuCounters) _globalGpuCounters.graphicsClearCalls++;
    return this;
  }
  beginFill() {
    return this;
  }
  endFill() {
    return this;
  }
  drawRect() {
    return this;
  }
  drawCircle() {
    return this;
  }
  circle(_x: number, _y: number, _r: number) {
    return this;
  }
  stroke(_opts?: any) {
    return this;
  }
  lineStyle() {
    return this;
  }
  moveTo() {
    return this;
  }
  lineTo() {
    return this;
  }
}

export class MockSprite extends MockContainer {
  anchor = { set(_x: number, _y: number) {} };
  texture: any = MockTexture.EMPTY;
  constructor(tex?: any) {
    super();
    if (tex) this.texture = tex;
  }
}

export class MockAnimatedSprite extends MockSprite {
  loop = true;
  autoUpdate = false;
  totalFrames = 4;
  private _currentFrame = 0;
  constructor(textures?: any[]) {
    super();
    if (textures) this.totalFrames = textures.length;
  }
  gotoAndStop(frame: number) {
    this._currentFrame = Math.max(0, Math.min(frame, this.totalFrames - 1));
  }
  play() {}
}

export class MockWebGLRenderer {
  render(_stage: any) {
    if (_globalGpuCounters) _globalGpuCounters.pixiRenderCalls++;
  }
  async init(_opts: any) {}
  resize(_w: number, _h: number) {}
  destroy() {}
}

export class MockRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  constructor(x = 0, y = 0, w = 0, h = 0) {
    this.x = x;
    this.y = y;
    this.width = w;
    this.height = h;
  }
}

/**
 * Complete PIXI mock module — pass to jest.mock("pixi.js", () => PIXI_MOCK_MODULE)
 */
export const PIXI_MOCK_MODULE = {
  Container: MockContainer,
  Sprite: MockSprite,
  AnimatedSprite: MockAnimatedSprite,
  Graphics: MockGraphics,
  Texture: MockTexture,
  WebGLRenderer: MockWebGLRenderer,
  Rectangle: MockRectangle,
};

// ═══════════════════════════════════════════════════════════════════════════
// Mock game state
// ═══════════════════════════════════════════════════════════════════════════

const PLAYER_COLORS: Colord[] = [
  colord("#e63946"),
  colord("#457b9d"),
  colord("#2a9d8f"),
  colord("#e9c46a"),
];

function createMockPlayerView(id: number, color: Colord): PlayerView {
  return {
    id: () => `player-${id}`,
    smallID: () => id,
    type: () => PlayerType.Human,
    isPlayer: () => true,
    isFriendly: () => false,
    isAtWarWith: () => false,
    isAlliedWith: () => false,
    nameLocation: () => ({ x: 100, y: 100 }),
    numTilesOwned: () => 1000,
    _color: color,
  } as unknown as PlayerView;
}

function createMockTheme() {
  return {
    territoryColor: (pv: any) => (pv as any)._color ?? colord("#888"),
    borderColor: (pv: any) =>
      ((pv as any)._color ?? colord("#888")).darken(0.2),
    spawnHighlightColor: () => colord("#ffffff"),
  };
}

/**
 * Build a mock UnitView for triggering FX events.
 */
export function createMockUnit(
  unitType: UnitType,
  owner: PlayerView,
  tile: number,
  lastTile: number,
  active: boolean,
  reachedTarget: boolean,
): UnitView {
  return {
    type: () => unitType,
    owner: () => owner,
    tile: () => tile as TileRef,
    lastTile: () => lastTile as TileRef,
    isActive: () => active,
    reachedTarget: () => reachedTarget,
    id: () => Math.floor(Math.random() * 100000),
    targetTile: () => tile as TileRef,
    level: () => 1,
  } as unknown as UnitView;
}

export interface MockGameState {
  players: PlayerView[];
  unitUpdates: { id: number }[];
  unitMap: Map<number, UnitView>;
  bomberExplosions: { x: number; y: number; radius: number }[];
  doomsdayExplosions: { x: number; y: number; radius: number }[];
  currentTick: number;
  fxEnabled: boolean;
}

export function freshState(): MockGameState {
  const players = PLAYER_COLORS.map((c, i) => createMockPlayerView(i + 1, c));
  return {
    players,
    unitUpdates: [],
    unitMap: new Map(),
    bomberExplosions: [],
    doomsdayExplosions: [],
    currentTick: 0,
    fxEnabled: true,
  };
}

/**
 * Build the mock GameView wired to a MockGameState.
 */
export function createMockGame(state: MockGameState): GameView {
  const theme = createMockTheme();
  return {
    width: () => MAP_WIDTH,
    height: () => MAP_HEIGHT,
    x: (tile: TileRef) => (tile as number) % MAP_WIDTH,
    y: (tile: TileRef) => Math.floor((tile as number) / MAP_WIDTH),
    ref: (x: number, y: number) => (y * MAP_WIDTH + x) as TileRef,
    tileRef: (x: number, y: number) => (y * MAP_WIDTH + x) as TileRef,
    isValidCoord: (x: number, y: number) =>
      x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT,
    isLand: () => true,
    numTilesOwned: () => 100,
    tile: (ref: TileRef) => ({
      terrain: () => "land",
      owner: () => state.players[0],
      hasOwner: () => true,
    }),
    unit: (id: number) => state.unitMap.get(id),
    config: () => ({
      theme: () => theme,
      serverConfig: () => ({ turnIntervalMs: () => 500 }),
      userSettings: () => ({
        fxLayer: () => state.fxEnabled,
      }),
    }),
    updatesSinceLastTick: () => {
      const updates: any = {};
      if (state.unitUpdates.length > 0) {
        updates[GameUpdateType.Unit] = [...state.unitUpdates];
      }
      if (state.bomberExplosions.length > 0) {
        updates[GameUpdateType.BomberExplosion] = [...state.bomberExplosions];
      }
      if (state.doomsdayExplosions.length > 0) {
        updates[GameUpdateType.DoomsdayExplosion] = [
          ...state.doomsdayExplosions,
        ];
      }
      return updates;
    },
    players: () => state.players,
    allPlayers: () => state.players,
    inSpawnPhase: () => false,
    isOnlyHumans: () => false,
    ticks: () => state.currentTick,
  } as unknown as GameView;
}

/**
 * Build a mock TransformHandler.
 */
export function createMockTransformHandler(
  cameraChanged = false,
): TransformHandler {
  return {
    scale: 1.8,
    worldToScreenCoordinates: (cell: Cell) => ({
      x: (cell.x - MAP_WIDTH / 2) * 1.8 + SCREEN_W / 2,
      y: (cell.y - MAP_HEIGHT / 2) * 1.8 + SCREEN_H / 2,
    }),
    hasChanged: () => cameraChanged,
    width: () => SCREEN_W,
    height: () => SCREEN_H,
    boundingRect: () => ({
      width: SCREEN_W,
      height: SCREEN_H,
      left: 0,
      top: 0,
    }),
  } as unknown as TransformHandler;
}

// ═══════════════════════════════════════════════════════════════════════════
// Event simulation helpers
// ═══════════════════════════════════════════════════════════════════════════

let _unitIdCounter = 1;

/**
 * Queue a dead unit event (Shell, Warship, AABullet, Nuke, etc).
 * These trigger FX creation in tick().
 */
export function queueUnitDeath(
  state: MockGameState,
  unitType: UnitType,
  reachedTarget: boolean,
  x?: number,
  y?: number,
): void {
  const id = _unitIdCounter++;
  const tile =
    (y ?? Math.floor(Math.random() * MAP_HEIGHT)) * MAP_WIDTH +
    (x ?? Math.floor(Math.random() * MAP_WIDTH));
  const owner = state.players[Math.floor(Math.random() * state.players.length)];
  const unit = createMockUnit(
    unitType,
    owner,
    tile,
    tile,
    false,
    reachedTarget,
  );
  state.unitMap.set(id, unit);
  state.unitUpdates.push({ id });
}

/**
 * Queue a bomber/nuke explosion (BomberExplosion update type).
 */
export function queueBomberExplosion(
  state: MockGameState,
  x?: number,
  y?: number,
  radius?: number,
): void {
  state.bomberExplosions.push({
    x: x ?? Math.floor(Math.random() * MAP_WIDTH),
    y: y ?? Math.floor(Math.random() * MAP_HEIGHT),
    radius: radius ?? 70,
  });
}

/**
 * Queue a doomsday explosion.
 */
export function queueDoomsdayExplosion(
  state: MockGameState,
  x?: number,
  y?: number,
  radius?: number,
): void {
  state.doomsdayExplosions.push({
    x: x ?? MAP_WIDTH / 2,
    y: y ?? MAP_HEIGHT / 2,
    radius: radius ?? 200,
  });
}

/**
 * Clear pending updates (call after tick() consumes them).
 */
export function clearUpdates(state: MockGameState): void {
  state.unitUpdates = [];
  state.bomberExplosions = [];
  state.doomsdayExplosions = [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas mock for FxLayer's document.createElement("canvas") + body.appendChild
// ═══════════════════════════════════════════════════════════════════════════

export function installCanvasMock() {
  const _realCreateElement = document.createElement.bind(document);
  jest
    .spyOn(document, "createElement")
    .mockImplementation((tag: string, options?: ElementCreationOptions) => {
      if (tag === "canvas") {
        const fakeCanvas = {
          width: SCREEN_W,
          height: SCREEN_H,
          style: {} as any,
          getContext: () => createNullContext(),
          toDataURL: () => "",
          addEventListener: () => {},
          removeEventListener: () => {},
        } as unknown as HTMLCanvasElement;
        return fakeCanvas;
      }
      return _realCreateElement(tag, options);
    });
  // Stub body.appendChild so FxLayer's DOM insertion doesn't fail
  jest
    .spyOn(document.body, "appendChild")
    .mockImplementation((node: any) => node);
}

function createNullContext(): CanvasRenderingContext2D {
  return {
    drawImage: () => {},
    clearRect: () => {},
    fillRect: () => {},
    putImageData: () => {},
    getImageData: () => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    }),
    createImageData: () => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    }),
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setTransform: () => {},
    fillStyle: "",
    canvas: { width: SCREEN_W, height: SCREEN_H },
  } as unknown as CanvasRenderingContext2D;
}

// ═══════════════════════════════════════════════════════════════════════════
// AnimatedSpriteLoader mock
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mock AnimatedSpriteLoader that returns mock textures/configs
 * without loading real images.
 */
export function mockAnimatedSpriteLoaderModule() {
  jest.mock("../../../src/client/graphics/AnimatedSpriteLoader", () => ({
    AnimatedSpriteLoader: class MockAnimatedSpriteLoader {
      async loadAllAnimatedSpriteImages() {}

      getPixiTextures(_fxType: any, _owner?: any, _theme?: any) {
        // Return 4 mock textures (typical frame count)
        return [
          new MockTexture(),
          new MockTexture(),
          new MockTexture(),
          new MockTexture(),
        ];
      }

      getConfig(_fxType: any) {
        return {
          frameWidth: 16,
          frameCount: 4,
          frameDuration: 100,
          looping: false,
          originX: 8,
          originY: 8,
        };
      }

      createAnimatedSprite() {
        return null; // Not used by FxLayer directly
      }
    },
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Benchmark runner
// ═══════════════════════════════════════════════════════════════════════════

const SAMPLES = 10;
const WARMUP = 2;

async function benchmark(
  label: string,
  counters: GpuCounters,
  fn: () => void | Promise<void>,
): Promise<BenchmarkResult> {
  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    resetGpuCounters(counters);
    await fn();
  }

  const timings: number[] = [];
  resetGpuCounters(counters);
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    await fn();
    timings.push(performance.now() - t0);
  }
  return computeStats(label, timings, counters);
}

/**
 * Main entry point — call from a test file.
 */
export function runFxBenchSuite(suiteName: string, factory: FxLayerFactory) {
  const counters: GpuCounters = {
    pixiRenderCalls: 0,
    graphicsClearCalls: 0,
    addChildCalls: 0,
    removeChildCalls: 0,
  };

  // Set GPU counters in beforeAll so the module-level reference is
  // correct when tests actually run (describe-phase calls would be
  // overwritten by later suites).
  beforeAll(() => {
    setGlobalGpuCounters(counters);
  });

  const results: BenchmarkResult[] = [];

  // Helper: create a fresh layer + state for each scenario
  async function setup(cameraChanged = false) {
    const state = freshState();
    const game = createMockGame(state);
    const transform = createMockTransformHandler(cameraChanged);
    const layer = factory(game, transform);
    if (layer.init) await layer.init();
    return { state, game, transform, layer };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 1: Single nuke explosion
  // Tests nukeFxFactory (shockwave + debris sprites) creation + initial render
  // ─────────────────────────────────────────────────────────────────────
  it(`S1: Single nuke explosion`, async () => {
    const r = await benchmark(
      "1. Single nuke explosion",
      counters,
      async () => {
        const { state, layer } = await setup();
        // Queue a nuke impact
        queueUnitDeath(state, UnitType.AtomBomb, true, 200, 150);
        resetGpuCounters(counters);
        layer.tick!();
        clearUpdates(state);
        // Render the frame with the new FX
        layer.renderLayer!(createNullContext());
      },
    );
    results.push(r);
    expect(r.meanMs).toBeLessThan(50);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 2: Burst — 10 simultaneous shell impacts
  // ─────────────────────────────────────────────────────────────────────
  it(`S2: Burst — 10 shell impacts`, async () => {
    const r = await benchmark(
      "2. Burst: 10 shell impacts",
      counters,
      async () => {
        const { state, layer } = await setup();
        for (let i = 0; i < 10; i++) {
          queueUnitDeath(state, UnitType.Shell, true);
        }
        resetGpuCounters(counters);
        layer.tick!();
        clearUpdates(state);
        layer.renderLayer!(createNullContext());
      },
    );
    results.push(r);
    expect(r.meanMs).toBeLessThan(30);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 3: Burst — 5 warship destructions (multiple FX per event)
  // ─────────────────────────────────────────────────────────────────────
  it(`S3: Burst — 5 warship destructions`, async () => {
    const r = await benchmark(
      "3. Burst: 5 warship destructions",
      counters,
      async () => {
        const { state, layer } = await setup();
        for (let i = 0; i < 5; i++) {
          queueUnitDeath(state, UnitType.Warship, false);
        }
        resetGpuCounters(counters);
        layer.tick!();
        clearUpdates(state);
        layer.renderLayer!(createNullContext());
      },
    );
    results.push(r);
    expect(r.meanMs).toBeLessThan(30);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 4: Sustained — 30 ticks of mixed combat events
  // ─────────────────────────────────────────────────────────────────────
  it(`S4: Sustained 30 ticks — mixed combat`, async () => {
    const r = await benchmark(
      "4. Sustained 30 ticks (mixed combat)",
      counters,
      async () => {
        const { state, layer } = await setup();
        resetGpuCounters(counters);
        for (let tick = 0; tick < 30; tick++) {
          state.currentTick = tick;
          // Each tick: 3 shell hits, 1 AA bullet hit, occasional warship
          for (let i = 0; i < 3; i++) {
            queueUnitDeath(state, UnitType.Shell, true);
          }
          queueUnitDeath(state, UnitType.AABullet, true);
          if (tick % 5 === 0) {
            queueUnitDeath(state, UnitType.Warship, false);
          }
          if (tick === 15) {
            queueUnitDeath(state, UnitType.AtomBomb, true, 200, 150);
          }
          layer.tick!();
          clearUpdates(state);
          layer.renderLayer!(createNullContext());
        }
      },
    );
    results.push(r);
    expect(r.meanMs).toBeLessThan(200);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 5: updateFx only — pure FX update loop, many active FX
  // ─────────────────────────────────────────────────────────────────────
  it(`S5: updateFx only — 100 active FX`, async () => {
    const r = await benchmark(
      "5. updateFx only (100 active FX)",
      counters,
      async () => {
        const { state, layer } = await setup();
        // Pre-populate with many FX
        for (let i = 0; i < 20; i++) {
          queueUnitDeath(state, UnitType.Shell, true);
        }
        for (let i = 0; i < 5; i++) {
          queueUnitDeath(state, UnitType.Warship, false);
        }
        queueUnitDeath(state, UnitType.AtomBomb, true, 200, 150);
        layer.tick!();
        clearUpdates(state);
        // Now measure just rendering (which calls updateFx internally)
        resetGpuCounters(counters);
        for (let frame = 0; frame < 10; frame++) {
          layer.renderLayer!(createNullContext());
        }
      },
    );
    results.push(r);
    expect(r.meanMs).toBeLessThan(50);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 6: renderLayer only — PIXI render + camera-change repositioning
  // ─────────────────────────────────────────────────────────────────────
  it(`S6: renderLayer + camera pan`, async () => {
    const r = await benchmark(
      "6. renderLayer + camera pan (50 FX)",
      counters,
      async () => {
        const state = freshState();
        const game = createMockGame(state);
        const transform = createMockTransformHandler(true); // camera changed!
        const layer = factory(game, transform);
        if (layer.init) await layer.init();
        // Pre-populate
        for (let i = 0; i < 10; i++) {
          queueUnitDeath(state, UnitType.Shell, true);
        }
        for (let i = 0; i < 3; i++) {
          queueUnitDeath(state, UnitType.Warship, false);
        }
        queueUnitDeath(state, UnitType.AtomBomb, true, 100, 100);
        layer.tick!();
        clearUpdates(state);
        resetGpuCounters(counters);
        // Render with camera changed — triggers position recalculation
        for (let frame = 0; frame < 10; frame++) {
          layer.renderLayer!(createNullContext());
        }
      },
    );
    results.push(r);
    expect(r.meanMs).toBeLessThan(50);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 7: Doomsday explosion (max debris density)
  // ─────────────────────────────────────────────────────────────────────
  it(`S7: Doomsday explosion`, async () => {
    const r = await benchmark(
      "7. Doomsday explosion (radius 200)",
      counters,
      async () => {
        const { state, layer } = await setup();
        queueDoomsdayExplosion(state, 200, 150, 200);
        resetGpuCounters(counters);
        layer.tick!();
        clearUpdates(state);
        layer.renderLayer!(createNullContext());
      },
    );
    results.push(r);
    expect(r.meanMs).toBeLessThan(50);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 8: Bomber explosion (BomberExplosion update path)
  // ─────────────────────────────────────────────────────────────────────
  it(`S8: Bomber explosion`, async () => {
    const r = await benchmark(
      "8. Bomber explosion (radius 70)",
      counters,
      async () => {
        const { state, layer } = await setup();
        queueBomberExplosion(state, 200, 150, 70);
        resetGpuCounters(counters);
        layer.tick!();
        clearUpdates(state);
        layer.renderLayer!(createNullContext());
      },
    );
    results.push(r);
    expect(r.meanMs).toBeLessThan(50);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 9: FX churn — spawn + expire cycle over 50 ticks
  // ─────────────────────────────────────────────────────────────────────
  it(`S9: FX churn — 50 ticks spawn/expire`, async () => {
    const r = await benchmark(
      "9. FX churn (50 ticks, 5 spawns/tick)",
      counters,
      async () => {
        const { state, layer } = await setup();
        resetGpuCounters(counters);
        for (let tick = 0; tick < 50; tick++) {
          state.currentTick = tick;
          // Spawn 5 FX per tick
          for (let i = 0; i < 3; i++) {
            queueUnitDeath(state, UnitType.Shell, true);
          }
          queueUnitDeath(state, UnitType.AABullet, true);
          queueUnitDeath(state, UnitType.AABullet, true);
          layer.tick!();
          clearUpdates(state);
          layer.renderLayer!(createNullContext());
        }
      },
    );
    results.push(r);
    expect(r.meanMs).toBeLessThan(300);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 10: SAM interception (explosion + shockwave)
  // ─────────────────────────────────────────────────────────────────────
  it(`S10: SAM interception burst`, async () => {
    const r = await benchmark("10. SAM interception ×5", counters, async () => {
      const { state, layer } = await setup();
      // 5 nukes intercepted by SAMs (reachedTarget = false)
      for (let i = 0; i < 5; i++) {
        queueUnitDeath(state, UnitType.AtomBomb, false);
      }
      resetGpuCounters(counters);
      layer.tick!();
      clearUpdates(state);
      layer.renderLayer!(createNullContext());
    });
    results.push(r);
    expect(r.meanMs).toBeLessThan(30);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Print results table
  // ─────────────────────────────────────────────────────────────────────
  afterAll(() => {
    const header = `  ${suiteName}  `;
    const border = "═".repeat(header.length);
    console.log(`╔${border}╗`);
    console.log(`║${header}║`);
    console.log(`╚${border}╝`);
    console.table(
      results.map((r) => ({
        Scenario: r.scenario,
        Samples: r.samples,
        "Mean (ms)": r.meanMs,
        "Median (ms)": r.medianMs,
        "P95 (ms)": r.p95Ms,
        "Std (ms)": r.stdMs,
        "Min (ms)": r.minMs,
        "Max (ms)": r.maxMs,
        "PIXI render": r.pixiRenderCalls,
        "gfx.clear()": r.graphicsClearCalls,
        addChild: r.addChildCalls,
        removeChild: r.removeChildCalls,
      })),
    );
  });
}
