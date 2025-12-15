import * as PIXI from "pixi.js";
import artilleryIcon from "../../../../proprietary/images/artillery-battery.png";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { Cell, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

// Render textures at higher pixel density to stay crisp when scaled
const ICON_TEXTURE_QUALITY = 4;
const ICON_DIM = 28;
const ICON_GROW_ZOOM_THRESHOLD = 2;
// Artillery is 20% smaller than structures
const SIZE_SCALE = 0.8;

class ArtilleryRenderInfo {
  public healthBarGraphics: PIXI.Graphics | null = null;

  constructor(
    public unit: UnitView,
    public pixiSprite: PIXI.Sprite,
  ) {}
}

// Track when artillery last fired to show red flash for multiple ticks
const FIRING_FLASH_DURATION = 30; // ticks

// Health bar colors and dimensions
const HEALTH_BAR_COLORS = [0xe81919, 0xf07a19, 0xcae70f, 0x2cef12]; // red, orange, yellow, green

export class ArtilleryLayer implements Layer {
  layerName = "ArtilleryLayer";
  private pixiCanvas: HTMLCanvasElement;
  private stage: PIXI.Container;
  private renderer: PIXI.Renderer;
  private theme: Theme;
  private renders: ArtilleryRenderInfo[] = [];
  private seenUnits: Set<number> = new Set();
  private textureCache: Map<string, PIXI.Texture> = new Map();
  private firingTextureCache: Map<string, PIXI.Texture> = new Map();
  private artilleryIconImage: HTMLImageElement | null = null;
  private lastFiredTick: Map<number, number> = new Map(); // unitId -> tick

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.loadIcon();
  }

  private loadIcon() {
    const img = new Image();
    img.src = artilleryIcon;
    img.onload = () => {
      this.artilleryIconImage = img;
      this.textureCache.clear();
    };
  }

  shouldTransform(): boolean {
    // Like StructureLayer: we handle transforms manually via screen coordinates
    return false;
  }

  async init() {
    window.addEventListener("resize", () => this.resizeCanvas());
    await this.setupRenderer();
  }

  async setupRenderer() {
    this.renderer = new PIXI.WebGLRenderer();
    this.pixiCanvas = document.createElement("canvas");
    this.pixiCanvas.width = window.innerWidth;
    this.pixiCanvas.height = window.innerHeight;
    this.stage = new PIXI.Container();
    await this.renderer.init({
      canvas: this.pixiCanvas,
      resolution: 1,
      width: this.pixiCanvas.width,
      height: this.pixiCanvas.height,
      clearBeforeRender: true,
      backgroundAlpha: 0,
      backgroundColor: 0x00000000,
    });
  }

  resizeCanvas() {
    if (this.renderer?.view) {
      this.pixiCanvas.width = window.innerWidth;
      this.pixiCanvas.height = window.innerHeight;
      this.renderer.resize(innerWidth, innerHeight, 1);
    }
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];

    for (const u of unitUpdates) {
      const unitView = this.game.unit(u.id);
      if (unitView === undefined) continue;

      if (unitView.type() !== UnitType.Artillery) {
        // Check if this is a shell - artillery is firing
        if (unitView.type() === UnitType.Shell && unitView.isActive()) {
          // Find which artillery fired by checking lastTile (origin of shell)
          const shellOriginTile = unitView.lastTile();
          const artilleryUnits = this.game.units(UnitType.Artillery);
          for (const artillery of artilleryUnits) {
            if (
              artillery.owner() === unitView.owner() &&
              artillery.tile() === shellOriginTile
            ) {
              // Mark this specific artillery as recently fired
              this.lastFiredTick.set(artillery.id(), this.game.ticks());
              break; // Found the firing artillery
            }
          }
        }
        continue;
      }

      if (unitView.isActive()) {
        if (!this.seenUnits.has(unitView.id())) {
          // New artillery unit
          this.seenUnits.add(unitView.id());
          const sprite = this.createSprite(unitView);
          this.renders.push(new ArtilleryRenderInfo(unitView, sprite));
        } else {
          // Update health bar for existing unit
          const render = this.renders.find(
            (r) => r.unit.id() === unitView.id(),
          );
          if (render) {
            this.updateHealthBar(render);
          }
        }
      } else {
        // Unit removed
        this.removeUnit(unitView.id());
      }
    }
  }

  private removeUnit(unitId: number) {
    const idx = this.renders.findIndex((r) => r.unit.id() === unitId);
    if (idx !== -1) {
      const render = this.renders[idx];
      render.pixiSprite.destroy();
      if (render.healthBarGraphics) {
        render.healthBarGraphics.destroy();
        render.healthBarGraphics = null;
      }
      this.renders.splice(idx, 1);
      this.seenUnits.delete(unitId);
    }
  }

  renderLayer(mainContext: CanvasRenderingContext2D) {
    if (!this.renderer) return;

    // Update all sprite positions and scales
    for (const render of this.renders) {
      this.updateSpritePosition(render);
      this.updateHealthBar(render);
    }

    this.renderer.render(this.stage);
    mainContext.drawImage(this.renderer.canvas, 0, 0);
  }

  private updateSpritePosition(render: ArtilleryRenderInfo) {
    const tile = render.unit.tile();
    const worldX = this.game.x(tile);
    const worldY = this.game.y(tile);
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(worldX, worldY),
    );
    render.pixiSprite.x = Math.floor(screenPos.x + 0.5);
    render.pixiSprite.y = Math.floor(screenPos.y + 0.5);
    render.pixiSprite.scale.set(this.iconScreenScale());

    // Flash red background when recently fired
    const lastFired = this.lastFiredTick.get(render.unit.id()) ?? 0;
    const ticksSinceFired = this.game.ticks() - lastFired;
    const isFiring = ticksSinceFired < FIRING_FLASH_DURATION;

    const texture = isFiring
      ? this.createFiringTexture(render.unit)
      : this.createTexture(render.unit);
    if (render.pixiSprite.texture !== texture) {
      render.pixiSprite.texture = texture;
    }
  }

  private iconScreenScale(): number {
    const s = this.transformHandler.scale;
    if (s <= ICON_GROW_ZOOM_THRESHOLD) {
      return (Math.min(1, s) / ICON_TEXTURE_QUALITY) * SIZE_SCALE;
    }
    return (s / ICON_GROW_ZOOM_THRESHOLD / ICON_TEXTURE_QUALITY) * SIZE_SCALE;
  }

  private createSprite(unit: UnitView): PIXI.Sprite {
    const texture = this.createTexture(unit);
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    this.stage.addChild(sprite);
    return sprite;
  }

  private createTexture(unit: UnitView): PIXI.Texture {
    return this.createTextureWithBackground(
      unit,
      "#c9dbff",
      this.textureCache,
      "",
    );
  }

  private createFiringTexture(unit: UnitView): PIXI.Texture {
    return this.createTextureWithBackground(
      unit,
      "#b86b6b",
      this.firingTextureCache,
      "-firing",
    );
  }

  private createTextureWithBackground(
    unit: UnitView,
    backgroundColor: string,
    cache: Map<string, PIXI.Texture>,
    cacheSuffix: string,
  ): PIXI.Texture {
    const border = this.theme.borderColor(unit.owner());
    const borderColor = border.darken(0.17).toRgbString();
    const level = unit.level ? unit.level() : 1;
    const cacheKey = `${unit.owner().id()}-${borderColor}-${level}${cacheSuffix}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)!;
    }

    const CANVAS_PX = Math.max(1, Math.round(ICON_DIM * ICON_TEXTURE_QUALITY));
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_PX;
    canvas.height = CANVAS_PX;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.scale(ICON_TEXTURE_QUALITY, ICON_TEXTURE_QUALITY);

    // Draw background square
    const pad = 0.5;
    ctx.beginPath();
    ctx.rect(pad, pad, ICON_DIM - pad * 2, ICON_DIM - pad * 2);
    ctx.fillStyle = backgroundColor;
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw icon
    if (this.artilleryIconImage && this.artilleryIconImage.complete) {
      const colored = this.getImageColored(
        this.artilleryIconImage,
        borderColor,
      );
      const padded = 4;
      const maxW = ICON_DIM - padded * 2;
      const maxH = ICON_DIM - padded * 2;
      const iw = Math.max(1, colored.width);
      const ih = Math.max(1, colored.height);
      const baseScale = Math.min(maxW / iw, maxH / ih);
      const factor = 1.4;
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
      ctx.drawImage(colored, dx, dy, dw, dh);
    }

    // Draw level indicator stars in top-left corner
    if (level >= 1 && level <= 3) {
      const tierColor = "#CD7F32"; /* bronze */
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

  redraw() {
    // Clear and rebuild all sprites
    for (const render of this.renders) {
      render.pixiSprite.destroy();
    }
    this.renders = [];
    this.seenUnits.clear();

    // Re-add all active artillery
    const artilleryUnits = this.game.units(UnitType.Artillery);
    for (const unit of artilleryUnits) {
      if (unit.isActive()) {
        this.seenUnits.add(unit.id());
        const sprite = this.createSprite(unit);
        this.renders.push(new ArtilleryRenderInfo(unit, sprite));
      }
    }
  }

  private updateHealthBar(render: ArtilleryRenderInfo) {
    const unit = render.unit;
    const maxHealth = unit.effectiveMaxHealth();

    if (!maxHealth) return; // No health for this unit type

    // Only show health bar if damaged and active
    if (!unit.isActive() || unit.health() >= maxHealth || unit.health() <= 0) {
      if (render.healthBarGraphics) {
        render.healthBarGraphics.destroy();
        render.healthBarGraphics = null;
      }
      return;
    }

    // Create health bar if it doesn't exist
    if (!render.healthBarGraphics) {
      render.healthBarGraphics = new PIXI.Graphics();
      this.stage.addChild(render.healthBarGraphics);
    }

    const graphics = render.healthBarGraphics;
    graphics.clear();

    // Get the scaled icon size
    const spriteScale = render.pixiSprite.scale.x; // Assumes uniform scaling
    const scaledIconSize = ICON_DIM * spriteScale;

    // Bar dimensions scale with the icon
    const barWidth = scaledIconSize * 3; // 300% of icon width
    const barHeight = scaledIconSize * 0.3; // 30% of icon height
    const gap = scaledIconSize * 1.8;
    const yOffset = -(scaledIconSize / 2 + barHeight + gap); // Above the icon with scaled gap

    // Position relative to sprite center
    graphics.x = render.pixiSprite.x;
    graphics.y = render.pixiSprite.y + yOffset;

    // Background (black border)
    graphics.beginFill(0x000000, 1);
    graphics.drawRect(-barWidth / 2 - 1, -1, barWidth + 2, barHeight + 2);
    graphics.endFill();

    // Health fill (color based on health percentage)
    const healthPercent = unit.health() / maxHealth;
    const colorIndex = Math.min(
      HEALTH_BAR_COLORS.length - 1,
      Math.floor(healthPercent * HEALTH_BAR_COLORS.length),
    );
    const fillColor = HEALTH_BAR_COLORS[colorIndex];

    graphics.beginFill(fillColor, 1);
    graphics.drawRect(
      -barWidth / 2,
      0,
      Math.max(1, healthPercent * barWidth),
      barHeight,
    );
    graphics.endFill();
  }
}
