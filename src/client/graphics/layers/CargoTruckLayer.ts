import {
  CargoTrucksUpdate,
  GameUpdateType,
  SerializedCargoTruck,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class CargoTruckLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private trucks = new Map<number, SerializedCargoTruck>();

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
        }
        for (const removedTruckId of cargoTruckUpdates.removed) {
          this.trucks.delete(removedTruckId);
        }
        for (const updatedTruck of cargoTruckUpdates.updated) {
          const existingTruck = this.trucks.get(updatedTruck.id);
          if (existingTruck) {
            // Preserve new properties that don't come in the 'updated' payload
            existingTruck.position = updatedTruck.position;
            existingTruck.progress = updatedTruck.progress;
          }
        }
      }
    }
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.trucks.size === 0) return;

    this.ctx.fillStyle = "#333333"; // Dark grey for all trucks
    const truckSize = 0.5; // Half a tile size

    for (const truck of this.trucks.values()) {
      // Draw the main truck block
      const x = truck.position[0];
      const y = truck.position[1];
      this.ctx.fillRect(
        x + (1 - truckSize) / 2,
        y + (1 - truckSize) / 2,
        truckSize,
        truckSize,
      );

      // If it's an international truck and not at the start of its path, draw a second "trailer" block.
      if (truck.isInternational && truck.progress > 0) {
        const trailerTile = truck.path[truck.progress - 1];
        if (trailerTile) {
          const trailerX = this.game.x(trailerTile);
          const trailerY = this.game.y(trailerTile);
          this.ctx.fillRect(
            trailerX + (1 - truckSize) / 2,
            trailerY + (1 - truckSize) / 2,
            truckSize,
            truckSize,
          );
        }
      }
    }

    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }
}
