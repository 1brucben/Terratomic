import * as PIXI from "pixi.js";
import { Cell, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

interface BulletSprite {
  graphics: PIXI.Graphics;
  unitId: number;
  lastX: number;
  lastY: number;
}

/**
 * PIXI-based layer for rendering AA bullets as fast-moving tracer rounds.
 * Uses GPU acceleration for smooth rendering of many small projectiles.
 */
export class AABulletLayer implements Layer {
  layerName = "AABulletLayer";
  private renderer: PIXI.Renderer;
  private stage: PIXI.Container;
  private bulletContainer: PIXI.Container;
  private pixiCanvas: HTMLCanvasElement;
  private bullets: Map<number, BulletSprite> = new Map();

  private lastRefresh: number = 0;
  private refreshRate: number = 16; // ~60 FPS

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return false; // We handle our own transforms
  }

  async init() {
    this.renderer = new PIXI.WebGLRenderer();
    this.pixiCanvas = document.createElement("canvas");
    this.pixiCanvas.width = window.innerWidth;
    this.pixiCanvas.height = window.innerHeight;
    this.pixiCanvas.style.pointerEvents = "none";
    this.stage = new PIXI.Container();
    this.bulletContainer = new PIXI.Container();
    this.stage.addChild(this.bulletContainer);

    await this.renderer.init({
      canvas: this.pixiCanvas,
      width: this.pixiCanvas.width,
      height: this.pixiCanvas.height,
      backgroundAlpha: 0,
      clearBeforeRender: true,
    });

    window.addEventListener("resize", () => this.resizeCanvas());
  }

  private resizeCanvas() {
    if (this.renderer) {
      this.pixiCanvas.width = window.innerWidth;
      this.pixiCanvas.height = window.innerHeight;
      this.renderer.resize(window.innerWidth, window.innerHeight);
    }
  }

  tick() {
    // Process unit updates for AA bullets
    const updates = this.game.updatesSinceLastTick()?.[GameUpdateType.Unit];
    if (updates) {
      for (const update of updates) {
        const unit = this.game.unit(update.id);
        if (unit?.type() === UnitType.AABullet) {
          this.onBulletUpdate(unit);
        }
      }
    }

    // Clean up inactive bullets
    for (const [unitId, bullet] of this.bullets) {
      const unit = this.game.unit(unitId);
      if (!unit || !unit.isActive()) {
        this.bulletContainer.removeChild(bullet.graphics);
        bullet.graphics.destroy();
        this.bullets.delete(unitId);
      }
    }
  }

  private onBulletUpdate(unit: UnitView) {
    let bullet = this.bullets.get(unit.id());

    if (!bullet) {
      // Create new bullet sprite
      const graphics = new PIXI.Graphics();
      bullet = {
        graphics,
        unitId: unit.id(),
        lastX: this.game.x(unit.tile()),
        lastY: this.game.y(unit.tile()),
      };
      this.bulletContainer.addChild(graphics);
      this.bullets.set(unit.id(), bullet);
    }

    // Update position
    bullet.lastX = this.game.x(unit.lastTile());
    bullet.lastY = this.game.y(unit.lastTile());
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const now = Date.now();
    if (now - this.lastRefresh < this.refreshRate) {
      // Still draw the cached frame
      context.drawImage(this.pixiCanvas, 0, 0);
      return;
    }
    this.lastRefresh = now;

    const scale = this.transformHandler.scale;

    // Update all bullet graphics
    for (const [unitId, bullet] of this.bullets) {
      const unit = this.game.unit(unitId);
      if (!unit || !unit.isActive()) continue;

      const worldX = this.game.x(unit.tile());
      const worldY = this.game.y(unit.tile());

      // Convert world coords to screen coords using TransformHandler
      const screenPos = this.transformHandler.worldToScreenCoordinates(
        new Cell(worldX, worldY),
      );
      const lastScreenPos = this.transformHandler.worldToScreenCoordinates(
        new Cell(bullet.lastX, bullet.lastY),
      );

      // Calculate trail start (50% shorter - midpoint between last and current)
      const trailStartX = screenPos.x + (lastScreenPos.x - screenPos.x) * 0.5;
      const trailStartY = screenPos.y + (lastScreenPos.y - screenPos.y) * 0.5;

      // Redraw the bullet
      bullet.graphics.clear();

      // Tracer trail (line from midpoint to current position - 50% shorter)
      bullet.graphics.setStrokeStyle({
        width: Math.max(1, scale * 0.5),
        color: 0xffdd66,
        alpha: 0.6,
      });
      bullet.graphics.moveTo(trailStartX, trailStartY);
      bullet.graphics.lineTo(screenPos.x, screenPos.y);
      bullet.graphics.stroke();

      // Bright bullet head
      const bulletSize = Math.max(1, scale * 0.3);
      bullet.graphics.circle(screenPos.x, screenPos.y, bulletSize);
      bullet.graphics.fill({ color: 0xffffcc, alpha: 1 });

      // Outer glow
      bullet.graphics.circle(screenPos.x, screenPos.y, bulletSize * 2);
      bullet.graphics.fill({ color: 0xffdd66, alpha: 0.4 });
    }

    // Render PIXI stage
    this.renderer.render(this.stage);

    // Draw onto the main canvas
    context.drawImage(this.pixiCanvas, 0, 0);
  }

  redraw() {
    // Force redraw on next frame
    this.lastRefresh = 0;
  }
}
