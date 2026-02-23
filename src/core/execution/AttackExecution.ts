import { renderNumber, renderTroops } from "../../client/Utils";
import {
  Attack,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  PlayerType,
  TerraNullius,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { FlatBinaryHeap } from "./utils/FlatBinaryHeap"; // adjust path if needed

const malusForRetreat = 25;

export class AttackExecution implements Execution {
  executionName = "AttackExecution";
  private breakAlliance = false;
  private wasAlliedAtInit = false; // Store alliance state at initialization
  private active: boolean = true;
  private toConquer = new FlatBinaryHeap();

  private random = new PseudoRandom(123);

  private target: Player | TerraNullius;

  private mg: Game;

  private attack: Attack | null = null;
  private isDeepStrike: boolean = false;
  private tilesToProcessAccumulator: number = 0;

  constructor(
    private startTroops: number | null = null,
    private _owner: Player,
    private _targetID: PlayerID | null,
    private sourceTile: TileRef | null = null,
    private removeTroops: boolean = true,
  ) {
    this.isDeepStrike = sourceTile !== null;
  }

  public targetID(): PlayerID | null {
    return this._targetID;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!this.active) {
      return;
    }
    this.mg = mg;

    if (this._targetID !== null && !mg.hasPlayer(this._targetID)) {
      console.warn(`target ${this._targetID} not found`);
      this.active = false;
      return;
    }

    this.target =
      this._targetID === this.mg.terraNullius().id()
        ? mg.terraNullius()
        : mg.player(this._targetID);

    if (this._owner === this.target) {
      console.error(`Player ${this._owner} cannot attack itself`);
      this.active = false;
      return;
    }

    if (this.target && this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (
        targetPlayer.type() !== PlayerType.Bot &&
        this._owner.type() !== PlayerType.Bot
      ) {
        // Don't let bots embargo since they can't trade anyway.
        targetPlayer.addEmbargo(this._owner.id(), true);
        this.rejectIncomingAllianceRequests(targetPlayer);
      }
    }

    if (this.target.isPlayer()) {
      if (
        this.mg.config().numSpawnPhaseTurns() +
          this.mg.config().spawnImmunityDuration() >
        this.mg.ticks()
      ) {
        console.warn("cannot attack player during immunity phase");
        this.active = false;
        return;
      }
      if (this._owner.isOnSameTeam(this.target)) {
        console.warn(
          `${this._owner.displayName()} cannot attack ${this.target.displayName()} because they are on the same team`,
        );
        this.active = false;
        return;
      }
    }

    this.startTroops ??= this.mg
      .config()
      .attackAmount(this._owner, this.target);
    if (this.removeTroops) {
      this.startTroops = Math.min(this._owner.troops(), this.startTroops);
      this._owner.removeTroops(this.startTroops);
    }
    this.attack = this._owner.createAttack(
      this.target,
      this.startTroops,
      this.sourceTile,
      new Set<TileRef>(),
    );

    // War declaration and aggression tracking on first contact
    if (this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      this._owner.setWarWith(targetPlayer);
      targetPlayer.setWarWith(this._owner);
      this._owner.recordAggression(targetPlayer);
      targetPlayer.recordAggression(this._owner);
    }

    const penalty = Math.floor(this._owner.population() * 0.01);
    this._owner.removeTroops(penalty);

    if (this.sourceTile !== null) {
      this.initializeConquestFromLandingTile(this.sourceTile);
    } else {
      this.refreshToConquer();
    }

    // Record stats
    this.mg.stats().attack(this._owner, this.target, this.startTroops);

    for (const incoming of this._owner.incomingAttacks()) {
      if (incoming.attacker() === this.target) {
        // Target has opposing attack, cancel them out
        if (incoming.troops() > this.attack.troops()) {
          incoming.setTroops(incoming.troops() - this.attack.troops());
          this.attack.delete();
          this.active = false;
          return;
        } else {
          this.attack.setTroops(this.attack.troops() - incoming.troops());
          incoming.delete();
        }
      }
    }
    for (const outgoing of this._owner.outgoingAttacks()) {
      if (
        outgoing !== this.attack &&
        outgoing.target() === this.attack.target() &&
        // Boat attacks (sourceTile is not null) are not combined with other attacks
        this.attack.sourceTile() === null
      ) {
        this.attack.setTroops(this.attack.troops() + outgoing.troops());
        outgoing.delete();
      }
    }

    if (this.target.isPlayer()) {
      // Store the alliance state at initialization time to prevent race conditions
      this.wasAlliedAtInit = this._owner.isAlliedWith(this.target);
      if (this.wasAlliedAtInit) {
        this.breakAlliance = true;
      }
      this.target.updateRelation(this._owner, -80);
    }
  }

  private initializeConquestFromLandingTile(tile: TileRef) {
    const attack = this.attack!;
    this.toConquer.clear();
    attack.clearBorder();
    this.toConquer.enqueue(tile, 0);
    attack.addBorderTile(tile);
    this.addNeighbors(tile, this._owner.smallID(), this.target.smallID());
  }

  private refreshToConquer() {
    const attack = this.attack!;
    const ownerSmallID = this._owner.smallID();
    const targetSmallID = this.target.smallID();
    this.toConquer.clear();
    attack.clearBorder();
    for (const tile of this._owner.borderTiles()) {
      this.addNeighbors(tile, ownerSmallID, targetSmallID);
    }
  }

  private retreat(malusPercent = 0) {
    const attack = this.attack!;
    const deaths = attack.troops() * (malusPercent / 100);
    if (deaths) {
      this.mg.displayMessage(
        `Attack cancelled, ${renderTroops(deaths)} soldiers killed during retreat.`,
        MessageType.ATTACK_CANCELLED,
        this._owner.id(),
      );
    }
    const survivors = attack.troops() - deaths;
    this._owner.addTroops(survivors);
    attack.delete();
    this.active = false;

    if (attack.retreated()) {
      this.mg.stats().attackCancel(this._owner, this.target, survivors);
    }
  }

  tick(ticks: number) {
    const attack = this.attack!;
    let troopCount = attack.troops();
    const targetIsPlayer = this.target.isPlayer();
    const targetPlayer = targetIsPlayer ? (this.target as Player) : null;

    if (attack.retreated()) {
      if (targetIsPlayer) {
        this.retreat(malusForRetreat);
      } else {
        this.retreat();
      }
      this.active = false;
      return;
    }

    if (attack.retreating()) {
      return;
    }

    if (!attack.isActive()) {
      this.active = false;
      return;
    }

    const alliance = targetPlayer
      ? this._owner.allianceWith(targetPlayer)
      : null;
    if (this.breakAlliance && alliance !== null) {
      this.breakAlliance = false;
      this._owner.breakAlliance(alliance);
    }

    // Calculate tiles to process
    this.tilesToProcessAccumulator += this.mg
      .config()
      .attackTilesPerTick(
        troopCount,
        this._owner,
        this.target,
        attack.borderSize() + this.random.nextInt(0, 5),
      );

    let numTilesPerTick = Math.floor(this.tilesToProcessAccumulator + 1e-9);
    this.tilesToProcessAccumulator -= numTilesPerTick;

    // ── Hoist per-tick invariants out of the tile loop ────────────────────
    const ownerSmallID = this._owner.smallID();
    const targetSmallID = this.target.smallID();
    const mg = this.mg;
    const config = mg.config();

    // Hospital multiplier is constant within a tick (unit counts don't change)
    const hospitalExp = this._owner.effectiveUnits(UnitType.Hospital);
    const attackerMultiplier = 0.6 + 0.4 * Math.pow(0.75, hospitalExp);
    const defenderMultiplier = targetPlayer
      ? 0.6 + 0.4 * Math.pow(0.75, hospitalExp)
      : 1;

    const isDeepStrike = this.isDeepStrike;
    const sourceTile = this.sourceTile;

    mg.beginBorderBatch();
    try {
      while (numTilesPerTick > 0) {
        if (troopCount < 1) {
          attack.delete();
          this.active = false;
          return;
        }

        if (this.toConquer.size() === 0) {
          if (!isDeepStrike) {
            this.refreshToConquer();
          }
          this.retreat();
          return;
        }

        const [tileToConquer] = this.toConquer.dequeue();
        attack.removeBorderTile(tileToConquer);

        // Border check via forEachNeighbor (zero-alloc callback)
        let onBorder = false;
        if (isDeepStrike && tileToConquer === sourceTile) {
          onBorder = true;
        } else {
          mg.forEachNeighbor(tileToConquer, (n: TileRef) => {
            if (!onBorder && mg.ownerID(n) === ownerSmallID) {
              onBorder = true;
            }
          });
        }
        if (mg.ownerID(tileToConquer) !== targetSmallID || !onBorder) {
          continue;
        }

        this.addNeighbors(tileToConquer, ownerSmallID, targetSmallID);

        const { attackerTroopLoss, defenderTroopLoss, tilesPerTickUsed } =
          config.attackLogic(
            mg,
            troopCount,
            this._owner,
            this.target,
            tileToConquer,
          );
        numTilesPerTick -= tilesPerTickUsed;
        troopCount -= attackerTroopLoss;
        attack.setTroops(troopCount);
        if (targetPlayer) {
          targetPlayer.removeTroops(defenderTroopLoss);
        }

        // Hospital returns using hoisted multipliers
        const attackerReturns = attackerTroopLoss * (1 - attackerMultiplier);
        const defenderReturns = defenderTroopLoss * (1 - defenderMultiplier);

        this._owner.addHospitalReturns(attackerReturns);
        if (targetPlayer) {
          targetPlayer.addHospitalReturns(defenderReturns);
        }
        mg.conquer(this._owner, tileToConquer);

        // Dead-defender check only for PvP (skipped for TN attacks)
        if (targetIsPlayer) {
          this.handleDeadDefender();
        }
      }
    } finally {
      mg.endBorderBatch();
    }
  }

  private rejectIncomingAllianceRequests(target: Player) {
    const request = this._owner
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === target);
    if (request !== undefined) {
      request.reject();
    }
  }

  private addNeighbors(
    tile: TileRef,
    ownerSmallID: number,
    targetSmallID: number,
  ): void {
    const attack = this.attack!;
    const mg = this.mg;
    const tickNow = mg.ticks();
    const random = this.random;
    const toConquer = this.toConquer;

    // forEachNeighbor uses direct callbacks — no Uint32Array subarray alloc
    mg.forEachNeighbor(tile, (neighbor: TileRef) => {
      if (mg.isWater(neighbor) || mg.ownerID(neighbor) !== targetSmallID) {
        return;
      }
      attack.addBorderTile(neighbor);

      let numOwnedByMe = 0;
      mg.forEachNeighbor(neighbor, (n: TileRef) => {
        if (mg.ownerID(n) === ownerSmallID) {
          numOwnedByMe++;
        }
      });

      // magnitude() directly instead of terrainType() enum + switch
      const magnitude = mg.magnitude(neighbor);
      let mag: number;
      if (magnitude >= 31) return; // Barrier — impassable
      if (magnitude < 10)
        mag = 1; // Plains
      else if (magnitude < 20)
        mag = 1.5; // Highland
      else mag = 2; // Mountain

      const priority =
        (random.nextInt(0, 7) + 10) * (1 - numOwnedByMe * 0.5 + mag / 2) +
        tickNow -
        (mg.hasRoadOnTile(neighbor) ? 10 : 0);

      toConquer.enqueue(neighbor, priority);
    });
  }

  private handleDeadDefender() {
    if (!(this.target.isPlayer() && this.target.numTilesOwned() < 100)) return;

    const gold = this.target.gold();
    this.mg.displayMessage(
      `Conquered ${this.target.displayName()} received ${renderNumber(
        gold,
      )} gold`,
      MessageType.CONQUERED_PLAYER,
      this._owner.id(),
      gold,
    );
    this.target.removeGold(gold);
    this._owner.addGold(gold);
    this.mg.stats().goldWar(this._owner, this.target, gold);

    for (let i = 0; i < 10; i++) {
      for (const tile of Array.from(this.target.tiles())) {
        const borders = this.mg
          .neighbors(tile)
          .some((t) => this.mg.owner(t) === this._owner);
        if (borders) {
          this._owner.conquer(tile);
        } else {
          for (const neighbor of this.mg.neighbors(tile)) {
            const no = this.mg.owner(neighbor);
            if (no.isPlayer() && no !== this.target) {
              this.mg.player(no.id()).conquer(tile);
              break;
            }
          }
        }
      }
    }
  }

  owner(): Player {
    return this._owner;
  }

  isActive(): boolean {
    return this.active;
  }
}
