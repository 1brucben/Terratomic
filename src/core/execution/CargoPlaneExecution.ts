import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";

export class CargoPlaneExecution implements Execution {
  private active = true;
  private mg: Game;
  private cargoPlane: Unit | undefined;
  private pathFinder: StraightPathFinder;
  private tilesTraveled = 0;
  private isCaptured = false;

  constructor(
    private origOwner: Player,
    private sourceAirfield: Unit,
    private destinationAirfield: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new StraightPathFinder(mg);
  }

  tick(ticks: number): void {
    if (this.cargoPlane === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.CargoPlane,
        this.sourceAirfield.tile(),
      );
      if (spawn === false) {
        console.warn(`Cargo plane cannot be built`);
        this.active = false;
        return;
      }
      this.cargoPlane = this.origOwner.buildUnit(UnitType.CargoPlane, spawn, {
        targetUnit: this.destinationAirfield,
      });
    }

    if (!this.cargoPlane.isActive()) {
      this.active = false;
      return;
    }
    if (this.cargoPlane.owner().id() !== this.origOwner.id()) {
      this.isCaptured = true;
      this.origOwner = this.cargoPlane.owner();
      this.tilesTraveled = 0;

      const friendlyAirfields = this.origOwner.units(UnitType.Airfield);
      if (friendlyAirfields.length > 0) {
        let closestAirfield: Unit | undefined;
        let minDistSquared = Infinity;

        for (const airfield of friendlyAirfields) {
          const distSquared = this.mg.euclideanDistSquared(
            this.cargoPlane.tile(),
            airfield.tile(),
          );
          if (distSquared < minDistSquared) {
            minDistSquared = distSquared;
            closestAirfield = airfield;
          }
        }

        if (closestAirfield) {
          this.destinationAirfield = closestAirfield;
          this.cargoPlane.setTargetUnit(closestAirfield);
          this.mg.displayMessage(
            `Cargo plane captured and redirected to ${closestAirfield.owner().displayName()}'s airfield!`,
            MessageType.CAPTURED_ENEMY_UNIT,
            this.origOwner.id(),
          );
        } else {
          this.cargoPlane.delete(false);
          this.active = false;
          return;
        }
      } else {
        this.cargoPlane.delete(false);
        this.active = false;
        return;
      }
    }

    if (!this.isCaptured) {
      if (
        this.destinationAirfield.owner().id() ===
          this.sourceAirfield.owner().id() &&
        this.cargoPlane.owner().id() === this.sourceAirfield.owner().id()
      ) {
        this.cargoPlane.delete(false);
        this.active = false;
        return;
      }
      if (
        !this.destinationAirfield.isActive() ||
        !this.cargoPlane.owner().canTrade(this.destinationAirfield.owner())
      ) {
        this.cargoPlane.delete(false);
        this.active = false;
        return;
      }
    }

    const result = this.pathFinder.nextTile(
      this.cargoPlane.tile(),
      this.destinationAirfield.tile(),
      2,
    );

    if (result === true) {
      this.complete();
      return;
    } else {
      this.cargoPlane.move(result);
      this.tilesTraveled++;
    }
  }

  private complete() {
    this.active = false;
    this.cargoPlane!.delete(false);

    if (this.isCaptured) {
      return;
    }
    const gold = this.mg.config().cargoPlaneGold(this.tilesTraveled);
    this.sourceAirfield.owner().addGold(gold);
    this.destinationAirfield.owner().addGold(gold);

    this.mg.displayMessage(
      `Received ${renderNumber(gold)} gold from trade using cargo plane with ${this.sourceAirfield.owner().displayName()}`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      this.destinationAirfield.owner().id(),
      gold,
    );
    this.mg.displayMessage(
      `Received ${renderNumber(gold)} gold from trade using cargo plane with ${this.destinationAirfield.owner().displayName()}`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      this.sourceAirfield.owner().id(),
      gold,
    );
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstAirfield(): TileRef {
    return this.destinationAirfield.tile();
  }
}
