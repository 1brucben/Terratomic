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
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { tradeIncomeModifiers } from "../tech/TechEffects";
import { distSortUnit } from "../Util";

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game;
  private tradeShip: Unit | undefined;
  private wasCaptured = false;
  private pathFinder: PathFinder;
  private tilesTraveled = 0;

  constructor(
    private origOwner: Player,
    private srcPort: Unit,
    private _dstPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinder.Mini(mg, 2500);
  }

  tick(ticks: number): void {
    if (this.tradeShip === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        console.warn(`cannot build trade ship`);
        this.active = false;
        return;
      }
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
        targetUnit: this._dstPort,
        lastSetSafeFromPirates: ticks,
      });
      this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    const tradeShipOwner = this.tradeShip.owner();
    const dstPortOwner = this._dstPort.owner();
    if (this.wasCaptured !== true && this.origOwner !== tradeShipOwner) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (dstPortOwner.id() === this.srcPort.owner().id()) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.wasCaptured &&
      (!this._dstPort.isActive() || !tradeShipOwner.canTrade(dstPortOwner))
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      this.wasCaptured &&
      (tradeShipOwner !== dstPortOwner || !this._dstPort.isActive())
    ) {
      const ports = this.tradeShip
        .owner()
        .units(UnitType.Port)
        .sort(distSortUnit(this.mg, this.tradeShip));
      if (ports.length === 0) {
        this.tradeShip.delete(false);
        this.active = false;
        return;
      } else {
        this._dstPort = ports[0];
        this.tradeShip.setTargetUnit(this._dstPort);
      }
    }

    const curTile = this.tradeShip.tile();
    if (curTile === this.dstPort()) {
      this.complete();
      return;
    }

    const result = this.pathFinder.nextTile(curTile, this._dstPort.tile());

    switch (result.type) {
      case PathFindResultType.Pending:
        // Fire unit event to rerender.
        this.tradeShip.move(curTile);
        break;
      case PathFindResultType.NextTile:
        // Update safeFromPirates status
        if (this.mg.isWater(result.node) && this.mg.isShoreline(result.node)) {
          this.tradeShip.setSafeFromPirates();
        }
        this.tradeShip.move(result.node);
        this.tilesTraveled++;
        break;
      case PathFindResultType.Completed:
        this.complete();
        break;
      case PathFindResultType.PathNotFound:
        console.warn("captured trade ship cannot find route");
        if (this.tradeShip.isActive()) {
          this.tradeShip.delete(false);
        }
        this.active = false;
        break;
    }
  }

  private complete() {
    this.active = false;
    this.tradeShip!.delete(false);
    const baseGold = this.mg.config().tradeShipGold(this.tilesTraveled);

    if (this.wasCaptured) {
      this.tradeShip!.owner().addGold(baseGold);
      this.mg.displayMessage(
        `Received ${renderNumber(baseGold)} gold from ship captured from ${this.origOwner.displayName()}`,
        MessageType.CAPTURED_ENEMY_UNIT,
        this.tradeShip!.owner().id(),
        baseGold,
      );
    } else {
      // Apply tech modifiers to each port owner
      const srcMods = tradeIncomeModifiers(this.srcPort.owner());
      const dstMods = tradeIncomeModifiers(this._dstPort.owner());

      const srcGold = BigInt(Math.floor(Number(baseGold) * srcMods.incomeMul));
      const dstGold = BigInt(Math.floor(Number(baseGold) * dstMods.incomeMul));

      this.srcPort.owner().addGold(srcGold);
      this._dstPort.owner().addGold(dstGold);
      this.mg.displayMessage(
        `Received ${renderNumber(dstGold)} gold from trade with ${this.srcPort.owner().displayName()}`,
        MessageType.RECEIVED_GOLD_FROM_TRADE,
        this._dstPort.owner().id(),
        dstGold,
      );
      this.mg.displayMessage(
        `Received ${renderNumber(srcGold)} gold from trade with ${this._dstPort.owner().displayName()}`,
        MessageType.RECEIVED_GOLD_FROM_TRADE,
        this.srcPort.owner().id(),
        srcGold,
      );
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this._dstPort.tile();
  }
}
