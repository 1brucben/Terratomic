import { renderNumber } from "../../client/Utils";
import { simpleHash, toInt, withinInt } from "../Util";
import {
  AllUnitParams,
  MessageType,
  Player,
  PlayerID,
  Tick,
  TrajectoryTile,
  Unit,
  UnitInfo,
  UnitType,
  UpgradeType,
  isStructureType,
} from "./Game";
import { GameImpl } from "./GameImpl";
import { TileRef } from "./GameMap";
import { GameUpdateType, UnitUpdate } from "./GameUpdates";
import { PlayerImpl } from "./PlayerImpl";

export class UnitImpl implements Unit {
  private _active = true;
  private _targetTile: TileRef | undefined;
  private _targetUnit: Unit | undefined;
  private _health: bigint;
  private _lastTile: TileRef;
  private _retreating: boolean = false;
  private _targetedBySAM = false;
  private _reachedTarget = false;
  private _lastSetSafeFromPirates: number; // Only for trade ships
  private _constructionType: UnitType | undefined;
  private _lastOwner: PlayerImpl | null = null;
  private _troops: number;
  private _cooldownStartTick: Tick | null = null;
  private _cooldownDuration: Tick | null = null;
  private _returning: boolean = false;
  private _patrolTile: TileRef | undefined;
  private _level: number = 1;
  private _bonusMaxHealth: number = 0; // Extra max health from upgrades (e.g. city upgrades)
  private _targetable: boolean = true;
  private _accumulatedRegen: number = 0;
  private _insuredBy: Player | null = null;
  // Transport-ship specific: track intended target player for cancellation on peace
  private _boatTargetPlayerID: PlayerID | null = null;
  public lastVisibleTick?: number;
  isDetectedByNavalUnit?: boolean;
  isAttacking?: boolean;

  isPeriodicallyVisible(): boolean {
    if (this.lastVisibleTick === undefined) {
      return false;
    }
    // 3 seconds * 10 ticks/sec = 30 ticks
    return this.mg.ticks() - this.lastVisibleTick < 30;
  }
  // Nuke only
  private _trajectoryIndex: number = 0;
  private _trajectory: TrajectoryTile[];

  constructor(
    private _type: UnitType,
    private mg: GameImpl,
    private _tile: TileRef,
    private _id: number,
    public _owner: PlayerImpl,
    params: AllUnitParams = {},
  ) {
    this._lastTile = _tile;
    // Initialize health to full effective max (base + bonus). Bonus starts at 0.
    this._health = toInt(this.mg.unitInfo(_type).maxHealth ?? 1);
    this._targetTile =
      "targetTile" in params ? (params.targetTile ?? undefined) : undefined;
    this._trajectory = "trajectory" in params ? (params.trajectory ?? []) : [];
    this._troops = "troops" in params ? (params.troops ?? 0) : 0;
    this._lastSetSafeFromPirates =
      "lastSetSafeFromPirates" in params
        ? (params.lastSetSafeFromPirates ?? 0)
        : 0;
    this._patrolTile =
      "patrolTile" in params ? (params.patrolTile ?? undefined) : undefined;
    this._targetUnit =
      "targetUnit" in params ? (params.targetUnit ?? undefined) : undefined;
    if (
      isStructureType(this._type) &&
      this._owner.hasUpgrade(UpgradeType.StructureInsurance)
    ) {
      this._insuredBy = this._owner;
    }

    switch (this._type) {
      case UnitType.Warship:
      case UnitType.FighterJet:
      case UnitType.Port:
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
        this.mg.stats().unitBuild(_owner, this._type);
    }
  }

  setTargetable(targetable: boolean): void {
    if (this._targetable !== targetable) {
      this._targetable = targetable;
      this.mg.addUpdate(this.toUpdate());
    }
  }

  isTargetable(): boolean {
    return this._targetable;
  }

  setPatrolTile(tile: TileRef): void {
    this._patrolTile = tile;
  }

  patrolTile(): TileRef | undefined {
    return this._patrolTile;
  }

  tick() {}

  isUnit(): this is Unit {
    return true;
  }

  touch(): void {
    this.mg.addUpdate(this.toUpdate());
  }
  setTileTarget(tile: TileRef | undefined): void {
    this._targetTile = tile;
  }
  tileTarget(): TileRef | undefined {
    return this._targetTile;
  }

  id() {
    return this._id;
  }

  toUpdate(): UnitUpdate {
    return {
      type: GameUpdateType.Unit,
      unitType: this._type,
      id: this._id,
      troops: this._troops,
      ownerID: this._owner.smallID(),
      lastOwnerID: this._lastOwner?.smallID(),
      isActive: this._active,
      reachedTarget: this._reachedTarget,
      retreating: this._retreating,
      pos: this._tile,
      targetable: this._targetable,
      lastPos: this._lastTile,
      health: this.hasHealth() ? Number(this._health) : undefined,
      level: this._level > 1 ? this._level : undefined,
      constructionType: this._constructionType,
      targetUnitId: this._targetUnit?.id() ?? undefined,
      targetTile: this.targetTile() ?? undefined,
      // Provide both for transition; cooldownEndsAt is the unified field
      ticksLeftInCooldown: this.ticksLeftInCooldown() ?? undefined,
      cooldownEndsAt:
        this._cooldownStartTick !== null && this._cooldownDuration !== null
          ? this._cooldownStartTick + this._cooldownDuration
          : undefined,
      cooldownDuration: this._cooldownDuration ?? undefined,
      returning: this.returning(),
      isAttacking: this.isAttacking,
      isDetectedByNavalUnit: this.isDetectedByNavalUnit,
    };
  }

  type(): UnitType {
    return this._type;
  }

  lastTile(): TileRef {
    return this._lastTile;
  }

  move(tile: TileRef): void {
    if (tile === null) {
      throw new Error("tile cannot be null");
    }
    this._lastTile = this._tile;
    this._tile = tile;
    this.mg.updateUnitTile(this);
    this.mg.addUpdate(this.toUpdate());
  }

  setTroops(troops: number): void {
    this._troops = troops;
  }
  troops(): number {
    return this._troops;
  }
  health(): number {
    return Number(this._health);
  }
  hasHealth(): boolean {
    return this.info().maxHealth !== undefined;
  }
  tile(): TileRef {
    return this._tile;
  }
  owner(): PlayerImpl {
    return this._owner;
  }

  info(): UnitInfo {
    return this.mg.unitInfo(this._type);
  }

  private baseMaxHealth(): number {
    return this.mg.unitInfo(this._type).maxHealth ?? 1;
  }

  private effectiveMaxHealth(): number {
    return this.baseMaxHealth() + this._bonusMaxHealth;
  }

  level(): number {
    return this._level;
  }

  /**
   * Generic structure upgrade entrypoint.
   * Supports City and Port upgrades: +1 level, +1000 max HP, heal 1000 (capped), invalidate caches, emit update.
   */
  upgradeStructure(): void {
    switch (this._type) {
      case UnitType.City: {
        this._level += 1;
        this._bonusMaxHealth += 1000;
        const healed = Number(this._health) + 1000;
        const capped = Math.min(healed, this.effectiveMaxHealth());
        this._health = toInt(capped);
        this._owner.invalidateEffectiveUnitsCache(UnitType.City);
        this.mg.addUpdate(this.toUpdate());
        return;
      }
      case UnitType.MissileSilo: {
        // Cap silo upgrades at level 3
        if (this._level >= 3) {
          return;
        }
        this._level += 1;
        this._bonusMaxHealth += 250;
        const healed = Number(this._health) + 250;
        const capped = Math.min(healed, this.effectiveMaxHealth());
        this._health = toInt(capped);
        // No change to "unitsOwned" semantics; silos do not count extra per level
        // No specific cache to invalidate for silos currently
        this.mg.addUpdate(this.toUpdate());
        return;
      }
      case UnitType.SAMLauncher: {
        // Cap SAM upgrades at level 3
        if (this._level >= 3) {
          return;
        }
        this._level += 1;
        // Small durability boost per upgrade, aligned with MissileSilo behavior
        this._bonusMaxHealth += 250;
        const healed = Number(this._health) + 250;
        const capped = Math.min(healed, this.effectiveMaxHealth());
        this._health = toInt(capped);
        this.mg.addUpdate(this.toUpdate());
        return;
      }
      case UnitType.Port: {
        this._level += 1;
        this._bonusMaxHealth += 1000;
        const healed = Number(this._health) + 1000;
        const capped = Math.min(healed, this.effectiveMaxHealth());
        this._health = toInt(capped);
        this._owner.invalidateEffectiveUnitsCache(UnitType.Port);
        this.mg.addUpdate(this.toUpdate());
        return;
      }
      case UnitType.Hospital: {
        this._level += 1;
        this._bonusMaxHealth += 1000;
        const healed = Number(this._health) + 1000;
        const capped = Math.min(healed, this.effectiveMaxHealth());
        this._health = toInt(capped);
        this._owner.invalidateEffectiveUnitsCache(UnitType.Hospital);
        this.mg.addUpdate(this.toUpdate());
        return;
      }
      case UnitType.Academy: {
        this._level += 1;
        this._bonusMaxHealth += 1000;
        const healed = Number(this._health) + 1000;
        const capped = Math.min(healed, this.effectiveMaxHealth());
        this._health = toInt(capped);
        this._owner.invalidateEffectiveUnitsCache(UnitType.Academy);
        this.mg.addUpdate(this.toUpdate());
        return;
      }
      case UnitType.ResearchLab: {
        this._level += 1;
        this._bonusMaxHealth += 1000;
        const healed = Number(this._health) + 1000;
        const capped = Math.min(healed, this.effectiveMaxHealth());
        this._health = toInt(capped);
        this._owner.invalidateEffectiveUnitsCache(UnitType.ResearchLab);
        this.mg.addUpdate(this.toUpdate());
        return;
      }
      case UnitType.Factory: {
        this._level += 1;
        this._bonusMaxHealth += 1000;
        const healed = Number(this._health) + 1000;
        const capped = Math.min(healed, this.effectiveMaxHealth());
        this._health = toInt(capped);
        this._owner.invalidateEffectiveUnitsCache(UnitType.Factory);
        this.mg.addUpdate(this.toUpdate());
        return;
      }
      default:
        // Unsupported structure types: no-op for now
        return;
    }
  }

  // Backward compatibility stub (avoid runtime errors if any legacy call sites remain)
  // Remove once all references to upgradeCity are fully eliminated.
  // @deprecated Use upgradeStructure()
  upgradeCity(): void {
    this.upgradeStructure();
  }

  setOwner(newOwner: PlayerImpl): void {
    if (this._insuredBy) {
      const baseCost = this.info().cost(this._insuredBy);
      if (baseCost > 0n) {
        const num = BigInt(this.mg.config().structureInsuranceRefundNum());
        const den = BigInt(this.mg.config().structureInsuranceRefundDen());
        const refundAmount = (baseCost * num) / den;
        this._insuredBy.addGold(refundAmount);
        this.mg.displayMessage(
          "messages.insurance_refund_conquest",
          MessageType.INSURANCE_REFUND,
          this._insuredBy.id(),
          refundAmount,
          { amount: renderNumber(refundAmount) },
        );
      }
    }
    this._insuredBy = null;
    switch (this._type) {
      case UnitType.Warship:
      case UnitType.FighterJet:
      case UnitType.Port:
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
        this.mg.stats().unitCapture(newOwner, this._type);
        this.mg.stats().unitLose(this._owner, this._type);
        break;
    }
    this._lastOwner = this._owner;
    this._lastOwner.invalidateEffectiveUnitsCache(this.type());
    this._lastOwner._units = this._lastOwner._units.filter((u) => u !== this);
    this._owner = newOwner;
    this._owner.invalidateEffectiveUnitsCache(this.type());
    this._owner._units.push(this);
    if (
      isStructureType(this._type) &&
      this._owner.hasUpgrade(UpgradeType.StructureInsurance)
    ) {
      this._insuredBy = this._owner;
    }
    this.mg.addUpdate(this.toUpdate());
    this.mg.displayMessage(
      `Your ${this.type()} was captured by ${newOwner.displayName()}`,
      MessageType.UNIT_CAPTURED_BY_ENEMY,
      this._lastOwner.id(),
    );
    this.mg.displayMessage(
      `Captured ${this.type()} from ${this._lastOwner.displayName()}`,
      MessageType.CAPTURED_ENEMY_UNIT,
      newOwner.id(),
    );
  }

  modifyHealth(delta: number, attacker?: Player): void {
    if (delta > 0) {
      this._accumulatedRegen += delta;
      const integerPart = Math.floor(this._accumulatedRegen);
      if (integerPart > 0) {
        this._health = withinInt(
          this._health + BigInt(integerPart),
          0n,
          toInt(this.effectiveMaxHealth()),
        );
        this._accumulatedRegen -= integerPart;
      }
    } else {
      this._health = withinInt(
        this._health + toInt(delta),
        0n,
        toInt(this.effectiveMaxHealth()),
      );
      this._accumulatedRegen = 0;
    }
    this.mg.addUpdate(this.toUpdate());
    (this.owner() as PlayerImpl).invalidateEffectiveUnitsCache(this.type());
    if (this._health === 0n) {
      this.delete(true, attacker);
    }
  }

  delete(displayMessage?: boolean, destroyer?: Player): void {
    if (!this.isActive()) {
      throw new Error(`cannot delete ${this} not active`);
    }
    if (this._insuredBy) {
      const baseCost = this.info().cost(this._insuredBy);
      if (baseCost > 0n) {
        const num = BigInt(this.mg.config().structureInsuranceRefundNum());
        const den = BigInt(this.mg.config().structureInsuranceRefundDen());
        const refundAmount = (baseCost * num) / den;
        this._insuredBy.addGold(refundAmount);
        this.mg.displayMessage(
          "messages.insurance_refund",
          MessageType.INSURANCE_REFUND,
          this._insuredBy.id(),
          refundAmount,
          { amount: renderNumber(refundAmount) },
        );
      }
    }
    this._insuredBy = null;
    this._owner._units = this._owner._units.filter((b) => b !== this);
    this._active = false;
    this.mg.addUpdate(this.toUpdate());
    this.mg.removeUnit(this);
    if (
      displayMessage !== false &&
      this._type !== UnitType.MIRVWarhead &&
      this._type !== UnitType.Bomber
    ) {
      this.mg.displayMessage(
        `Your ${this._type} was destroyed`,
        MessageType.UNIT_DESTROYED,
        this.owner().id(),
      );
    }
    if (destroyer !== undefined) {
      switch (this._type) {
        case UnitType.TransportShip:
          this.mg
            .stats()
            .boatDestroyTroops(destroyer, this._owner, this._troops);
          break;
        case UnitType.TradeShip:
          this.mg.stats().boatDestroyTrade(destroyer, this._owner);
          break;
        case UnitType.City:
        case UnitType.DefensePost:
        case UnitType.MissileSilo:
        case UnitType.Port:
        case UnitType.SAMLauncher:
        case UnitType.Warship:
        case UnitType.FighterJet:
          this.mg.stats().unitDestroy(destroyer, this._type);
          this.mg.stats().unitLose(this.owner(), this._type);
          break;
      }
    }
  }

  isActive(): boolean {
    return this._active;
  }

  retreating(): boolean {
    return this._retreating;
  }

  orderBoatRetreat() {
    if (this.type() !== UnitType.TransportShip) {
      throw new Error(`Cannot retreat ${this.type()}`);
    }
    this._retreating = true;
  }

  constructionType(): UnitType | null {
    if (this.type() !== UnitType.Construction) {
      throw new Error(`Cannot get construction type on ${this.type()}`);
    }
    return this._constructionType ?? null;
  }

  setConstructionType(type: UnitType): void {
    if (this.type() !== UnitType.Construction) {
      throw new Error(`Cannot set construction type on ${this.type()}`);
    }
    this._constructionType = type;
    this.mg.addUpdate(this.toUpdate());
  }

  hash(): number {
    return this.tile() + simpleHash(this.type()) * this._id;
  }

  toString(): string {
    return `Unit:${this._type},owner:${this.owner().name()}`;
  }

  // Transport ship targeting metadata
  setBoatTargetPlayerID(pid: PlayerID | null): void {
    this._boatTargetPlayerID = pid;
  }
  boatTargetPlayerID(): PlayerID | null {
    return this._boatTargetPlayerID;
  }

  insure(player: Player | null): void {
    if (!isStructureType(this._type)) return;
    this._insuredBy = player;
  }

  launch(duration?: Tick): void {
    this._cooldownStartTick = this.mg.ticks();
    if (duration !== undefined) {
      this._cooldownDuration = duration;
    } else {
      // Choose default by unit type
      if (this.type() === UnitType.MissileSilo) {
        // Reduce cooldown by 20% per upgrade level beyond 1: L1=100%, L2=80%, L3=60%
        const base = this.mg.config().SiloCooldown();
        const levelsAboveOne = Math.max(0, this._level - 1);
        const multiplier = Math.max(0, 1 - 0.2 * levelsAboveOne);
        this._cooldownDuration = Math.floor(base * multiplier);
      } else if (this.type() === UnitType.SAMLauncher) {
        this._cooldownDuration = this.mg.config().SAMNukeCooldown();
      } else if (this.type() === UnitType.City) {
        // City anti-air default will be set by caller via duration; fallback to SAM cooldown
        this._cooldownDuration = this.mg.config().SAMNukeCooldown();
      } else {
        this._cooldownDuration = this.mg.config().SAMNukeCooldown();
      }
    }
    this.mg.addUpdate(this.toUpdate());
  }

  ticksLeftInCooldown(): Tick | undefined {
    let cooldownDuration = this._cooldownDuration;

    if (cooldownDuration === null) {
      return undefined;
    }

    if (
      this.type() === UnitType.SAMLauncher ||
      this.type() === UnitType.MissileSilo
    ) {
      if (this.hasHealth()) {
        const healthPercentage =
          Number(this.health()) / (this.info().maxHealth ?? 1);
        if (healthPercentage > 0) {
          cooldownDuration /= healthPercentage;
        }
      }
    }

    if (!this._cooldownStartTick) {
      return undefined;
    }

    return cooldownDuration - (this.mg.ticks() - this._cooldownStartTick);
  }

  isInCooldown(duration?: Tick): boolean {
    const ticksLeft = this.ticksLeftInCooldown();
    if (duration !== undefined) {
      return (
        ticksLeft !== undefined &&
        ticksLeft > this._cooldownDuration! - duration
      );
    }
    return ticksLeft !== undefined && ticksLeft > 0;
  }

  setTargetTile(targetTile: TileRef | undefined) {
    this._targetTile = targetTile;
  }

  targetTile(): TileRef | undefined {
    return this._targetTile;
  }

  setTrajectoryIndex(i: number): void {
    const max = this._trajectory.length - 1;
    this._trajectoryIndex = i < 0 ? 0 : i > max ? max : i;
  }

  trajectoryIndex(): number {
    return this._trajectoryIndex;
  }

  trajectory(): TrajectoryTile[] {
    return this._trajectory;
  }

  setTargetUnit(target: Unit | undefined): void {
    this._targetUnit = target;
  }

  targetUnit(): Unit | undefined {
    return this._targetUnit;
  }

  setTargetedBySAM(targeted: boolean): void {
    this._targetedBySAM = targeted;
  }

  targetedBySAM(): boolean {
    return this._targetedBySAM;
  }

  returning(): boolean {
    return this._returning;
  }

  setReturning(returning: boolean): void {
    this._returning = returning;
  }

  setReachedTarget(): void {
    this._reachedTarget = true;
  }

  reachedTarget(): boolean {
    return this._reachedTarget;
  }

  setSafeFromPirates(): void {
    this._lastSetSafeFromPirates = this.mg.ticks();
  }

  isSafeFromPirates(): boolean {
    return (
      this.mg.ticks() - this._lastSetSafeFromPirates <
      this.mg.config().safeFromPiratesCooldownMax()
    );
  }
}
