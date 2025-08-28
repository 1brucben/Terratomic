import { TileRef } from "./GameMap";

export interface RoadSegmentStyle {
  width: number;
  color: string;
}

export class RoadCache {
  private segmentCache = new Map<string, ImageData>();
  private offscreenCanvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor(
    private tileSize: number,
    private mapWidth: number,
  ) {
    this.offscreenCanvas = new OffscreenCanvas(tileSize, tileSize);
    this.ctx = this.offscreenCanvas.getContext(
      "2d",
    ) as OffscreenCanvasRenderingContext2D;
  }

  public getCachedSegment(
    from: TileRef,
    to: TileRef,
    style: RoadSegmentStyle,
  ): ImageData {
    const key = this.getSegmentKey(from, to, style);

    if (!this.segmentCache.has(key)) {
      const imageData = this.renderSegment(from, to, style);
      this.segmentCache.set(key, imageData);
    }

    return this.segmentCache.get(key)!;
  }

  private getSegmentKey(
    from: TileRef,
    to: TileRef,
    style: RoadSegmentStyle,
  ): string {
    const points = from < to ? [from, to] : [to, from];
    return `${points[0]}-${points[1]}-${style.width}-${style.color}`;
  }

  private renderSegment(
    from: TileRef,
    to: TileRef,
    style: RoadSegmentStyle,
  ): ImageData {
    this.ctx.clearRect(0, 0, this.tileSize, this.tileSize);

    this.ctx.beginPath();
    this.ctx.strokeStyle = style.color;
    this.ctx.lineWidth = style.width;
    this.ctx.lineCap = "round";

    // Convert tile refs to pixel coordinates using map width
    const fromX = (from % this.mapWidth) * this.tileSize;
    const fromY = Math.floor(from / this.mapWidth) * this.tileSize;
    const toX = (to % this.mapWidth) * this.tileSize;
    const toY = Math.floor(to / this.mapWidth) * this.tileSize;

    this.ctx.moveTo(fromX, fromY);
    this.ctx.lineTo(toX, toY);
    this.ctx.stroke();

    return this.ctx.getImageData(0, 0, this.tileSize, this.tileSize);
  }

  public clearCache(): void {
    this.segmentCache.clear();
  }
}
