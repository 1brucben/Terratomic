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
      // Three shares of gold are paid out:
      // 1. Ship owner gets base gold
      // 2. Source port owner gets port gold (with road bonus)
      // 3. Destination port owner gets port gold (with road bonus)
      // A player can receive multiple shares if they own multiple roles
      const shipOwner = this.origOwner;
      const srcPortOwner = this.srcPort.owner();
      const dstPortOwner = this._dstPort.owner();

      // Calculate gold with road connection bonus for each port
      const srcPortGold = this.calculatePortGoldWithRoadBonus(
        this.srcPort,
        baseGold,
      );
      const dstPortGold = this.calculatePortGoldWithRoadBonus(
        this._dstPort,
        baseGold,
      );
      // Ship owner gets base gold (no road bonus - the ship itself isn't road-connected)
      const shipOwnerGold = baseGold;

      // Pay ship owner their share
      if (shipOwner.isPlayer() && shipOwner.isAlive()) {
        shipOwner.addGold(shipOwnerGold);
        this.mg.displayMessage(
          `Received ${renderNumber(shipOwnerGold)} gold from trade ship voyage`,
          MessageType.RECEIVED_GOLD_FROM_TRADE,
          shipOwner.id(),
          shipOwnerGold,
        );
      }

      // Pay source port owner their share
      if (srcPortOwner.isPlayer() && srcPortOwner.isAlive()) {
        srcPortOwner.addGold(srcPortGold);
        this.mg.displayMessage(
          `Received ${renderNumber(srcPortGold)} gold from trade with ${dstPortOwner.isPlayer() ? dstPortOwner.displayName() : "unknown"}`,
          MessageType.RECEIVED_GOLD_FROM_TRADE,
          srcPortOwner.id(),
          srcPortGold,
        );
      }

      // Pay destination port owner their share
      if (dstPortOwner.isPlayer() && dstPortOwner.isAlive()) {
        dstPortOwner.addGold(dstPortGold);
        this.mg.displayMessage(
          `Received ${renderNumber(dstPortGold)} gold from trade with ${srcPortOwner.isPlayer() ? srcPortOwner.displayName() : "unknown"}`,
          MessageType.RECEIVED_GOLD_FROM_TRADE,
          dstPortOwner.id(),
          dstPortGold,
        );
      }
    }
    return;
  }

  /**
   * Calculate port gold with road connection bonus.
   * If the port is connected to the road network, add up to +20% bonus scaled by road quality.
   */
  private calculatePortGoldWithRoadBonus(port: Unit, baseGold: bigint): bigint {
    if (!this.mg.isStructureConnectedToRoadNetwork(port)) {
      return baseGold;
    }

    const owner = port.owner();
    if (!owner.isPlayer()) {
      return baseGold;
    }

    // Get road quality (0-150, with 100 being baseline)
    const roadQuality = (owner as Player).roadNetworkQuality();
    // Road bonus: at 100% quality = 20% increase, at 50% = 10%, at 150% = 30%
    const bonusFactor = 0.2 * (roadQuality / 100);
    const bonusGold = BigInt(Math.floor(Number(baseGold) * bonusFactor));

    return baseGold + bonusGold;
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
