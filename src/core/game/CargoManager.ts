import { renderNumber } from "../../client/Utils";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { Game, MessageType, Player, UpgradeType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType, SerializedCargoTruck } from "./GameUpdates"; // Import GameUpdateType and SerializedCargoTruck
import { RoadManager } from "./RoadManager";

export interface CargoTruck {
  id: number;
  owner: Player;
  path: TileRef[];
  progress: number;
  position: [number, number];
}

// Updated to match GameUpdates.ts
export interface CargoTruckUpdate {
  type: GameUpdateType.CargoTrucks; // Added
  added: SerializedCargoTruck[]; // Changed
  removed: number[];
  updated: { id: number; progress: number; position: [number, number] }[]; // Changed
}

export class CargoManager {
  private trucks = new Map<number, CargoTruck>();
  private nextTruckId = 0;
  private random: PseudoRandom;

  constructor(
    private game: Game,
    private roadManager: RoadManager,
  ) {
    this.random = new PseudoRandom(game.ticks());
  }

  public tick(): CargoTruckUpdate {
    const updates: CargoTruckUpdate = {
      type: GameUpdateType.CargoTrucks, // Added
      added: [],
      removed: [],
      updated: [],
    };

    // Spawning Logic
    const BUCKET_SIZE = 10;
    const currentBucket = this.game.ticks() % BUCKET_SIZE;

    const playersWithRoads = this.game
      .players()
      .filter((p) => p.hasUpgrade(UpgradeType.Roads));

    for (const player of playersWithRoads) {
      if (simpleHash(player.id()) % BUCKET_SIZE !== currentBucket) {
        continue;
      }

      const connectedNodes = this.roadManager.getConnectedNodes(player);
      if (connectedNodes.length < 2) {
        continue;
      }

      const spawnChance = this.game
        .config()
        .cargoTruckSpawnRate(connectedNodes.length);

      if (this.random.chance(spawnChance)) {
        const origin = this.random.randElement(connectedNodes);
        const destination = this.random.randElement(
          connectedNodes.filter((n) => n.id() !== origin.id()),
        );

        if (destination) {
          const path = this.roadManager.findCompleteStructurePath(
            origin,
            destination,
          );
          if (path) {
            const newTruck: CargoTruck = {
              id: this.nextTruckId++,
              owner: player,
              path: path,
              progress: 0,
              position: [this.game.x(path[0]), this.game.y(path[0])],
            };
            this.trucks.set(newTruck.id, newTruck);
            // Serialize for update
            updates.added.push({
              id: newTruck.id,
              ownerID: newTruck.owner.smallID(), // Use ownerID
              path: newTruck.path,
              progress: newTruck.progress,
              position: newTruck.position,
            });
          }
        }
      }
    }

    // Movement Logic
    for (const truck of this.trucks.values()) {
      truck.progress++;

      if (truck.progress >= truck.path.length) {
        // Arrived
        const gold = this.game.config().cargoTruckGold(truck.path.length);
        truck.owner.addGold(gold);
        this.game.displayMessage(
          `Received ${renderNumber(gold)} gold from cargo truck delivery.`,
          MessageType.RECEIVED_GOLD_FROM_TRADE,
          truck.owner.id(),
          gold,
          { goldAmount: Number(gold) },
        );
        this.trucks.delete(truck.id);
        updates.removed.push(truck.id);
      } else {
        // Move
        const currentTile = truck.path[truck.progress];
        truck.position[0] = this.game.x(currentTile);
        truck.position[1] = this.game.y(currentTile);
        // Serialize for update
        updates.updated.push({
          id: truck.id,
          progress: truck.progress,
          position: truck.position,
        });
      }
    }

    return updates;
  }
}
