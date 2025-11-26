import { renderNumber } from "../../client/Utils";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { Game, MessageType, Player, PlayerID, UpgradeType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType, SerializedCargoTruck } from "./GameUpdates";
import { RoadManager } from "./RoadManager";

const SUMMARY_INTERVAL_TICKS = 300; // 30 seconds

export interface CargoTruck {
  id: number;
  owner: Player;
  path: TileRef[];
  progress: number;
  position: [number, number];
  isInternational?: boolean;
  destinationOwner?: Player;
}

export interface CargoTruckUpdate {
  type: GameUpdateType.CargoTrucks;
  added: SerializedCargoTruck[];
  removed: number[];
  updated: { id: number; progress: number; position: [number, number] }[];
}

export class CargoManager {
  private trucks = new Map<number, CargoTruck>();
  private domesticGoldSinceLastMessage: Map<PlayerID, bigint> = new Map();
  private nextTruckId = 0;
  private random: PseudoRandom;

  constructor(
    private game: Game,
    private roadManager: RoadManager,
  ) {
    this.random = new PseudoRandom(game.ticks());
  }

  public tick(playersWithRoads: Player[]): CargoTruckUpdate {
    const updates: CargoTruckUpdate = {
      type: GameUpdateType.CargoTrucks,
      added: [],
      removed: [],
      updated: [],
    };

    // --- Spawning Logic (Largely Unchanged) ---
    const BUCKET_SIZE = 10;
    const currentBucket = this.game.ticks() % BUCKET_SIZE;

    for (const player of playersWithRoads) {
      if (simpleHash(player.id()) % BUCKET_SIZE !== currentBucket) {
        continue;
      }
      const connectedNodes = this.roadManager.getConnectedNodes(player);
      if (connectedNodes.length < 2) {
        continue;
      }
      // Domestic
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
            updates.added.push({
              id: newTruck.id,
              ownerID: newTruck.owner.smallID(),
              path: newTruck.path,
              progress: newTruck.progress,
              position: newTruck.position,
            });
          }
        }
      }
      // International
      if (
        player.hasUpgrade(UpgradeType.InternationalTrade) &&
        this.game.config().internationalCargoTrucksEnabled() &&
        this.random.chance(
          this.game.config().internationalCargoTruckSpawnChance(),
        )
      ) {
        const tradingPartners = player.tradingPartners();
        if (tradingPartners.length > 0) {
          const destinationPlayer = this.random.randElement(tradingPartners);
          const originStructure = this.random.randElement(connectedNodes);
          const destinationStructures =
            this.roadManager.getConnectedNodes(destinationPlayer);
          if (destinationStructures.length > 0) {
            const destinationStructure = this.random.randElement(
              destinationStructures,
            );
            if (originStructure && destinationStructure) {
              const path = this.roadManager.findCompleteStructurePath(
                originStructure,
                destinationStructure,
              );
              if (path) {
                const newTruck: CargoTruck = {
                  id: this.nextTruckId++,
                  owner: player,
                  path: path,
                  progress: 0,
                  position: [this.game.x(path[0]), this.game.y(path[0])],
                  isInternational: true,
                  destinationOwner: destinationPlayer,
                };
                this.trucks.set(newTruck.id, newTruck);
                updates.added.push({
                  id: newTruck.id,
                  ownerID: newTruck.owner.smallID(),
                  path: newTruck.path,
                  progress: newTruck.progress,
                  position: newTruck.position,
                  isInternational: true,
                  destinationOwnerID: destinationPlayer.smallID(),
                });
              }
            }
          }
        }
      }
    }

    // --- Movement & Arrival Logic ---
    for (const truck of this.trucks.values()) {
      truck.progress++;
      if (truck.progress >= truck.path.length) {
        // Arrived
        if (truck.isInternational && truck.destinationOwner) {
          // International Arrival (Original logic with hardcoded strings)
          if (
            truck.owner.canTrade(truck.destinationOwner) &&
            truck.destinationOwner.isAlive()
          ) {
            const totalGold = BigInt(
              Math.floor(
                Number(this.game.config().cargoTruckGold(truck.path.length)) *
                  this.game.config().internationalCargoTruckGoldMultiplier(),
              ),
            );
            const splitRatio = this.game
              .config()
              .internationalCargoTruckGoldSplitRatio();
            const destinationGold = BigInt(
              Math.floor(Number(totalGold) * splitRatio),
            );
            const originGold = totalGold - destinationGold;
            truck.owner.addGold(originGold);
            truck.destinationOwner.addGold(destinationGold);
            this.game.displayMessage(
              "messages.international_trade_origin",
              MessageType.RECEIVED_GOLD_FROM_TRADE,
              truck.owner.id(),
              originGold,
              {
                destinationName: truck.destinationOwner.name(),
                goldAmount: renderNumber(originGold),
              },
            );
            this.game.displayMessage(
              "messages.international_trade_destination",
              MessageType.RECEIVED_GOLD_FROM_TRADE,
              truck.destinationOwner.id(),
              destinationGold,
              {
                originName: truck.owner.name(),
                goldAmount: renderNumber(destinationGold),
              },
            );
          }
        } else {
          // --- REVISED: Domestic Arrival ---
          const gold = this.game.config().cargoTruckGold(truck.path.length);
          truck.owner.addGold(gold);
          const currentGold =
            this.domesticGoldSinceLastMessage.get(truck.owner.id()) ?? 0n;
          this.domesticGoldSinceLastMessage.set(
            truck.owner.id(),
            currentGold + gold,
          );
        }
        this.trucks.delete(truck.id);
        updates.removed.push(truck.id);
      } else {
        // Move
        const currentTile = truck.path[truck.progress];
        truck.position[0] = this.game.x(currentTile);
        truck.position[1] = this.game.y(currentTile);
        updates.updated.push({
          id: truck.id,
          progress: truck.progress,
          position: truck.position,
        });
      }
    }

    // --- NEW: Send Summary Message Periodically ---
    if (this.game.ticks() % SUMMARY_INTERVAL_TICKS === 0) {
      for (const [
        playerID,
        totalGold,
      ] of this.domesticGoldSinceLastMessage.entries()) {
        if (totalGold > 0) {
          this.game.displayMessage(
            "messages.domestic_trade_summary",
            MessageType.RECEIVED_GOLD_FROM_TRADE,
            playerID,
            totalGold,
            {
              goldAmount: renderNumber(totalGold), // Formatted for display
              seconds: SUMMARY_INTERVAL_TICKS / 10,
            },
          );
        }
      }
      this.domesticGoldSinceLastMessage.clear();
    }

    return updates;
  }
}
