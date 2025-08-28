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

    this.ctx.fillStyle = "#333333"; // Dark grey color for the truck
    const truckSize = 0.5; // Half a tile size

    for (const truck of this.trucks.values()) {
      const x = truck.position[0];
      const y = truck.position[1];

      // Draw the truck centered on the tile
      this.ctx.fillRect(
        x + (1 - truckSize) / 2,
        y + (1 - truckSize) / 2,
        truckSize,
        truckSize,
      );
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
