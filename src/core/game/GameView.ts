import { PlayerListChangedEvent } from "../../client/events/PlayerListChangedEvent";
import { UnitCooldownEndedEvent } from "../../client/events/UnitCooldownEndedEvent";
import { SpatialIndex } from "../../client/graphics/SpatialIndex";
import { Config } from "../configuration/Config";
import { EventBus } from "../EventBus";
import { ClientID, GameID } from "../Schemas";
import { computeResearchLevel } from "../tech/ResearchTree";
import { createRandomName } from "../Util";
import { WorkerClient } from "../worker/WorkerClient";
import {
  Cell,
  EmojiMessage,
  GameUpdates,
  Gold,
  isStructureType,
  NameViewData,
  Player,
  PlayerActions,
  PlayerBorderTiles,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  Team,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
  UpgradeType,
} from "./Game";
import { GameMap, TileRef, TileUpdate } from "./GameMap";
import {
  AllianceViewData,
  AttackUpdate,
  GameUpdateType,
  GameUpdateViewData,
  PlayerUpdate,
  UnitUpdate,
} from "./GameUpdates";
import { TerraNulliusImpl } from "./TerraNulliusImpl";
import { UnitGrid, UnitPredicate } from "./UnitGrid";
import { UserSettings } from "./UserSettings";

const userSettings: UserSettings = new UserSettings();

export class UnitView {
  public _wasUpdated = true;
  public lastPos: TileRef[] = [];

  constructor(
    private gameView: GameView,
    private data: UnitUpdate,
  ) {
    this.lastPos.push(data.pos);
  }

  wasUpdated(): boolean {
    return this._wasUpdated;
  }

  lastTiles(): TileRef[] {
    return this.lastPos;
  }

  lastTile(): TileRef {
    if (this.lastPos.length === 0) {
      return this.data.pos;
    }
    return this.lastPos[0];
  }

  update(data: UnitUpdate) {
    this.lastPos.push(data.pos);
    this._wasUpdated = true;
    this.data = data;
  }

  id(): number {
    return this.data.id;
  }

  targetable(): boolean {
    return this.data.targetable;
  }

  type(): UnitType {
    return this.data.unitType;
  }
  troops(): number {
    return this.data.troops;
  }
  retreating(): boolean {
    if (this.type() !== UnitType.TransportShip) {
      throw Error("Must be a transport ship");
    }
    return this.data.retreating;
  }
  tile(): TileRef {
    return this.data.pos;
  }
  owner(): PlayerView {
    return this.gameView.playerBySmallID(this.data.ownerID)! as PlayerView;
  }
  isActive(): boolean {
    return this.data.isActive;
  }
  reachedTarget(): boolean {
    return this.data.reachedTarget;
  }
  hasHealth(): boolean {
    return this.data.health !== undefined;
  }
  health(): number {
    return this.data.health ?? 0;
  }
  constructionType(): UnitType | undefined {
    return this.data.constructionType;
  }
  constructionTargetLevel(): number {
    return this.data.constructionTargetLevel ?? 1;
  }
  targetUnitId(): number | undefined {
    return this.data.targetUnitId;
  }
  targetTile(): TileRef | undefined {
    return this.data.targetTile;
  }
  ticksLeftInCooldown(): Tick | undefined {
    return this.data.ticksLeftInCooldown;
  }
  cooldownEndsAt(): Tick | undefined {
    return (this.data as any).cooldownEndsAt;
  }
  cooldownDuration(): Tick | undefined {
    return this.data.cooldownDuration;
  }
  isCooldown(): boolean {
    const endsAt = (this.data as any).cooldownEndsAt as Tick | undefined;
    if (endsAt !== undefined) {
      return this.gameView.ticks() < endsAt;
    }
    if (this.data.ticksLeftInCooldown === undefined) return false;
    return this.data.ticksLeftInCooldown > 0;
  }

  returning(): boolean {
    return this.data.returning ?? false;
  }

  info(): UnitInfo {
    return this.gameView.unitInfo(this.type());
  }

  isAttacking(): boolean {
    return this.data.isAttacking ?? false;
  }

  isDetectedByNavalUnit(): boolean {
    return this.data.isDetectedByNavalUnit ?? false;
  }

  targetedBySAM(): boolean {
    return this.data.targetedBySAM ?? false;
  }

  // Trade metadata (optional)
  tradeRouteStartOwner(): PlayerView | null {
    const id = (this.data as any).tradeRouteStartOwnerID as number | undefined;
    return id !== undefined
      ? (this.gameView.playerBySmallID(id) as PlayerView)
      : null;
  }
  tradeRouteEndOwner(): PlayerView | null {
    const id = (this.data as any).tradeRouteEndOwnerID as number | undefined;
    return id !== undefined
      ? (this.gameView.playerBySmallID(id) as PlayerView)
      : null;
  }
  tradePhase(): "toStart" | "toEnd" | null {
    const v = (this.data as any).tradePhase as "toStart" | "toEnd" | undefined;
    return v ?? null;
  }
  dockedAtPortOwner(): PlayerView | null {
    const id = (this.data as any).dockedAtPortOwnerID as number | undefined;
    return id !== undefined
      ? (this.gameView.playerBySmallID(id) as PlayerView)
      : null;
  }

  // Structure upgrade level (>=1). Defaults to 1 when undefined in updates.
  level(): number {
    return (this.data as any).level ?? 1;
  }

  // Stack count (>=1). Number of stacked instances for stackable structures.
  stackCount(): number {
    return (this.data as any).stackCount ?? 1;
  }

  // Missile silo specific: remaining launches before cooldown (for stacked silos)
  launchesRemaining(): number | null {
    const v = (this.data as any).launchesRemaining as number | undefined;
    return v ?? null;
  }

  // Airfield-specific: bomber upgrade level. Defaults to 1.
  bomberLevel(): number {
    return (this.data as any).bomberLevel ?? 1;
  }

  // Port-specific: pending trade ship construction due tick (or null if none scheduled)
  pendingTradeShipDueTick(): Tick | null {
    const v = (this.data as any).pendingTradeShipDueTick as Tick | undefined;
    return v ?? null;
  }
  // Port-specific: multiple pending trade ship construction due ticks
  pendingTradeShipDueTicks(): Tick[] {
    const arr = (this.data as any).pendingTradeShipDueTicks as
      | Tick[]
      | undefined;
    return Array.isArray(arr) ? [...arr] : [];
  }

  // Get effective max health from server
  effectiveMaxHealth(): number {
    return this.data.maxHealth ?? 0;
  }
}

export class PlayerView {
  public anonymousName: string | null = null;
  // Cache for aggregate research tech level; recomputed only on configured cadence
  private _cachedResearchTechLevel: number = 1;
  private _cachedResearchTechLevelTick: number = -1;

  constructor(
    private game: GameView,
    public data: PlayerUpdate,
    public nameData: NameViewData,
  ) {
    if (data.clientID === game.myClientID()) {
      this.anonymousName = this.data.name;
    } else {
      this.anonymousName = createRandomName(
        this.data.name,
        this.data.playerType,
      );
    }
  }

  async actions(tile: TileRef): Promise<PlayerActions> {
    return this.game.worker.playerInteraction(
      this.id(),
      this.game.x(tile),
      this.game.y(tile),
    );
  }

  async borderTiles(): Promise<PlayerBorderTiles> {
    return this.game.worker.playerBorderTiles(this.id());
  }

  outgoingAttacks(): AttackUpdate[] {
    return this.data.outgoingAttacks;
  }

  incomingAttacks(): AttackUpdate[] {
    return this.data.incomingAttacks;
  }

  async attackAveragePosition(
    playerID: number,
    attackID: string,
  ): Promise<Cell | null> {
    return this.game.worker.attackAveragePosition(playerID, attackID);
  }

  units(...types: UnitType[]): UnitView[] {
    return this.game
      .units(...types)
      .filter((u) => u.owner().smallID() === this.smallID());
  }

  effectiveUnits(type: UnitType): number {
    return this.data.effectiveUnits[type];
  }

  invalidateEffectiveUnitsCache(type: UnitType): void {
    // No-op on the client-side view as the cache is managed server-side.
  }

  nameLocation(): NameViewData {
    return this.nameData;
  }

  smallID(): number {
    return this.data.smallID;
  }
  flag(): string | undefined {
    return this.data.flag;
  }
  name(): string {
    return this.anonymousName !== null && userSettings.anonymousNames()
      ? this.anonymousName
      : this.data.name;
  }
  displayName(): string {
    return this.anonymousName !== null && userSettings.anonymousNames()
      ? this.anonymousName
      : this.data.name;
  }

  clientID(): ClientID | null {
    return this.data.clientID;
  }
  id(): PlayerID {
    return this.data.id;
  }
  team(): Team | null {
    return this.data.team ?? null;
  }
  type(): PlayerType {
    return this.data.playerType;
  }
  isAlive(): boolean {
    return this.data.isAlive;
  }
  isPlayer(): this is Player {
    return true;
  }

  hasUpgrade(upgrade: UpgradeType): boolean {
    return this.data.upgrades.includes(upgrade);
  }

  hasResearchedTech(techId: string): boolean {
    return this.data.researchTreeTechs?.includes(techId) ?? false;
  }

  researchBeakers(techId: string): number {
    return this.data.researchTreeBeakers?.[techId] ?? 0;
  }
  researchPriorityTech(): string | null {
    return this.data.researchPriorityTech ?? null;
  }
  researchPriorities(): Set<string> {
    return new Set(this.data.researchPriorities ?? []);
  }

  // Aggregate research progress across levels in [0, L] (L = max level in tree)
  researchTechLevel(): number {
    const tick = this.game.ticks();
    const interval = this.game.config().researchIntervalTicks();
    // Only recompute on cadence: when server tick is on a research step boundary
    if (
      tick !== this._cachedResearchTechLevelTick &&
      interval > 0 &&
      tick % interval === 0
    ) {
      this._cachedResearchTechLevel = computeResearchLevel(
        this.data.researchTreeTechs ?? [],
      );
      this._cachedResearchTechLevelTick = tick;
    }
    return this._cachedResearchTechLevel;
  }

  /** Force recompute now (called from GameView on cadence) */
  _recomputeResearchTechLevelCache(currentTick: number): void {
    this._cachedResearchTechLevel = computeResearchLevel(
      this.data.researchTreeTechs ?? [],
    );
    this._cachedResearchTechLevelTick = currentTick;
  }

  unitsOwned(type: UnitType): number {
    return this.data.unitsOwned[type];
  }
  numTilesOwned(): number {
    return this.data.tilesOwned;
  }
  allies(): PlayerView[] {
    return this.data.allies.map(
      (a) => this.game.playerBySmallID(a) as PlayerView,
    );
  }
  targets(): PlayerView[] {
    return this.data.targets.map(
      (id) => this.game.playerBySmallID(id) as PlayerView,
    );
  }
  gold(): Gold {
    return this.data.gold;
  }
  industrialProduction(): number {
    return (this.data as any).industrialProduction;
  }
  population(): number {
    return this.data.population;
  }
  totalPopulation(): number {
    return this.data.totalPopulation;
  }
  workers(): number {
    return this.data.workers;
  }
  targetTroopRatio(): number {
    return this.data.targetTroopRatio;
  }
  troops(): number {
    return this.data.troops;
  }
  productivity(): number {
    return this.data.productivity;
  }
  productivityGrowthPerMinute(): number {
    return this.data.productivityGrowthPerMinute;
  }
  investmentRate(): number {
    return this.data.investmentRate;
  }
  roadInvestmentRate(): number {
    return (this.data as any).roadInvestmentRate ?? 0;
  }
  researchInvestmentRate(): number {
    return (this.data as any).researchInvestmentRate ?? 0;
  }
  // Road KPIs (optional on wire; default to 100% quality and 100% completion if absent)
  roadNetworkQuality(): number {
    return this.data.roadNetworkQuality ?? 100;
  }
  roadNetworkCompletion(): number {
    return this.data.roadNetworkCompletion ?? 100;
  }
  roadNetworkLength(): number {
    return this.data.roadNetworkLength ?? 0;
  }
  roadNetPixelsPerSecond(): number {
    return this.data.roadNetPixelsPerSecond ?? 0;
  }
  isAlliedWith(other: Player | PlayerView): boolean {
    return this.data.allies.some((n) => other.smallID() === n);
  }

  isOnSameTeam(other: Player | PlayerView): boolean {
    return this.data.team !== undefined && this.data.team === other.team();
  }

  isFriendly(other: Player | PlayerView): boolean {
    return this.isAlliedWith(other) || this.isOnSameTeam(other);
  }

  // Diplomacy: client-side war check. Backed by the server-provided set used for war state.
  isAtWarWith(other: PlayerView): boolean {
    return (this.data.wars ?? []).some((n) => other.smallID() === n);
  }

  isRequestingAllianceWith(other: PlayerView) {
    return this.data.outgoingAllianceRequests.some((id) => other.id() === id);
  }

  hasEmbargoAgainst(other: PlayerView): boolean {
    return this.data.embargoes.has(other.id());
  }

  profile(): Promise<PlayerProfile> {
    return this.game.worker.playerProfile(this.smallID());
  }

  bestTransportShipSpawn(targetTile: TileRef): Promise<TileRef | false> {
    return this.game.worker.transportShipSpawn(this.id(), targetTile);
  }

  transitiveTargets(): PlayerView[] {
    return [...this.targets(), ...this.allies().flatMap((p) => p.targets())];
  }

  isTraitor(): boolean {
    return this.data.isTraitor;
  }
  outgoingEmojis(): EmojiMessage[] {
    return this.data.outgoingEmojis;
  }
  info(): PlayerInfo {
    return new PlayerInfo(
      this.flag(),
      this.name(),
      this.type(),
      this.clientID(),
      this.id(),
    );
  }
  hasSpawned(): boolean {
    return this.data.hasSpawned;
  }
  hospitalReturns(): number {
    return this.data.hospitalReturns ?? 0;
  }
  isDisconnected(): boolean {
    return this.data.isDisconnected;
  }
  // Trade: global demand queue length (server-provided; default 0)
  tradeDemandQueueLength(): number {
    return (this.data as any).tradeDemandQueueLength ?? 0;
  }
}

export class GameView implements GameMap {
  // Recalculate research tech level only after research step cadence (from config)
  private lastUpdate: GameUpdateViewData | null;
  private smallIDToID = new Map<number, PlayerID>();
  private _players = new Map<PlayerID, PlayerView>();
  private _units = new Map<number, UnitView>();
  private updatedTiles: TileRef[] = [];

  private _myPlayer: PlayerView | null = null;
  private _focusedPlayer: PlayerView | null = null;
  private _alliances: AllianceViewData[] = [];
  // Submarine periodic pings removed; ghosts are used instead
  private _submarineGhosts: Map<
    number,
    { pos: TileRef; expiresAt: Tick; ownerID: number }
  > = new Map();
  private _cooldownActive = new Set<number>();

  private unitGrid: UnitGrid;
  private structureIndex: SpatialIndex;

  private toDelete = new Set<number>();

  constructor(
    public eventBus: EventBus,
    public worker: WorkerClient,
    private _config: Config,
    private _map: GameMap,
    private _myClientID: ClientID,
    private _gameID: GameID,
  ) {
    this.lastUpdate = null;
    this.unitGrid = new UnitGrid(_map);
    this.structureIndex = new SpatialIndex(this);
  }
  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  public updatesSinceLastTick(): GameUpdates | null {
    return this.lastUpdate?.updates ?? null;
  }

  public getStructureIndex(): SpatialIndex {
    return this.structureIndex;
  }

  public update(gu: GameUpdateViewData) {
    // Fingerprint BEFORE the update
    const oldAlivePlayerIds = new Set(
      Array.from(this._players.values())
        .filter((p) => p.isAlive())
        .map((p) => p.id()),
    );

    this.toDelete.forEach((id) => this._units.delete(id));
    this.toDelete.clear();

    this.lastUpdate = gu;

    this.updatedTiles = [];
    this.lastUpdate.packedTileUpdates.forEach((tu) => {
      this.updatedTiles.push(this.updateTile(tu));
    });

    if (gu.updates === null) {
      throw new Error("lastUpdate.updates not initialized");
    }
    if (gu.alliances) {
      this._alliances = gu.alliances;
    }
    // Submarine pings removed
    // City SAM cooldown updates have been removed; cooldown is now derived from each unit's cooldownEndsAt field.
    gu.updates[GameUpdateType.Player].forEach((pu) => {
      this.smallIDToID.set(pu.smallID, pu.id);
      const player = this._players.get(pu.id);
      if (player !== undefined) {
        player.data = pu;
        player.nameData = gu.playerNameViewData[pu.id];
      } else {
        this._players.set(
          pu.id,
          new PlayerView(this, pu, gu.playerNameViewData[pu.id]),
        );
      }
    });

    this._myPlayer ??= this.playerByClientID(this._myClientID);

    for (const unit of this._units.values()) {
      unit._wasUpdated = false;
      unit.lastPos = unit.lastPos.slice(-1);
    }
    gu.updates[GameUpdateType.Unit].forEach((update) => {
      // Handle ghost updates for submarines
      if (
        update.unitType === UnitType.Submarine &&
        (update as any).ghost === true
      ) {
        const expiresAt = (update as any).ghostExpiresAt as Tick | undefined;
        this._submarineGhosts.set(update.id, {
          pos: update.pos,
          expiresAt: expiresAt ?? this.ticks() + 300,
          ownerID: update.ownerID,
        });
      } else if (update.unitType === UnitType.Submarine) {
        // Receiving a real sub update clears any ghost
        this._submarineGhosts.delete(update.id);
      }
      let unit = this._units.get(update.id);
      if (unit !== undefined) {
        unit.update(update);
      } else {
        unit = new UnitView(this, update);
        this._units.set(update.id, unit);
        this.unitGrid.addUnit(unit);
        if (isStructureType(unit.type())) {
          this.structureIndex.add(unit);
        }
      }
      if (!update.isActive) {
        this.unitGrid.removeUnit(unit);
        if (isStructureType(unit.type())) {
          this.structureIndex.remove(unit);
        }
      } else if (unit.tile() !== unit.lastTile()) {
        this.unitGrid.updateUnitCell(unit);
      }
      if (!unit.isActive()) {
        // Wait until next tick to delete the unit.
        this.toDelete.add(unit.id());
      }
    });

    // Submarine pings removed

    // Fingerprint AFTER the update
    const newAlivePlayerIds = new Set(
      Array.from(this._players.values())
        .filter((p) => p.isAlive())
        .map((p) => p.id()),
    );

    // Compare the fingerprints
    let listsAreDifferent = false;
    if (oldAlivePlayerIds.size !== newAlivePlayerIds.size) {
      listsAreDifferent = true;
    } else {
      for (const id of oldAlivePlayerIds) {
        if (!newAlivePlayerIds.has(id)) {
          listsAreDifferent = true;
          break;
        }
      }
    }

    if (listsAreDifferent) {
      this.eventBus.emit(new PlayerListChangedEvent());
    }

    // Recompute cached research tech level on the configured cadence boundary
    const t = this.ticks();
    const interval = this._config.researchIntervalTicks();
    if (interval > 0 && t % interval === 0) {
      for (const p of this._players.values()) {
        p._recomputeResearchTechLevelCache(t);
      }
    }
    this._emitEndedUnitCooldowns();
  }

  submarineGhosts(): Array<{
    id: number;
    pos: TileRef;
    expiresAt: Tick;
    ownerID: number;
  }> {
    const now = this.ticks();
    const result: Array<{
      id: number;
      pos: TileRef;
      expiresAt: Tick;
      ownerID: number;
    }> = [];
    for (const [id, ghost] of this._submarineGhosts) {
      if (ghost.expiresAt > now) {
        result.push({
          id,
          pos: ghost.pos,
          expiresAt: ghost.expiresAt,
          ownerID: ghost.ownerID,
        });
      } else {
        this._submarineGhosts.delete(id);
      }
    }
    return result;
  }

  public alliances(): AllianceViewData[] {
    return this._alliances;
  }

  private _emitEndedUnitCooldowns(): void {
    const now = this.ticks();
    const nextActive = new Set<number>();
    for (const unit of this._units.values()) {
      const endsAt = (unit as any).data?.cooldownEndsAt as Tick | undefined;
      const active =
        endsAt !== undefined
          ? now < endsAt
          : (unit.ticksLeftInCooldown() ?? 0) > 0;
      if (active) nextActive.add(unit.id());
    }
    for (const id of this._cooldownActive) {
      if (!nextActive.has(id)) {
        const unit = this.unit(id);
        if (unit) this.eventBus.emit(new UnitCooldownEndedEvent(unit));
      }
    }
    this._cooldownActive = nextActive;
  }

  recentlyUpdatedTiles(): TileRef[] {
    return this.updatedTiles;
  }

  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | UnitType[],
    predicate?: UnitPredicate,
  ): Array<{ unit: UnitView; distSquared: number }> {
    return this.unitGrid.nearbyUnits(
      tile,
      searchRange,
      types,
      predicate,
    ) as Array<{
      unit: UnitView;
      distSquared: number;
    }>;
  }

  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId: PlayerID,
  ) {
    return this.unitGrid.hasUnitNearby(tile, searchRange, type, playerId);
  }

  myClientID(): ClientID {
    return this._myClientID;
  }

  myPlayer(): PlayerView | null {
    return this._myPlayer;
  }

  player(id: PlayerID): PlayerView {
    const player = this._players.get(id);
    if (player === undefined) {
      throw Error(`player id ${id} not found`);
    }
    return player;
  }

  players(): PlayerView[] {
    return Array.from(this._players.values());
  }

  playerBySmallID(id: number): PlayerView | TerraNullius {
    if (id === 0) {
      return new TerraNulliusImpl();
    }
    const playerId = this.smallIDToID.get(id);
    if (playerId === undefined) {
      throw new Error(`small id ${id} not found`);
    }
    return this.player(playerId);
  }

  playerByClientID(id: ClientID): PlayerView | null {
    const player =
      Array.from(this._players.values()).filter(
        (p) => p.clientID() === id,
      )[0] ?? null;
    if (player === null) {
      return null;
    }
    return player;
  }
  hasPlayer(id: PlayerID): boolean {
    return false;
  }
  playerViews(): PlayerView[] {
    return Array.from(this._players.values());
  }

  owner(tile: TileRef): PlayerView | TerraNullius {
    return this.playerBySmallID(this.ownerID(tile));
  }

  ticks(): Tick {
    if (this.lastUpdate === null) return 0;
    return this.lastUpdate.tick;
  }

  peaceTimerEndsAtTick(): Tick | null {
    return this.lastUpdate?.peaceTimerEndsAtTick ?? null;
  }
  inSpawnPhase(): boolean {
    return this.ticks() <= this._config.numSpawnPhaseTurns();
  }
  config(): Config {
    return this._config;
  }
  units(...types: UnitType[]): UnitView[] {
    if (types.length === 0) {
      return Array.from(this._units.values()).filter((u) => u.isActive());
    }
    return Array.from(this._units.values()).filter(
      (u) => u.isActive() && types.includes(u.type()),
    );
  }
  unit(id: number): UnitView | undefined {
    return this._units.get(id);
  }
  unitInfo(type: UnitType): UnitInfo {
    return this._config.unitInfo(type);
  }

  ref(x: number, y: number): TileRef {
    return this._map.ref(x, y);
  }
  isValidRef(ref: TileRef): boolean {
    return this._map.isValidRef(ref);
  }
  x(ref: TileRef): number {
    return this._map.x(ref);
  }
  y(ref: TileRef): number {
    return this._map.y(ref);
  }
  cell(ref: TileRef): Cell {
    return this._map.cell(ref);
  }
  width(): number {
    return this._map.width();
  }
  height(): number {
    return this._map.height();
  }
  numLandTiles(): number {
    return this._map.numLandTiles();
  }
  isValidCoord(x: number, y: number): boolean {
    return this._map.isValidCoord(x, y);
  }
  isLand(ref: TileRef): boolean {
    return this._map.isLand(ref);
  }
  isOceanShore(ref: TileRef): boolean {
    return this._map.isOceanShore(ref);
  }
  isOcean(ref: TileRef): boolean {
    return this._map.isOcean(ref);
  }
  isShoreline(ref: TileRef): boolean {
    return this._map.isShoreline(ref);
  }
  magnitude(ref: TileRef): number {
    return this._map.magnitude(ref);
  }
  ownerID(ref: TileRef): number {
    return this._map.ownerID(ref);
  }
  hasOwner(ref: TileRef): boolean {
    return this._map.hasOwner(ref);
  }
  setOwnerID(ref: TileRef, playerId: number): void {
    return this._map.setOwnerID(ref, playerId);
  }
  hasFallout(ref: TileRef): boolean {
    return this._map.hasFallout(ref);
  }
  setFallout(ref: TileRef, value: boolean): void {
    return this._map.setFallout(ref, value);
  }
  isBorder(ref: TileRef): boolean {
    return this._map.isBorder(ref);
  }
  neighbors(ref: TileRef): Uint32Array {
    return this._map.neighbors(ref);
  }
  isWater(ref: TileRef): boolean {
    return this._map.isWater(ref);
  }
  isLake(ref: TileRef): boolean {
    return this._map.isLake(ref);
  }
  isShore(ref: TileRef): boolean {
    return this._map.isShore(ref);
  }
  cost(ref: TileRef): number {
    return this._map.cost(ref);
  }
  terrainType(ref: TileRef): TerrainType {
    return this._map.terrainType(ref);
  }
  forEachTile(fn: (tile: TileRef) => void): void {
    return this._map.forEachTile(fn);
  }
  manhattanDist(c1: TileRef, c2: TileRef): number {
    return this._map.manhattanDist(c1, c2);
  }
  euclideanDistSquared(c1: TileRef, c2: TileRef): number {
    return this._map.euclideanDistSquared(c1, c2);
  }
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef> {
    return this._map.bfs(tile, filter);
  }
  toTileUpdate(tile: TileRef): bigint {
    return this._map.toTileUpdate(tile);
  }
  updateTile(tu: TileUpdate): TileRef {
    return this._map.updateTile(tu);
  }
  numTilesWithFallout(): number {
    return this._map.numTilesWithFallout();
  }
  gameID(): GameID {
    return this._gameID;
  }

  focusedPlayer(): PlayerView | null {
    // TODO: renable when performance issues are fixed.
    return this.myPlayer();
  }
  setFocusedPlayer(player: PlayerView | null): void {
    this._focusedPlayer = player;
  }

  // isUnitPeriodicallyVisible removed with ping feature
}
