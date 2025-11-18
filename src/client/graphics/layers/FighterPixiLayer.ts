import * as PIXI from "pixi.js";
import { Assets } from "pixi.js";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { Cell, UnitType } from "../../../core/game/Game";
import { GameView, UnitView } from "../../../core/game/GameView";
import { ReplaySpeedChangeEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import fighterSprite from "../../../../proprietary/images/fighter1.png";

export class FighterPixiLayer implements Layer {
  private stage: PIXI.Container;
  private renderer!: PIXI.Renderer;
  private pixicanvas!: HTMLCanvasElement;
  private fighterTexture: PIXI.Texture | null = null;
  private fighters = new Map<number, PIXI.Sprite>();
  // no debug overlays
  private theme: Theme;

  // Simple tick-timing to interpolate fighter movement between server ticks
  private baseTickIntervalMs = 100;
  private tickIntervalMs = 100;
  private lastTickTimestamp = 0;
  private lastRotation = new Map<number, number>();

  // Flight model per fighter for straight-line motion with turn radius
  private flight = new Map<
    number,
    {
      x: number; // world coords (tile units)
      y: number;
      heading: number; // radians, direction of travel (no +PI/2 offset)
      speed: number; // tiles/ms
      targetX: number;
      targetY: number;
      lastTime: number; // ms timestamp
    }
  >();
  private readonly turnRadiusPx = 20; // radius in pixels for turning arc

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.stage = new PIXI.Container();
    // Initialize interpolation timing from server config
    this.baseTickIntervalMs = this.game
      .config()
      .serverConfig()
      .turnIntervalMs();
    this.tickIntervalMs = this.baseTickIntervalMs;
    this.lastTickTimestamp = this.now();
  }

  shouldTransform(): boolean {
    return false;
  }

  init(): void {
    this.setupRenderer();
    window.addEventListener("resize", () => this.resizeCanvas());

    // Adjust interpolation timing when replay speed changes
    this.eventBus.on(ReplaySpeedChangeEvent, (e) => {
      const base = this.game.config().serverConfig().turnIntervalMs();
      this.baseTickIntervalMs = base;
      this.tickIntervalMs = base * e.replaySpeedMultiplier;
      this.lastTickTimestamp = this.now();
    });

    const url = fighterSprite as unknown as string;
    Assets.load(url)
      .then((tex) => {
        this.fighterTexture = tex as PIXI.Texture;
        for (const [, sprite] of this.fighters) {
          const unitId = (sprite as any)._unitId as number | undefined;
          if (unitId !== undefined) {
            const unit = this.game.unit(unitId);
            if (unit) {
              sprite.texture = this.fighterTexture;
              sprite.tint = this.getTintForOwner(unit.owner().id());
            }
          } else if (this.fighterTexture) {
            sprite.texture = this.fighterTexture;
          }
          sprite.visible = true;
        }
      })
      .catch((err) => console.error("Failed to load fighter1.png", err));

    this.syncAllFighters();
  }

  tick(): void {
    // Keep interpolation clock in sync with the game tick cadence
    this.lastTickTimestamp = this.now();
    const configuredInterval = this.game
      .config()
      .serverConfig()
      .turnIntervalMs();
    if (configuredInterval !== this.baseTickIntervalMs) {
      this.baseTickIntervalMs = configuredInterval;
      this.tickIntervalMs = this.baseTickIntervalMs;
    }
  }

  renderLayer(mainContext?: CanvasRenderingContext2D): void {
    this.syncAllFighters();
    if (this.renderer) {
      this.renderer.render(this.stage);
      if (mainContext) {
        mainContext.drawImage(this.renderer.canvas, 0, 0);
      }
    }
  }

  private setupRenderer() {
    this.renderer = new (PIXI as any).WebGLRenderer();
    this.pixicanvas = document.createElement("canvas");
    this.pixicanvas.width = window.innerWidth;
    this.pixicanvas.height = window.innerHeight;
    (this.renderer as any).init?.({
      canvas: this.pixicanvas,
      resolution: 1,
      width: this.pixicanvas.width,
      height: this.pixicanvas.height,
      clearBeforeRender: true,
      backgroundAlpha: 0,
      backgroundColor: 0x00000000,
    });
  }

  private resizeCanvas() {
    if ((this.renderer as any)?.view) {
      this.pixicanvas.width = window.innerWidth;
      this.pixicanvas.height = window.innerHeight;
      (this.renderer as any).resize?.(innerWidth, innerHeight, 1);
    }
  }

  private syncAllFighters(): void {
    const seenIds = new Set<number>();
    for (const unit of this.game.units(UnitType.FighterJet)) {
      const id = unit.id();
      seenIds.add(id);

      let sprite = this.fighters.get(id);
      if (!unit.isActive()) {
        if (sprite) {
          sprite.destroy();
          this.fighters.delete(id);
        }
        continue;
      }

      if (!sprite) {
        sprite = this.createFighterSprite(unit);
        this.fighters.set(id, sprite);
        this.stage.addChild(sprite);
        // no debug dots in production
      }

      this.updateFighterState(unit);
      this.updateFighterSprite(unit, sprite);
      // no debug overlay updates
    }

    for (const [id, sprite] of this.fighters) {
      if (!seenIds.has(id)) {
        sprite.destroy();
        this.fighters.delete(id);
        // no debug overlay cleanup needed
      }
    }
  }

  private createFighterSprite(unit: UnitView): PIXI.Sprite {
    const tex = this.fighterTexture ?? PIXI.Texture.EMPTY;
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.zIndex = 5;
    sprite.alpha = 1;
    (sprite as any)._unitId = unit.id();
    if (this.fighterTexture) {
      sprite.tint = this.getTintForOwner(unit.owner().id());
    }
    sprite.visible = this.fighterTexture !== null;
    return sprite;
  }

  private getTintForOwner(ownerId: string): number {
    const hex = this.theme.territoryColor(this.game.player(ownerId)).toHex();
    return parseInt(hex.replace(/^#/, ""), 16);
  }

  private updateFighterSprite(unit: UnitView, sprite: PIXI.Sprite): void {
    // Glide linearly between lastTile and current tile based on tick alpha
    const state = this.flight.get(unit.id());
    let worldX: number;
    let worldY: number;
    let heading: number | null = null;
    if (state) {
      // Use flight model position and heading
      worldX = state.x;
      worldY = state.y;
      heading = state.heading;
    } else {
      const lastTile = unit.lastTile();
      const currentTile = unit.tile();
      const alpha = this.computeTickAlpha();
      const startX = this.game.x(lastTile);
      const startY = this.game.y(lastTile);
      const endX = this.game.x(currentTile);
      const endY = this.game.y(currentTile);
      worldX = startX + (endX - startX) * alpha;
      worldY = startY + (endY - startY) * alpha;
      // Derive heading from segment for fallback
      const dx = endX - startX;
      const dy = endY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 0.0001) heading = Math.atan2(dy, dx);
    }
    const screen = this.transformHandler.worldToScreenCoordinates(
      new Cell(worldX, worldY),
    );
    sprite.x = screen.x;
    sprite.y = screen.y;
    const basePx = 15;
    const scale = Math.max(0.25, this.transformHandler.scale);
    const size = basePx * scale;
    sprite.width = size;
    sprite.height = size;
    // Apply rotation from heading if available; sprite up axis is +PI/2 offset
    if (heading !== null) {
      const desired = heading + Math.PI / 2;
      const id = unit.id();
      const current = this.lastRotation.get(id) ?? desired;
      const next = this.angleLerp(current, desired, 0.25);
      sprite.rotation = next;
      this.lastRotation.set(id, next);
    }
  }

  private angleLerp(a: number, b: number, t: number): number {
    const diff = this.normalizeAngle(b - a);
    return this.normalizeAngle(a + diff * Math.max(0, Math.min(1, t)));
  }

  private normalizeAngle(x: number): number {
    // Wrap to [-PI, PI)
    const twoPi = Math.PI * 2;
    x = ((((x + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
    return x;
  }

  private updateFighterState(unit: UnitView): void {
    const id = unit.id();
    const tgtTile = unit.targetTile?.call(unit) as any;
    if (tgtTile) {
      const targetX = this.game.x(tgtTile);
      const targetY = this.game.y(tgtTile);
      let s = this.flight.get(id);
      if (!s) {
        const startX = this.game.x(unit.tile());
        const startY = this.game.y(unit.tile());
        // Initial heading from recent motion if available
        const lx = this.game.x(unit.lastTile());
        const ly = this.game.y(unit.lastTile());
        const dx = startX - lx;
        const dy = startY - ly;
        const initialHeading =
          Math.abs(dx) + Math.abs(dy) > 0.0001
            ? Math.atan2(dy, dx)
            : Math.atan2(targetY - startY, targetX - startX);
        // Estimate speed from last tile step per tick
        const stepDist = Math.hypot(dx, dy) || 1;
        const v =
          this.tickIntervalMs > 0 ? stepDist / this.tickIntervalMs : 0.01;
        s = {
          x: startX,
          y: startY,
          heading: initialHeading,
          speed: v,
          targetX,
          targetY,
          lastTime: this.now(),
        };
        this.flight.set(id, s);
      } else {
        // Update target and gently update speed based on recent server step
        s.targetX = targetX;
        s.targetY = targetY;
        const cx = this.game.x(unit.tile());
        const cy = this.game.y(unit.tile());
        const lx = this.game.x(unit.lastTile());
        const ly = this.game.y(unit.lastTile());
        const dist = Math.hypot(cx - lx, cy - ly);
        const measured =
          this.tickIntervalMs > 0 ? dist / this.tickIntervalMs : s.speed;
        s.speed = s.speed * 0.8 + measured * 0.2;
      }
      // Advance the state using turn-radius limited heading
      const now = this.now();
      const dt = Math.max(0, now - s.lastTime);
      s.lastTime = now;
      // Desired heading toward target
      const desired = Math.atan2(s.targetY - s.y, s.targetX - s.x);
      // Limit turn rate using pixel radius: convert speed (tiles/ms) to px/ms
      const speedPx = s.speed * this.transformHandler.scale;
      const maxOmega = speedPx > 0 ? speedPx / this.turnRadiusPx : 0; // rad/ms
      const diff = this.normalizeAngle(desired - s.heading);
      const step = Math.sign(diff) * Math.min(Math.abs(diff), maxOmega * dt);
      s.heading = this.normalizeAngle(s.heading + step);
      // Integrate forward motion
      const distStep = s.speed * dt;
      s.x += Math.cos(s.heading) * distStep;
      s.y += Math.sin(s.heading) * distStep;
      // Arrive snapping
      const rem = Math.hypot(s.targetX - s.x, s.targetY - s.y);
      if (
        rem < Math.max(0.1, distStep * 1.1) ||
        unit.reachedTarget?.call(unit)
      ) {
        // Snap to current server tile and clear flight plan
        s.x = this.game.x(unit.tile());
        s.y = this.game.y(unit.tile());
        this.flight.delete(id);
      }
    } else {
      // No target; clear any flight plan
      this.flight.delete(id);
    }
  }

  private computeTickAlpha(): number {
    const elapsed = Math.min(
      this.now() - this.lastTickTimestamp,
      this.tickIntervalMs,
    );
    if (this.tickIntervalMs === 0) return 1;
    return Math.max(0, elapsed / this.tickIntervalMs);
  }

  private now(): number {
    if (typeof performance !== "undefined" && performance.now) {
      return performance.now();
    }
    return Date.now();
  }
}
