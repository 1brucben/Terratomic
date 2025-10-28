import { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType, RoadsUpdate } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class RoadLayer implements Layer {
  // Map of canonical segment key -> [tile1, tile2]
  private segments = new Map<string, [TileRef, TileRef]>();
  // Cache tileRef -> world pixel coordinates to avoid repeated GameView.x/y calls
  private tileCoordCache = new Map<TileRef, [number, number]>();
  // Keep this threshold aligned with StructureLayer's ICON_GROW_ZOOM_THRESHOLD
  private static readonly ROAD_GROW_ZOOM_THRESHOLD = 2;
  private static readonly BASE_ROAD_WIDTH = 1.8; // base inner stroke width in screen px at/under threshold
  private static readonly OUTLINE_EXTRA = 1.6; // extra px for outline relative to inner stroke
  // Neutral outline color to avoid player color dependence; matches StructureLayer under-construction border
  private static readonly ROAD_OUTLINE_COLOR = "rgb(128, 127, 127)";
  // Cache geometry as a Path2D to avoid re-tracing every frame
  private path: Path2D | null = null;
  private dirty = true;
  private lastWidth = 0;
  private lastHeight = 0;

  constructor(
    private game: GameView,
    private transform: TransformHandler,
  ) {
    // No theme needed for fixed neutral road outline color
  }

  shouldTransform(): boolean {
    return true;
  }

  init() {
    // No offscreen canvas needed; we'll draw vector paths directly each frame
    this.dirty = true;
    this.path = null;
    this.lastWidth = this.game.width();
    this.lastHeight = this.game.height();
    this.tileCoordCache.clear();
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    const roadUpdates = updates[GameUpdateType.Roads] as
      | RoadsUpdate[]
      | undefined;
    if (roadUpdates && roadUpdates.length > 0) {
      let anyAdded = false;
      let anyRemoved = false;
      for (const update of roadUpdates) {
        if (update.added.length > 0) {
          anyAdded = true;
          for (const segment of update.added) {
            // Parse once and cache tile refs
            const dash = segment.indexOf("-");
            if (dash > 0) {
              const a = parseInt(segment.substring(0, dash), 10) as TileRef;
              const b = parseInt(segment.substring(dash + 1), 10) as TileRef;
              this.segments.set(segment, [a, b]);
            }
          }
        }
        if (update.removed.length > 0) {
          anyRemoved = true;
          for (const segment of update.removed) {
            this.segments.delete(segment);
          }
        }
      }
      // If there were removals, we must rebuild the path from scratch
      // (Path2D has no API to remove subpaths)
      if (anyRemoved) {
        this.dirty = true;
        this.path = null;
      } else if (anyAdded) {
        // Fast path: append new segments directly into the cached Path2D
        // when safe (no pending rebuilds and dimensions stable).
        const w = this.game.width();
        const h = this.game.height();
        if (
          !this.dirty &&
          this.path &&
          w === this.lastWidth &&
          h === this.lastHeight
        ) {
          for (const update of roadUpdates) {
            for (const segment of update.added ?? []) {
              const pair = this.segments.get(segment);
              if (pair) this.traceSegment(this.path, pair[0], pair[1]);
            }
          }
          // No need to mark dirty; appended geometry will render this frame
        } else {
          // Fallback: mark for a single rebuild during render
          this.dirty = true;
          this.path = null;
        }
      }
      // Notify views that a redraw is needed (kept for backward-compatible tests)
      this.redraw();
    }
  }

  redraw() {
    // No-op: kept for interface compatibility
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.segments.size === 0) return;

    // Draw vector paths directly under the active transform to avoid pixelation
    // Note: Coordinates are in game space; offset by half map size to align with transform origin
    // Rebuild cached geometry if needed (road changes or size changed)
    if (
      this.dirty ||
      this.lastWidth !== this.game.width() ||
      this.lastHeight !== this.game.height()
    ) {
      this.path = this.buildPath();
      this.dirty = false;
      const w = this.game.width();
      const h = this.game.height();
      if (w !== this.lastWidth || h !== this.lastHeight) {
        // Screen size changed; cached origin offset will differ, but tile world coords are stable.
        // We still update last dims and clear coord cache to be safe with any theme/layout-dependent x/y.
        this.tileCoordCache.clear();
      }
      this.lastWidth = w;
      this.lastHeight = h;
    }

    if (!this.path) return;

    const s = this.transform.scale || 1;
    const t = RoadLayer.ROAD_GROW_ZOOM_THRESHOLD;
    // Match StructureLayer behavior: stable up to threshold, then grow with zoom
    const screenScale = s <= t ? Math.min(1, s) : s / t;
    // Convert desired on-screen widths to world units by compensating for current transform scale
    const innerWorldWidth = (RoadLayer.BASE_ROAD_WIDTH * screenScale) / s;
    const outlineWorldWidth =
      ((RoadLayer.BASE_ROAD_WIDTH + RoadLayer.OUTLINE_EXTRA) * screenScale) / s;
    context.lineJoin = "round";
    context.lineCap = "round";

    // Use a neutral grey outline independent of player color
    context.strokeStyle = RoadLayer.ROAD_OUTLINE_COLOR;
    context.lineWidth = outlineWorldWidth;
    context.stroke(this.path);

    // Inner semi-transparent white stroke similar to structure icon fill
    context.strokeStyle = "#A8A8A8";
    context.lineWidth = innerWorldWidth;
    context.stroke(this.path);
  }

  // Minimal sink interface implemented by both CanvasRenderingContext2D and Path2D
  private traceSegment(
    ctx: {
      moveTo(x: number, y: number): void;
      lineTo(x: number, y: number): void;
    },
    tile1: TileRef,
    tile2: TileRef,
  ) {
    // Align world coordinates with the transform's centered origin
    const ox = this.game.width() / 2;
    const oy = this.game.height() / 2;
    const [wx1, wy1] = this.getTilePoint(tile1);
    const [wx2, wy2] = this.getTilePoint(tile2);
    const x1 = wx1 - ox + 0.5;
    const y1 = wy1 - oy + 0.5;
    const x2 = wx2 - ox + 0.5;
    const y2 = wy2 - oy + 0.5;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }

  private buildPath(): Path2D | null {
    if (this.segments.size === 0) return null;
    const p = new Path2D();
    for (const [_, pair] of this.segments) {
      this.traceSegment(p, pair[0], pair[1]);
    }
    return p;
  }

  private getTilePoint(tile: TileRef): [number, number] {
    const cached = this.tileCoordCache.get(tile);
    if (cached) return cached;
    // World pixel coordinates from GameView
    const pt: [number, number] = [this.game.x(tile), this.game.y(tile)];
    this.tileCoordCache.set(tile, pt);
    return pt;
  }
}
