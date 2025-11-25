// No theme color usage here; ring uses a fixed fallback color
import { EventBus } from "../../../core/EventBus";
import { Cell, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { MouseOverEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

/**
 * RangeOverlayLayer
 * Draws hover overlays for Defense Posts and SAM Launchers, visualizing their operation radii.
 * - World-space rendering so rings scale/translate with the map
 * - Colors reflect relationship (self/ally/enemy) and match the theme
 * - Subtle transparency and glow to fit the game's aesthetic
 */
export class RangeOverlayLayer implements Layer {
  private lastMouse: { x: number; y: number } | null = null;
  private hovered: UnitView | null = null;
  private halos: Array<{
    id: number;
    x: number; // tile-space center (game grid coordinates)
    y: number;
    inner: number;
    outer: number;
    expiresAt: number; // Date.now() timestamp (Infinity until impact)
  }> = [];
  private haloById: Map<
    number,
    {
      id: number;
      x: number;
      y: number;
      inner: number;
      outer: number;
      expiresAt: number;
    }
  > = new Map();

  // Rendering constants (screen pixels)
  private static readonly GROW_ZOOM_THRESHOLD = 2; // match Structure/Road layers' behavior

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transform: TransformHandler,
    private uiState: UIState,
  ) {}

  shouldTransform(): boolean {
    return true; // render in world space
  }

  init() {
    this.eventBus.on(MouseOverEvent, (e) => {
      this.lastMouse = { x: e.x, y: e.y };
      this.updateHoveredUnit();
    });
  }

  tick() {
    // Cull expired halos
    if (this.halos.length > 0) {
      const now = Date.now();
      this.halos = this.halos.filter((h) => h.expiresAt > now);
    }

    // Show halo on launch, keep until impact, then extend 1s after detonation
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates?.[GameUpdateType.Unit];
    if (unitUpdates) {
      for (const upd of unitUpdates) {
        const unit = this.game.unit(upd.id);
        if (!unit) continue;
        const t = unit.type();
        if (t !== UnitType.AtomBomb && t !== UnitType.HydrogenBomb) continue;
        const id = unit.id();

        if (unit.isActive()) {
          const target = unit.targetTile();
          if (!target) continue;
          if (!this.haloById.has(id)) {
            const mags = this.game.config().nukeMagnitudes(t);
            const halo = {
              id,
              x: this.game.x(target),
              y: this.game.y(target),
              inner: mags.inner,
              outer: mags.outer,
              expiresAt: Number.POSITIVE_INFINITY,
            };
            this.halos.push(halo);
            this.haloById.set(id, halo);
          }
        } else {
          const halo = this.haloById.get(id);
          if (!halo) continue;
          if (unit.reachedTarget()) {
            halo.expiresAt = Date.now() + 1000;
          } else {
            halo.expiresAt = 0; // intercepted, remove immediately
          }
          this.haloById.delete(id);
        }
      }
    }
  }

  redraw() {
    // No offscreen buffers to rebuild
  }

  renderLayer(ctx: CanvasRenderingContext2D) {
    // Prepare batched draws to minimize setLineDash changes
    type Arc = { wx: number; wy: number; r: number; color: string };
    const dotted: Arc[] = [];
    const solid: Arc[] = [];

    // Render any short-lived post-selection/impact halos first so they always show
    if (this.halos.length > 0) {
      const [vpTL, vpBR] = this.transform.screenBoundingRect();
      for (const h of this.halos) {
        if (!this.circleIntersectsViewport(h.x, h.y, h.outer, vpTL, vpBR)) {
          continue;
        }
        const wx = h.x - this.game.width() / 2 + 0.5;
        const wy = h.y - this.game.height() / 2 + 0.5;
        dotted.push({ wx, wy, r: h.outer, color: "rgba(255, 60, 60, 0.7)" });
        solid.push({ wx, wy, r: h.inner, color: "rgba(255, 90, 90, 0.5)" });
      }
    }

    // If in build (ghost) mode for selected unit types, show ring at cursor
    const pending = this.uiState.pendingBuildUnitType;
    if (
      pending === UnitType.SAMLauncher ||
      pending === UnitType.DefensePost ||
      pending === UnitType.Airfield ||
      pending === UnitType.AtomBomb ||
      pending === UnitType.HydrogenBomb
    ) {
      if (!this.lastMouse) return;
      const cell = this.transform.screenToWorldCoordinates(
        this.lastMouse.x,
        this.lastMouse.y,
      );
      if (!this.game.isValidCoord(cell.x, cell.y)) return;
      // Nuke types have inner+outer; others single radius
      if (pending === UnitType.AtomBomb || pending === UnitType.HydrogenBomb) {
        const mags = this.nukeRadii(pending);
        if (mags.outer <= 0) return;
        const [vpTL, vpBR] = this.transform.screenBoundingRect();
        const centerX = cell.x;
        const centerY = cell.y;
        if (
          !this.circleIntersectsViewport(
            centerX,
            centerY,
            mags.outer,
            vpTL,
            vpBR,
          )
        )
          return;
        const wx = centerX - this.game.width() / 2 + 0.5;
        const wy = centerY - this.game.height() / 2 + 0.5;
        dotted.push({
          wx,
          wy,
          r: mags.outer,
          color: "rgba(255, 255, 255, 0.6)",
        });
        solid.push({
          wx,
          wy,
          r: mags.inner,
          color: "rgba(255, 255, 255, 0.35)",
        });
        // Flush batched draws and return early for build-mode
        this.flushArcs(ctx, dotted, solid);
        return;
      }

      const radiusTiles = this.buildModeRadius(pending);
      if (radiusTiles <= 0) return;
      // world-space center (map origin centered)
      const [vpTL, vpBR] = this.transform.screenBoundingRect();
      if (
        this.circleIntersectsViewport(cell.x, cell.y, radiusTiles, vpTL, vpBR)
      ) {
        const wx = cell.x - this.game.width() / 2 + 0.5;
        const wy = cell.y - this.game.height() / 2 + 0.5;
        solid.push({
          wx,
          wy,
          r: radiusTiles,
          color: "rgba(230, 230, 230, 0.9)",
        });
        this.flushArcs(ctx, dotted, solid);
      }
      return;
    }

    // Hover overlays for existing structures (if any)
    if (this.hovered) {
      const u = this.hovered;
      if (
        u.type() === UnitType.AtomBomb ||
        u.type() === UnitType.HydrogenBomb
      ) {
        const mags = this.nukeRadii(u.type());
        if (mags.outer > 0) {
          const tile = u.tile();
          const cx = this.game.x(tile);
          const cy = this.game.y(tile);
          const [vpTL, vpBR] = this.transform.screenBoundingRect();
          if (this.circleIntersectsViewport(cx, cy, mags.outer, vpTL, vpBR)) {
            const wx = cx - this.game.width() / 2 + 0.5;
            const wy = cy - this.game.height() / 2 + 0.5;
            dotted.push({
              wx,
              wy,
              r: mags.outer,
              color: "rgba(230, 230, 230, 0.9)",
            });
            solid.push({
              wx,
              wy,
              r: mags.inner,
              color: "rgba(230, 230, 230, 0.9)",
            });
          }
        }
      } else {
        const radiusTiles = this.operationRadius(u);
        if (radiusTiles > 0) {
          const tile = u.tile();
          const cx = this.game.x(tile);
          const cy = this.game.y(tile);
          const [vpTL, vpBR] = this.transform.screenBoundingRect();
          if (this.circleIntersectsViewport(cx, cy, radiusTiles, vpTL, vpBR)) {
            const wx = cx - this.game.width() / 2 + 0.5;
            const wy = cy - this.game.height() / 2 + 0.5;
            solid.push({
              wx,
              wy,
              r: radiusTiles,
              color: "rgba(230, 230, 230, 0.9)",
            });
          }
        }
      }
    }
    // Flush remaining batched arcs
    this.flushArcs(ctx, dotted, solid);
  }

  private strokeRing(
    ctx: CanvasRenderingContext2D,
    wx: number,
    wy: number,
    radiusTiles: number,
    strokeStyle: string = "rgba(230, 230, 230, 0.9)",
  ) {
    const s = this.transform.scale || 1;
    const t = RangeOverlayLayer.GROW_ZOOM_THRESHOLD;
    const screenScale = s <= t ? Math.min(1, s) : s / t;
    // Thin 1px stroke in screen space, no fill/glow
    const worldLineWidth = (1 * screenScale) / s;
    ctx.save();
    ctx.beginPath();
    ctx.arc(wx, wy, radiusTiles, 0, Math.PI * 2);
    ctx.lineWidth = worldLineWidth;
    ctx.setLineDash([]);
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
    ctx.restore();
  }

  private strokeDottedRing(
    ctx: CanvasRenderingContext2D,
    wx: number,
    wy: number,
    radiusTiles: number,
    strokeStyle: string,
  ) {
    const s = this.transform.scale || 1;
    const t = RangeOverlayLayer.GROW_ZOOM_THRESHOLD;
    const screenScale = s <= t ? Math.min(1, s) : s / t;
    const worldLineWidth = (1 * screenScale) / s;
    ctx.save();
    ctx.beginPath();
    ctx.arc(wx, wy, radiusTiles, 0, Math.PI * 2);
    ctx.lineWidth = worldLineWidth;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
    ctx.restore();
  }

  private flushArcs(
    ctx: CanvasRenderingContext2D,
    dotted: Array<{ wx: number; wy: number; r: number; color: string }>,
    solid: Array<{ wx: number; wy: number; r: number; color: string }>,
  ) {
    // Compute world-space line width once
    const s = this.transform.scale || 1;
    const t = RangeOverlayLayer.GROW_ZOOM_THRESHOLD;
    const screenScale = s <= t ? Math.min(1, s) : s / t;
    const worldLineWidth = (1 * screenScale) / s;

    // Dotted batch
    if (dotted.length) {
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = worldLineWidth;
      for (const a of dotted) {
        ctx.beginPath();
        ctx.arc(a.wx, a.wy, a.r, 0, Math.PI * 2);
        ctx.strokeStyle = a.color;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Solid batch
    if (solid.length) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineWidth = worldLineWidth;
      for (const a of solid) {
        ctx.beginPath();
        ctx.arc(a.wx, a.wy, a.r, 0, Math.PI * 2);
        ctx.strokeStyle = a.color;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private circleIntersectsViewport(
    centerX: number,
    centerY: number,
    radius: number,
    vpTL: Cell,
    vpBR: Cell,
  ): boolean {
    const left = centerX - radius;
    const right = centerX + radius;
    const top = centerY - radius;
    const bottom = centerY + radius;
    return !(
      right < vpTL.x ||
      left > vpBR.x ||
      bottom < vpTL.y ||
      top > vpBR.y
    );
  }

  private updateHoveredUnit() {
    if (!this.lastMouse) {
      this.hovered = null;
      return;
    }
    const cell = this.transform.screenToWorldCoordinates(
      this.lastMouse.x,
      this.lastMouse.y,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      this.hovered = null;
      return;
    }
    this.hovered = this.findDefenseOrSAMAtCell(cell);
  }

  private findDefenseOrSAMAtCell(
    cell: { x: number; y: number },
    search: number = 10,
  ): UnitView | null {
    const ref = this.game.ref(cell.x, cell.y);
    const types = [
      UnitType.DefensePost,
      UnitType.SAMLauncher,
      UnitType.Airfield,
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
    ];
    const nearby = this.game.nearbyUnits(ref, search, types);
    for (const { unit } of nearby) {
      if (unit.isActive() && types.includes(unit.type())) {
        return unit;
      }
    }
    return null;
  }

  private operationRadius(u: UnitView): number {
    if (u.type() === UnitType.DefensePost) {
      // Show the Defense Post's defensive aura radius, not its shell targeting range
      return this.game.config().defensePostRange();
    }
    if (u.type() === UnitType.SAMLauncher) {
      const base = this.game.config().defaultSamRange();
      const bonus = this.game.config().samRangeUpgradePercent();
      const lvl = u.level();
      if (lvl <= 1) return base;
      const factor = Math.pow(1 + bonus, lvl - 1);
      return Math.round(base * factor);
    }
    if (u.type() === UnitType.Airfield) {
      // Show bomber range based on airfield's bomber level
      return this.game.config().bomberTargetRange(u.bomberLevel());
    }
    if (u.type() === UnitType.AtomBomb || u.type() === UnitType.HydrogenBomb) {
      return this.game.config().nukeMagnitudes(u.type()).outer;
    }
    return 0;
  }

  private buildModeRadius(type: UnitType): number {
    if (type === UnitType.DefensePost)
      return this.game.config().defensePostRange();
    if (type === UnitType.SAMLauncher) {
      // Get the selected build level from localStorage (same as BuildMenu)
      let desiredLevel = 1;
      try {
        const raw = localStorage.getItem("buildSettings.levels");
        if (raw) {
          const obj = JSON.parse(raw);
          const val = obj?.[String(type)];
          if (typeof val === "number" && val >= 1) {
            desiredLevel = Math.min(3, val); // SAM max level is 3
          }
        }
      } catch (_) {
        // Fall back to level 1
      }

      const base = this.game.config().defaultSamRange();
      if (desiredLevel <= 1) return base;
      const bonus = this.game.config().samRangeUpgradePercent();
      const factor = Math.pow(1 + bonus, desiredLevel - 1);
      return Math.round(base * factor);
    }
    if (type === UnitType.Airfield) {
      // Get the selected build level from localStorage (same as BuildMenu)
      let desiredLevel = 1;
      try {
        const raw = localStorage.getItem("buildSettings.levels");
        if (raw) {
          const obj = JSON.parse(raw);
          const val = obj?.[String(type)];
          if (typeof val === "number" && val >= 1) {
            desiredLevel = Math.min(3, val); // Airfield bomber max level is 3
          }
        }
      } catch (_) {
        // Fall back to level 1
      }
      return this.game.config().bomberTargetRange(desiredLevel);
    }
    if (type === UnitType.AtomBomb || type === UnitType.HydrogenBomb)
      return this.game.config().nukeMagnitudes(type).outer;
    return 0;
  }

  // Intentionally empty: no helpers needed after style simplification
  private nukeRadii(type: UnitType): { inner: number; outer: number } {
    const mags = this.game.config().nukeMagnitudes(type);
    return { inner: mags.inner, outer: mags.outer };
  }
}
