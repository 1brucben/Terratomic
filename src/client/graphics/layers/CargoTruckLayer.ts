import {
  CargoTrucksUpdate,
  GameUpdateType,
  SerializedCargoTruck,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class CargoTruckLayer implements Layer {
  layerName = "CargoTruckLayer";
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private trucks = new Map<number, SerializedCargoTruck>();
  // Cache trailer world positions so we don't recompute per-frame
  private trailerPosCache = new Map<number, [number, number] | null>();
  // Throttle expensive redraw work; we still blit the cached canvas every frame
  private lastRedrawMs = 0;
  private redrawIntervalMs = 50; // ~20 FPS updates for this layer

  constructor(
    private game: GameView,
    private transform: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  init(): void {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context not supported");
    this.ctx = ctx;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.trailerPosCache.clear();
    this.lastRedrawMs = 0;
  }

  tick(): void {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    const cargoTruckUpdatesArray = updates[
      GameUpdateType.CargoTrucks
    ] as CargoTrucksUpdate[];
    if (cargoTruckUpdatesArray) {
      for (const cargoTruckUpdates of cargoTruckUpdatesArray) {
        for (const addedTruck of cargoTruckUpdates.added) {
          this.trucks.set(addedTruck.id, addedTruck);
          // Initialize cached trailer position
          if (addedTruck.isInternational && addedTruck.progress > 0) {
            const trailerTile = addedTruck.path[addedTruck.progress - 1];
            if (trailerTile) {
              this.trailerPosCache.set(addedTruck.id, [
                this.game.x(trailerTile),
                this.game.y(trailerTile),
              ]);
            } else {
              this.trailerPosCache.set(addedTruck.id, null);
            }
          } else {
            this.trailerPosCache.set(addedTruck.id, null);
          }
        }
        for (const removedTruckId of cargoTruckUpdates.removed) {
          this.trucks.delete(removedTruckId);
          this.trailerPosCache.delete(removedTruckId);
        }
        for (const updatedTruck of cargoTruckUpdates.updated) {
          const existingTruck = this.trucks.get(updatedTruck.id);
          if (existingTruck) {
            // Preserve new properties that don't come in the 'updated' payload
            existingTruck.position = updatedTruck.position;
            existingTruck.progress = updatedTruck.progress;
            // Recompute cached trailer position only when progress changes
            if (existingTruck.isInternational && existingTruck.progress > 0) {
              const trailerTile =
                existingTruck.path[existingTruck.progress - 1];
              if (trailerTile) {
                this.trailerPosCache.set(existingTruck.id, [
                  this.game.x(trailerTile),
                  this.game.y(trailerTile),
                ]);
              } else {
                this.trailerPosCache.set(existingTruck.id, null);
              }
            } else {
              this.trailerPosCache.set(existingTruck.id, null);
            }
          }
        }
      }
    }
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    // Only recompute the offscreen layer if enough time has passed
    const now = performance.now();
    const shouldRedraw = now - this.lastRedrawMs >= this.redrawIntervalMs;

    if (shouldRedraw) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.trucks.size > 0) {
        this.ctx.fillStyle = "#333333"; // Dark grey for all trucks
        const truckSize = 0.5; // Half a tile size (world units)
        const halfPad = (1 - truckSize) / 2;

        // Build a single path for all rects to minimize draw calls
        const path = new Path2D();

        // Simple LOD: when zoomed far out, decimate trucks to reduce work
        const s = this.transform.scale || 1;
        let step = 1;
        if (s < 0.6) step = 2;
        if (s < 0.4) step = 4;

        const w = this.canvas.width;
        const h = this.canvas.height;

        let i = 0;
        for (const truck of this.trucks.values()) {
          if (i++ % step !== 0) continue;
          // Main cab
          const x = truck.position[0];
          const y = truck.position[1];
          // Viewport culling against offscreen canvas bounds
          if (x < -1 || y < -1 || x > w + 1 || y > h + 1) {
            // Outside of drawing surface; skip
          } else {
            path.rect(x + halfPad, y + halfPad, truckSize, truckSize);
          }

          // Trailer (cached)
          if (truck.isInternational && truck.progress > 0) {
            const tpos = this.trailerPosCache.get(truck.id);
            if (tpos) {
              const tx = tpos[0];
              const ty = tpos[1];
              if (!(tx < -1 || ty < -1 || tx > w + 1 || ty > h + 1)) {
                path.rect(tx + halfPad, ty + halfPad, truckSize, truckSize);
              }
            }
          }
        }

        this.ctx.fill(path);
      }
      this.lastRedrawMs = now;
    }

    // Always blit latest cached image under active transform
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }
}
