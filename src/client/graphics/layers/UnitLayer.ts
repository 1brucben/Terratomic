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

// PIXI rendering constants
const ICON_TEXTURE_QUALITY = 4; // Render textures at higher pixel density
const ICON_DIM = 28;
const ICON_GROW_ZOOM_THRESHOLD = 2;
const SIZE_SCALE = 0.8; // Units are 20% smaller than structures

// Unit types that use PIXI rendering (GPU-accelerated)
const PIXI_UNIT_TYPES = new Set<UnitType>([
  UnitType.Warship,
  UnitType.Submarine,
  UnitType.Bomber,
  UnitType.FighterJet,
  UnitType.TradeShip,
  UnitType.Shell,
]);

// PIXI render info for tracking sprites
class UnitRenderInfo {
  constructor(
    public unit: UnitView,
    public pixiSprite: PIXI.Sprite,
    public lastAngle: number = 0, // For smooth rotation interpolation
    public facingLeft: boolean = false, // Track horizontal facing direction
  ) {}
}

// Ghost sprite for submarine last-known positions
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

// Unit types that should be rendered by UnitLayer.
// This excludes structures, constructions, and other types handled by specific layers.
const UNIT_LAYER_TYPES = new Set<UnitType>([
  UnitType.TransportShip,
  UnitType.Paratrooper,
  UnitType.Submarine,
  UnitType.Warship,
  // Artillery is rendered by ArtilleryLayer
  UnitType.Shell,
  UnitType.SAMMissile,
  UnitType.TradeShip,
  UnitType.CargoPlane,
  UnitType.MIRVWarhead,
  UnitType.Bomber,
  UnitType.FighterJet,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
]);

export class UnitLayer implements Layer {
  layerName = "UnitLayer";
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private transportShipTrailCanvas: HTMLCanvasElement;
  private unitTrailContext: CanvasRenderingContext2D;
  private interpolationCanvas: HTMLCanvasElement;
  private interpolationContext: CanvasRenderingContext2D;

  private unitToTrail = new Map<UnitView, TileRef[]>();

  private unitToLastAngle = new Map<UnitView, number>();

  private theme: Theme;

  private alternateView = false;

  private oldShellTile = new Map<UnitView, TileRef>();

  private transformHandler: TransformHandler;

  // Selected unit property as suggested in the review comment
  private selectedUnit: UnitView | null = null;

  // Configuration for unit selection
  private readonly WARSHIP_SELECTION_RADIUS = 10; // Radius in game cells for warship selection hit zone
  private readonly SUBMARINE_SELECTION_RADIUS = 10;
  private readonly FIGHTER_JET_SELECTION_RADIUS = 10;

  // Indicates we're in the base-canvas draw pass (used to suppress double-draw)
  private drawingBasePass = false;

  // Unit types that should be interpolated between ticks
  private readonly interpolatedUnitTypes: UnitType[] = [
    UnitType.SAMMissile,
    UnitType.AtomBomb,
    UnitType.HydrogenBomb,
    UnitType.MIRV,
    UnitType.MIRVWarhead,
    UnitType.Shell,
    // AABullet is rendered by AABulletLayer using PIXI
    UnitType.Warship,
    UnitType.TransportShip,
    UnitType.TradeShip,
    UnitType.Submarine,
    UnitType.Bomber,
    UnitType.FighterJet,
    UnitType.CargoPlane,
  ];

  private baseTickIntervalMs = 100;
  private tickIntervalMs = 100;
  private replaySpeedMultiplier: ReplaySpeedMultiplier =
    defaultReplaySpeedMultiplier;
  private lastTickTimestamp = 0;

  // Cache sprite sizes per UnitType to avoid repeated lookups when clearing
  private spriteSizeCache = new Map<UnitType, number>();

  private renderedGhosts = new Map<number, TileRef>();

  // PIXI rendering infrastructure
  private pixiCanvas: HTMLCanvasElement;
  private pixiStage: PIXI.Container;
  private pixiRenderer: PIXI.Renderer;
  private pixiRenders: UnitRenderInfo[] = [];
  private pixiSeenUnits: Set<number> = new Set();
  private textureCache: Map<string, PIXI.Texture> = new Map();
  private targetingTextureCache: Map<string, PIXI.Texture> = new Map(); // Red tint for attacking units
  private starTextureCache: Map<number, PIXI.Texture> = new Map(); // Star level indicators (Phase 1 optimization)

  // Icon images for PIXI units
  private warshipIconImage: HTMLImageElement | null = null;
  private submarineIconImage: HTMLImageElement | null = null;
  private fighterJetIconImage: HTMLImageElement | null = null;
  private bomberIconImage: HTMLImageElement | null = null;
  private tradeShipIconImage: HTMLImageElement | null = null;

  // Submarine ghost sprites
  private ghostRenders: GhostRenderInfo[] = [];
  private renderedUnits = new Map<number, UnitView>();

  // Cache bomber visibility at airfield (updated once per tick instead of 60×/sec)
  private bomberAtAirfield = new Map<number, boolean>();

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

  private loadPixiIcons() {
    // Load warship icon
    const warshipImg = new Image();
    warshipImg.src = warshipIcon;
    warshipImg.onload = () => {
      this.warshipIconImage = warshipImg;
      this.clearTextureCache(UnitType.Warship);
    };

    // Load submarine icon
    const submarineImg = new Image();
    submarineImg.src = submarineIcon;
    submarineImg.onload = () => {
      this.submarineIconImage = submarineImg;
      this.clearTextureCache(UnitType.Submarine);
    };

    // Load fighter jet icon
    const fighterJetImg = new Image();
    fighterJetImg.src = fighterJetIcon;
    fighterJetImg.onload = () => {
      this.fighterJetIconImage = fighterJetImg;
      this.clearTextureCache(UnitType.FighterJet);
    };

    // Load bomber sprite
    const bomberImg = new Image();
    bomberImg.src = bomberSprite;
    bomberImg.onload = () => {
      this.bomberIconImage = bomberImg;
      this.clearTextureCache(UnitType.Bomber);
    };

    // Load trade ship icon
    const tradeShipImg = new Image();
    tradeShipImg.src = tradeShipIcon;
    tradeShipImg.onload = () => {
      this.tradeShipIconImage = tradeShipImg;
      this.clearTextureCache(UnitType.TradeShip);
    };
  }

  private clearTextureCache(unitType: UnitType) {
    // Clear cached textures for this unit type when icon loads/reloads
    const keysToDelete: string[] = [];
    for (const key of this.textureCache.keys()) {
      if (key.includes(unitType.toString())) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.textureCache.delete(key);
      this.targetingTextureCache.delete(key);
    }
  }

  async setupPixiRenderer() {
    this.pixiRenderer = new PIXI.WebGLRenderer();
    this.pixiCanvas = document.createElement("canvas");
    this.pixiCanvas.width = window.innerWidth;
    this.pixiCanvas.height = window.innerHeight;
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

  private createPixiTexture(
    unit: UnitView,
    isTargeting: boolean = false,
  ): PIXI.Texture {
    const border = this.theme.borderColor(unit.owner());
    const unitType = unit.type();

    // Naval units use lighter color for contrast with water, air units use darker
    const isNavalUnit =
      unitType === UnitType.Warship ||
      unitType === UnitType.Submarine ||
      unitType === UnitType.TradeShip;
    const borderColor = isNavalUnit
      ? border.lighten(0.1).toRgbString()
      : border.darken(0.1).toRgbString();

    // Get level, default to 1 if undefined/null, ensure it's a valid number
    const level = (unit.level && unit.level()) || 1;
    const cache = isTargeting ? this.targetingTextureCache : this.textureCache;
    const cacheSuffix = isTargeting ? "-targeting" : "";
    const cacheKey = `${unitType}-${unit.owner().id()}-${borderColor}-${level}${cacheSuffix}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)!;
    }

    const iconImage = this.getIconImage(unitType);
    // If icon not loaded yet, return empty texture and don't cache
    // It will be recreated once the icon loads
    if (!iconImage || !iconImage.complete) {
      return PIXI.Texture.EMPTY;
    }

    const CANVAS_PX = Math.max(1, Math.round(ICON_DIM * ICON_TEXTURE_QUALITY));
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_PX;
    canvas.height = CANVAS_PX;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.scale(ICON_TEXTURE_QUALITY, ICON_TEXTURE_QUALITY);

    // Draw icon (NO background, just icon + stars)
    // Apply player color to icon (targeting shown by marker, not color change)
    const colored = this.getImageColored(iconImage, borderColor);
    const padded = 4;
    const maxW = ICON_DIM - padded * 2;
    const maxH = ICON_DIM - padded * 2;
    const iw = Math.max(1, colored.width);
    const ih = Math.max(1, colored.height);
    const baseScale = Math.min(maxW / iw, maxH / ih);
    // Reduce bomber and fighterjet size to match old sprite sizes
    const factor =
      unitType === UnitType.Bomber || unitType === UnitType.FighterJet
        ? 1.0
        : 1.4;
    const dw = Math.min(
      ICON_DIM,
      Math.max(1, Math.round(iw * baseScale * factor)),
    );
    const dh = Math.min(
      ICON_DIM,
      Math.max(1, Math.round(ih * baseScale * factor)),
    );
    const dx = Math.round((ICON_DIM - dw) / 2);
    const dy = Math.round((ICON_DIM - dh) / 2);

    // Draw icon with player color
    ctx.drawImage(colored, dx, dy, dw, dh);

    // Draw level indicator stars (bronze) in top-left corner
    // FighterJets have stars drawn separately (not in texture) to keep horizontal while sprite rotates
    // TradeShips don't have levels, so skip stars
    // Bombers don't show levels (rotation makes badges look bad)
    if (
      unitType !== UnitType.TradeShip &&
      unitType !== UnitType.Bomber &&
      unitType !== UnitType.FighterJet &&
      level &&
      level >= 1 &&
      level <= 4
    ) {
      const tierColor = "#CD7F32"; // bronze
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

    // Draw small red target marker in top-right when targeting
    if (isTargeting) {
      const markerSize = 5;
      const padding = 1;
      const centerX = ICON_DIM - padding - markerSize / 2;
      const centerY = padding + markerSize / 2;

      ctx.strokeStyle = "#FF0000";
      ctx.lineWidth = 0.8;

      // Draw crosshair
      ctx.beginPath();
      // Outer circle
      ctx.arc(centerX, centerY, markerSize / 2, 0, Math.PI * 2);
      ctx.stroke();
      // Horizontal line
      ctx.moveTo(centerX - markerSize / 2, centerY);
      ctx.lineTo(centerX + markerSize / 2, centerY);
      ctx.stroke();
      // Vertical line
      ctx.moveTo(centerX, centerY - markerSize / 2);
      ctx.lineTo(centerX, centerY + markerSize / 2);
      ctx.stroke();
      ctx.closePath();
    }

    const texture = PIXI.Texture.from(canvas);
    cache.set(cacheKey, texture);
    return texture;
  }

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

  /**
   * Phase 1 Optimization: Get or create cached star texture for a given level
   * Pre-renders stars to reusable textures instead of redrawing graphics every frame
   */
  private getStarTexture(level: number): PIXI.Texture {
    if (this.starTextureCache.has(level)) {
      return this.starTextureCache.get(level)!;
    }

    // Create canvas to render stars
    const canvas = document.createElement("canvas");
    const starSize = 8;
    const spacing = 0.6;
    const padding = 1;

    // Calculate canvas size based on number of stars
    canvas.width = Math.ceil(padding * 2 + level * (starSize + spacing));
    canvas.height = starSize + padding * 2;

    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#cd7f32"; // bronze color

    // Draw stars to canvas
    for (let i = 0; i < level; i++) {
      const x = padding + starSize / 2 + i * (starSize + spacing);
      const y = padding + starSize / 2;
      this.drawStar(ctx, x, y, starSize);
    }

    // Create and cache texture
    const texture = PIXI.Texture.from(canvas);
    this.starTextureCache.set(level, texture);
    return texture;
  }

  private getImageColored(
    image: HTMLImageElement,
    color: string,
  ): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(image, 0, 0);
    return canvas;
  }

  shouldTransform(): boolean {
    return true;
  }

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
    const unitIds = this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => unit.id);

    this.updateUnitsSprites(unitIds ?? []);

    // Sweep for zombies (units that are inactive but weren't in the update list)
    // This fixes the issue where visible entities count > total entities
    const zombieIds: number[] = [];
    for (const [id, unit] of this.renderedUnits) {
      if (!unit.isActive()) {
        zombieIds.push(id);
      }
    }
    if (zombieIds.length > 0) {
      this.updateUnitsSprites(zombieIds);
    }

    // Clean up inactive PIXI sprites
    for (let i = this.pixiRenders.length - 1; i >= 0; i--) {
      const render = this.pixiRenders[i];
      if (!render.unit.isActive()) {
        this.removePixiUnit(render.unit.id());
      }
    }

    this.updateGhosts();
    // Process new/removed PIXI units BEFORE updating bomber-at-airfield cache
    // so newly spawned bombers are included in the cache computation
    this.updatePixiUnits();

    // Update bomber-at-airfield cache for all active bombers
    for (const render of this.pixiRenders) {
      if (render.unit.type() === UnitType.Bomber && render.unit.isActive()) {
        this.bomberAtAirfield.set(
          render.unit.id(),
          this.isUnitAtOwnedAirfield(render.unit),
        );
      }
    }
  }

  private isUnitAtOwnedAirfield(unit: UnitView): boolean {
    const unitOwnerSmallId = unit.owner().smallID();
    const unitTile = unit.tile();
    return (
      this.game
        .units(UnitType.Airfield)
        .find(
          (a) =>
            a.owner().smallID() === unitOwnerSmallId &&
            a.tile() === unitTile &&
            a.isActive(),
        ) !== undefined
    );
  }

  private updatePixiUnits() {
    if (!this.pixiRenderer) return;

    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];

    const metrics = PerformanceMetrics.getInstance();

    // Track execution activity by counting unit updates per type
    // This gives us a proxy for server-side execution activity
    if (metrics.enabled) {
      for (const u of unitUpdates) {
        const unitView = this.game.unit(u.id);
        if (unitView && PIXI_UNIT_TYPES.has(unitView.type())) {
          // Estimate execution time based on update frequency
          // Units that update more frequently are doing more server work
          metrics.recordUnitExecutionTime(unitView.type(), 0.1); // Small constant per update
        }
      }
    }

    for (const u of unitUpdates) {
      const unitView = this.game.unit(u.id);
      if (unitView === undefined) continue;

      // Only handle PIXI units
      if (!PIXI_UNIT_TYPES.has(unitView.type())) {
        continue;
      }

      if (unitView.isActive()) {
        if (!this.pixiSeenUnits.has(unitView.id())) {
          // New PIXI unit
          this.pixiSeenUnits.add(unitView.id());
          const sprite = this.createPixiSprite(unitView);
          const render = new UnitRenderInfo(unitView, sprite);
          // All units now use horizontal flip - no rotation needed
          this.pixiRenders.push(render);
        }
        // Note: All units now use horizontal flip - no rotation angle tracking needed
      } else {
        // Unit removed
        this.removePixiUnit(unitView.id());
        this.bomberAtAirfield.delete(unitView.id());
      }
    }
  }

  private removePixiUnit(unitId: number) {
    const idx = this.pixiRenders.findIndex((r) => r.unit.id() === unitId);
    if (idx !== -1) {
      const render = this.pixiRenders[idx];
      render.pixiSprite.destroy();
      this.pixiRenders.splice(idx, 1);
      this.pixiSeenUnits.delete(unitId);
    }
  }

  private createPixiSprite(unit: UnitView): PIXI.Sprite {
    // Shells use Graphics instead of Sprite textures
    if (unit.type() === UnitType.Shell) {
      const graphics = new PIXI.Graphics() as any;
      this.pixiStage.addChild(graphics);
      return graphics; // Graphics extends Container like Sprite
    }

    // Fighter jets use Container with sprite + horizontal star overlay
    if (unit.type() === UnitType.FighterJet) {
      const container = new PIXI.Container() as any as PIXI.Sprite;
      const texture = this.createPixiTexture(unit, false);
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5, 0.5);
      container.addChild(sprite);

      // Phase 1 Optimization: Use sprite with cached texture instead of Graphics
      const level = unit.level ? unit.level() : 1;
      const starTexture = this.getStarTexture(level);
      const starSprite = new PIXI.Sprite(starTexture);
      starSprite.anchor.set(0, 0); // Top-left anchor
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

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => this.onAlternativeViewEvent(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(UnitSelectionEvent, (e) => this.onUnitSelectionChange(e));
    this.eventBus.on(ReplaySpeedChangeEvent, (e) =>
      this.onReplaySpeedChange(e.replaySpeedMultiplier),
    );

    window.addEventListener("resize", () => this.resizePixiCanvas());

    this.redraw();

    loadAllSprites();

    // Setup PIXI renderer for GPU-accelerated units (async but non-blocking)
    // Once ready, rebuild PIXI sprites for any units that exist
    this.setupPixiRenderer().then(() => {
      this.redrawPixiUnits();
    });
  }

  /**
   * Find player-owned warships near the given cell within a configurable radius
   * @param cell The cell to check
   * @returns Array of player's warships in range, sorted by distance (closest first)
   */
  private findWarshipsNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      // The cell coordinate were invalid (user probably clicked outside the map), therefore no warships can be found
      return [];
    }
    const clickRef = this.game.ref(cell.x, cell.y);

    // Track query for performance monitoring
    PerformanceMetrics.getInstance().recordUnitQuery(UnitType.Warship);

    // Only select warships owned by the player
    return this.game
      .units(UnitType.Warship)
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === this.game.myPlayer() && // Only allow selecting own warships
          this.game.manhattanDist(unit.tile(), clickRef) <=
            this.WARSHIP_SELECTION_RADIUS,
      )
      .sort((a, b) => {
        // Sort by distance (closest first)
        const distA = this.game.manhattanDist(a.tile(), clickRef);
        const distB = this.game.manhattanDist(b.tile(), clickRef);
        return distA - distB;
      });
  }

  private findSubmarinesNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return [];
    }
    const clickRef = this.game.ref(cell.x, cell.y);

    return this.game
      .units(UnitType.Submarine) // <-- Change this line
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === this.game.myPlayer() &&
          this.game.manhattanDist(unit.tile(), clickRef) <=
            this.SUBMARINE_SELECTION_RADIUS, // <-- Change this line
      )
      .sort((a, b) => {
        const distA = this.game.manhattanDist(a.tile(), clickRef);
        const distB = this.game.manhattanDist(b.tile(), clickRef);
        return distA - distB;
      });
  }

  private findFighterJetsNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return [];
    }
    const clickRef = this.game.ref(cell.x, cell.y);

    return this.game
      .units(UnitType.FighterJet)
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === this.game.myPlayer() &&
          this.game.manhattanDist(unit.tile(), clickRef) <=
            this.FIGHTER_JET_SELECTION_RADIUS,
      )
      .sort((a, b) => {
        const distA = this.game.manhattanDist(a.tile(), clickRef);
        const distB = this.game.manhattanDist(b.tile(), clickRef);
        return distA - distB;
      });
  }

  private findArtilleryNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return [];
    }
    const clickRef = this.game.ref(cell.x, cell.y);

    return this.game
      .units(UnitType.Artillery)
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === this.game.myPlayer() &&
          this.game.manhattanDist(unit.tile(), clickRef) <=
            this.WARSHIP_SELECTION_RADIUS, // Reuse warship radius for artillery
      )
      .sort((a, b) => {
        const distA = this.game.manhattanDist(a.tile(), clickRef);
        const distB = this.game.manhattanDist(b.tile(), clickRef);
        return distA - distB;
      });
  }

  private onMouseUp(event: MouseUpEvent) {
    // Convert screen coordinates to world coordinates
    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );

    // Find warships near this cell, sorted by distance
    const nearbyWarships = this.findWarshipsNearCell(cell);
    const nearbySubmarines = this.findSubmarinesNearCell(cell);
    const nearbyFighterJets = this.findFighterJetsNearCell(cell);
    const nearbyArtillery = this.findArtilleryNearCell(cell);

    // unit upgrade mode removed: proceed with selection/move logic only

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
        // Check distance cap before sending move intent
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
      // Mark click as consumed whenever a unit was selected, so other handlers don't also treat it as an attack
      event.consumed = true;
      // Deselect
      this.eventBus.emit(new UnitSelectionEvent(this.selectedUnit, false));
      return;
    } else if (nearbyWarships.length > 0) {
      // Toggle selection of the closest warship
      const clickedUnit = nearbyWarships[0];
      this.eventBus.emit(new UnitSelectionEvent(clickedUnit, true));
    } else if (nearbySubmarines.length > 0) {
      // Toggle selection of the closest submarine
      const clickedUnit = nearbySubmarines[0];
      this.eventBus.emit(new UnitSelectionEvent(clickedUnit, true));
    } else if (nearbyFighterJets.length > 0) {
      const clickedUnit = nearbyFighterJets[0];
      this.eventBus.emit(new UnitSelectionEvent(clickedUnit, true));
    } else if (nearbyArtillery.length > 0) {
      const clickedUnit = nearbyArtillery[0];
      this.eventBus.emit(new UnitSelectionEvent(clickedUnit, true));
    }
  }

  /**
   * Handle unit selection changes
   */
  private onUnitSelectionChange(event: UnitSelectionEvent) {
    if (event.isSelected) {
      this.selectedUnit = event.unit;
    } else if (this.selectedUnit === event.unit) {
      this.selectedUnit = null;
    }
  }

  /**
   * Handle unit deactivation or destruction
   * If the selected unit is removed from the game, deselect it
   */
  private handleUnitDeactivation(unit: UnitView) {
    if (this.selectedUnit === unit && !unit.isActive()) {
      this.eventBus.emit(new UnitSelectionEvent(unit, false));
    }
    this.unitToLastAngle.delete(unit);
  }

  renderLayer(context: CanvasRenderingContext2D) {
    this.updateInterpolatedUnits();

    // Update and render PIXI units
    this.renderPixiUnits(context);

    PerformanceMetrics.getInstance().incrementVisibleEntities(
      this.renderedUnits.size + this.pixiRenders.length,
    );
    context.drawImage(
      this.transportShipTrailCanvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    if (this.interpolationCanvas) {
      context.drawImage(
        this.interpolationCanvas,
        -this.game.width() / 2,
        -this.game.height() / 2,
        this.game.width(),
        this.game.height(),
      );
    }
  }

  private renderPixiUnits(mainContext: CanvasRenderingContext2D) {
    if (!this.pixiRenderer) return;

    const metrics = PerformanceMetrics.getInstance();
    const unitCounts = new Map<UnitType, number>();
    const renderTimes = new Map<UnitType, number>();

    // Get viewport bounds for visibility checking
    const canvasWidth = this.pixiRenderer.canvas.width;
    const canvasHeight = this.pixiRenderer.canvas.height;

    // Update all PIXI sprite positions and states
    for (const render of this.pixiRenders) {
      const startTime = metrics.enabled ? performance.now() : 0;
      this.updatePixiSpritePosition(render);
      if (metrics.enabled) {
        const duration = performance.now() - startTime;
        const currentTime = renderTimes.get(render.unit.type()) ?? 0;
        renderTimes.set(render.unit.type(), currentTime + duration);

        // Track visible count - check if sprite is actually in viewport bounds
        if (render.pixiSprite.visible) {
          const sprite = render.pixiSprite;
          const bounds = sprite.getBounds();
          const isInViewport =
            bounds.x + bounds.width >= 0 &&
            bounds.y + bounds.height >= 0 &&
            bounds.x <= canvasWidth &&
            bounds.y <= canvasHeight;

          if (isInViewport) {
            const count = unitCounts.get(render.unit.type()) ?? 0;
            unitCounts.set(render.unit.type(), count + 1);
          }
        }
      }
    }

    // Record accumulated render times and visible counts
    if (metrics.enabled) {
      renderTimes.forEach((time, unitType) => {
        metrics.recordUnitRenderTime(unitType, time);
      });
      unitCounts.forEach((count, unitType) => {
        metrics.recordUnitVisible(unitType, count);
      });
    }

    // Update ghost sprite positions
    this.updatePixiGhosts();

    // Render PIXI stage to its canvas
    this.pixiRenderer.render(this.pixiStage);

    // Save current transform, reset to DPR base, draw PIXI canvas, then restore.
    // The PIXI canvas is in CSS-pixel space but the backing buffer is DPR-scaled,
    // so we must apply (dpr, 0, 0, dpr) instead of plain identity.
    const dpr = window.devicePixelRatio || 1;
    mainContext.save();
    mainContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    mainContext.drawImage(this.pixiRenderer.canvas, 0, 0);
    mainContext.restore();
  }

  private updatePixiSpritePosition(render: UnitRenderInfo) {
    const unit = render.unit;

    // Handle Shell projectiles with PIXI Graphics
    if (unit.type() === UnitType.Shell) {
      this.updateShellGraphics(render);
      return;
    }

    // Apply rotation to bombers and fighter jets to point them in movement direction
    if (unit.type() === UnitType.Bomber) {
      const atAirfield = this.bomberAtAirfield.get(unit.id()) ?? false;
      if (atAirfield) {
        render.pixiSprite.visible = false;
        return; // Skip rendering this bomber
      } else {
        render.pixiSprite.visible = true;
      }

      // Apply rotation to point bomber in movement direction
      const angle = this.getUnitAngle(unit);
      if (angle !== null) {
        render.pixiSprite.rotation = angle;
      }
    }

    // Fighter jets: rotate sprite child, keep stars horizontal
    if (unit.type() === UnitType.FighterJet) {
      const angle = this.getUnitAngle(unit);
      const jetSprite = (render.pixiSprite as any)._jetSprite;
      const starSprite = (render.pixiSprite as any)._starSprite;

      if (angle !== null && jetSprite) {
        jetSprite.rotation = angle;
      }

      // Phase 1 Optimization: Update star sprite texture only if level changed
      if (starSprite && jetSprite) {
        const level = unit.level ? unit.level() : 1;
        const starTexture = this.getStarTexture(level);

        // Only update texture if it changed (level up/down)
        if (starSprite.texture !== starTexture) {
          starSprite.texture = starTexture;
        }

        // Position stars at top-left of jet sprite
        const spriteWidth = jetSprite.texture.width;
        const spriteHeight = jetSprite.texture.height;
        const padding = 1;

        starSprite.x = -spriteWidth / 2 + padding;
        starSprite.y = -spriteHeight / 2 + padding;
      }
    }

    // Handle submarine stealth opacity (75% when not detected/attacking/cooldown)
    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() === this.game.myPlayer()
    ) {
      const isAttacking = unit.isAttacking();
      const isDetected = unit.isDetectedByNavalUnit();
      const isOnCooldown = unit.isCooldown();
      const isVisibleToEnemies = isAttacking || isDetected || isOnCooldown;
      render.pixiSprite.alpha = isVisibleToEnemies ? 1.0 : 0.75;
    } else {
      render.pixiSprite.alpha = 1.0;
    }

    // Use interpolated position for smooth movement
    // Only interpolate if unit is actually moving between tiles
    const lastTile = unit.lastTile();
    const currentTile = unit.tile();
    const isMoving = lastTile !== currentTile;

    let position: { x: number; y: number };
    if (isMoving) {
      const alpha = this.computeTickAlpha();
      position = this.interpolatePosition(unit, alpha);
    } else {
      // Unit is stationary - use exact tile position
      position = {
        x: this.game.x(currentTile),
        y: this.game.y(currentTile),
      };
    }

    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(position.x, position.y),
    );

    render.pixiSprite.x = Math.floor(screenPos.x + 0.5);
    render.pixiSprite.y = Math.floor(screenPos.y + 0.5);

    // Set scale (including horizontal flip for all PIXI units based on direction)
    const baseScale = this.iconScreenScale();

    // PIXI units with horizontal flip based on east/west movement
    // Bombers and FighterJets use rotation instead of flip
    if (
      unit.type() === UnitType.Warship ||
      unit.type() === UnitType.Submarine ||
      unit.type() === UnitType.TradeShip
    ) {
      if (lastTile && currentTile) {
        const lastX = this.game.x(lastTile);
        const currentX = this.game.x(currentTile);
        const dx = currentX - lastX;
        // Only update facing direction when moving horizontally
        if (dx !== 0) {
          render.facingLeft = dx < 0;
        }
        // Use stored facing direction
        const scaleX = render.facingLeft ? -baseScale : baseScale;
        render.pixiSprite.scale.set(scaleX, baseScale);
      } else {
        render.pixiSprite.scale.set(baseScale, baseScale);
      }
    } else {
      render.pixiSprite.scale.set(baseScale, baseScale);
    }

    // Handle targeting tint for Warship and FighterJet
    const isTargeting = this.isUnitTargeting(unit);
    const texture = this.createPixiTexture(unit, isTargeting);
    if (render.pixiSprite.texture !== texture) {
      render.pixiSprite.texture = texture;
    }

    // All units now use horizontal flip - no rotation needed
  }

  private updateShellGraphics(render: UnitRenderInfo) {
    const unit = render.unit;
    const graphics = render.pixiSprite as any as PIXI.Graphics;

    graphics.clear();

    // Get color
    const color = this.theme.borderColor(unit.owner());
    const colorNum = parseInt(color.toHex().substring(1), 16);

    // Interpolate position
    const alpha = this.computeTickAlpha();
    const position = this.interpolatePosition(unit, alpha);

    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(position.x, position.y),
    );

    // Draw trail from last position
    const lastTile = unit.lastTile();
    const lastWorldPos = { x: this.game.x(lastTile), y: this.game.y(lastTile) };

    if (lastWorldPos.x !== position.x || lastWorldPos.y !== position.y) {
      const lastScreenPos = this.transformHandler.worldToScreenCoordinates(
        new Cell(lastWorldPos.x, lastWorldPos.y),
      );

      // Draw trail line
      graphics.lineStyle(1, colorNum, 0.7);
      graphics.moveTo(lastScreenPos.x, lastScreenPos.y);
      graphics.lineTo(screenPos.x, screenPos.y);
    }

    // Draw center pixel (1x1)
    graphics.beginFill(colorNum, 1.0);
    graphics.drawRect(screenPos.x - 0.5, screenPos.y - 0.5, 1, 1);
    graphics.endFill();

    // Draw outer glow (2x2)
    graphics.beginFill(colorNum, 0.4);
    graphics.drawRect(screenPos.x - 1, screenPos.y - 1, 2, 2);
    graphics.endFill();
  }

  private isUnitTargeting(unit: UnitView): boolean {
    // Warships, Submarines, and FighterJets show target marker when attacking
    if (
      unit.type() === UnitType.Warship ||
      unit.type() === UnitType.Submarine ||
      unit.type() === UnitType.FighterJet
    ) {
      return unit.targetUnitId() !== undefined;
    }
    return false;
  }

  onAlternativeViewEvent(event: AlternateViewEvent) {
    this.alternateView = event.alternateView;
    this.redraw();
  }

  redraw() {
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.transportShipTrailCanvas = document.createElement("canvas");
    const trailContext = this.transportShipTrailCanvas.getContext("2d");
    if (trailContext === null) throw new Error("2d context not supported");
    this.unitTrailContext = trailContext;
    this.interpolationCanvas = document.createElement("canvas");
    const interpolationContext = this.interpolationCanvas.getContext("2d");
    if (interpolationContext === null)
      throw new Error("2d context not supported");
    this.interpolationContext = interpolationContext;
    this.interpolationContext.imageSmoothingEnabled = false;

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.transportShipTrailCanvas.width = this.game.width();
    this.transportShipTrailCanvas.height = this.game.height();
    this.interpolationCanvas.width = this.game.width();
    this.interpolationCanvas.height = this.game.height();

    this.renderedUnits.clear();
    const units = this.game.units();
    units.forEach((u) => {
      // Only add non-PIXI units to renderedUnits (PIXI units are tracked separately)
      if (UNIT_LAYER_TYPES.has(u.type()) && !PIXI_UNIT_TYPES.has(u.type())) {
        this.renderedUnits.set(u.id(), u);
      }
    });
    this.updateUnitsSprites(units.map((unit) => unit.id()));

    // Rebuild PIXI sprites
    this.redrawPixiUnits();

    // After redrawing units, render submarine ghosts (last known positions)
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

    // Clear existing PIXI sprites
    for (const render of this.pixiRenders) {
      render.pixiSprite.destroy();
    }
    this.pixiRenders = [];
    this.pixiSeenUnits.clear();

    // Clear existing ghost sprites
    for (const ghost of this.ghostRenders) {
      ghost.pixiSprite.destroy();
    }
    this.ghostRenders = [];

    // Recreate sprites for all active PIXI units
    const units = this.game.units();
    for (const unit of units) {
      if (PIXI_UNIT_TYPES.has(unit.type()) && unit.isActive()) {
        this.pixiSeenUnits.add(unit.id());
        const sprite = this.createPixiSprite(unit);
        this.pixiRenders.push(new UnitRenderInfo(unit, sprite));
      }
    }
  }

  private updateUnitsSprites(unitIds: number[]) {
    const unitsToUpdate: UnitView[] = [];
    const unitsToRemove: UnitView[] = [];

    if (unitIds) {
      for (const id of unitIds) {
        const unit = this.game.unit(id);
        if (unit) {
          // Only handle non-PIXI units (PIXI units tracked separately)
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
    }

    const allUnitsToClear = [...unitsToUpdate, ...unitsToRemove];

    if (allUnitsToClear.length > 0) {
      const oldAngleByUnit = new Map<UnitView, number | null>();
      for (const u of allUnitsToClear) {
        oldAngleByUnit.set(u, this.unitToLastAngle.get(u) ?? null);
      }

      // Precompute angles once per unit to avoid duplicate work across passes
      const angleByUnit = new Map<UnitView, number | null>();
      for (const u of unitsToUpdate) {
        // Only aircraft currently use angles; others will return null quickly
        angleByUnit.set(u, this.getUnitAngle(u));
      }

      // the clearing and drawing of unit sprites need to be done in 2 passes
      // otherwise the sprite of a unit can be drawn on top of another unit
      this.clearUnitsCells(allUnitsToClear, oldAngleByUnit);
      this.drawUnitsCells(unitsToUpdate, angleByUnit);

      // Handle deactivation for removed units
      for (const u of unitsToRemove) {
        this.handleUnitDeactivation(u);
      }
    }
  }

  private clearUnitsCells(
    unitViews: UnitView[],
    angleByUnit: Map<UnitView, number | null>,
  ) {
    unitViews
      .filter((unitView) => isSpriteReady(unitView.type()))
      .forEach((unitView) => {
        // Compute the same geometry used during draw to clear sprite + dot overlays
        const spriteSize = this.getSpriteSize(unitView);
        const sizeMult = this.effectiveSizeMultiplier(unitView);
        const newWidth = spriteSize * sizeMult;
        const newHeight = spriteSize * sizeMult;

        // Badge overlay parameters: badge sits 1px outside top-right
        const level = (unitView as any).level ? (unitView as any).level() : 1;
        const badgeSize = Math.max(2, Math.min(3, Math.round(newWidth * 0.18)));
        const offset = 1;
        const overlayTop = badgeSize + offset; // extend upwards to cover outside badge
        const extraRight = badgeSize + offset; // full right-side extension beyond sprite

        const padding = 2; // small safety margin around computed bounds
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

        // Clear an axis-aligned box in the rotated space that covers the sprite and the dots above
        const left = lastX - maxHalfWidth - padding;
        const top = lastY - newHeight / 2 - overlayTop - padding;
        const width = maxHalfWidth * 2 + padding * 2;
        const height = newHeight + overlayTop + padding * 2;
        this.context.clearRect(left, top, width, height);

        if (angle !== null) {
          this.context.restore();
        }
      });
  }

  private drawUnitsCells(
    unitViews: UnitView[],
    angleByUnit: Map<UnitView, number | null>,
  ) {
    // Suppress base-canvas sprites for units that are also drawn via interpolation overlay
    this.drawingBasePass = true;

    const metrics = PerformanceMetrics.getInstance();
    const canvasUnitCounts = new Map<UnitType, number>();
    const canvasRenderTimes = new Map<UnitType, number>();

    // Get canvas viewport bounds for visibility checking
    const canvasWidth = this.context.canvas.width;
    const canvasHeight = this.context.canvas.height;
    const halfWidth = this.game.width() / 2;
    const halfHeight = this.game.height() / 2;

    try {
      for (const unitView of unitViews) {
        if (!PIXI_UNIT_TYPES.has(unitView.type())) {
          const startTime = metrics.enabled ? performance.now() : 0;
          this.onUnitEvent(unitView, angleByUnit);
          if (metrics.enabled) {
            const duration = performance.now() - startTime;
            const currentTime = canvasRenderTimes.get(unitView.type()) ?? 0;
            canvasRenderTimes.set(unitView.type(), currentTime + duration);

            // Check if unit is actually in viewport
            const worldX = this.game.x(unitView.tile());
            const worldY = this.game.y(unitView.tile());
            const screenPos = this.transformHandler.worldToScreenCoordinates(
              new Cell(worldX, worldY),
            );

            // Check if position is within canvas bounds (with some margin for sprite size)
            const margin = 50; // Sprite can be up to 50px
            const isInViewport =
              screenPos.x >= -margin &&
              screenPos.y >= -margin &&
              screenPos.x <= canvasWidth + margin &&
              screenPos.y <= canvasHeight + margin;

            if (isInViewport) {
              const count = canvasUnitCounts.get(unitView.type()) ?? 0;
              canvasUnitCounts.set(unitView.type(), count + 1);
            }
          }
        } else {
          // PIXI units still need to be processed for other effects
          this.onUnitEvent(unitView, angleByUnit);
        }
      }

      // Record accumulated times and counts
      if (metrics.enabled) {
        canvasRenderTimes.forEach((time, unitType) => {
          metrics.recordUnitRenderTime(unitType, time);
        });
        canvasUnitCounts.forEach((count, unitType) => {
          metrics.recordUnitVisible(unitType, count);
        });
      }
    } finally {
      this.drawingBasePass = false;
    }
  }

  private interpolatePosition(unit: UnitView, alpha: number) {
    const startTile = unit.lastTile();
    const endTile = unit.tile();

    const startX = this.game.x(startTile);
    const startY = this.game.y(startTile);
    const endX = this.game.x(endTile);
    const endY = this.game.y(endTile);

    return {
      x: startX + (endX - startX) * alpha,
      y: startY + (endY - startY) * alpha,
    };
  }

  private updateInterpolatedUnits() {
    if (!this.interpolationContext || !this.interpolationCanvas) {
      return;
    }

    this.interpolationContext.clearRect(
      0,
      0,
      this.interpolationCanvas.width,
      this.interpolationCanvas.height,
    );

    const alpha = this.computeTickAlpha();
    const units = this.game.units(...this.interpolatedUnitTypes);

    for (const unit of units) {
      if (!unit.isActive()) {
        continue;
      }

      // Skip PIXI units - they're rendered by the PIXI renderer
      if (PIXI_UNIT_TYPES.has(unit.type())) {
        continue;
      }

      // Hide bombers at their airfield
      if (unit.type() === UnitType.Bomber) {
        if (this.isUnitAtOwnedAirfield(unit)) {
          continue; // Skip rendering this bomber
        }
      }

      // Respect submarine visibility rules from onUnitEvent
      if (
        unit.type() === UnitType.Submarine &&
        unit.owner() !== this.game.myPlayer()
      ) {
        // Server handles visibility filtering.
      }

      // Skip AABullets - they're rendered by AABulletLayer
      if (unit.type() === UnitType.AABullet) {
        continue;
      }

      const position = this.interpolatePosition(unit, alpha);

      switch (unit.type()) {
        case UnitType.Shell:
          this.renderShell(unit, position);
          continue;
        case UnitType.MIRVWarhead:
          this.renderWarhead(unit, position);
          continue;
        default:
          if (!isSpriteReady(unit.type())) {
            continue;
          }
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
      if (
        unit.type() === UnitType.Warship ||
        unit.type() === UnitType.FighterJet
      ) {
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
    if (!this.interpolationContext) {
      return;
    }
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
    if (!this.interpolationContext) {
      return;
    }
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
    if (myPlayer === null) {
      return Relationship.Enemy;
    }
    if (myPlayer === unit.owner()) {
      return Relationship.Self;
    }
    if (myPlayer.isFriendly(unit.owner())) {
      return Relationship.Ally;
    }
    return Relationship.Enemy;
  }

  onUnitEvent(unit: UnitView, angleByUnit?: Map<UnitView, number | null>) {
    // Skip PIXI units - they're rendered by the PIXI renderer
    if (PIXI_UNIT_TYPES.has(unit.type())) {
      return;
    }

    // Check if unit was deactivated
    if (!unit.isActive()) {
      this.handleUnitDeactivation(unit);
    }

    // Hide bombers at their airfield
    if (unit.type() === UnitType.Bomber) {
      if (this.isUnitAtOwnedAirfield(unit)) {
        return; // Skip rendering this bomber
      }
    }

    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() !== this.game.myPlayer()
    ) {
      // Server handles visibility filtering (including linger time).
      // If we receive an update for an enemy sub, it should be visible.
      // We trust the server's judgment here to avoid client-side lag when linger is active.
    }

    // START: Custom rendering for owner's submarine visibility
    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() === this.game.myPlayer()
    ) {
      const isAttacking = unit.isAttacking();
      const isDetected = unit.isDetectedByNavalUnit();
      const isOnCooldown = unit.isCooldown();
      const isVisibleToEnemies = isAttacking || isDetected || isOnCooldown;
      if (!isVisibleToEnemies) {
        this.drawSprite(unit, undefined, 0.75);
        return;
      }
    }
    // END: Custom rendering

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
        this.handleArtilleryEvent(unit, angleByUnit);
        break;
      case UnitType.Shell:
        this.handleShellEvent(unit);
        break;
      // AABullet is handled by AABulletLayer
      case UnitType.SAMMissile:
        this.handleMissileEvent(unit);
        break;
      case UnitType.TradeShip:
        this.handleTradeShipEvent(unit, angleByUnit);
        break;
      case UnitType.CargoPlane:
        this.handleCargoPlaneEvent(unit, angleByUnit);
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

  private handleArtilleryEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    // Artillery is now rendered by StructureLayer (GPU-accelerated PIXI)
  }

  private handleShellEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    // Clear current and previous positions
    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));
    const oldTile = this.oldShellTile.get(unit);
    if (oldTile !== undefined) {
      this.clearCell(this.game.x(oldTile), this.game.y(oldTile));
    }

    this.oldShellTile.set(unit, unit.lastTile());
    if (!unit.isActive()) {
      return;
    }

    // Paint current and previous positions
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

  // interception missle from SAM
  private handleMissileEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    this.drawSprite(unit, undefined, angleByUnit);
  }

  private drawTrail(trail: number[], color: Colord, rel: Relationship) {
    // Paint new trail
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

    // Repaint overlapping trails
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
    const trail = this.unitToTrail.get(unit) ?? [];
    // It can move faster than 1 pixel, draw a line for the trail or else it will be dotted
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

  private handleMIRVWarhead(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    const rel = this.relationship(unit);

    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));

    if (unit.isActive()) {
      // Paint area
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

  private handleCargoPlaneEvent(
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
    const trail = this.unitToTrail.get(unit) ?? [];
    trail.push(unit.lastTile());

    // Paint trail
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

  drawSprite(
    unit: UnitView,
    customTerritoryColor?: Colord,
    sizeMultiplier?: number,
  );
  drawSprite(
    unit: UnitView,
    customTerritoryColor?: Colord,
    angleByUnit?: Map<UnitView, number | null>,
    sizeMultiplier?: number,
  );
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

    // If we're in the base pass and this unit type is interpolated, skip drawing the sprite
    // to avoid double images (the interpolation overlay will render it smoothly).
    if (
      this.drawingBasePass &&
      this.interpolatedUnitTypes.includes(unit.type())
    ) {
      return;
    }

    const x = this.game.x(unit.tile());
    const y = this.game.y(unit.tile());

    let alternateViewColor: Colord | null = null;

    if (this.alternateView) {
      let rel = this.relationship(unit);
      const destinationId = unit.targetUnitId();
      if (
        (unit.type() === UnitType.TradeShip ||
          unit.type() === UnitType.CargoPlane) &&
        destinationId !== undefined
      ) {
        const target = this.game.unit(destinationId)?.owner();
        const myPlayer = this.game.myPlayer();
        if (myPlayer !== null && target !== undefined) {
          if (myPlayer === target) {
            rel = Relationship.Self;
          } else if (myPlayer.isFriendly(target)) {
            rel = Relationship.Ally;
          }
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
      const cx = Math.round(x);
      const cy = Math.round(y);
      const newWidth = sprite.width * sizeMult;
      const newHeight = sprite.width * sizeMult; // Keep aspect ratio square

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

      // Draw a tiny top-right corner badge offset 1px outside the sprite
      // Only for Warships, FighterJets, Submarines, and Bombers
      const type = unit.type();
      if (
        type === UnitType.Warship ||
        type === UnitType.FighterJet ||
        type === UnitType.Submarine ||
        type === UnitType.Bomber
      ) {
        const level = unit.level ? unit.level() : 1;
        // Tier color mapping: 1→bronze, 2→silver, 3→gold, 4+→platinum
        const tierColor =
          level >= 4
            ? "#E5E4E2" /* platinum */
            : level === 3
              ? "#FFD700" /* gold */
              : level === 2
                ? "#C0C0C0" /* silver */
                : "#CD7F32"; /* bronze */
        // Badge size: crisp 2–3 px depending on sprite size
        const badgeSize = Math.max(2, Math.min(3, Math.round(newWidth * 0.18)));
        // Offset 1px to the right and 1px above the sprite's top-right corner
        const offset = 1;
        const badgeLeft = Math.round(cx + newWidth / 2 + offset);
        const badgeTop = Math.round(cy - newHeight / 2 - badgeSize - offset);
        this.context.fillStyle = tierColor;
        this.context.fillRect(badgeLeft, badgeTop, badgeSize, badgeSize);
      }

      if (angle !== null) {
        this.context.restore();
      }

      if (!targetable) {
        this.context.restore();
      }
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
      if (
        (unit.type() === UnitType.TradeShip ||
          unit.type() === UnitType.CargoPlane) &&
        destinationId !== undefined
      ) {
        const target = this.game.unit(destinationId)?.owner();
        const myPlayer = this.game.myPlayer();
        if (myPlayer !== null && target !== undefined) {
          if (myPlayer === target) {
            rel = Relationship.Self;
          } else if (myPlayer.isFriendly(target)) {
            rel = Relationship.Ally;
          }
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
        ? Math.round(position.x - sprite.width / 2)
        : position.x - sprite.width / 2;
      const offsetY = snapToPixel
        ? Math.round(position.y - sprite.width / 2)
        : position.y - sprite.width / 2;

      // Apply rotation on interpolation overlay for aircraft
      const isAircraft =
        unit.type() === UnitType.Bomber ||
        unit.type() === UnitType.FighterJet ||
        unit.type() === UnitType.CargoPlane;
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

      // Draw the same tiny badge on interpolation overlay for select unit types
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
            ? "#E5E4E2" /* platinum */
            : level === 3
              ? "#FFD700" /* gold */
              : level === 2
                ? "#C0C0C0" /* silver */
                : "#CD7F32"; /* bronze */
        const badgeSize = Math.max(
          2,
          Math.min(3, Math.round(sprite.width * 0.18)),
        );
        const offset = 1;
        const cx = offsetX + sprite.width / 2;
        const cy = offsetY + sprite.width / 2;
        const badgeLeft = Math.round(cx + sprite.width / 2 + offset);
        const badgeTop = Math.round(cy - sprite.width / 2 - badgeSize - offset);
        context.fillStyle = tierColor;
        context.fillRect(badgeLeft, badgeTop, badgeSize, badgeSize);
      }

      if (rotated) {
        context.restore();
      }

      if (!targetable) {
        context.restore();
      }
    }
  }

  private getUnitAngle(unit: UnitView): number | null {
    const lastTile = unit.lastTile();
    const currentTile = unit.tile();

    if (
      lastTile &&
      currentTile &&
      (unit.type() === UnitType.Bomber ||
        unit.type() === UnitType.FighterJet ||
        unit.type() === UnitType.CargoPlane)
    ) {
      const lastPos = { x: this.game.x(lastTile), y: this.game.y(lastTile) };
      const currentPos = {
        x: this.game.x(currentTile),
        y: this.game.y(currentTile),
      };
      const dx = currentPos.x - lastPos.x;
      const dy = currentPos.y - lastPos.y;

      const lastAngle = this.unitToLastAngle.get(unit);

      if (dx === 0 && dy === 0) {
        return lastAngle ?? null;
      }

      let angle = Math.atan2(dy, dx);

      // Note: FighterJet SVG icon is already oriented correctly (pointing right at 0 degrees)
      // Old PNG sprites needed +PI/2 adjustment, but new SVG icons don't

      if (lastAngle !== undefined) {
        // Determines how quickly the unit realigns its orientation.
        // A smaller value results in a longer period of realignment.
        const smoothingFactor = 0.25;
        let angleDiff = angle - lastAngle;

        // Normalize the angle difference to be between -PI and PI
        while (angleDiff > Math.PI) {
          angleDiff -= 2 * Math.PI;
        }
        while (angleDiff < -Math.PI) {
          angleDiff += 2 * Math.PI;
        }

        angle = lastAngle + angleDiff * smoothingFactor;
      }

      this.unitToLastAngle.set(unit, angle);
      return angle;
    }
    return null;
  }

  // Get square sprite size for a unit type, cached
  private getSpriteSize(unit: UnitView): number {
    const t = unit.type();
    const existing = this.spriteSizeCache.get(t);
    if (existing !== undefined) return existing;
    // Use a single colored sprite to get width; colorization does not affect size
    const canvas = getColoredSprite(unit, this.theme);
    const size = canvas.width;
    this.spriteSizeCache.set(t, size);
    return size;
  }

  // Mirror draw-time size multiplier decisions for clearing
  private effectiveSizeMultiplier(unit: UnitView): number {
    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() === this.game.myPlayer()
    ) {
      const isAttacking = ((unit as any).isAttacking?.() ?? false) as boolean;
      const isDetected = ((unit as any).isDetectedByNavalUnit?.() ??
        false) as boolean;
      const isOnCooldown = ((unit as any).isCooldown?.() ?? false) as boolean;
      const isVisibleToEnemies = isAttacking || isDetected || isOnCooldown;
      if (!isVisibleToEnemies) {
        return 0.75;
      }
    }
    return 1.0;
  }

  private computeTickAlpha(): number {
    const elapsed = Math.min(
      this.now() - this.lastTickTimestamp,
      this.tickIntervalMs,
    );
    if (this.tickIntervalMs === 0) {
      return 1;
    }
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

    // Remove ghosts that are no longer active
    const ghostsToRemove: number[] = [];
    for (const [id, pos] of this.renderedGhosts) {
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

    // Create a dummy unit view to get the correct texture
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
    sprite.alpha = 0.3; // Ghosts at 30% opacity

    // Position the ghost
    const worldX = this.game.x(ghost.pos);
    const worldY = this.game.y(ghost.pos);
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(worldX, worldY),
    );
    sprite.x = Math.floor(screenPos.x + 0.5);
    sprite.y = Math.floor(screenPos.y + 0.5);
    sprite.scale.set(this.iconScreenScale());

    this.pixiStage.addChild(sprite);
    this.ghostRenders.push(
      new GhostRenderInfo(ghost.id, { x: worldX, y: worldY }, sprite),
    );
  }

  private removePixiGhost(ghostId: number) {
    // Find ghost sprite by ID
    const idx = this.ghostRenders.findIndex(
      (ghost) => ghost.ghostId === ghostId,
    );

    if (idx !== -1) {
      const ghostRender = this.ghostRenders[idx];
      ghostRender.pixiSprite.destroy();
      this.ghostRenders.splice(idx, 1);
    }
  }

  private updatePixiGhosts() {
    // Update ghost positions on camera transform
    for (const ghostRender of this.ghostRenders) {
      const screenPos = this.transformHandler.worldToScreenCoordinates(
        new Cell(ghostRender.position.x, ghostRender.position.y),
      );
      ghostRender.pixiSprite.x = Math.floor(screenPos.x + 0.5);
      ghostRender.pixiSprite.y = Math.floor(screenPos.y + 0.5);
      ghostRender.pixiSprite.scale.set(this.iconScreenScale());
    }
  }

  private clearGhost(ghost: { pos: number; ownerID: number }) {
    // No longer needed for PIXI rendering - kept for compatibility
  }

  private drawGhost(ghost: { id: number; pos: number; ownerID: number }) {
    // No longer needed for PIXI rendering - kept for compatibility
  }
}
