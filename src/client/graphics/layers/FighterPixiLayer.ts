import * as PIXI from "pixi.js";
import { Assets } from "pixi.js";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { Cell, UnitType } from "../../../core/game/Game";
import { GameView, UnitView } from "../../../core/game/GameView";
import {
  MouseUpEvent,
  ReplaySpeedChangeEvent,
  UnitSelectionEvent,
} from "../../InputHandler";
import { MoveFighterJetIntentEvent, PauseGameEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import fighterSprite from "../../../../proprietary/images/fighter1.png";

export class FighterPixiLayer implements Layer {
  private static readonly DEBUG_HITTEST = true;
  private stage: PIXI.Container;
  private renderer!: PIXI.Renderer;
  private pixicanvas!: HTMLCanvasElement;
  private fighterTexture: PIXI.Texture | null = null;
  private fighters = new Map<number, PIXI.Sprite>();
  // no debug overlays
  private theme: Theme;

  // Simple tick-timing to interpolate fighter movement between server ticks
  private tickIntervalMs = 100;
  private baseTickStartTime = 0;

  private replaySpeedMultiplier = 1;
  private paused = false;

  private lastRotation = new Map<number, number>();
  private selectedFighterId: number | null = null;
  private selectionGraphics: PIXI.Graphics | null = null;
  private selectionLastBounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null = null;

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
      lastTime: number; // ms timestamp (per-fighter integrator clock)
    }
  >();
  private readonly turnRadiusPx = 20; // radius in pixels for turning arc

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.stage = new PIXI.Container({
      sortableChildren: true,
    });
    this.stage.sortableChildren = true; // <-- PIXI 7 sometimes ignores the constructor flag

    // Initialize interpolation timing from server config
    this.tickIntervalMs = this.game.config().serverConfig().turnIntervalMs();
    this.baseTickStartTime = this.now();
  }

  shouldTransform(): boolean {
    return false;
  }

  init(): void {
    this.setupRenderer();
    window.addEventListener("resize", () => this.resizeCanvas());

    // Adjust replay speed (we do NOT scale tickIntervalMs here anymore)
    this.eventBus.on(ReplaySpeedChangeEvent, (e) => {
      this.replaySpeedMultiplier = e.replaySpeedMultiplier;
    });

    // Observe explicit pause/resume events from the local server
    this.eventBus.on(PauseGameEvent, (e) => {
      const wasPaused = this.paused;
      this.paused = e.paused;
      if (!this.paused && wasPaused) {
        // Avoid large catch-up step after resuming
        const now = this.now();
        for (const s of this.flight.values()) {
          s.lastTime = now;
        }
      }
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

    // Listen for fighter selection changes
    this.eventBus.on(UnitSelectionEvent, (e) => {
      const unit = e.unit;
      if (unit && unit.type() === UnitType.FighterJet) {
        this.selectedFighterId = e.isSelected ? unit.id() : null;
        if (FighterPixiLayer.DEBUG_HITTEST) {
          console.debug("[FighterSelect] fighter selection changed", {
            unitId: unit.id(),
            isSelected: e.isSelected,
            selectedFighterId: this.selectedFighterId,
          });
        }
      } else if (e.isSelected) {
        // Selecting a non-fighter should clear any fighter selection outline
        this.selectedFighterId = null;
        if (FighterPixiLayer.DEBUG_HITTEST) {
          console.debug(
            "[FighterSelect] non-fighter selected; clearing fighter selection",
          );
        }
      }
      if (this.selectedFighterId === null) {
        this.clearSelectionGraphics();
      }
    });

    // Handle clicks for fighter selection using PIXI sprite hit-testing
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
  }

  tick(): void {
    // Mark the beginning of this server tick for interpolation
    this.baseTickStartTime = this.now();

    // Keep interpolation clock in sync with the game tick cadence
    const configuredInterval = this.game
      .config()
      .serverConfig()
      .turnIntervalMs();
    if (configuredInterval !== this.tickIntervalMs) {
      this.tickIntervalMs = configuredInterval;
    }
  }

  renderLayer(mainContext?: CanvasRenderingContext2D): void {
    this.syncAllFighters();
    if (this.renderer) {
      this.renderer.render(this.stage);
      if (mainContext) {
        // Draw PIXI canvas without the world transform applied to mainContext
        mainContext.save();
        mainContext.setTransform(1, 0, 0, 1, 0, 0);
        mainContext.drawImage(this.renderer.canvas, 0, 0);
        mainContext.restore();
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

      // Update continuous flight model (curved motion)
      this.updateFighterState(unit);

      // Then update sprite from flight state / interpolation
      this.updateFighterSprite(unit, sprite);

      // Update selection outline if this is the selected fighter
      if (this.selectedFighterId === id) {
        this.updateSelectionOutline(unit, sprite);
      }
      // no debug overlay updates
    }

    for (const [id, sprite] of this.fighters) {
      if (!seenIds.has(id)) {
        sprite.destroy();
        this.fighters.delete(id);
        // no debug overlay cleanup needed
      }
    }

    // If selected fighter no longer exists, clear the outline
    if (
      this.selectedFighterId !== null &&
      !this.fighters.has(this.selectedFighterId)
    ) {
      this.selectedFighterId = null;
      this.clearSelectionGraphics();
    }
  }

  private createFighterSprite(unit: UnitView): PIXI.Sprite {
    const tex = this.fighterTexture ?? PIXI.Texture.EMPTY;
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.zIndex = 10;
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
    // If we have a flight state, use it; else fall back to simple interpolation.
    const state = this.flight.get(unit.id());
    let worldX: number;
    let worldY: number;
    let heading: number | null = null;

    if (state) {
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

  private updateSelectionOutline(unit: UnitView, sprite: PIXI.Sprite): void {
    // Use a neutral grey dotted outline (not player-tinted)
    const color = 0x9ca3af; // approx Tailwind gray-400

    const x = Math.round(sprite.x);
    const y = Math.round(sprite.y);
    const w = Math.max(8, Math.round(sprite.width + 8));
    const h = Math.max(8, Math.round(sprite.height + 8));

    // Avoid redrawing if bounds unchanged
    if (
      this.selectionLastBounds &&
      this.selectionLastBounds.x === x &&
      this.selectionLastBounds.y === y &&
      this.selectionLastBounds.w === w &&
      this.selectionLastBounds.h === h
    ) {
      return;
    }

    if (!this.selectionGraphics) {
      this.selectionGraphics = new PIXI.Graphics();
      this.selectionGraphics.zIndex = 1000;
      this.stage.addChild(this.selectionGraphics);
    }
    const g = this.selectionGraphics;
    g.clear();
    g.position.set(x, y);
    g.alpha = 0.95;

    // Draw only a dotted outline (no solid box)
    const halfW = Math.floor(w / 2);
    const halfH = Math.floor(h / 2);
    const dot = 2; // 2px dot
    const step = 4; // spacing for dotted effect

    // Top and bottom edges
    for (let dx = -halfW; dx <= halfW; dx += step) {
      g.beginFill(color, 1);
      g.drawRect(dx, -halfH, dot, dot);
      g.endFill();
      g.beginFill(color, 1);
      g.drawRect(dx, halfH - dot, dot, dot);
      g.endFill();
    }
    // Left and right edges
    for (let dy = -halfH; dy <= halfH; dy += step) {
      g.beginFill(color, 1);
      g.drawRect(-halfW, dy, dot, dot);
      g.endFill();
      g.beginFill(color, 1);
      g.drawRect(halfW - dot, dy, dot, dot);
      g.endFill();
    }

    this.selectionLastBounds = { x, y, w, h };
  }

  private clearSelectionGraphics(): void {
    if (this.selectionGraphics) {
      this.selectionGraphics.clear();
      this.stage.removeChild(this.selectionGraphics);
      this.selectionGraphics.destroy();
      this.selectionGraphics = null;
    }
    this.selectionLastBounds = null;
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
    let s = this.flight.get(id);

    // If game is paused, snapshot current position into a flight state and freeze
    if (this.paused) {
      if (!s) {
        const now = this.now();
        const cx = this.game.x(unit.tile());
        const cy = this.game.y(unit.tile());
        const lx = this.game.x(unit.lastTile());
        const ly = this.game.y(unit.lastTile());
        const dx = cx - lx;
        const dy = cy - ly;
        const initialHeading =
          Math.abs(dx) + Math.abs(dy) > 0.0001 ? Math.atan2(dy, dx) : 0;
        s = {
          x: cx,
          y: cy,
          heading: initialHeading,
          speed: 0,
          targetX: cx,
          targetY: cy,
          lastTime: now,
        };
        this.flight.set(id, s);
      }
      return;
    }

    // Fastest mode (replaySpeedMultiplier === 0) means no interpolation between ticks.
    // Snap to authoritative position instantly and keep heading in sync.
    if (this.replaySpeedMultiplier === 0) {
      const now = this.now();
      const cx = this.game.x(unit.tile());
      const cy = this.game.y(unit.tile());
      const lx = this.game.x(unit.lastTile());
      const ly = this.game.y(unit.lastTile());
      const dx = cx - lx;
      const dy = cy - ly;
      const heading =
        Math.abs(dx) + Math.abs(dy) > 0.0001
          ? Math.atan2(dy, dx)
          : (s?.heading ?? 0);
      if (!s) {
        s = {
          x: cx,
          y: cy,
          heading,
          speed: 0,
          targetX: cx,
          targetY: cy,
          lastTime: now,
        };
        this.flight.set(id, s);
      } else {
        s.x = cx;
        s.y = cy;
        s.heading = heading;
        s.targetX = cx;
        s.targetY = cy;
        s.lastTime = now;
      }
      return;
    }

    // Determine an effective target to keep smooth turning even without targetTile
    let effectiveTarget: { x: number; y: number } | null = null;
    const tgtTile = unit.targetTile?.call(unit) as any;
    if (tgtTile) {
      effectiveTarget = { x: this.game.x(tgtTile), y: this.game.y(tgtTile) };
    } else if (typeof unit.targetUnitId === "function") {
      const tid = unit.targetUnitId();
      if (tid !== undefined) {
        const tu = this.game.unit(tid);
        if (tu && tu.isActive()) {
          effectiveTarget = {
            x: this.game.x(tu.tile()),
            y: this.game.y(tu.tile()),
          };
        }
      }
    }

    // Fallback: guide toward the server's current tile,
    // but project slightly forward to avoid oscillation.
    if (!effectiveTarget) {
      const cx = this.game.x(unit.tile());
      const cy = this.game.y(unit.tile());
      const lx = this.game.x(unit.lastTile());
      const ly = this.game.y(unit.lastTile());

      // direction of travel from lastTile -> tile
      const dx0 = cx - lx;
      const dy0 = cy - ly;
      const len = Math.hypot(dx0, dy0) || 1;

      // project target slightly forward along the current travel direction
      const px = cx + (dx0 / len) * 0.6;
      const py = cy + (dy0 / len) * 0.6;

      effectiveTarget = { x: px, y: py };
    }

    // resume/normal speed: continue updating state
    const now = this.now();

    if (!s) {
      const startX = this.game.x(unit.tile());
      const startY = this.game.y(unit.tile());
      const lx = this.game.x(unit.lastTile());
      const ly = this.game.y(unit.lastTile());
      const dx = startX - lx;
      const dy = startY - ly;
      const initialHeading =
        Math.abs(dx) + Math.abs(dy) > 0.0001
          ? Math.atan2(dy, dx)
          : Math.atan2(effectiveTarget.y - startY, effectiveTarget.x - startX);
      const stepDist = Math.hypot(dx, dy) || 1;
      const baseV =
        this.tickIntervalMs > 0 ? stepDist / this.tickIntervalMs : 0.01;

      s = {
        x: startX,
        y: startY,
        heading: initialHeading,
        speed: baseV,
        targetX: effectiveTarget.x,
        targetY: effectiveTarget.y,
        lastTime: now,
      };
      this.flight.set(id, s);
    } else {
      // Update target and gently adapt speed based on recent server step
      s.targetX = effectiveTarget.x;
      s.targetY = effectiveTarget.y;

      const cx = this.game.x(unit.tile());
      const cy = this.game.y(unit.tile());
      const lx = this.game.x(unit.lastTile());
      const ly = this.game.y(unit.lastTile());
      const dist = Math.hypot(cx - lx, cy - ly);
      const measured =
        this.tickIntervalMs > 0 ? dist / this.tickIntervalMs : s.speed;
      s.speed = s.speed * 0.8 + measured * 0.2;
    }

    // Time step for this frame (per-fighter, frame delta).
    // ReplaySpeedMultiplier enum uses larger numbers for slower playback
    // (e.g., 2 = slow, 1 = normal, 0.5 = fast, 0 = pause).
    // Convert to an effective speed scale where larger means faster.
    const dtMs = now - s.lastTime;
    const speedScale = this.paused
      ? 0
      : this.replaySpeedMultiplier === 0
        ? 1
        : 1 / this.replaySpeedMultiplier;
    const dt = dtMs * speedScale;
    s.lastTime = now;

    if (dt <= 0) {
      return;
    }

    // Advance the state using turn-radius limited heading
    const desired = Math.atan2(s.targetY - s.y, s.targetX - s.x);
    const speedPx = s.speed * this.transformHandler.scale;
    const maxOmega = speedPx > 0 ? speedPx / this.turnRadiusPx : 0; // rad/ms
    const diff = this.normalizeAngle(desired - s.heading);
    const step = Math.sign(diff) * Math.min(Math.abs(diff), maxOmega * dt);
    s.heading = this.normalizeAngle(s.heading + step);
    const distStep = s.speed * dt;
    s.x += Math.cos(s.heading) * distStep;
    s.y += Math.sin(s.heading) * distStep;

    // Snap gently toward the authoritative tile when very close to avoid long-term drift
    const srvX = this.game.x(unit.tile());
    const srvY = this.game.y(unit.tile());
    const err = Math.hypot(srvX - s.x, srvY - s.y);
    if (err < 0.1) {
      s.x = srvX;
      s.y = srvY;
    }

    // Only clear flight when we had an explicit target tile and we reached it
    const hadExplicitTarget = Boolean(tgtTile);
    const rem = Math.hypot(s.targetX - s.x, s.targetY - s.y);
    if (
      hadExplicitTarget &&
      (rem < Math.max(0.1, distStep * 1.1) || unit.reachedTarget?.call(unit))
    ) {
      s.x = srvX;
      s.y = srvY;
      this.flight.delete(id);
    }
  }

  private computeTickAlpha(): number {
    // Used only for fallback interpolation when no flight state exists
    const elapsed = Math.min(
      this.now() - this.baseTickStartTime,
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

  private onMouseUp(e: MouseUpEvent): void {
    // Update sprites to latest positions for accurate hit testing
    this.syncAllFighters();

    const clickX = e.x;
    const clickY = e.y;
    if (FighterPixiLayer.DEBUG_HITTEST) {
      // Log click location
      console.debug("[FighterHitTest] click", { clickX, clickY });
    }

    let best: { unit: UnitView; sprite: PIXI.Sprite; dist: number } | null =
      null;
    const pt = new PIXI.Point(clickX, clickY);

    for (const [id, sprite] of this.fighters) {
      const unit = this.game.unit(id);
      if (!unit || !unit.isActive()) continue;
      const my = this.game.myPlayer();
      const owned = unit.owner() === my;
      if (!owned) {
        if (FighterPixiLayer.DEBUG_HITTEST) {
          console.debug("[FighterHitTest] skip (not owned)", {
            id,
            owner: unit.owner()?.id?.(),
            me: my?.id?.(),
          });
        }
        continue; // only select own fighters
      }

      // Prefer precise bounds hit-test in screen space
      let hit = false;
      try {
        const b: any = sprite.getBounds(false) as any;
        if (b && typeof b.x === "number") {
          const within =
            pt.x >= b.x &&
            pt.x <= b.x + (b.width ?? 0) &&
            pt.y >= b.y &&
            pt.y <= b.y + (b.height ?? 0);
          if (FighterPixiLayer.DEBUG_HITTEST) {
            console.debug("[FighterHitTest] bounds", {
              id,
              b,
              within,
              spriteXY: { x: sprite.x, y: sprite.y },
              wh: { w: sprite.width, h: sprite.height },
            });
          }
          if (within) hit = true;
        }
      } catch (_) {
        // ignore and fallback to radius test
      }

      // Fallback: generous radius check around sprite center
      if (!hit) {
        const dx = clickX - sprite.x;
        const dy = clickY - sprite.y;
        const dist = Math.hypot(dx, dy);
        const sizeRadius = Math.max(sprite.width, sprite.height) * 0.75;
        const radius = Math.max(24, sizeRadius + 8);
        hit = dist <= radius;
        if (FighterPixiLayer.DEBUG_HITTEST) {
          console.debug("[FighterHitTest] radius", {
            id,
            dx,
            dy,
            dist,
            radius,
            center: { x: sprite.x, y: sprite.y },
          });
        }
        if (hit) {
          if (!best || dist < best.dist) {
            best = { unit, sprite, dist };
          }
        }
      } else {
        // If bounds hit, compute distance for best-pick purposes
        const dx = clickX - sprite.x;
        const dy = clickY - sprite.y;
        const dist = Math.hypot(dx, dy);
        if (!best || dist < best.dist) {
          best = { unit, sprite, dist };
        }
      }
    }

    if (best) {
      // If a fighter is already selected and this click is on a different fighter,
      // treat it as a move command for the currently selected fighter instead of
      // switching selection.
      if (
        this.selectedFighterId !== null &&
        this.selectedFighterId !== best.unit.id()
      ) {
        const cell = this.transformHandler.screenToWorldCoordinates(
          clickX,
          clickY,
        );
        if (this.game.isValidCoord(cell.x, cell.y)) {
          const tile = this.game.ref(cell.x, cell.y);
          this.eventBus.emit(
            new MoveFighterJetIntentEvent(this.selectedFighterId, tile),
          );
          // Deselect fighter after assigning move intent to match existing UX
          const u = this.game.unit(this.selectedFighterId);
          if (u) {
            this.eventBus.emit(new UnitSelectionEvent(u, false));
          }
          this.selectedFighterId = null;
          this.clearSelectionGraphics();
        }
        // Consume click so global handlers (e.g., ground attack) don't process it
        e.consumed = true;
        return;
      }
      if (FighterPixiLayer.DEBUG_HITTEST) {
        console.debug("[FighterHitTest] select", {
          id: best.unit.id(),
          pos: { x: best.sprite.x, y: best.sprite.y },
          dist: best.dist,
        });
      }
      this.eventBus.emit(new UnitSelectionEvent(best.unit, true));
      // Consume click so global handlers (e.g., ground attack) don't process it
      e.consumed = true;
    } else {
      // No fighter under cursor; if a fighter is currently selected, treat this click
      // as a move command for that fighter (do not trigger ground attack logic).
      if (this.selectedFighterId !== null) {
        if (FighterPixiLayer.DEBUG_HITTEST) {
          console.debug("[FighterMove] click with fighter selected", {
            selectedFighterId: this.selectedFighterId,
            screen: { x: clickX, y: clickY },
          });
        }
        const cell = this.transformHandler.screenToWorldCoordinates(
          clickX,
          clickY,
        );
        if (this.game.isValidCoord(cell.x, cell.y)) {
          const tile = this.game.ref(cell.x, cell.y);
          if (FighterPixiLayer.DEBUG_HITTEST) {
            console.debug("[FighterMove] emitting MoveFighterJetIntentEvent", {
              selectedFighterId: this.selectedFighterId,
              cell,
              tile,
            });
          }
          this.eventBus.emit(
            new MoveFighterJetIntentEvent(this.selectedFighterId, tile),
          );
          // Deselect fighter after assigning move intent
          const u = this.game.unit(this.selectedFighterId);
          if (u) {
            this.eventBus.emit(new UnitSelectionEvent(u, false));
          }
          this.selectedFighterId = null;
          this.clearSelectionGraphics();
        }
        // Consume click to avoid ground attack and stop further processing
        e.consumed = true;
        return;
      }
      if (FighterPixiLayer.DEBUG_HITTEST) {
        console.debug("[FighterHitTest] no hit");
      }
    }
  }
}
