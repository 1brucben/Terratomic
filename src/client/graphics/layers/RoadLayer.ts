import { colord } from "colord";
import { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType, RoadsUpdate } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class RoadLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private roadSegments = new Set<string>();

  constructor(
    private game: GameView,
    private transform: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  init() {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context not supported");
    this.ctx = ctx;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    const roadUpdates = updates[GameUpdateType.Roads] as
      | RoadsUpdate[]
      | undefined;
    if (roadUpdates && roadUpdates.length > 0) {
      let changed = false;
      for (const update of roadUpdates) {
        if (update.added.length > 0) {
          changed = true;
          for (const segment of update.added) {
            this.roadSegments.add(segment);
          }
        }
        if (update.removed.length > 0) {
          changed = true;
          for (const segment of update.removed) {
            this.roadSegments.delete(segment);
          }
        }
      }
      if (changed) {
        this.redraw();
      }
    }
  }

  redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.roadSegments.size === 0) return;

    const roadWidth = 1.2;
    const edgeWidth = 1.8;

    // Group segments by owner to apply the correct color
    const segmentsByOwner = new Map<PlayerView | null, string[]>();
    for (const segment of this.roadSegments) {
      const [tile1Str] = segment.split("-");
      const tile1 = parseInt(tile1Str, 10) as TileRef;
      const owner = this.game.owner(tile1);
      const playerOwner = owner.isPlayer() ? (owner as PlayerView) : null;

      if (!segmentsByOwner.has(playerOwner)) {
        segmentsByOwner.set(playerOwner, []);
      }
      segmentsByOwner.get(playerOwner)!.push(segment);
    }

    for (const [owner, segments] of segmentsByOwner.entries()) {
      let baseColor;
      if (owner) {
        baseColor = this.game.config().theme().territoryColor(owner);
      } else {
        baseColor = colord("#808080");
      }
      const darkerColor = baseColor.darken(0.05).toRgbString();
      const evenDarkerColor = baseColor.darken(0.1).toRgbString();

      this.ctx.lineJoin = "round";
      this.ctx.lineCap = "round";

      // Outer darker edge
      this.ctx.strokeStyle = evenDarkerColor;
      this.ctx.lineWidth = edgeWidth;
      this.ctx.beginPath();
      for (const segment of segments) {
        const [tile1Str, tile2Str] = segment.split("-");
        const tile1 = parseInt(tile1Str, 10) as TileRef;
        const tile2 = parseInt(tile2Str, 10) as TileRef;
        this.traceSegment(this.ctx, tile1, tile2);
      }
      this.ctx.stroke();

      // Inner lighter road surface
      this.ctx.strokeStyle = darkerColor;
      this.ctx.lineWidth = roadWidth;
      this.ctx.beginPath();
      for (const segment of segments) {
        const [tile1Str, tile2Str] = segment.split("-");
        const tile1 = parseInt(tile1Str, 10) as TileRef;
        const tile2 = parseInt(tile2Str, 10) as TileRef;
        this.traceSegment(this.ctx, tile1, tile2);
      }
      this.ctx.stroke();
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  private traceSegment(
    ctx: CanvasRenderingContext2D,
    tile1: TileRef,
    tile2: TileRef,
  ) {
    const x1 = this.game.x(tile1) + 0.5;
    const y1 = this.game.y(tile1) + 0.5;
    const x2 = this.game.x(tile2) + 0.5;
    const y2 = this.game.y(tile2) + 0.5;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
}
