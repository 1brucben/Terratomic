import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
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
  private theme: Theme;
  private lastMouse: { x: number; y: number } | null = null;
  private hovered: UnitView | null = null;

  // Rendering constants (screen pixels)
  private static readonly RING_BASE_WIDTH = 2.5; // stroke width at/under threshold
  private static readonly RING_OUTLINE_EXTRA = 1.5; // additional px for outer outline
  private static readonly GROW_ZOOM_THRESHOLD = 2; // match Structure/Road layers' behavior

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transform: TransformHandler,
  ) {
    this.theme = game.config().theme();
  }

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
    const innerWorldWidth =
      (RangeOverlayLayer.RING_BASE_WIDTH * screenScale) / s;
    const outlineWorldWidth =
      ((RangeOverlayLayer.RING_BASE_WIDTH +
        RangeOverlayLayer.RING_OUTLINE_EXTRA) *
        screenScale) /
      s;

    // Use the owner's LIGHT border color as the base hue
    const baseColor = this.ownerLightBorderColor(u);
    const glow = baseColor.alpha(0.6).toRgbString();
    const fill = baseColor.alpha(0.14).toRgbString();
    const stroke = baseColor.alpha(0.85).toRgbString();
    const outline = baseColor.darken(0.4).alpha(0.8).toRgbString();

    // Filled translucent disk + soft glow
    ctx.save();
    ctx.beginPath();
    ctx.arc(wx, wy, radiusTiles, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 8 * screenScale;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Outer darker outline
    ctx.strokeStyle = outline;
    ctx.lineWidth = outlineWorldWidth;
    ctx.setLineDash([]);
    ctx.stroke();

    // Inner bright stroke for definition
    ctx.strokeStyle = stroke;
    ctx.lineWidth = innerWorldWidth;
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
      return this.game.config().defensePostTargettingRange();
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

  private ownerLightBorderColor(u: UnitView): Colord {
    const owner = u.owner();
    return this.theme.defendedBorderColors(owner).light;
  }
}
