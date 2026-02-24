/**
 * UnitLayer Performance Benchmark Harness
 * ========================================
 * Implementation-agnostic harness for benchmarking any Layer that renders
 * mobile units. Exports mock game state, unit spawning/movement simulation,
 * stats utilities, and a `runUnitBenchSuite()` function that works with any
 * factory producing a `Layer`.
 *
 * Usage in a test file:
 *
 *   import { runUnitBenchSuite } from "./unit-layer-bench-harness";
 *   import { UnitLayer } from "...";
 *
 *   runUnitBenchSuite("Canvas2D+PIXI UnitLayer", (game, eventBus, transform, uiState) =>
 *     new UnitLayer(game, eventBus, transform, uiState),
 *   );
 *
 * Each implementation gets identical scenarios and the results table is
 * printed at the end so you can compare side-by-side.
 */

import { colord, type Colord } from "colord";
import type { Layer } from "../../../src/client/graphics/layers/Layer";
import type { TransformHandler } from "../../../src/client/graphics/TransformHandler";
import type { UIState } from "../../../src/client/graphics/UIState";
import type { EventBus } from "../../../src/core/EventBus";
import { Cell, PlayerType, UnitType } from "../../../src/core/game/Game";
import type { TileRef } from "../../../src/core/game/GameMap";
import {
  GameUpdateType,
  type UnitUpdate,
} from "../../../src/core/game/GameUpdates";
import type { GameView, UnitView } from "../../../src/core/game/GameView";
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
  /** Total drawImage calls during measured samples */
  drawImageCalls: number;
  /** Total fillRect calls during measured samples */
  fillRectCalls: number;
  /** Total clearRect calls during measured samples */
  clearRectCalls: number;
  /** Total canvas context save/restore cycles */
  saveRestoreCycles: number;
}

export interface GpuCounters {
  drawImageCalls: number;
  fillRectCalls: number;
  clearRectCalls: number;
  saveRestoreCycles: number;
}

/** Simple player region — contiguous band of tiles. */
export interface PlayerRegion {
  id: string;
  smallID: number;
  startTile: number;
  tileCount: number;
}

/** A mock unit with all fields needed by UnitLayer and GameView */
export interface MockUnit {
  id: number;
  unitType: UnitType;
  ownerSmallID: number;
  pos: TileRef;
  lastPos: TileRef;
  isActive: boolean;
  health: number;
  maxHealth: number;
  level: number;
  targetUnitId?: number;
  targetTile?: TileRef;
  isAttacking: boolean;
  isDetectedByNavalUnit: boolean;
  isCooldown: boolean;
  targetable: boolean;
  returning: boolean;
  retreating: boolean;
  reachedTarget: boolean;
  troops: number;
}

export interface MockGameState {
  ownerMap: Int32Array;
  regions: PlayerRegion[];
  players: PlayerView[];
  units: Map<number, MockUnit>;
  /** Unit IDs updated in the most recent "tick" */
  recentUnitUpdates: UnitUpdate[];
  currentTick: number;
}

/**
 * Factory signature: given mocked dependencies, return a Layer.
 */
export type UnitLayerFactory = (
  game: GameView,
  eventBus: EventBus,
  transformHandler: TransformHandler,
  uiState: UIState,
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
    drawImageCalls: gpuMetrics.drawImageCalls,
    fillRectCalls: gpuMetrics.fillRectCalls,
    clearRectCalls: gpuMetrics.clearRectCalls,
    saveRestoreCycles: gpuMetrics.saveRestoreCycles,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas / context instrumented mock
// ═══════════════════════════════════════════════════════════════════════════

export function resetGpuCounters(c: GpuCounters) {
  c.drawImageCalls = 0;
  c.fillRectCalls = 0;
  c.clearRectCalls = 0;
  c.saveRestoreCycles = 0;
}

export function createInstrumentedContext(
  width: number,
  height: number,
  counters: GpuCounters,
): CanvasRenderingContext2D {
  let saveDepth = 0;
  return {
    drawImage: () => {
      counters.drawImageCalls++;
    },
    putImageData: () => {},
    clearRect: () => {
      counters.clearRectCalls++;
    },
    fillRect: () => {
      counters.fillRectCalls++;
    },
    strokeRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    arc: () => {},
    fill: () => {},
    save: () => {
      saveDepth++;
    },
    restore: () => {
      if (saveDepth > 0) {
        saveDepth--;
        counters.saveRestoreCycles++;
      }
    },
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setTransform: () => {},
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getImageData: (_sx: number, _sy: number, sw: number, sh: number) => ({
      data: new Uint8ClampedArray(sw * sh * 4),
      width: sw,
      height: sh,
    }),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
    canvas: { width, height },
  } as unknown as CanvasRenderingContext2D;
}

// Capture the real createElement once, before any spies wrap it
let _realCreateElement: typeof document.createElement | null = null;

function getRealCreateElement(): typeof document.createElement {
  if (_realCreateElement === null) {
    _realCreateElement = document.createElement.bind(document);
  }
  return _realCreateElement!;
}

/**
 * Monkey-patch `document.createElement("canvas")` to return instrumented
 * canvases that track GPU-proxy calls. Safe to call repeatedly — always
 * delegates non-canvas calls to the true original.
 *
 * Returns real HTMLCanvasElement nodes (so they can be appended to the DOM)
 * but with mocked getContext returning instrumented contexts.
 */
export function installCanvasMock(
  width: number,
  height: number,
  counters: GpuCounters,
) {
  const origCreateElement = getRealCreateElement();

  // Restore any prior spy before installing a new one
  if (jest.isMockFunction(document.createElement)) {
    (document.createElement as jest.Mock).mockRestore?.();
  }

  jest
    .spyOn(document, "createElement")
    .mockImplementation((tag: string, options?: ElementCreationOptions) => {
      if (tag === "canvas") {
        // Create a real canvas element so it can be appended to the DOM
        const realCanvas = origCreateElement("canvas") as HTMLCanvasElement;
        realCanvas.width = width;
        realCanvas.height = height;

        // Override getContext to return instrumented context
        const ctx = createInstrumentedContext(width, height, counters);
        realCanvas.getContext = ((_id: string, _opts?: any) => ctx) as any;
        realCanvas.toDataURL = () => "";
        return realCanvas;
      }
      return origCreateElement(tag, options);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Player / game-state mock builders
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

function createMockPlayerView(region: PlayerRegion, color: Colord): PlayerView {
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
    specialBuildingColor: (pv: any) =>
      ((pv as any)._color ?? colord("#888888")).lighten(0.2),
    terrainColor: () => colord("#558b2f"),
    backgroundColor: () => colord("#1a1a2e"),
    font: () => "sans-serif",
    textColor: () => "#ffffff",
    teamColor: () => colord("#ffffff"),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Unit spawning helpers
// ═══════════════════════════════════════════════════════════════════════════

let nextUnitId = 1;

export function resetUnitIdCounter() {
  nextUnitId = 1;
}

/**
 * Create a mock unit at a random ocean-ish tile for the given player.
 * We use the bottom half of the map as "ocean" conceptually.
 */
export function spawnUnit(
  state: MockGameState,
  unitType: UnitType,
  ownerSmallID: number,
  opts: Partial<MockUnit> = {},
): MockUnit {
  const id = nextUnitId++;
  // Place units in ocean area (bottom half conceptually)
  const oceanStart = Math.floor(TOTAL_TILES * 0.5);
  const pos =
    opts.pos ??
    oceanStart + Math.floor(Math.random() * (TOTAL_TILES - oceanStart));
  const unit: MockUnit = {
    id,
    unitType,
    ownerSmallID,
    pos,
    lastPos: opts.lastPos ?? pos,
    isActive: opts.isActive ?? true,
    health: opts.health ?? 100,
    maxHealth: opts.maxHealth ?? 100,
    level: opts.level ?? 1,
    targetUnitId: opts.targetUnitId,
    targetTile: opts.targetTile,
    isAttacking: opts.isAttacking ?? false,
    isDetectedByNavalUnit: opts.isDetectedByNavalUnit ?? false,
    isCooldown: opts.isCooldown ?? false,
    targetable: opts.targetable ?? true,
    returning: opts.returning ?? false,
    retreating: opts.retreating ?? false,
    reachedTarget: opts.reachedTarget ?? false,
    troops: opts.troops ?? 10,
  };
  state.units.set(id, unit);
  return unit;
}

/**
 * Spawn N units of a given type evenly across all players.
 */
export function spawnUnitsEvenly(
  state: MockGameState,
  unitType: UnitType,
  count: number,
  opts: Partial<MockUnit> = {},
): MockUnit[] {
  const spawned: MockUnit[] = [];
  for (let i = 0; i < count; i++) {
    const ownerIdx = i % state.regions.length;
    spawned.push(
      spawnUnit(state, unitType, state.regions[ownerIdx].smallID, opts),
    );
  }
  return spawned;
}

/**
 * Simulate unit movement: shift each unit's position by a small random delta,
 * recording lastPos. Returns the unit IDs that moved (for update list).
 */
export function simulateUnitMovement(
  state: MockGameState,
  unitIds?: number[],
): UnitUpdate[] {
  const updates: UnitUpdate[] = [];
  const idsToMove = unitIds ?? [...state.units.keys()];

  for (const id of idsToMove) {
    const unit = state.units.get(id);
    if (!unit || !unit.isActive) continue;

    // Move 1-3 tiles in a random direction
    const oldPos = unit.pos;
    const x = oldPos % MAP_WIDTH;
    const y = Math.floor(oldPos / MAP_WIDTH);
    const dx = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
    const dy = Math.floor(Math.random() * 3) - 1;
    const nx = Math.max(0, Math.min(MAP_WIDTH - 1, x + dx));
    const ny = Math.max(0, Math.min(MAP_HEIGHT - 1, y + dy));
    const newPos = ny * MAP_WIDTH + nx;

    unit.lastPos = oldPos;
    unit.pos = newPos;

    updates.push(mockUnitToUpdate(unit));
  }

  return updates;
}

/**
 * Convert a MockUnit to a UnitUpdate wire-format object.
 */
export function mockUnitToUpdate(unit: MockUnit): UnitUpdate {
  return {
    type: GameUpdateType.Unit,
    unitType: unit.unitType,
    id: unit.id,
    ownerID: unit.ownerSmallID,
    pos: unit.pos,
    lastPos: unit.lastPos,
    isActive: unit.isActive,
    health: unit.health,
    maxHealth: unit.maxHealth,
    level: unit.level,
    targetUnitId: unit.targetUnitId,
    targetTile: unit.targetTile,
    isAttacking: unit.isAttacking,
    isDetectedByNavalUnit: unit.isDetectedByNavalUnit,
    targetable: unit.targetable,
    returning: unit.returning,
    retreating: unit.retreating,
    reachedTarget: unit.reachedTarget,
    troops: unit.troops,
  };
}

/**
 * Deactivate N randomly-selected units (simulate destruction).
 */
export function deactivateUnits(
  state: MockGameState,
  count: number,
): UnitUpdate[] {
  const activeIds = [...state.units.values()]
    .filter((u) => u.isActive)
    .map((u) => u.id);
  const toKill = activeIds.slice(0, Math.min(count, activeIds.length));
  const updates: UnitUpdate[] = [];

  for (const id of toKill) {
    const unit = state.units.get(id)!;
    unit.isActive = false;
    updates.push(mockUnitToUpdate(unit));
  }

  return updates;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock UnitView wrapping MockUnit  (lightweight proxy for GameView)
// ═══════════════════════════════════════════════════════════════════════════

function createMockUnitView(
  unit: MockUnit,
  playersBySmallID: Map<number, PlayerView>,
): UnitView {
  const owner = playersBySmallID.get(unit.ownerSmallID)!;
  return {
    id: () => unit.id,
    type: () => unit.unitType,
    tile: () => unit.pos,
    lastTile: () => unit.lastPos,
    lastTiles: () => [unit.lastPos],
    owner: () => owner,
    isActive: () => unit.isActive,
    health: () => unit.health,
    effectiveMaxHealth: () => unit.maxHealth,
    level: () => unit.level,
    targetUnitId: () => unit.targetUnitId,
    targetTile: () => unit.targetTile,
    isAttacking: () => unit.isAttacking,
    isDetectedByNavalUnit: () => unit.isDetectedByNavalUnit,
    isCooldown: () => unit.isCooldown,
    targetable: () => unit.targetable,
    returning: () => unit.returning,
    retreating: () => unit.retreating,
    reachedTarget: () => unit.reachedTarget,
    troops: () => unit.troops,
    wasUpdated: () => true,
    _wasUpdated: true,
    lastPos: [unit.lastPos],
    hasHealth: () => true,
    info: () => ({ cost: () => 0, territoryBound: false }),
    constructionType: () => undefined,
    constructionTargetLevel: () => 1,
    ticksLeftInCooldown: () => undefined,
    cooldownEndsAt: () => undefined,
    cooldownDuration: () => undefined,
    stackCount: () => 1,
    launchesRemaining: () => null,
    bomberLevel: () => 1,
    tradeRouteStartOwner: () => null,
    tradeRouteEndOwner: () => null,
    tradePhase: () => null,
    dockedAtPortOwner: () => null,
    targetedBySAM: () => false,
    update: () => {},
  } as unknown as UnitView;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock GameView (with full unit support)
// ═══════════════════════════════════════════════════════════════════════════

export function createMockGameView(state: MockGameState): GameView {
  const theme = createMockTheme();

  const playersBySmallID = new Map<number, PlayerView>();
  const playersById = new Map<string, PlayerView>();
  for (const p of state.players) {
    playersBySmallID.set(p.smallID(), p);
    playersById.set(p.id(), p);
  }

  // Build UnitView wrappers that stay synced with MockUnit
  const unitViewCache = new Map<number, UnitView>();
  function getUnitView(id: number): UnitView | undefined {
    const mu = state.units.get(id);
    if (!mu) return undefined;
    let uv = unitViewCache.get(id);
    if (!uv) {
      uv = createMockUnitView(mu, playersBySmallID);
      unitViewCache.set(id, uv);
    }
    return uv;
  }

  function allActiveUnits(...types: UnitType[]): UnitView[] {
    const result: UnitView[] = [];
    for (const mu of state.units.values()) {
      if (!mu.isActive) continue;
      if (types.length > 0 && !types.includes(mu.unitType)) continue;
      const uv = getUnitView(mu.id);
      if (uv) result.push(uv);
    }
    return result;
  }

  const game: Partial<GameView> = {
    width: () => MAP_WIDTH,
    height: () => MAP_HEIGHT,
    config: () =>
      ({
        theme: () => theme,
        serverConfig: () => ({
          turnIntervalMs: () => 100,
        }),
        defensePostRange: () => 3,
        unitInfo: () => ({ cost: () => 0, territoryBound: false }),
      }) as any,
    ref: (x: number, y: number) => y * MAP_WIDTH + x,
    x: (t: TileRef) => t % MAP_WIDTH,
    y: (t: TileRef) => Math.floor(t / MAP_WIDTH),
    cell: (t: TileRef) => new Cell(t % MAP_WIDTH, Math.floor(t / MAP_WIDTH)),
    isValidCoord: (x: number, y: number) =>
      x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT,
    isValidRef: (ref: TileRef) => ref >= 0 && ref < TOTAL_TILES,
    hasOwner: (t: TileRef) => state.ownerMap[t] !== -1,
    ownerID: (t: TileRef) => state.ownerMap[t],
    owner: (t: TileRef) => {
      const sid = state.ownerMap[t];
      if (sid === -1) return { isPlayer: () => false } as any;
      return playersBySmallID.get(sid) ?? ({ isPlayer: () => false } as any);
    },
    isOcean: (t: TileRef) => t >= Math.floor(TOTAL_TILES * 0.5),
    isLand: (t: TileRef) => t < Math.floor(TOTAL_TILES * 0.5),
    isBorder: () => false,
    hasFallout: () => false,
    neighbors: (t: TileRef) => {
      const x = t % MAP_WIDTH;
      const y = Math.floor(t / MAP_WIDTH);
      const result: number[] = [];
      if (x > 0) result.push(t - 1);
      if (x < MAP_WIDTH - 1) result.push(t + 1);
      if (y > 0) result.push(t - MAP_WIDTH);
      if (y < MAP_HEIGHT - 1) result.push(t + MAP_WIDTH);
      return new Uint32Array(result);
    },
    forEachTile: (fn: (t: TileRef) => void) => {
      for (let t = 0; t < TOTAL_TILES; t++) fn(t);
    },
    ticks: () => state.currentTick,
    inSpawnPhase: () => false,
    myPlayer: () => state.players[0] ?? null,
    focusedPlayer: () => state.players[0] ?? null,
    playerViews: () => state.players,
    playerBySmallID: (id: number) =>
      playersBySmallID.get(id) ?? ({ isPlayer: () => false } as any),
    hasUnitNearby: () => false,
    manhattanDist: (c1: TileRef, c2: TileRef) => {
      const x1 = c1 % MAP_WIDTH,
        y1 = Math.floor(c1 / MAP_WIDTH);
      const x2 = c2 % MAP_WIDTH,
        y2 = Math.floor(c2 / MAP_WIDTH);
      return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    },
    euclideanDistSquared: (c1: TileRef, c2: TileRef) => {
      const x1 = c1 % MAP_WIDTH,
        y1 = Math.floor(c1 / MAP_WIDTH);
      const x2 = c2 % MAP_WIDTH,
        y2 = Math.floor(c2 / MAP_WIDTH);
      return (x1 - x2) ** 2 + (y1 - y2) ** 2;
    },
    units: (...types: UnitType[]) => allActiveUnits(...types),
    unit: (id: number) => getUnitView(id),
    unitInfo: () => ({ cost: () => 0, territoryBound: false }) as any,
    recentlyUpdatedTiles: () => [],
    updatesSinceLastTick: () => {
      const updates: any = {};
      for (const key of Object.values(GameUpdateType)) {
        if (typeof key === "number") updates[key] = [];
      }
      updates[GameUpdateType.Unit] = state.recentUnitUpdates;
      return updates;
    },
    submarineGhosts: () => [],
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
    scale: 1.5,
    screenToWorldCoordinates: (sx: number, sy: number) => ({ x: sx, y: sy }),
    worldToScreenCoordinates: (cell: any) => ({
      x: (cell.x ?? 0) * 1.5,
      y: (cell.y ?? 0) * 1.5,
    }),
  } as unknown as TransformHandler;
}

export function createMockUIState(): UIState {
  return {
    attackRatio: 0.5,
    investmentRate: 0.2,
    pendingBuildUnitType: null,
    multibuildEnabled: false,
    upgradeMode: false,
    unitLevels: {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Fresh state builder
// ═══════════════════════════════════════════════════════════════════════════

export function freshState(): MockGameState {
  resetUnitIdCounter();
  const regions = buildPlayerRegions();
  const players = regions.map((r, i) =>
    createMockPlayerView(r, PLAYER_COLORS[i]),
  );
  const ownerMap = buildOwnerMap(regions);
  return {
    ownerMap,
    regions,
    players,
    units: new Map(),
    recentUnitUpdates: [],
    currentTick: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Unit mix presets (realistic game scenarios)
// ═══════════════════════════════════════════════════════════════════════════

export interface UnitMix {
  name: string;
  composition: [UnitType, number][]; // [type, count] pairs
}

export const UNIT_MIXES: Record<string, UnitMix> = {
  /** Typical mid-game: lots of warships, some fighters and trade ships */
  midGame: {
    name: "Mid-game (200 units)",
    composition: [
      [UnitType.Warship, 60],
      [UnitType.FighterJet, 40],
      [UnitType.TradeShip, 30],
      [UnitType.TransportShip, 25],
      [UnitType.Submarine, 20],
      [UnitType.Bomber, 15],
      [UnitType.Shell, 10],
    ],
  },
  /** Heavy naval battle: lots of warships and submarines */
  navalBattle: {
    name: "Naval battle (300 units)",
    composition: [
      [UnitType.Warship, 120],
      [UnitType.Submarine, 60],
      [UnitType.TradeShip, 40],
      [UnitType.Shell, 40],
      [UnitType.FighterJet, 30],
      [UnitType.Bomber, 10],
    ],
  },
  /** Air superiority: many fighters and bombers */
  airWar: {
    name: "Air war (250 units)",
    composition: [
      [UnitType.FighterJet, 100],
      [UnitType.Bomber, 60],
      [UnitType.SAMMissile, 30],
      [UnitType.Warship, 30],
      [UnitType.TradeShip, 20],
      [UnitType.CargoPlane, 10],
    ],
  },
  /** Stress test: maximum unit count */
  stress: {
    name: "Stress test (500 units)",
    composition: [
      [UnitType.Warship, 150],
      [UnitType.FighterJet, 100],
      [UnitType.TradeShip, 80],
      [UnitType.Submarine, 60],
      [UnitType.Shell, 50],
      [UnitType.Bomber, 30],
      [UnitType.TransportShip, 20],
      [UnitType.SAMMissile, 10],
    ],
  },
  /** Minimal: just a few units for baseline */
  minimal: {
    name: "Minimal (20 units)",
    composition: [
      [UnitType.Warship, 8],
      [UnitType.FighterJet, 4],
      [UnitType.TradeShip, 4],
      [UnitType.Submarine, 4],
    ],
  },
};

/**
 * Spawn all units from a UnitMix into the state.
 */
export function spawnMix(state: MockGameState, mix: UnitMix): MockUnit[] {
  const allUnits: MockUnit[] = [];
  for (const [type, count] of mix.composition) {
    allUnits.push(...spawnUnitsEvenly(state, type, count));
  }
  return allUnits;
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
    drawImageCalls: 0,
    fillRectCalls: 0,
    clearRectCalls: 0,
    saveRestoreCycles: 0,
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
      totalGpu.drawImageCalls += ctx.gpuCounters.drawImageCalls;
      totalGpu.fillRectCalls += ctx.gpuCounters.fillRectCalls;
      totalGpu.clearRectCalls += ctx.gpuCounters.clearRectCalls;
      totalGpu.saveRestoreCycles += ctx.gpuCounters.saveRestoreCycles;
    }
  }

  return computeStats(label, timings, totalGpu);
}

// ═══════════════════════════════════════════════════════════════════════════
// Public: run the full benchmark suite for any Layer implementation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registers a Jest `describe` block with benchmark scenarios for the given
 * Layer implementation. Call this from a `*.test.ts` file.
 *
 * @param suiteName  Label for the describe block (e.g. "UnitLayer")
 * @param factory    Creates the Layer under test from mock dependencies.
 * @param options    Optional: warmup/iteration counts, which mixes to run,
 *                   custom mixes to add.
 */
export function runUnitBenchSuite(
  suiteName: string,
  factory: UnitLayerFactory,
  options: {
    warmup?: number;
    iterations?: number;
    /** Which preset mixes to benchmark (default: all) */
    mixes?: string[];
    /** Additional custom mixes to benchmark */
    customMixes?: UnitMix[];
  } = {},
) {
  const WARMUP = options.warmup ?? 3;
  const ITERATIONS = options.iterations ?? 10;

  // Resolve which mixes to run
  const mixKeys = options.mixes ?? Object.keys(UNIT_MIXES);
  const mixesToRun: UnitMix[] = mixKeys
    .filter((k) => UNIT_MIXES[k])
    .map((k) => UNIT_MIXES[k]);
  if (options.customMixes) {
    mixesToRun.push(...options.customMixes);
  }

  describe(suiteName, () => {
    const allResults: BenchmarkResult[] = [];

    afterAll(() => {
      // Print comparison table
      console.log(
        `\n╔══════════════════════════════════════════════════════════════════════════╗`,
      );
      console.log(`║  ${suiteName.padEnd(70)}  ║`);
      console.log(
        `╚══════════════════════════════════════════════════════════════════════════╝\n`,
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
          drawImage: r.drawImageCalls,
          fillRect: r.fillRectCalls,
          clearRect: r.clearRectCalls,
          "save/restore": r.saveRestoreCycles,
        })),
      );
    });

    // ── helpers ──

    function makeLayer(
      state: MockGameState,
      gpuCounters: GpuCounters,
    ): BenchCtx {
      installCanvasMock(MAP_WIDTH, MAP_HEIGHT, gpuCounters);
      const gameView = createMockGameView(state);
      const eventBus = createMockEventBus();
      const transformHandler = createMockTransformHandler();
      const uiState = createMockUIState();
      const layer = factory(gameView, eventBus, transformHandler, uiState);
      const renderCtx = createInstrumentedContext(
        MAP_WIDTH,
        MAP_HEIGHT,
        gpuCounters,
      );
      return { layer, renderCtx, gpuCounters, state };
    }

    function newGpuCounters(): GpuCounters {
      return {
        drawImageCalls: 0,
        fillRectCalls: 0,
        clearRectCalls: 0,
        saveRestoreCycles: 0,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Scenario 1: Full redraw (baseline per mix)
    // ═══════════════════════════════════════════════════════════════════════

    for (const mix of mixesToRun) {
      const totalUnits = mix.composition.reduce((s, [, c]) => s + c, 0);

      it(`S1: Full redraw — ${mix.name}`, () => {
        const result = runBenchmark(
          `1. Full redraw: ${mix.name}`,
          WARMUP,
          ITERATIONS,
          () => {
            const state = freshState();
            spawnMix(state, mix);
            // Put all units in the update list so redraw picks them up
            state.recentUnitUpdates = [...state.units.values()].map(
              mockUnitToUpdate,
            );
            return makeLayer(state, newGpuCounters());
          },
          ({ layer }) => {
            layer.redraw!();
          },
        );
        allResults.push(result);
        expect(result.meanMs).toBeDefined();
      });

      // ═════════════════════════════════════════════════════════════════════
      // Scenario 2: tick() + renderLayer() with all units moving
      // ═════════════════════════════════════════════════════════════════════

      it(`S2: tick+render (all moving) — ${mix.name}`, () => {
        const result = runBenchmark(
          `2. tick+render (moving): ${mix.name}`,
          WARMUP,
          ITERATIONS,
          () => {
            const state = freshState();
            spawnMix(state, mix);
            state.recentUnitUpdates = [...state.units.values()].map(
              mockUnitToUpdate,
            );
            const ctx = makeLayer(state, newGpuCounters());
            ctx.layer.init?.();
            ctx.layer.redraw!();
            resetGpuCounters(ctx.gpuCounters);

            // Simulate movement for all units
            state.recentUnitUpdates = simulateUnitMovement(state);
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

      // ═════════════════════════════════════════════════════════════════════
      // Scenario 3: tick() only (no render) — measure update processing cost
      // ═════════════════════════════════════════════════════════════════════

      it(`S3: tick() only — ${mix.name}`, () => {
        const result = runBenchmark(
          `3. tick() only: ${mix.name}`,
          WARMUP,
          ITERATIONS,
          () => {
            const state = freshState();
            spawnMix(state, mix);
            state.recentUnitUpdates = [...state.units.values()].map(
              mockUnitToUpdate,
            );
            const ctx = makeLayer(state, newGpuCounters());
            ctx.layer.init?.();
            ctx.layer.redraw!();
            resetGpuCounters(ctx.gpuCounters);

            state.recentUnitUpdates = simulateUnitMovement(state);
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

      // ═════════════════════════════════════════════════════════════════════
      // Scenario 4: renderLayer() only — measure pure rendering cost
      // ═════════════════════════════════════════════════════════════════════

      it(`S4: renderLayer() only — ${mix.name}`, () => {
        const result = runBenchmark(
          `4. renderLayer() only: ${mix.name}`,
          WARMUP,
          ITERATIONS,
          () => {
            const state = freshState();
            spawnMix(state, mix);
            state.recentUnitUpdates = [...state.units.values()].map(
              mockUnitToUpdate,
            );
            const ctx = makeLayer(state, newGpuCounters());
            ctx.layer.init?.();
            ctx.layer.redraw!();

            // Move units, tick, then measure only renderLayer
            state.recentUnitUpdates = simulateUnitMovement(state);
            state.currentTick++;
            ctx.layer.tick!();

            // Reset counters for pure render measurement
            resetGpuCounters(ctx.gpuCounters);
            state.recentUnitUpdates = [];
            return ctx;
          },
          ({ layer, renderCtx }) => {
            layer.renderLayer!(renderCtx);
          },
        );
        allResults.push(result);
        expect(result.meanMs).toBeDefined();
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Scenario 5: Sustained ticks — 50 ticks of movement (mid-game mix)
    // ═══════════════════════════════════════════════════════════════════════

    it("S5: Sustained 50 ticks — Mid-game mix", () => {
      const NUM_TICKS = 50;

      const result = runBenchmark(
        "5. Sustained 50 ticks (mid-game)",
        WARMUP,
        ITERATIONS,
        () => {
          const state = freshState();
          spawnMix(state, UNIT_MIXES.midGame);
          state.recentUnitUpdates = [...state.units.values()].map(
            mockUnitToUpdate,
          );
          const ctx = makeLayer(state, newGpuCounters());
          ctx.layer.init?.();
          ctx.layer.redraw!();
          resetGpuCounters(ctx.gpuCounters);
          return ctx;
        },
        ({ layer, renderCtx, state }) => {
          for (let tick = 0; tick < NUM_TICKS; tick++) {
            state.recentUnitUpdates = simulateUnitMovement(state);
            state.currentTick++;
            layer.tick!();
            layer.renderLayer!(renderCtx);
          }
        },
      );
      allResults.push(result);
      expect(result.meanMs).toBeDefined();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Scenario 6: Unit churn — spawn + destroy units each tick
    // ═══════════════════════════════════════════════════════════════════════

    it("S6: Unit churn (spawn+destroy per tick)", () => {
      const NUM_TICKS = 30;
      const SPAWN_PER_TICK = 10;
      const KILL_PER_TICK = 8;

      const result = runBenchmark(
        "6. Unit churn (30 ticks, +10/-8 per tick)",
        WARMUP,
        ITERATIONS,
        () => {
          const state = freshState();
          spawnMix(state, UNIT_MIXES.midGame);
          state.recentUnitUpdates = [...state.units.values()].map(
            mockUnitToUpdate,
          );
          const ctx = makeLayer(state, newGpuCounters());
          ctx.layer.init?.();
          ctx.layer.redraw!();
          resetGpuCounters(ctx.gpuCounters);
          return ctx;
        },
        ({ layer, renderCtx, state }) => {
          for (let tick = 0; tick < NUM_TICKS; tick++) {
            // Destroy some units
            const killUpdates = deactivateUnits(state, KILL_PER_TICK);

            // Spawn new ones
            const newUnits: MockUnit[] = [];
            for (let s = 0; s < SPAWN_PER_TICK; s++) {
              const types: UnitType[] = [
                UnitType.Warship,
                UnitType.FighterJet,
                UnitType.TradeShip,
              ];
              const t = types[s % types.length];
              const ownerIdx = s % state.regions.length;
              newUnits.push(
                spawnUnit(state, t, state.regions[ownerIdx].smallID),
              );
            }
            const spawnUpdates = newUnits.map(mockUnitToUpdate);

            // Move remaining active units
            const moveUpdates = simulateUnitMovement(state);

            state.recentUnitUpdates = [
              ...killUpdates,
              ...spawnUpdates,
              ...moveUpdates,
            ];
            state.currentTick++;
            layer.tick!();
            layer.renderLayer!(renderCtx);
          }
        },
      );
      allResults.push(result);
      expect(result.meanMs).toBeDefined();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Scenario 7: Mixed levels — units with varying upgrade levels
    // ═══════════════════════════════════════════════════════════════════════

    it("S7: Mixed levels (level 1-4 units)", () => {
      const result = runBenchmark(
        "7. Mixed levels (200 units, L1-L4)",
        WARMUP,
        ITERATIONS,
        () => {
          const state = freshState();
          // Spawn units with varying levels
          for (let i = 0; i < 50; i++) {
            const level = (i % 4) + 1;
            spawnUnit(state, UnitType.Warship, state.regions[i % 4].smallID, {
              level,
            });
          }
          for (let i = 0; i < 50; i++) {
            const level = (i % 4) + 1;
            spawnUnit(
              state,
              UnitType.FighterJet,
              state.regions[i % 4].smallID,
              { level },
            );
          }
          for (let i = 0; i < 50; i++) {
            const level = (i % 4) + 1;
            spawnUnit(state, UnitType.Submarine, state.regions[i % 4].smallID, {
              level,
            });
          }
          for (let i = 0; i < 50; i++) {
            spawnUnit(state, UnitType.TradeShip, state.regions[i % 4].smallID);
          }

          state.recentUnitUpdates = [...state.units.values()].map(
            mockUnitToUpdate,
          );
          const ctx = makeLayer(state, newGpuCounters());
          ctx.layer.init?.();
          ctx.layer.redraw!();
          resetGpuCounters(ctx.gpuCounters);

          state.recentUnitUpdates = simulateUnitMovement(state);
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

    // ═══════════════════════════════════════════════════════════════════════
    // Scenario 8: Targeting units (with attack markers / texture swaps)
    // ═══════════════════════════════════════════════════════════════════════

    it("S8: Targeting (attack markers)", () => {
      const result = runBenchmark(
        "8. Targeting (100 attacking units)",
        WARMUP,
        ITERATIONS,
        () => {
          const state = freshState();
          // Spawn warships and fighters that are attacking
          for (let i = 0; i < 50; i++) {
            const u = spawnUnit(
              state,
              UnitType.Warship,
              state.regions[i % 4].smallID,
              {
                isAttacking: true,
                targetUnitId: 9999,
              },
            );
          }
          for (let i = 0; i < 50; i++) {
            spawnUnit(
              state,
              UnitType.FighterJet,
              state.regions[i % 4].smallID,
              {
                isAttacking: true,
                targetUnitId: 9999,
              },
            );
          }
          // Add some non-attacking units too
          spawnUnitsEvenly(state, UnitType.TradeShip, 40);
          spawnUnitsEvenly(state, UnitType.Submarine, 20);

          state.recentUnitUpdates = [...state.units.values()].map(
            mockUnitToUpdate,
          );
          const ctx = makeLayer(state, newGpuCounters());
          ctx.layer.init?.();
          ctx.layer.redraw!();
          resetGpuCounters(ctx.gpuCounters);

          state.recentUnitUpdates = simulateUnitMovement(state);
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
  });
}
