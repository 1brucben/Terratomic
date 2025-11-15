// No theme color usage here; ring uses a fixed fallback color
import { EventBus } from "../../../core/EventBus";
import { Cell, UnitType } from "../../../core/game/Game";
import { GameView, UnitView } from "../../../core/game/GameView";
import { MouseOverEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
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

  // Rendering constants (screen pixels)
  private static readonly GROW_ZOOM_THRESHOLD = 2; // match Structure/Road layers' behavior

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transform: TransformHandler,
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
    // No periodic work needed; we render based on current hover
  }

  redraw() {
    // No offscreen buffers to rebuild
  }

  renderLayer(ctx: CanvasRenderingContext2D) {
    if (!this.hovered) return;

    const u = this.hovered;
    const radiusTiles = this.operationRadius(u);
    if (radiusTiles <= 0) return;

    // Center in world coords (game space), with origin centered like other layers
    const tile = u.tile();
    const wx = this.game.x(tile) - this.game.width() / 2 + 0.5;
    const wy = this.game.y(tile) - this.game.height() / 2 + 0.5;

    // Skip if center is far off-screen
    const centerCell = new Cell(this.game.x(tile), this.game.y(tile));
    if (!this.transform.isOnScreen(centerCell)) return;

    // Convert desired on-screen widths to world units by compensating for current transform scale
    const s = this.transform.scale || 1;
    const t = RangeOverlayLayer.GROW_ZOOM_THRESHOLD;
    const screenScale = s <= t ? Math.min(1, s) : s / t;
    // Thin 1px stroke in screen space, no fill/glow
    const worldLineWidth = (1 * screenScale) / s;

    // Always use the fallback color, no theme border color
    const strokeStyle = "rgba(230, 230, 230, 0.9)";

    ctx.save();
    ctx.beginPath();
    ctx.arc(wx, wy, radiusTiles, 0, Math.PI * 2);
    ctx.lineWidth = worldLineWidth;
    // Solid stroke (not dashed)
    ctx.setLineDash([]);
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
    ctx.restore();
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
    const types = [UnitType.DefensePost, UnitType.SAMLauncher];
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
    return 0;
  }

  // Intentionally empty: no helpers needed after style simplification
}
