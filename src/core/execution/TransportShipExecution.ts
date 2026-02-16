import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerType,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { targetTransportTile } from "../game/TransportShipUtils";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { AttackExecution } from "./AttackExecution";

export class TransportShipExecution implements Execution {
  executionName = "TransportShipExecution";

  // TODO: make this configurable
  private ticksPerMove = 1;
  private lastMove: number;

  private active = true;

  private mg: Game;
  private target: Player | TerraNullius;
  private pathFinder: SteppingPathFinder<TileRef>;

  private dst: TileRef | null;
  private src: TileRef | null;
  private boat: Unit;

  constructor(
    private attacker: Player,
    private ref: TileRef,
    private troops: number,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!mg.isValidRef(this.ref)) {
      console.warn(`TransportShipExecution: ref ${this.ref} not valid`);
      this.active = false;
      return;
    }

    this.lastMove = ticks;
    this.mg = mg;
    this.target = mg.owner(this.ref);
    this.pathFinder = PathFinding.Water(mg);

    const isPeaceTimerActive =
      mg.peaceTimerEndsAtTick !== null && mg.ticks() < mg.peaceTimerEndsAtTick;

    if (isPeaceTimerActive && this.target.isPlayer()) {
      const attackerType = this.attacker.type();
      const defenderType = this.target.type();

      if (
        (attackerType === PlayerType.Human || attackerType === PlayerType.AI) &&
        (defenderType === PlayerType.Human || defenderType === PlayerType.AI)
      ) {
        mg.displayMessage(
          `Attack blocked: Peace timer is active.`,
          MessageType.PEACE_TIMER_BLOCKED,
          this.attacker.id(),
        );
        this.active = false;
        return;
      }
    }

    if (
      this.attacker.unitCount(UnitType.TransportShip) >=
      mg.config().boatMaxNumber()
    ) {
      mg.displayMessage(
        `No boats available, max ${mg.config().boatMaxNumber()}`,
        MessageType.ATTACK_FAILED,
        this.attacker.id(),
      );
      this.active = false;
      return;
    }

    this.troops ??= this.mg
      .config()
      .boatAttackAmount(this.attacker, this.target);
    this.troops = Math.min(this.troops, this.attacker.troops());

    this.dst = targetTransportTile(this.mg, this.ref);

    if (this.dst === null) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find target tile`,
      );
      this.active = false;
      return;
    }

    const src = this.attacker.canBuild(UnitType.TransportShip, this.dst);

    if (src === false) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find start tile`,
      );
      this.active = false;
      return;
    }

    this.src = src;

    this.boat = this.attacker.buildUnit(UnitType.TransportShip, this.src, {
      troops: this.troops,
    });
    // Track intended target player on the boat for selective cancellation on peace
    (this.boat as any).setBoatTargetPlayerID?.(this.target.id());

    if (this.dst !== null) {
      this.boat.setTargetTile(this.dst);
    } else {
      this.boat.setTargetTile(undefined);
    }

    // Notify the target player about the incoming naval invasion
    if (this.target.id() !== mg.terraNullius().id()) {
      mg.displayIncomingUnit(
        this.boat.id(),
        // TODO TranslateText
        `Naval invasion incoming from ${this.attacker.displayName()}`,
        MessageType.NAVAL_INVASION_INBOUND,
        this.target.id(),
      );
    }

    // Record stats
    this.mg
      .stats()
      .boatSendTroops(this.attacker, this.target, this.boat.troops());
  }

  tick(ticks: number) {
    if (this.dst === null) {
      this.active = false;
      return;
    }
    if (!this.active) {
      return;
    }
    if (!this.boat.isActive()) {
      this.active = false;
      return;
    }
    if (ticks - this.lastMove < this.ticksPerMove) {
      return;
    }
    this.lastMove = ticks;

    // Retreat if the destination tile's owner changed and we're not at war with the new owner
    if (!this.boat.retreating() && this.dst !== null) {
      const dstOwner = this.mg.owner(this.dst);
      if (
        dstOwner !== this.target &&
        dstOwner.isPlayer() &&
        !this.attacker.isAtWarWith(dstOwner as Player)
      ) {
        this.boat.orderBoatRetreat();
      }
    }

    if (this.boat.retreating()) {
      // Ensure retreat source is still valid for (new) owner
      if (this.mg.owner(this.src!) !== this.attacker) {
        // Use bestTransportShipSpawn, not canBuild because of its max boats check etc
        const newSrc = this.attacker.bestTransportShipSpawn(this.dst);
        if (newSrc === false) {
          this.src = null;
        } else {
          this.src = newSrc;
        }
      }

      if (this.src === null) {
        console.warn(
          `TransportShipExecution: retreating but no src found for new attacker`,
        );
        this.attacker.addTroops(this.boat.troops());
        this.boat.delete(false);
        this.active = false;
        return;
      } else {
        this.dst = this.src;

        if (this.boat.targetTile() !== this.dst) {
          this.boat.setTargetTile(this.dst);
        }
      }
    }

    const result = this.pathFinder.next(this.boat.tile(), this.dst);
    switch (result.status) {
      case PathStatus.COMPLETE:
        if (this.mg.owner(this.dst) === this.attacker) {
          this.attacker.addTroops(this.boat.troops());
          this.boat.delete(false);
          this.active = false;

          // Record stats
          this.mg
            .stats()
            .boatArriveTroops(this.attacker, this.target, this.boat.troops());
          return;
        }
        this.attacker.conquer(this.dst);
        if (this.target.isPlayer() && this.attacker.isFriendly(this.target)) {
          this.attacker.addTroops(this.boat.troops());
        } else {
          this.mg.addExecution(
            new AttackExecution(
              this.boat.troops(),
              this.attacker,
              this.target.id(),
              this.dst,
              false,
            ),
          );
        }
        this.boat.delete(false);
        this.active = false;

        // Record stats
        this.mg
          .stats()
          .boatArriveTroops(this.attacker, this.target, this.boat.troops());
        return;
      case PathStatus.NEXT:
        this.boat.move(result.node);
        break;
      case PathStatus.PENDING:
        break;
      case PathStatus.NOT_FOUND: {
        // TODO: add to poisoned port list
        const map = this.mg.map();
        const boatTile = this.boat.tile();
        console.warn(
          `TransportShip path not found: boat@(${map.x(boatTile)},${map.y(boatTile)}) -> dst@(${map.x(this.dst)},${map.y(this.dst)}), attacker=${this.attacker.id()}, target=${this.target.id()}`,
        );
        this.attacker.addTroops(this.boat.troops());
        this.boat.delete(false);
        this.active = false;
        return;
      }
    }
  }

  owner(): Player {
    return this.attacker;
  }

  isActive(): boolean {
    return this.active;
  }
}
