/**
 * UnitLayerV2 — Performance-optimized fork of UnitLayer
 * =====================================================
 *
 * Key optimizations vs V1:
 *
 * 1. **Set for interpolatedUnitTypes** — O(1) `.has()` vs O(n) `.includes()`
 *    on the hot `drawingBasePass` check and `updateInterpolatedUnits` filter.
 *
 * 2. **Map<number, UnitRenderInfo> for PIXI units** — O(1) add / remove / lookup
 *    instead of `findIndex` + `splice` (O(n) per removal → O(n²) for batch).
 *
 * 3. **Cached tick-alpha per frame** — `computeTickAlpha()` evaluated once in
 *    `renderLayer`, stored in `_frameAlpha`, reused by every interpolated unit
 *    and PIXI sprite update.
 *
 * 4. **Reusable point for worldToScreen** — one `_tmpPoint` object reused across
 *    all coordinate conversions instead of allocating `new Cell(...)` per unit
 *    per frame (300+ allocations → 0).
 *
 * 5. **Cached colored images** — `getImageColored()` results keyed by
 *    image.src + color string, avoiding repeated canvas allocation and
 *    composite draw for the same icon/color pair.
 *
 * 6. **Airfield tile Set per tick** — built once per `tick()`, used for O(1)
 *    bomber-at-airfield checks instead of linear scan of all Airfield units
 *    per bomber.
 *
 * 7. **No getBounds() in renderPixiUnits** — viewport culling uses the
 *    already-computed screen position + fixed icon radius instead of the
 *    expensive PIXI `getBounds()` traversal.
 *
 * 8. **Canvas reuse in redraw()** — existing canvases are cleared rather
 *    than reallocated (avoids DOM node creation + GC).
 *
 * 9. **Bitwise pixel-snap** — `(v + 0.5) | 0` replaces `Math.floor(v + 0.5)`
 *    and `Math.round(v)` in the inner render loop.
 *
 * 10. **Eliminated redundant angle computation** — `getUnitAngle` short-circuits
 *     immediately for non-aircraft via a static Set.
 */

import type { Colord } from "colord";
import { colord } from "colord";
import * as PIXI from "pixi.js";
import type { EventBus } from "../../../core/EventBus";
import type { Theme } from "../../../core/configuration/Config";
import { Cell, UnitType } from "../../../core/game/Game";
import type { TileRef } from "../../../core/game/GameMap";
import type { GameView, UnitView } from "../../../core/game/GameView";
import { BezenhamLine } from "../../../core/utilities/Line";
import {
  AlternateViewEvent,
  MouseUpEvent,
  ReplaySpeedChangeEvent,
  UnitSelectionEvent,
} from "../../InputHandler";
import {
  ArtilleryOutOfRangeEvent,
  MoveArtilleryIntentEvent,
  MoveFighterJetIntentEvent,
  MoveSubmarineIntentEvent,
  MoveWarshipIntentEvent,
} from "../../Transport";
import { PerformanceMetrics } from "../../utilities/PerformanceMetrics";
import type { ReplaySpeedMultiplier } from "../../utilities/ReplaySpeedMultiplier";
import { defaultReplaySpeedMultiplier } from "../../utilities/ReplaySpeedMultiplier";
import type { TransformHandler } from "../TransformHandler";
import type { UIState } from "../UIState";
import type { Layer } from "./Layer";

import { GameUpdateType } from "../../../core/game/GameUpdates";
import { getArtilleryMaxDistance } from "../../../core/game/UnitUpgrades";
import {
  getColoredSprite,
  isSpriteReady,
  loadAllSprites,
} from "../SpriteLoader";

// PIXI unit icons
import bomberSprite from "../../../../proprietary/images/bomberv3.png";
import tradeShipIcon from "../../../../proprietary/images/tradeship.png";
import warshipIcon from "../../../../resources/images/BattleshipIconWhite.svg";
import fighterJetIcon from "../../../../resources/images/FighterJetIcon.svg";
import submarineIcon from "../../../../resources/images/submarine.svg";

// ── constants ──────────────────────────────────────────────────────────────
const ICON_TEXTURE_QUALITY = 4;
const ICON_DIM = 28;
const ICON_GROW_ZOOM_THRESHOLD = 2;
const SIZE_SCALE = 0.8;

// ── static lookup sets (allocated once, never mutated) ─────────────────────

/** Units rendered via the PIXI/WebGL pipeline. */
const PIXI_UNIT_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.Warship,
  UnitType.Submarine,
  UnitType.Bomber,
  UnitType.FighterJet,
  UnitType.TradeShip,
  UnitType.Shell,
]);

/** All unit types processed by this layer (excludes structures). */
const UNIT_LAYER_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.TransportShip,
  UnitType.Paratrooper,
  UnitType.Submarine,
  UnitType.Warship,
  UnitType.Shell,
  UnitType.SAMMissile,
  UnitType.TradeShip,
  UnitType.MIRVWarhead,
  UnitType.Bomber,
  UnitType.FighterJet,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
]);

/**
 * OPT 1 — Set for O(1) membership test (was Array.includes → O(n)).
 * Checked on every unit in the hot drawUnitsCells base-pass guard and
 * every unit in updateInterpolatedUnits.
 */
const INTERPOLATED_UNIT_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.SAMMissile,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.MIRVWarhead,
  UnitType.Shell,
  UnitType.Warship,
  UnitType.TransportShip,
  UnitType.TradeShip,
  UnitType.Submarine,
  UnitType.Bomber,
  UnitType.FighterJet,
]);

/** Array form of the same set, for passing to game.units(). */
const INTERPOLATED_UNIT_TYPES_ARRAY: UnitType[] = [...INTERPOLATED_UNIT_TYPES];

/**
 * OPT 10 — Only these types can produce a non-null angle. Short-circuit
 * immediately for everything else (avoids lastTile/tile lookups + Math.atan2).
 */
const ROTATABLE_UNIT_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.Bomber,
  UnitType.FighterJet,
]);

/** Units that use horizontal flip instead of rotation. */
const FLIP_UNIT_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.Warship,
  UnitType.Submarine,
  UnitType.TradeShip,
]);

// ── PIXI render info ──────────────────────────────────────────────────────

class UnitRenderInfo {
  constructor(
    public unit: UnitView,
    public pixiSprite: PIXI.Sprite,
    public lastAngle: number = 0,
    public facingLeft: boolean = false,
  ) {}
}

class GhostRenderInfo {
  constructor(
    public ghostId: number,
    public position: { x: number; y: number },
    public pixiSprite: PIXI.Sprite,
  ) {}
}

enum Relationship {
  Self,
  Ally,
  Enemy,
}

// ═══════════════════════════════════════════════════════════════════════════
// UnitLayerV2
// ═══════════════════════════════════════════════════════════════════════════

export class UnitLayerV2 implements Layer {
  layerName = "UnitLayerV2";

  // ── canvases ──
  private canvas!: HTMLCanvasElement;
  private context!: CanvasRenderingContext2D;
  private transportShipTrailCanvas!: HTMLCanvasElement;
  private unitTrailContext!: CanvasRenderingContext2D;
  private interpolationCanvas!: HTMLCanvasElement;
  private interpolationContext!: CanvasRenderingContext2D;
  /** OPT 8 — track whether canvases have been allocated so `redraw()` can reuse. */
  private canvasesAllocated = false;

  private unitToTrail = new Map<UnitView, TileRef[]>();
  private unitToLastAngle = new Map<UnitView, number>();
  private theme: Theme;
  private alternateView = false;
  private oldShellTile = new Map<UnitView, TileRef>();
  private transformHandler: TransformHandler;
  private selectedUnit: UnitView | null = null;

  private readonly WARSHIP_SELECTION_RADIUS = 10;
  private readonly SUBMARINE_SELECTION_RADIUS = 10;
  private readonly FIGHTER_JET_SELECTION_RADIUS = 10;

  private drawingBasePass = false;

  private baseTickIntervalMs = 100;
  private tickIntervalMs = 100;
  private replaySpeedMultiplier: ReplaySpeedMultiplier =
    defaultReplaySpeedMultiplier;
  private lastTickTimestamp = 0;

  private spriteSizeCache = new Map<UnitType, number>();
  private renderedGhosts = new Map<number, TileRef>();

  // ── PIXI infra ──

  private pixiCanvas!: HTMLCanvasElement;
  private pixiStage!: PIXI.Container;
  private pixiRenderer!: PIXI.Renderer;

  /**
   * OPT 2 — Map keyed by unit ID for O(1) lookup & removal.
   * Was: UnitRenderInfo[] with findIndex O(n) per removal.
   */
  private pixiRenderMap = new Map<number, UnitRenderInfo>();
  private textureCache = new Map<string, PIXI.Texture>();
  private targetingTextureCache = new Map<string, PIXI.Texture>();
  private starTextureCache = new Map<number, PIXI.Texture>();

  private warshipIconImage: HTMLImageElement | null = null;
  private submarineIconImage: HTMLImageElement | null = null;
  private fighterJetIconImage: HTMLImageElement | null = null;
  private bomberIconImage: HTMLImageElement | null = null;
  private tradeShipIconImage: HTMLImageElement | null = null;

  private ghostRenders: GhostRenderInfo[] = [];
  private renderedUnits = new Map<number, UnitView>();

  /** OPT 6 — Set of airfield tiles per ownerSmallID, rebuilt once per tick. */
  private airfieldTilesByOwner = new Map<number, Set<TileRef>>();

  /**
   * OPT 5 — Cache for `getImageColored()` results.
   * Key: `${image.src}|${colorString}`.
   */
  private coloredImageCache = new Map<string, HTMLCanvasElement>();

  /**
   * OPT 3 — Per-frame cached alpha, computed once in `renderLayer`
   * and consumed by all downstream interpolation.
   */
  private _frameAlpha = 0;

  /**
   * OPT 4 — Single mutable point reused for all worldToScreen conversions
   * in a frame. Eliminates hundreds of `new Cell(x,y)` allocations per
   * render call.  We use a plain `{x,y}` because Cell.x/y are readonly.
   */
  private _tmpPoint: { x: number; y: number } = { x: 0, y: 0 };

  // ────────────────────────────────────────────────────────────────────────
  // Constructor
  // ────────────────────────────────────────────────────────────────────────

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    transformHandler: TransformHandler,
    private uiState: UIState,
  ) {
    this.theme = game.config().theme();
    this.transformHandler = transformHandler;
    this.baseTickIntervalMs = this.game
      .config()
      .serverConfig()
      .turnIntervalMs();
    this.updateTickInterval();
    this.lastTickTimestamp = this.now();
    this.loadPixiIcons();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Icon loading (unchanged — runs once)
  // ────────────────────────────────────────────────────────────────────────

  private loadPixiIcons() {
    const load = (
      src: string,
      cb: (img: HTMLImageElement) => void,
      unitType: UnitType,
    ) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        cb(img);
        this.clearTextureCache(unitType);
      };
    };
    load(warshipIcon, (i) => (this.warshipIconImage = i), UnitType.Warship);
    load(
      submarineIcon,
      (i) => (this.submarineIconImage = i),
      UnitType.Submarine,
    );
    load(
      fighterJetIcon,
      (i) => (this.fighterJetIconImage = i),
      UnitType.FighterJet,
    );
    load(bomberSprite, (i) => (this.bomberIconImage = i), UnitType.Bomber);
    load(
      tradeShipIcon,
      (i) => (this.tradeShipIconImage = i),
      UnitType.TradeShip,
    );
  }

  private clearTextureCache(unitType: UnitType) {
    const tag = unitType.toString();
    for (const key of this.textureCache.keys()) {
      if (key.includes(tag)) {
        this.textureCache.delete(key);
        this.targetingTextureCache.delete(key);
      }
    }
    // Also bust colored image cache for this type
    this.coloredImageCache.clear();
  }

  // ────────────────────────────────────────────────────────────────────────
  // PIXI renderer setup (unchanged — runs once)
  // ────────────────────────────────────────────────────────────────────────

  async setupPixiRenderer() {
    this.pixiRenderer = new PIXI.WebGLRenderer();
    this.pixiCanvas = document.createElement("canvas");
    this.pixiCanvas.width = window.innerWidth;
    this.pixiCanvas.height = window.innerHeight;

    this.pixiCanvas.style.position = "fixed";
    this.pixiCanvas.style.left = "0";
    this.pixiCanvas.style.top = "0";
    this.pixiCanvas.style.width = "100%";
    this.pixiCanvas.style.height = "100%";
    this.pixiCanvas.style.pointerEvents = "none";
    this.pixiCanvas.style.zIndex = "33";
    document.body.appendChild(this.pixiCanvas);

    this.pixiStage = new PIXI.Container();
    await this.pixiRenderer.init({
      canvas: this.pixiCanvas,
      resolution: 1,
      width: this.pixiCanvas.width,
      height: this.pixiCanvas.height,
      clearBeforeRender: true,
      backgroundAlpha: 0,
      backgroundColor: 0x00000000,
    });
  }

  resizePixiCanvas() {
    if (this.pixiRenderer?.view) {
      this.pixiCanvas.width = window.innerWidth;
      this.pixiCanvas.height = window.innerHeight;
      this.pixiRenderer.resize(innerWidth, innerHeight, 1);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Icon helpers
  // ────────────────────────────────────────────────────────────────────────

  private iconScreenScale(): number {
    const s = this.transformHandler.scale;
    if (s <= ICON_GROW_ZOOM_THRESHOLD) {
      return (Math.min(1, s) / ICON_TEXTURE_QUALITY) * SIZE_SCALE;
    }
    return (s / ICON_GROW_ZOOM_THRESHOLD / ICON_TEXTURE_QUALITY) * SIZE_SCALE;
  }

  private getIconImage(unitType: UnitType): HTMLImageElement | null {
    switch (unitType) {
      case UnitType.Warship:
        return this.warshipIconImage;
      case UnitType.Submarine:
        return this.submarineIconImage;
      case UnitType.FighterJet:
        return this.fighterJetIconImage;
      case UnitType.Bomber:
        return this.bomberIconImage;
      case UnitType.TradeShip:
        return this.tradeShipIconImage;
      default:
        return null;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Texture creation (with OPT 5 — cached getImageColored)
  // ────────────────────────────────────────────────────────────────────────

  private createPixiTexture(
    unit: UnitView,
    isTargeting: boolean = false,
  ): PIXI.Texture {
    const border = this.theme.borderColor(unit.owner());
    const unitType = unit.type();

    const isNavalUnit =
      unitType === UnitType.Warship ||
      unitType === UnitType.Submarine ||
      unitType === UnitType.TradeShip;
    const borderColor = isNavalUnit
      ? border.lighten(0.1).toRgbString()
      : border.darken(0.1).toRgbString();

    const level = (unit.level && unit.level()) || 1;
    const cache = isTargeting ? this.targetingTextureCache : this.textureCache;
    const cacheSuffix = isTargeting ? "-targeting" : "";
    const cacheKey = `${unitType}-${unit.owner().id()}-${borderColor}-${level}${cacheSuffix}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)!;
    }

    const iconImage = this.getIconImage(unitType);
    if (!iconImage || !iconImage.complete) {
      return PIXI.Texture.EMPTY;
    }

    const CANVAS_PX = Math.max(1, (ICON_DIM * ICON_TEXTURE_QUALITY + 0.5) | 0);
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_PX;
    canvas.height = CANVAS_PX;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.scale(ICON_TEXTURE_QUALITY, ICON_TEXTURE_QUALITY);

    // OPT 5 — use cached getImageColored
    const colored = this.getImageColored(iconImage, borderColor);
    const padded = 4;
    const maxW = ICON_DIM - padded * 2;
    const maxH = ICON_DIM - padded * 2;
    const iw = Math.max(1, colored.width);
    const ih = Math.max(1, colored.height);
    const baseScale = Math.min(maxW / iw, maxH / ih);
    const factor =
      unitType === UnitType.Bomber || unitType === UnitType.FighterJet
        ? 1.0
        : 1.4;
    const dw = Math.min(
      ICON_DIM,
      Math.max(1, (iw * baseScale * factor + 0.5) | 0),
    );
    const dh = Math.min(
      ICON_DIM,
      Math.max(1, (ih * baseScale * factor + 0.5) | 0),
    );
    const dx = ((ICON_DIM - dw) / 2 + 0.5) | 0;
    const dy = ((ICON_DIM - dh) / 2 + 0.5) | 0;

    ctx.drawImage(colored, dx, dy, dw, dh);

    // Level stars (skip FighterJet, TradeShip, Bomber)
    if (
      unitType !== UnitType.TradeShip &&
      unitType !== UnitType.Bomber &&
      unitType !== UnitType.FighterJet &&
      level >= 1 &&
      level <= 4
    ) {
      const tierColor = "#CD7F32";
      const starSize = 4;
      const spacing = 0.3;
      const padding = 1;
      const startX = padding + starSize / 2;
      const startY = padding + starSize / 2;

      ctx.fillStyle = tierColor;
      for (let i = 0; i < level; i++) {
        const x = startX + i * (starSize + spacing);
        this.drawStar(ctx, x, startY, starSize);
      }
    }

    // Targeting marker
    if (isTargeting) {
      const markerSize = 5;
      const padding = 1;
      const centerX = ICON_DIM - padding - markerSize / 2;
      const centerY = padding + markerSize / 2;

      ctx.strokeStyle = "#FF0000";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(centerX, centerY, markerSize / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.moveTo(centerX - markerSize / 2, centerY);
      ctx.lineTo(centerX + markerSize / 2, centerY);
      ctx.stroke();
      ctx.moveTo(centerX, centerY - markerSize / 2);
      ctx.lineTo(centerX, centerY + markerSize / 2);
      ctx.stroke();
      ctx.closePath();
    }

    const texture = PIXI.Texture.from(canvas);
    cache.set(cacheKey, texture);
    return texture;
  }

  // Star drawing helpers (unchanged)
  private drawStar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
  ) {
    const spikes = 5;
    const outerRadius = size / 2;
    const innerRadius = outerRadius * 0.4;
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      let x = cx + Math.cos(rot) * outerRadius;
      let y = cy + Math.sin(rot) * outerRadius;
      ctx.lineTo(x, y);
      rot += step;
      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fill();
  }

  private drawPixiStar(
    graphics: PIXI.Graphics,
    cx: number,
    cy: number,
    size: number,
  ) {
    const spikes = 5;
    const outerRadius = size / 2;
    const innerRadius = outerRadius * 0.4;
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;
    const points: number[] = [];
    points.push(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      let x = cx + Math.cos(rot) * outerRadius;
      let y = cy + Math.sin(rot) * outerRadius;
      points.push(x, y);
      rot += step;
      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      points.push(x, y);
      rot += step;
    }
    points.push(cx, cy - outerRadius);
    graphics.drawPolygon(points);
  }

  private getStarTexture(level: number): PIXI.Texture {
    if (this.starTextureCache.has(level)) {
      return this.starTextureCache.get(level)!;
    }
    const canvas = document.createElement("canvas");
    const starSize = 8;
    const spacing = 0.6;
    const padding = 1;
    canvas.width = Math.ceil(padding * 2 + level * (starSize + spacing));
    canvas.height = starSize + padding * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#cd7f32";
    for (let i = 0; i < level; i++) {
      const x = padding + starSize / 2 + i * (starSize + spacing);
      const y = padding + starSize / 2;
      this.drawStar(ctx, x, y, starSize);
    }
    const texture = PIXI.Texture.from(canvas);
    this.starTextureCache.set(level, texture);
    return texture;
  }

  /**
   * OPT 5 — Cached version: results are keyed by image src + color string.
   * The original created a new canvas *every* call.
   */
  private getImageColored(
    image: HTMLImageElement,
    color: string,
  ): HTMLCanvasElement {
    const cacheKey = `${image.src}|${color}`;
    const cached = this.coloredImageCache.get(cacheKey);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(image, 0, 0);

    this.coloredImageCache.set(cacheKey, canvas);
    return canvas;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Layer interface
  // ────────────────────────────────────────────────────────────────────────

  shouldTransform(): boolean {
    return true;
  }

  /**
   * OPT 6 — Build airfield tile set once per tick instead of linear
   * scanning all Airfield units for every bomber.
   */
  tick() {
    this.lastTickTimestamp = this.now();

    const configuredInterval = this.game
      .config()
      .serverConfig()
      .turnIntervalMs();
    if (configuredInterval !== this.baseTickIntervalMs) {
      this.baseTickIntervalMs = configuredInterval;
      this.updateTickInterval();
    }

    // OPT 6 — rebuild airfield lookup
    this.airfieldTilesByOwner.clear();
    for (const airfield of this.game.units(UnitType.Airfield)) {
      if (!airfield.isActive()) continue;
      const ownerSid = airfield.owner().smallID();
      let set = this.airfieldTilesByOwner.get(ownerSid);
      if (!set) {
        set = new Set<TileRef>();
        this.airfieldTilesByOwner.set(ownerSid, set);
      }
      set.add(airfield.tile());
    }

    const unitIds =
      this.game
        .updatesSinceLastTick()
        ?.[GameUpdateType.Unit]?.map((unit) => unit.id) ?? [];

    this.updateUnitsSprites(unitIds);

    // Sweep zombies
    const zombieIds: number[] = [];
    for (const [id, unit] of this.renderedUnits) {
      if (!unit.isActive()) {
        zombieIds.push(id);
      }
    }
    if (zombieIds.length > 0) {
      this.updateUnitsSprites(zombieIds);
    }

    // Clean up inactive PIXI sprites (OPT 2 — iterate Map, O(1) removal)
    for (const [id, render] of this.pixiRenderMap) {
      if (!render.unit.isActive()) {
        this.removePixiUnit(id);
      }
    }

    this.updateGhosts();
    this.updatePixiUnits();

    // OPT 6 — O(1) bomber-at-airfield lookup
    // (bomberAtAirfield map removed; checked inline via airfieldTilesByOwner)
  }

  /**
   * OPT 6 — O(1) airfield check using the per-tick Set.
   */
  private isUnitAtOwnedAirfield(unit: UnitView): boolean {
    const ownerSid = unit.owner().smallID();
    const tiles = this.airfieldTilesByOwner.get(ownerSid);
    return tiles !== undefined && tiles.has(unit.tile());
  }

  private updatePixiUnits() {
    if (!this.pixiRenderer) return;

    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];

    const metrics = PerformanceMetrics.getInstance();

    if (metrics.enabled) {
      for (const u of unitUpdates) {
        const unitView = this.game.unit(u.id);
        if (unitView && PIXI_UNIT_TYPES.has(unitView.type())) {
          metrics.recordUnitExecutionTime(unitView.type(), 0.1);
        }
      }
    }

    for (const u of unitUpdates) {
      const unitView = this.game.unit(u.id);
      if (unitView === undefined) continue;
      if (!PIXI_UNIT_TYPES.has(unitView.type())) continue;

      if (unitView.isActive()) {
        // OPT 2 — Map check, O(1)
        if (!this.pixiRenderMap.has(unitView.id())) {
          const sprite = this.createPixiSprite(unitView);
          const render = new UnitRenderInfo(unitView, sprite);
          this.pixiRenderMap.set(unitView.id(), render);
        }
      } else {
        this.removePixiUnit(unitView.id());
      }
    }
  }

  /**
   * OPT 2 — O(1) removal via Map (was findIndex + splice → O(n)).
   */
  private removePixiUnit(unitId: number) {
    const render = this.pixiRenderMap.get(unitId);
    if (render) {
      render.pixiSprite.destroy();
      this.pixiRenderMap.delete(unitId);
    }
  }

  private createPixiSprite(unit: UnitView): PIXI.Sprite {
    if (unit.type() === UnitType.Shell) {
      const graphics = new PIXI.Graphics() as any;
      this.pixiStage.addChild(graphics);
      return graphics;
    }

    if (unit.type() === UnitType.FighterJet) {
      const container = new PIXI.Container() as any as PIXI.Sprite;
      const texture = this.createPixiTexture(unit, false);
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5, 0.5);
      container.addChild(sprite);

      const level = unit.level ? unit.level() : 1;
      const starTexture = this.getStarTexture(level);
      const starSprite = new PIXI.Sprite(starTexture);
      starSprite.anchor.set(0, 0);
      container.addChild(starSprite);
      (container as any)._jetSprite = sprite;
      (container as any)._starSprite = starSprite;

      this.pixiStage.addChild(container);
      return container;
    }

    const texture = this.createPixiTexture(unit, false);
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    this.pixiStage.addChild(sprite);
    return sprite;
  }

  // ────────────────────────────────────────────────────────────────────────
  // init / redraw
  // ────────────────────────────────────────────────────────────────────────

  init() {
    this.eventBus.on(AlternateViewEvent, (e: AlternateViewEvent) =>
      this.onAlternativeViewEvent(e),
    );
    this.eventBus.on(MouseUpEvent, (e: MouseUpEvent) => this.onMouseUp(e));
    this.eventBus.on(UnitSelectionEvent, (e: UnitSelectionEvent) =>
      this.onUnitSelectionChange(e),
    );
    this.eventBus.on(ReplaySpeedChangeEvent, (e: ReplaySpeedChangeEvent) =>
      this.onReplaySpeedChange(e.replaySpeedMultiplier),
    );
    window.addEventListener("resize", () => this.resizePixiCanvas());

    this.redraw();
    loadAllSprites();
    this.setupPixiRenderer().then(() => this.redrawPixiUnits());
  }

  /**
   * OPT 8 — Reuse existing canvas elements when possible.
   */
  redraw() {
    if (!this.canvasesAllocated) {
      this.canvas = document.createElement("canvas");
      this.transportShipTrailCanvas = document.createElement("canvas");
      this.interpolationCanvas = document.createElement("canvas");
      this.canvasesAllocated = true;
    }

    const w = this.game.width();
    const h = this.game.height();

    // Only resize if dimensions changed
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.transportShipTrailCanvas.width = w;
      this.transportShipTrailCanvas.height = h;
      this.interpolationCanvas.width = w;
      this.interpolationCanvas.height = h;
    }

    this.context = this.canvas.getContext("2d")!;
    this.unitTrailContext = this.transportShipTrailCanvas.getContext("2d")!;
    this.interpolationContext = this.interpolationCanvas.getContext("2d")!;
    this.interpolationContext.imageSmoothingEnabled = false;

    // Clear all three
    this.context.clearRect(0, 0, w, h);
    this.unitTrailContext.clearRect(0, 0, w, h);
    this.interpolationContext.clearRect(0, 0, w, h);

    this.renderedUnits.clear();
    const units = this.game.units();
    units.forEach((u) => {
      if (UNIT_LAYER_TYPES.has(u.type()) && !PIXI_UNIT_TYPES.has(u.type())) {
        this.renderedUnits.set(u.id(), u);
      }
    });
    this.updateUnitsSprites(units.map((unit) => unit.id()));

    this.redrawPixiUnits();

    this.renderedGhosts.clear();
    const ghosts = (this.game as any).submarineGhosts?.call(this.game) ?? [];
    for (const ghost of ghosts as Array<{
      id: number;
      pos: number;
      expiresAt: number;
      ownerID: number;
    }>) {
      this.createPixiGhost(ghost);
      this.renderedGhosts.set(ghost.id, ghost.pos);
    }

    this.unitToTrail.forEach((trail, unit) => {
      for (const t of trail) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          this.relationship(unit),
          this.theme.territoryColor(unit.owner()),
          150,
          this.unitTrailContext,
        );
      }
    });
  }

  private redrawPixiUnits() {
    if (!this.pixiRenderer) return;

    // OPT 2 — iterate Map
    for (const render of this.pixiRenderMap.values()) {
      render.pixiSprite.destroy();
    }
    this.pixiRenderMap.clear();

    for (const ghost of this.ghostRenders) {
      ghost.pixiSprite.destroy();
    }
    this.ghostRenders = [];

    const units = this.game.units();
    for (const unit of units) {
      if (PIXI_UNIT_TYPES.has(unit.type()) && unit.isActive()) {
        const sprite = this.createPixiSprite(unit);
        this.pixiRenderMap.set(unit.id(), new UnitRenderInfo(unit, sprite));
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // renderLayer (OPT 3 — cache alpha, OPT 4 — reuse Cell)
  // ────────────────────────────────────────────────────────────────────────

  renderLayer(context: CanvasRenderingContext2D) {
    // OPT 3 — compute once, reuse everywhere this frame
    this._frameAlpha = this.computeTickAlpha();

    this.updateInterpolatedUnits();
    this.renderPixiUnits();

    PerformanceMetrics.getInstance().incrementVisibleEntities(
      this.renderedUnits.size + this.pixiRenderMap.size,
    );

    const hw = -this.game.width() / 2;
    const hh = -this.game.height() / 2;
    const w = this.game.width();
    const h = this.game.height();

    context.drawImage(this.transportShipTrailCanvas, hw, hh, w, h);
    context.drawImage(this.canvas, hw, hh, w, h);
    if (this.interpolationCanvas) {
      context.drawImage(this.interpolationCanvas, hw, hh, w, h);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // PIXI render loop (OPT 7 — no getBounds, OPT 4 — reuse Cell)
  // ────────────────────────────────────────────────────────────────────────

  private renderPixiUnits() {
    if (!this.pixiRenderer) return;

    const metrics = PerformanceMetrics.getInstance();
    const unitCounts = new Map<UnitType, number>();
    const renderTimes = new Map<UnitType, number>();

    const canvasWidth = this.pixiRenderer.canvas.width;
    const canvasHeight = this.pixiRenderer.canvas.height;

    // OPT 2 — iterate map values
    for (const render of this.pixiRenderMap.values()) {
      const startTime = metrics.enabled ? performance.now() : 0;
      this.updatePixiSpritePosition(render);

      if (metrics.enabled) {
        const duration = performance.now() - startTime;
        const t = render.unit.type();
        renderTimes.set(t, (renderTimes.get(t) ?? 0) + duration);

        // OPT 7 — use sprite x/y directly instead of getBounds()
        if (render.pixiSprite.visible) {
          const sx = render.pixiSprite.x;
          const sy = render.pixiSprite.y;
          const margin = ICON_DIM * this.iconScreenScale();
          if (
            sx + margin >= 0 &&
            sy + margin >= 0 &&
            sx - margin <= canvasWidth &&
            sy - margin <= canvasHeight
          ) {
            unitCounts.set(t, (unitCounts.get(t) ?? 0) + 1);
          }
        }
      }
    }

    if (metrics.enabled) {
      renderTimes.forEach((time, ut) => metrics.recordUnitRenderTime(ut, time));
      unitCounts.forEach((count, ut) => metrics.recordUnitVisible(ut, count));
    }

    this.updatePixiGhosts();
    this.pixiRenderer.render(this.pixiStage);
  }

  /**
   * OPT 4 — use _tmpPoint to avoid `new Cell(...)` per unit.
   * OPT 9 — bitwise pixel-snap.
   */
  private updatePixiSpritePosition(render: UnitRenderInfo) {
    const unit = render.unit;

    if (unit.type() === UnitType.Shell) {
      this.updateShellGraphics(render);
      return;
    }

    // Bomber at airfield — OPT 6 O(1) check
    if (unit.type() === UnitType.Bomber) {
      if (this.isUnitAtOwnedAirfield(unit)) {
        render.pixiSprite.visible = false;
        return;
      }
      render.pixiSprite.visible = true;
      const angle = this.getUnitAngle(unit);
      if (angle !== null) render.pixiSprite.rotation = angle;
    }

    // FighterJet rotation + stars
    if (unit.type() === UnitType.FighterJet) {
      const angle = this.getUnitAngle(unit);
      const jetSprite = (render.pixiSprite as any)._jetSprite;
      const starSprite = (render.pixiSprite as any)._starSprite;

      if (angle !== null && jetSprite) {
        jetSprite.rotation = angle;
      }
      if (starSprite && jetSprite) {
        const level = unit.level ? unit.level() : 1;
        const starTexture = this.getStarTexture(level);
        if (starSprite.texture !== starTexture) {
          starSprite.texture = starTexture;
        }
        const spriteWidth = jetSprite.texture.width;
        const spriteHeight = jetSprite.texture.height;
        const padding = 1;
        starSprite.x = -spriteWidth / 2 + padding;
        starSprite.y = -spriteHeight / 2 + padding;
      }
    }

    // Submarine stealth
    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() === this.game.myPlayer()
    ) {
      const visible =
        unit.isAttacking() || unit.isDetectedByNavalUnit() || unit.isCooldown();
      render.pixiSprite.alpha = visible ? 1.0 : 0.75;
    } else {
      render.pixiSprite.alpha = 1.0;
    }

    // Interpolated position (OPT 3 — use cached _frameAlpha)
    const lastTile = unit.lastTile();
    const currentTile = unit.tile();
    const isMoving = lastTile !== currentTile;

    let px: number, py: number;
    if (isMoving) {
      const alpha = this._frameAlpha;
      const sx = this.game.x(lastTile);
      const sy = this.game.y(lastTile);
      const ex = this.game.x(currentTile);
      const ey = this.game.y(currentTile);
      px = sx + (ex - sx) * alpha;
      py = sy + (ey - sy) * alpha;
    } else {
      px = this.game.x(currentTile);
      py = this.game.y(currentTile);
    }

    // OPT 4 — reuse _tmpPoint
    this._tmpPoint.x = px;
    this._tmpPoint.y = py;
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      this._tmpPoint as Cell,
    );

    // OPT 9 — bitwise pixel-snap
    render.pixiSprite.x = (screenPos.x + 0.5) | 0;
    render.pixiSprite.y = (screenPos.y + 0.5) | 0;

    // Scale + horizontal flip
    const baseScale = this.iconScreenScale();

    if (FLIP_UNIT_TYPES.has(unit.type())) {
      if (lastTile && currentTile) {
        const dx = this.game.x(currentTile) - this.game.x(lastTile);
        if (dx !== 0) render.facingLeft = dx < 0;
        render.pixiSprite.scale.set(
          render.facingLeft ? -baseScale : baseScale,
          baseScale,
        );
      } else {
        render.pixiSprite.scale.set(baseScale, baseScale);
      }
    } else {
      render.pixiSprite.scale.set(baseScale, baseScale);
    }

    // Targeting texture swap
    const isTargeting = this.isUnitTargeting(unit);
    const texture = this.createPixiTexture(unit, isTargeting);
    if (render.pixiSprite.texture !== texture) {
      render.pixiSprite.texture = texture;
    }
  }

  private updateShellGraphics(render: UnitRenderInfo) {
    const unit = render.unit;
    const graphics = render.pixiSprite as any as PIXI.Graphics;
    graphics.clear();

    const color = this.theme.borderColor(unit.owner());
    const colorNum = parseInt(color.toHex().substring(1), 16);

    // OPT 3 — cached alpha
    const alpha = this._frameAlpha;
    const sx = this.game.x(unit.lastTile());
    const sy = this.game.y(unit.lastTile());
    const ex = this.game.x(unit.tile());
    const ey = this.game.y(unit.tile());
    const px = sx + (ex - sx) * alpha;
    const py = sy + (ey - sy) * alpha;

    // OPT 4 — reuse _tmpPoint
    this._tmpPoint.x = px;
    this._tmpPoint.y = py;
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      this._tmpPoint as Cell,
    );

    if (sx !== px || sy !== py) {
      this._tmpPoint.x = sx;
      this._tmpPoint.y = sy;
      const lastScreenPos = this.transformHandler.worldToScreenCoordinates(
        this._tmpPoint as Cell,
      );
      graphics.lineStyle(1, colorNum, 0.7);
      graphics.moveTo(lastScreenPos.x, lastScreenPos.y);
      graphics.lineTo(screenPos.x, screenPos.y);
    }

    graphics.beginFill(colorNum, 1.0);
    graphics.drawRect(screenPos.x - 0.5, screenPos.y - 0.5, 1, 1);
    graphics.endFill();

    graphics.beginFill(colorNum, 0.4);
    graphics.drawRect(screenPos.x - 1, screenPos.y - 1, 2, 2);
    graphics.endFill();
  }

  private isUnitTargeting(unit: UnitView): boolean {
    if (
      unit.type() === UnitType.Warship ||
      unit.type() === UnitType.Submarine ||
      unit.type() === UnitType.FighterJet
    ) {
      return unit.targetUnitId() !== undefined;
    }
    return false;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Canvas2D unit update (OPT 1, 10)
  // ────────────────────────────────────────────────────────────────────────

  private updateUnitsSprites(unitIds: number[]) {
    const unitsToUpdate: UnitView[] = [];
    const unitsToRemove: UnitView[] = [];

    for (const id of unitIds) {
      const unit = this.game.unit(id);
      if (unit) {
        if (
          UNIT_LAYER_TYPES.has(unit.type()) &&
          !PIXI_UNIT_TYPES.has(unit.type())
        ) {
          unitsToUpdate.push(unit);
          this.renderedUnits.set(id, unit);
        }
      } else {
        const removed = this.renderedUnits.get(id);
        if (removed) {
          unitsToRemove.push(removed);
          this.renderedUnits.delete(id);
        }
      }
    }

    const allUnitsToClear = [...unitsToUpdate, ...unitsToRemove];
    if (allUnitsToClear.length === 0) return;

    const oldAngleByUnit = new Map<UnitView, number | null>();
    for (const u of allUnitsToClear) {
      oldAngleByUnit.set(u, this.unitToLastAngle.get(u) ?? null);
    }

    // OPT 10 — angleByUnit only computed for rotatable types
    const angleByUnit = new Map<UnitView, number | null>();
    for (const u of unitsToUpdate) {
      // getUnitAngle now short-circuits for non-rotatable types
      angleByUnit.set(u, this.getUnitAngle(u));
    }

    this.clearUnitsCells(allUnitsToClear, oldAngleByUnit);
    this.drawUnitsCells(unitsToUpdate, angleByUnit);

    for (const u of unitsToRemove) {
      this.handleUnitDeactivation(u);
    }
  }

  private clearUnitsCells(
    unitViews: UnitView[],
    angleByUnit: Map<UnitView, number | null>,
  ) {
    for (const unitView of unitViews) {
      if (!isSpriteReady(unitView.type())) continue;

      const spriteSize = this.getSpriteSize(unitView);
      const sizeMult = this.effectiveSizeMultiplier(unitView);
      const newWidth = spriteSize * sizeMult;
      const newHeight = spriteSize * sizeMult;

      const level = (unitView as any).level ? (unitView as any).level() : 1;
      const badgeSize = Math.max(2, Math.min(3, (newWidth * 0.18 + 0.5) | 0));
      const offset = 1;
      const overlayTop = badgeSize + offset;
      const extraRight = badgeSize + offset;
      const padding = 2;
      const maxHalfWidth = newWidth / 2 + extraRight;
      const lastX = this.game.x(unitView.lastTile());
      const lastY = this.game.y(unitView.lastTile());
      const angle = angleByUnit.get(unitView) ?? null;

      if (angle !== null) {
        this.context.save();
        this.context.translate(lastX, lastY);
        this.context.rotate(angle);
        this.context.translate(-lastX, -lastY);
      }

      const left = lastX - maxHalfWidth - padding;
      const top = lastY - newHeight / 2 - overlayTop - padding;
      const width = maxHalfWidth * 2 + padding * 2;
      const height = newHeight + overlayTop + padding * 2;
      this.context.clearRect(left, top, width, height);

      if (angle !== null) {
        this.context.restore();
      }
    }
  }

  private drawUnitsCells(
    unitViews: UnitView[],
    angleByUnit: Map<UnitView, number | null>,
  ) {
    this.drawingBasePass = true;

    const metrics = PerformanceMetrics.getInstance();
    const canvasUnitCounts = new Map<UnitType, number>();
    const canvasRenderTimes = new Map<UnitType, number>();

    const canvasWidth = this.context.canvas.width;
    const canvasHeight = this.context.canvas.height;

    try {
      for (const unitView of unitViews) {
        if (!PIXI_UNIT_TYPES.has(unitView.type())) {
          const startTime = metrics.enabled ? performance.now() : 0;
          this.onUnitEvent(unitView, angleByUnit);

          if (metrics.enabled) {
            const duration = performance.now() - startTime;
            const t = unitView.type();
            canvasRenderTimes.set(
              t,
              (canvasRenderTimes.get(t) ?? 0) + duration,
            );

            const worldX = this.game.x(unitView.tile());
            const worldY = this.game.y(unitView.tile());
            // OPT 4
            this._tmpPoint.x = worldX;
            this._tmpPoint.y = worldY;
            const screenPos = this.transformHandler.worldToScreenCoordinates(
              this._tmpPoint as Cell,
            );
            const margin = 50;
            if (
              screenPos.x >= -margin &&
              screenPos.y >= -margin &&
              screenPos.x <= canvasWidth + margin &&
              screenPos.y <= canvasHeight + margin
            ) {
              canvasUnitCounts.set(t, (canvasUnitCounts.get(t) ?? 0) + 1);
            }
          }
        } else {
          this.onUnitEvent(unitView, angleByUnit);
        }
      }

      if (metrics.enabled) {
        canvasRenderTimes.forEach((time, ut) =>
          metrics.recordUnitRenderTime(ut, time),
        );
        canvasUnitCounts.forEach((count, ut) =>
          metrics.recordUnitVisible(ut, count),
        );
      }
    } finally {
      this.drawingBasePass = false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Interpolation (OPT 1, 3)
  // ────────────────────────────────────────────────────────────────────────

  private interpolatePosition(unit: UnitView, alpha: number) {
    const startTile = unit.lastTile();
    const endTile = unit.tile();
    const sx = this.game.x(startTile);
    const sy = this.game.y(startTile);
    const ex = this.game.x(endTile);
    const ey = this.game.y(endTile);
    return { x: sx + (ex - sx) * alpha, y: sy + (ey - sy) * alpha };
  }

  private updateInterpolatedUnits() {
    if (!this.interpolationContext || !this.interpolationCanvas) return;

    this.interpolationContext.clearRect(
      0,
      0,
      this.interpolationCanvas.width,
      this.interpolationCanvas.height,
    );

    // OPT 3 — use cached _frameAlpha
    const alpha = this._frameAlpha;
    const units = this.game.units(...INTERPOLATED_UNIT_TYPES_ARRAY);

    for (const unit of units) {
      if (!unit.isActive()) continue;
      if (PIXI_UNIT_TYPES.has(unit.type())) continue;

      if (unit.type() === UnitType.Bomber && this.isUnitAtOwnedAirfield(unit)) {
        continue;
      }

      if (unit.type() === UnitType.AABullet) continue;

      const position = this.interpolatePosition(unit, alpha);

      switch (unit.type()) {
        case UnitType.Shell:
          this.renderShell(unit, position);
          continue;
        case UnitType.MIRVWarhead:
          this.renderWarhead(unit, position);
          continue;
        default:
          if (!isSpriteReady(unit.type())) continue;
          this.drawSpriteAtPosition(
            unit,
            position,
            this.getInterpolatedSpriteColor(unit),
            this.interpolationContext,
            true,
          );
      }
    }
  }

  private getInterpolatedSpriteColor(unit: UnitView): Colord | undefined {
    if (unit.targetUnitId()) {
      const t = unit.type();
      if (t === UnitType.Warship || t === UnitType.FighterJet) {
        return colord("rgb(200,0,0)");
      }
    }
    return undefined;
  }

  private renderShell(unit: UnitView, position: { x: number; y: number }) {
    const rel = this.relationship(unit);
    const color = this.theme.borderColor(unit.owner());
    this.drawInterpolatedSquare(position, rel, color, 1, 1);
    this.drawInterpolatedSquare(position, rel, color, 2, 0.4);
    const last = {
      x: this.game.x(unit.lastTile()),
      y: this.game.y(unit.lastTile()),
    };
    if (last.x !== position.x || last.y !== position.y) {
      this.drawInterpolatedSegment(last, position, rel, color, 0.7);
    }
  }

  private renderWarhead(unit: UnitView, position: { x: number; y: number }) {
    const rel = this.relationship(unit);
    const color = this.theme.borderColor(unit.owner());
    this.drawInterpolatedSquare(position, rel, color, 1, 1);
    this.drawInterpolatedSquare(position, rel, color, 2, 0.35);
    const last = {
      x: this.game.x(unit.lastTile()),
      y: this.game.y(unit.lastTile()),
    };
    if (last.x !== position.x || last.y !== position.y) {
      this.drawInterpolatedSegment(last, position, rel, color, 0.5);
    }
  }

  private drawInterpolatedSquare(
    position: { x: number; y: number },
    relationship: Relationship,
    color: Colord,
    size: number,
    alpha: number,
  ) {
    if (!this.interpolationContext) return;
    const ctx = this.interpolationContext;
    ctx.fillStyle = this.resolveInterpolatedColor(relationship, color, alpha);
    ctx.fillRect(position.x - size / 2, position.y - size / 2, size, size);
  }

  private drawInterpolatedSegment(
    start: { x: number; y: number },
    end: { x: number; y: number },
    relationship: Relationship,
    color: Colord,
    alpha: number,
  ) {
    if (!this.interpolationContext) return;
    const ctx = this.interpolationContext;
    ctx.strokeStyle = this.resolveInterpolatedColor(relationship, color, alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  private resolveInterpolatedColor(
    relationship: Relationship,
    color: Colord,
    alpha: number,
  ): string {
    if (this.alternateView) {
      return this.getAlternateViewColor(relationship)
        .alpha(alpha)
        .toRgbString();
    }
    return color.alpha(alpha).toRgbString();
  }

  private getAlternateViewColor(relationship: Relationship): Colord {
    switch (relationship) {
      case Relationship.Self:
        return this.theme.selfColor();
      case Relationship.Ally:
        return this.theme.allyColor();
      case Relationship.Enemy:
      default:
        return this.theme.enemyColor();
    }
  }

  private relationship(unit: UnitView): Relationship {
    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) return Relationship.Enemy;
    if (myPlayer === unit.owner()) return Relationship.Self;
    if (myPlayer.isFriendly(unit.owner())) return Relationship.Ally;
    return Relationship.Enemy;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Selection / event handlers (identical logic, kept for parity)
  // ────────────────────────────────────────────────────────────────────────

  private findWarshipsNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) return [];
    const clickRef = this.game.ref(cell.x, cell.y);
    PerformanceMetrics.getInstance().recordUnitQuery(UnitType.Warship);
    return this.game
      .units(UnitType.Warship)
      .filter(
        (u) =>
          u.isActive() &&
          u.owner() === this.game.myPlayer() &&
          this.game.manhattanDist(u.tile(), clickRef) <=
            this.WARSHIP_SELECTION_RADIUS,
      )
      .sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), clickRef) -
          this.game.manhattanDist(b.tile(), clickRef),
      );
  }

  private findSubmarinesNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) return [];
    const clickRef = this.game.ref(cell.x, cell.y);
    return this.game
      .units(UnitType.Submarine)
      .filter(
        (u) =>
          u.isActive() &&
          u.owner() === this.game.myPlayer() &&
          this.game.manhattanDist(u.tile(), clickRef) <=
            this.SUBMARINE_SELECTION_RADIUS,
      )
      .sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), clickRef) -
          this.game.manhattanDist(b.tile(), clickRef),
      );
  }

  private findFighterJetsNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) return [];
    const clickRef = this.game.ref(cell.x, cell.y);
    return this.game
      .units(UnitType.FighterJet)
      .filter(
        (u) =>
          u.isActive() &&
          u.owner() === this.game.myPlayer() &&
          this.game.manhattanDist(u.tile(), clickRef) <=
            this.FIGHTER_JET_SELECTION_RADIUS,
      )
      .sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), clickRef) -
          this.game.manhattanDist(b.tile(), clickRef),
      );
  }

  private findArtilleryNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) return [];
    const clickRef = this.game.ref(cell.x, cell.y);
    return this.game
      .units(UnitType.Artillery)
      .filter(
        (u) =>
          u.isActive() &&
          u.owner() === this.game.myPlayer() &&
          this.game.manhattanDist(u.tile(), clickRef) <=
            this.WARSHIP_SELECTION_RADIUS,
      )
      .sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), clickRef) -
          this.game.manhattanDist(b.tile(), clickRef),
      );
  }

  private onMouseUp(event: MouseUpEvent) {
    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    const nearbyWarships = this.findWarshipsNearCell(cell);
    const nearbySubmarines = this.findSubmarinesNearCell(cell);
    const nearbyFighterJets = this.findFighterJetsNearCell(cell);
    const nearbyArtillery = this.findArtilleryNearCell(cell);

    if (this.selectedUnit) {
      const clickRef = this.game.ref(cell.x, cell.y);
      if (this.selectedUnit.type() === UnitType.FighterJet) {
        this.eventBus.emit(
          new MoveFighterJetIntentEvent(this.selectedUnit.id(), clickRef),
        );
      } else if (
        this.selectedUnit.type() === UnitType.Warship &&
        this.game.isOcean(clickRef)
      ) {
        this.eventBus.emit(
          new MoveWarshipIntentEvent(this.selectedUnit.id(), clickRef),
        );
      } else if (
        this.selectedUnit.type() === UnitType.Submarine &&
        this.game.isOcean(clickRef)
      ) {
        this.eventBus.emit(
          new MoveSubmarineIntentEvent(this.selectedUnit.id(), clickRef),
        );
      } else if (
        this.selectedUnit.type() === UnitType.Artillery &&
        !this.game.isOcean(clickRef)
      ) {
        const lvl = this.selectedUnit.level ? this.selectedUnit.level() : 1;
        const maxDist = getArtilleryMaxDistance(lvl);
        const distSq = this.game.euclideanDistSquared(
          this.selectedUnit.tile(),
          clickRef,
        );
        if (distSq > maxDist * maxDist) {
          this.eventBus.emit(new ArtilleryOutOfRangeEvent(lvl, maxDist));
        } else {
          this.eventBus.emit(
            new MoveArtilleryIntentEvent(this.selectedUnit.id(), clickRef),
          );
        }
      }
      event.consumed = true;
      this.eventBus.emit(new UnitSelectionEvent(this.selectedUnit, false));
      return;
    } else if (nearbyWarships.length > 0) {
      this.eventBus.emit(new UnitSelectionEvent(nearbyWarships[0], true));
    } else if (nearbySubmarines.length > 0) {
      this.eventBus.emit(new UnitSelectionEvent(nearbySubmarines[0], true));
    } else if (nearbyFighterJets.length > 0) {
      this.eventBus.emit(new UnitSelectionEvent(nearbyFighterJets[0], true));
    } else if (nearbyArtillery.length > 0) {
      this.eventBus.emit(new UnitSelectionEvent(nearbyArtillery[0], true));
    }
  }

  private onUnitSelectionChange(event: UnitSelectionEvent) {
    if (event.isSelected) {
      this.selectedUnit = event.unit;
    } else if (this.selectedUnit === event.unit) {
      this.selectedUnit = null;
    }
  }

  private handleUnitDeactivation(unit: UnitView) {
    if (this.selectedUnit === unit && !unit.isActive()) {
      this.eventBus.emit(new UnitSelectionEvent(unit, false));
    }
    this.unitToLastAngle.delete(unit);
  }

  onAlternativeViewEvent(event: AlternateViewEvent) {
    this.alternateView = event.alternateView;
    this.redraw();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Canvas2D unit event dispatch
  // ────────────────────────────────────────────────────────────────────────

  onUnitEvent(unit: UnitView, angleByUnit?: Map<UnitView, number | null>) {
    if (PIXI_UNIT_TYPES.has(unit.type())) return;

    if (!unit.isActive()) {
      this.handleUnitDeactivation(unit);
    }

    if (unit.type() === UnitType.Bomber && this.isUnitAtOwnedAirfield(unit)) {
      return;
    }

    // Submarine owner stealth
    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() === this.game.myPlayer()
    ) {
      const visible =
        unit.isAttacking() || unit.isDetectedByNavalUnit() || unit.isCooldown();
      if (!visible) {
        this.drawSprite(unit, undefined, 0.75);
        return;
      }
    }

    switch (unit.type()) {
      case UnitType.TransportShip:
      case UnitType.Paratrooper:
        this.handleBoatEvent(unit);
        break;
      case UnitType.Submarine:
      case UnitType.Warship:
        this.handleWarShipEvent(unit, angleByUnit);
        break;
      case UnitType.Artillery:
        break; // Rendered by StructureLayer
      case UnitType.Shell:
        this.handleShellEvent(unit);
        break;
      case UnitType.SAMMissile:
        this.handleMissileEvent(unit, angleByUnit);
        break;
      case UnitType.TradeShip:
        this.handleTradeShipEvent(unit, angleByUnit);
        break;
      case UnitType.MIRVWarhead:
        this.handleMIRVWarhead(unit);
        break;
      case UnitType.Bomber:
        this.handleBomberEvent(unit, angleByUnit);
        break;
      case UnitType.FighterJet:
        this.handleFighterJetEvent(unit, angleByUnit);
        break;
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        this.handleNuke(unit);
        break;
    }
  }

  private handleWarShipEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    if (unit.targetUnitId()) {
      this.drawSprite(unit, colord({ r: 200, b: 0, g: 0 }), angleByUnit);
    } else {
      this.drawSprite(unit, undefined, angleByUnit);
    }
  }

  private handleShellEvent(unit: UnitView) {
    const rel = this.relationship(unit);
    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));
    const oldTile = this.oldShellTile.get(unit);
    if (oldTile !== undefined) {
      this.clearCell(this.game.x(oldTile), this.game.y(oldTile));
    }
    this.oldShellTile.set(unit, unit.lastTile());
    if (!unit.isActive()) return;

    this.paintCell(
      this.game.x(unit.tile()),
      this.game.y(unit.tile()),
      rel,
      this.theme.borderColor(unit.owner()),
      255,
    );
    this.paintCell(
      this.game.x(unit.lastTile()),
      this.game.y(unit.lastTile()),
      rel,
      this.theme.borderColor(unit.owner()),
      255,
    );
  }

  private handleMissileEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    this.drawSprite(unit, undefined, angleByUnit);
  }

  private drawTrail(trail: number[], color: Colord, rel: Relationship) {
    for (const t of trail) {
      this.paintCell(
        this.game.x(t),
        this.game.y(t),
        rel,
        color,
        150,
        this.unitTrailContext,
      );
    }
  }

  private clearTrail(unit: UnitView) {
    const trail = this.unitToTrail.get(unit) ?? [];
    const rel = this.relationship(unit);
    for (const t of trail) {
      this.clearCell(this.game.x(t), this.game.y(t), this.unitTrailContext);
    }
    this.unitToTrail.delete(unit);

    const trailSet = new Set(trail);
    for (const [other, trail] of this.unitToTrail) {
      for (const t of trail) {
        if (trailSet.has(t)) {
          this.paintCell(
            this.game.x(t),
            this.game.y(t),
            rel,
            this.theme.territoryColor(other.owner()),
            150,
            this.unitTrailContext,
          );
        }
      }
    }
  }

  private handleNuke(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    const rel = this.relationship(unit);
    if (!this.unitToTrail.has(unit)) {
      this.unitToTrail.set(unit, []);
    }
    let newTrailSize = 1;
    const trail = this.unitToTrail.get(unit)!;
    if (trail.length >= 1) {
      const cur = {
        x: this.game.x(unit.lastTile()),
        y: this.game.y(unit.lastTile()),
      };
      const prev = {
        x: this.game.x(trail[trail.length - 1]),
        y: this.game.y(trail[trail.length - 1]),
      };
      const line = new BezenhamLine(prev, cur);
      let point = line.increment();
      while (point !== true) {
        trail.push(this.game.ref(point.x, point.y));
        point = line.increment();
      }
      newTrailSize = line.size();
    } else {
      trail.push(unit.lastTile());
    }
    this.drawTrail(
      trail.slice(-newTrailSize),
      this.theme.territoryColor(unit.owner()),
      rel,
    );
    this.drawSprite(unit, undefined, angleByUnit);
    if (!unit.isActive()) {
      this.clearTrail(unit);
    }
  }

  private handleMIRVWarhead(unit: UnitView) {
    const rel = this.relationship(unit);
    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));
    if (unit.isActive()) {
      this.paintCell(
        this.game.x(unit.tile()),
        this.game.y(unit.tile()),
        rel,
        this.theme.borderColor(unit.owner()),
        255,
      );
    }
  }

  private handleTradeShipEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    this.drawSprite(unit, undefined, angleByUnit);
  }

  private handleBomberEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    this.drawSprite(unit, undefined, angleByUnit);
  }

  private handleFighterJetEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    if (unit.targetUnitId()) {
      this.drawSprite(unit, colord({ r: 200, b: 0, g: 0 }), angleByUnit);
    } else {
      this.drawSprite(unit, undefined, angleByUnit);
    }
  }

  private handleBoatEvent(unit: UnitView) {
    const rel = this.relationship(unit);
    if (!this.unitToTrail.has(unit)) {
      this.unitToTrail.set(unit, []);
    }
    const trail = this.unitToTrail.get(unit)!;
    trail.push(unit.lastTile());
    this.drawTrail(
      trail.slice(-1),
      this.theme.territoryColor(unit.owner()),
      rel,
    );
    this.drawSprite(unit);
    if (!unit.isActive()) {
      this.clearTrail(unit);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Paint / clear helpers
  // ────────────────────────────────────────────────────────────────────────

  paintCell(
    x: number,
    y: number,
    relationship: Relationship,
    color: Colord,
    alpha: number,
    context: CanvasRenderingContext2D = this.context,
  ) {
    this.clearCell(x, y, context);
    if (this.alternateView) {
      switch (relationship) {
        case Relationship.Self:
          context.fillStyle = this.theme.selfColor().toRgbString();
          break;
        case Relationship.Ally:
          context.fillStyle = this.theme.allyColor().toRgbString();
          break;
        case Relationship.Enemy:
          context.fillStyle = this.theme.enemyColor().toRgbString();
          break;
      }
    } else {
      context.fillStyle = color.alpha(alpha / 255).toRgbString();
    }
    context.fillRect(x, y, 1, 1);
  }

  clearCell(
    x: number,
    y: number,
    context: CanvasRenderingContext2D = this.context,
  ) {
    context.clearRect(x, y, 1, 1);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Sprite drawing (OPT 1 — Set.has for base-pass guard)
  // ────────────────────────────────────────────────────────────────────────

  drawSprite(
    unit: UnitView,
    customTerritoryColor?: Colord,
    sizeMultiplier?: number,
  ): void;
  drawSprite(
    unit: UnitView,
    customTerritoryColor?: Colord,
    angleByUnit?: Map<UnitView, number | null>,
    sizeMultiplier?: number,
  ): void;
  drawSprite(
    unit: UnitView,
    customTerritoryColor?: Colord,
    angleByUnitOrSizeMultiplier?: Map<UnitView, number | null> | number,
    sizeMultiplier: number = 1.0,
  ) {
    let angleByUnit: Map<UnitView, number | null> | undefined;
    let sizeMult = sizeMultiplier;

    if (typeof angleByUnitOrSizeMultiplier === "number") {
      sizeMult = angleByUnitOrSizeMultiplier;
    } else {
      angleByUnit = angleByUnitOrSizeMultiplier;
    }

    // OPT 1 — Set.has O(1) instead of Array.includes O(n)
    if (this.drawingBasePass && INTERPOLATED_UNIT_TYPES.has(unit.type())) {
      return;
    }

    const x = this.game.x(unit.tile());
    const y = this.game.y(unit.tile());

    let alternateViewColor: Colord | null = null;
    if (this.alternateView) {
      let rel = this.relationship(unit);
      const destinationId = unit.targetUnitId();
      if (unit.type() === UnitType.TradeShip && destinationId !== undefined) {
        const target = this.game.unit(destinationId)?.owner();
        const myPlayer = this.game.myPlayer();
        if (myPlayer !== null && target !== undefined) {
          if (myPlayer === target) rel = Relationship.Self;
          else if (myPlayer.isFriendly(target)) rel = Relationship.Ally;
        }
      }
      switch (rel) {
        case Relationship.Self:
          alternateViewColor = this.theme.selfColor();
          break;
        case Relationship.Ally:
          alternateViewColor = this.theme.allyColor();
          break;
        case Relationship.Enemy:
          alternateViewColor = this.theme.enemyColor();
          break;
      }
    }

    const sprite = getColoredSprite(
      unit,
      this.theme,
      alternateViewColor ?? customTerritoryColor,
      alternateViewColor ?? undefined,
    );

    if (unit.isActive()) {
      const targetable = unit.targetable();
      if (!targetable) {
        this.context.save();
        this.context.globalAlpha = 0.5;
      }

      const angle = angleByUnit?.get(unit) ?? this.getUnitAngle(unit);
      // OPT 9 — bitwise round
      const cx = (x + 0.5) | 0;
      const cy = (y + 0.5) | 0;
      const newWidth = sprite.width * sizeMult;
      const newHeight = sprite.width * sizeMult;

      if (angle !== null) {
        this.context.save();
        this.context.translate(cx, cy);
        this.context.rotate(angle);
        this.context.translate(-cx, -cy);
      }

      this.context.drawImage(
        sprite,
        cx - newWidth / 2,
        cy - newHeight / 2,
        newWidth,
        newHeight,
      );

      // Level badge
      const type = unit.type();
      if (
        type === UnitType.Warship ||
        type === UnitType.FighterJet ||
        type === UnitType.Submarine ||
        type === UnitType.Bomber
      ) {
        const level = unit.level ? unit.level() : 1;
        const tierColor =
          level >= 4
            ? "#E5E4E2"
            : level === 3
              ? "#FFD700"
              : level === 2
                ? "#C0C0C0"
                : "#CD7F32";
        const badgeSize = Math.max(2, Math.min(3, (newWidth * 0.18 + 0.5) | 0));
        const offset = 1;
        const badgeLeft = (cx + newWidth / 2 + offset + 0.5) | 0;
        const badgeTop = (cy - newHeight / 2 - badgeSize - offset + 0.5) | 0;
        this.context.fillStyle = tierColor;
        this.context.fillRect(badgeLeft, badgeTop, badgeSize, badgeSize);
      }

      if (angle !== null) this.context.restore();
      if (!targetable) this.context.restore();
    }
  }

  private drawSpriteAtPosition(
    unit: UnitView,
    position: { x: number; y: number },
    customTerritoryColor?: Colord,
    context: CanvasRenderingContext2D = this.context,
    snapToPixel = true,
  ) {
    let alternateViewColor: Colord | null = null;
    if (this.alternateView) {
      let rel = this.relationship(unit);
      const destinationId = unit.targetUnitId();
      if (unit.type() === UnitType.TradeShip && destinationId !== undefined) {
        const target = this.game.unit(destinationId)?.owner();
        const myPlayer = this.game.myPlayer();
        if (myPlayer !== null && target !== undefined) {
          if (myPlayer === target) rel = Relationship.Self;
          else if (myPlayer.isFriendly(target)) rel = Relationship.Ally;
        }
      }
      switch (rel) {
        case Relationship.Self:
          alternateViewColor = this.theme.selfColor();
          break;
        case Relationship.Ally:
          alternateViewColor = this.theme.allyColor();
          break;
        case Relationship.Enemy:
          alternateViewColor = this.theme.enemyColor();
          break;
      }
    }

    const sprite = getColoredSprite(
      unit,
      this.theme,
      alternateViewColor ?? customTerritoryColor,
      alternateViewColor ?? undefined,
    );

    if (unit.isActive()) {
      const targetable = unit.targetable();
      if (!targetable) {
        context.save();
        context.globalAlpha = 0.5;
      }

      const offsetX = snapToPixel
        ? (position.x - sprite.width / 2 + 0.5) | 0
        : position.x - sprite.width / 2;
      const offsetY = snapToPixel
        ? (position.y - sprite.width / 2 + 0.5) | 0
        : position.y - sprite.width / 2;

      const isAircraft = ROTATABLE_UNIT_TYPES.has(unit.type());
      let rotated = false;
      if (isAircraft) {
        const angle = this.getUnitAngle(unit);
        if (angle !== null) {
          const cx = offsetX + sprite.width / 2;
          const cy = offsetY + sprite.width / 2;
          context.save();
          context.translate(cx, cy);
          context.rotate(angle);
          context.translate(-cx, -cy);
          rotated = true;
        }
      }

      context.drawImage(sprite, offsetX, offsetY, sprite.width, sprite.width);

      const type = unit.type();
      if (
        type === UnitType.Warship ||
        type === UnitType.FighterJet ||
        type === UnitType.Submarine ||
        type === UnitType.Bomber
      ) {
        const level = (unit as any).level ? (unit as any).level() : 1;
        const tierColor =
          level >= 4
            ? "#E5E4E2"
            : level === 3
              ? "#FFD700"
              : level === 2
                ? "#C0C0C0"
                : "#CD7F32";
        const badgeSize = Math.max(
          2,
          Math.min(3, (sprite.width * 0.18 + 0.5) | 0),
        );
        const offset = 1;
        const cx = offsetX + sprite.width / 2;
        const cy = offsetY + sprite.width / 2;
        const badgeLeft = (cx + sprite.width / 2 + offset + 0.5) | 0;
        const badgeTop = (cy - sprite.width / 2 - badgeSize - offset + 0.5) | 0;
        context.fillStyle = tierColor;
        context.fillRect(badgeLeft, badgeTop, badgeSize, badgeSize);
      }

      if (rotated) context.restore();
      if (!targetable) context.restore();
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Angle computation (OPT 10 — early exit for non-rotatable types)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * OPT 10 — Short-circuit immediately if unit type is not rotatable.
   * Avoids lastTile/tile lookups + math for the majority of units.
   */
  private getUnitAngle(unit: UnitView): number | null {
    if (!ROTATABLE_UNIT_TYPES.has(unit.type())) return null;

    const lastTile = unit.lastTile();
    const currentTile = unit.tile();
    if (!lastTile || !currentTile) return null;

    const lastX = this.game.x(lastTile);
    const lastY = this.game.y(lastTile);
    const curX = this.game.x(currentTile);
    const curY = this.game.y(currentTile);
    const dx = curX - lastX;
    const dy = curY - lastY;

    const lastAngle = this.unitToLastAngle.get(unit);
    if (dx === 0 && dy === 0) return lastAngle ?? null;

    let angle = Math.atan2(dy, dx);

    if (lastAngle !== undefined) {
      const smoothingFactor = 0.25;
      let angleDiff = angle - lastAngle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      angle = lastAngle + angleDiff * smoothingFactor;
    }

    this.unitToLastAngle.set(unit, angle);
    return angle;
  }

  private getSpriteSize(unit: UnitView): number {
    const t = unit.type();
    const existing = this.spriteSizeCache.get(t);
    if (existing !== undefined) return existing;
    const canvas = getColoredSprite(unit, this.theme);
    const size = canvas.width;
    this.spriteSizeCache.set(t, size);
    return size;
  }

  private effectiveSizeMultiplier(unit: UnitView): number {
    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() === this.game.myPlayer()
    ) {
      const isAttacking = ((unit as any).isAttacking?.() ?? false) as boolean;
      const isDetected = ((unit as any).isDetectedByNavalUnit?.() ??
        false) as boolean;
      const isOnCooldown = ((unit as any).isCooldown?.() ?? false) as boolean;
      if (!(isAttacking || isDetected || isOnCooldown)) return 0.75;
    }
    return 1.0;
  }

  private computeTickAlpha(): number {
    const elapsed = Math.min(
      this.now() - this.lastTickTimestamp,
      this.tickIntervalMs,
    );
    if (this.tickIntervalMs === 0) return 1;
    return Math.max(0, elapsed / this.tickIntervalMs);
  }

  private onReplaySpeedChange(multiplier: ReplaySpeedMultiplier) {
    this.replaySpeedMultiplier = multiplier;
    this.updateTickInterval();
    this.lastTickTimestamp = this.now();
  }

  private updateTickInterval() {
    const baseInterval = this.baseTickIntervalMs;
    if (baseInterval <= 0) {
      this.tickIntervalMs = 0;
      return;
    }
    this.tickIntervalMs = baseInterval * this.replaySpeedMultiplier;
  }

  private now(): number {
    if (typeof performance !== "undefined" && performance.now) {
      return performance.now();
    }
    return Date.now();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Ghost management (unchanged)
  // ────────────────────────────────────────────────────────────────────────

  private updateGhosts() {
    const ghosts = (this.game as any).submarineGhosts?.call(this.game) ?? [];
    const currentGhostIds = new Set<number>();

    for (const ghost of ghosts as Array<{
      id: number;
      pos: number;
      expiresAt: number;
      ownerID: number;
    }>) {
      currentGhostIds.add(ghost.id);
      if (!this.renderedGhosts.has(ghost.id)) {
        this.createPixiGhost(ghost);
        this.renderedGhosts.set(ghost.id, ghost.pos);
      }
    }

    const ghostsToRemove: number[] = [];
    for (const [id] of this.renderedGhosts) {
      if (!currentGhostIds.has(id)) {
        ghostsToRemove.push(id);
      }
    }
    for (const id of ghostsToRemove) {
      this.removePixiGhost(id);
      this.renderedGhosts.delete(id);
    }
  }

  private createPixiGhost(ghost: { id: number; pos: number; ownerID: number }) {
    if (!this.pixiRenderer) return;
    const owner = this.game.playerBySmallID(ghost.ownerID);
    if (!owner) return;

    const dummyUnit = {
      tile: () => ghost.pos,
      type: () => UnitType.Submarine,
      owner: () => owner,
      level: () => 1,
      target: () => null,
      isActive: () => true,
    } as unknown as UnitView;

    const texture = this.createPixiTexture(dummyUnit, false);
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.alpha = 0.3;

    const worldX = this.game.x(ghost.pos);
    const worldY = this.game.y(ghost.pos);
    // OPT 4 — reuse _tmpPoint
    this._tmpPoint.x = worldX;
    this._tmpPoint.y = worldY;
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      this._tmpPoint as Cell,
    );
    sprite.x = (screenPos.x + 0.5) | 0;
    sprite.y = (screenPos.y + 0.5) | 0;
    sprite.scale.set(this.iconScreenScale());

    this.pixiStage.addChild(sprite);
    this.ghostRenders.push(
      new GhostRenderInfo(ghost.id, { x: worldX, y: worldY }, sprite),
    );
  }

  private removePixiGhost(ghostId: number) {
    const idx = this.ghostRenders.findIndex((g) => g.ghostId === ghostId);
    if (idx !== -1) {
      this.ghostRenders[idx].pixiSprite.destroy();
      this.ghostRenders.splice(idx, 1);
    }
  }

  private updatePixiGhosts() {
    for (const ghostRender of this.ghostRenders) {
      // OPT 4 — reuse _tmpPoint
      this._tmpPoint.x = ghostRender.position.x;
      this._tmpPoint.y = ghostRender.position.y;
      const screenPos = this.transformHandler.worldToScreenCoordinates(
        this._tmpPoint as Cell,
      );
      ghostRender.pixiSprite.x = (screenPos.x + 0.5) | 0;
      ghostRender.pixiSprite.y = (screenPos.y + 0.5) | 0;
      ghostRender.pixiSprite.scale.set(this.iconScreenScale());
    }
  }
}
