import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { MouseMoveEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

/**
 * PointerCoordsLayer
 * Renders the world tile coordinates next to the mouse pointer.
 * Y is displayed using a bottom-left origin: y' = (H - 1) - y.
 * Drawn in screen-space (no transform) so it sticks to the pointer.
 */
export class PointerCoordsLayer implements Layer {
  private lastScreenX: number | null = null;
  private lastScreenY: number | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transform: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return false; // screen-space overlay
  }

  init() {
    this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) => {
      this.lastScreenX = e.x;
      this.lastScreenY = e.y;
    });
  }

  renderLayer(ctx: CanvasRenderingContext2D) {
    if (this.lastScreenX === null || this.lastScreenY === null) return;

    const world = this.transform.screenToWorldCoordinates(
      this.lastScreenX,
      this.lastScreenY,
    );
    if (!this.game.isValidCoord(world.x, world.y)) return;

    const x = world.x;
    const yBL = this.game.height() - 1 - world.y; // bottom-left origin

    const label = `(${x}, ${yBL})`;

    // Position slightly offset from the pointer
    const px = this.lastScreenX + 12;
    const py = this.lastScreenY + 18;

    // Draw background pill for readability
    ctx.save();
    ctx.font = "12px Inter, system-ui, -apple-system, Segoe UI, Roboto";
    ctx.textBaseline = "top";
    const paddingX = 6;
    const paddingY = 3;
    const metrics = ctx.measureText(label);
    const w = Math.ceil(metrics.width) + paddingX * 2;
    const h = 16 + paddingY * 2;

    ctx.fillStyle = "rgba(20, 20, 24, 0.8)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const r = 6;
    this.roundRect(ctx, px - 2, py - 2, w + 4, h + 4, r);
    ctx.fill();
    ctx.stroke();

    // Draw text
    ctx.fillStyle = "#E5E7EB"; // light gray for contrast
    ctx.fillText(label, px + paddingX, py + paddingY);
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
}
