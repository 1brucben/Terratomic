import { renderNumber, renderTroops } from "../../client/Utils";
import { PseudoRandom } from "../PseudoRandom";
import { ClientID } from "../Schemas";
import { Category, findTech } from "../tech/ResearchTree";
import {
  applyTechCompletionEffects,
  revokeTechEffects,
} from "../tech/TechEffects";
import {
  assertNever,
  distSortUnit,
  maxInt,
  minInt,
  simpleHash,
  toInt,
  within,
} from "../Util";
import { sanitizeUsername } from "../validations/username";
import { AttackImpl } from "./AttackImpl";
import {
  Alliance,
  AllianceRequest,
  AllPlayers,
  Attack,
  BuildableUnit,
  Cell,
  ColoredTeams,
  Embargo,
  EmojiMessage,
  GameMode,
  GameType,
  Gold,
  MessageType,
  MutableAlliance,
  Player,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  Relation,
  Team,
  TerraNullius,
  Tick,
  Unit,
  UnitParams,
  UnitType,
  UpgradeType,
} from "./Game";
import { GameImpl } from "./GameImpl";
import { andFN, manhattanDistFN, TileRef } from "./GameMap";
import { AttackUpdate, GameUpdateType, PlayerUpdate } from "./GameUpdates";
import {
  bestShoreDeploymentSource,
  canBuildTransportShip,
} from "./TransportShipUtils";
import { UnitImpl } from "./UnitImpl";

interface Target {
  tick: Tick;
  target: Player;
}

class Donation {
  constructor(
    public readonly recipient: Player,
    public readonly tick: Tick,
  ) {}
}

export class PlayerImpl implements Player {
  public _lastTileChange: number = 0;
  public _pseudo_random: PseudoRandom;

  private _gold: bigint;
  private _troops: bigint;
  private _workers: bigint;

  // 0 to 100
  private _targetTroopRatio: bigint;
  private _investmentRate: number = 0.5;
  // Client slider: pixels per 10 ticks (i.e., pixels/second). Range [0,5].
  private _productivity = 1;
  private _productivityGrowthPerMinute = 0;
  private _maxproductivity = 1;
  private _roadInvestmentRate: number = 0; // 0..1, fraction of per-tick income allocated to roads
  private _researchInvestmentRate: number = 0; // 0..1, fraction of per-tick income allocated to research

  markedTraitorTick = -1;

  private embargoes = new Map<PlayerID, Embargo>();

  public _borderTiles: Set<TileRef> = new Set();

  public _units: Unit[] = [];
  private _effectiveUnitsCache: Map<UnitType, number> = new Map();
  public _tiles: Set<TileRef> = new Set();
  private _upgrades: Set<UpgradeType> = new Set();
  // Per-match research tree selections (IDs are client-defined strings)
  private _researchTreeTechs: Set<string> = new Set();
  // Per-match research progress (beakers) per tech
  private _researchBeakers: Map<string, number> = new Map();
  // Currently selected research priority tech id
  private _researchPriority: string | null = null;

  private _flag: string | undefined;
  private _name: string;
  private _displayName: string;
  private _hospitalReturns: number = 0;

  public pastOutgoingAllianceRequests: AllianceRequest[] = [];
  private _expiredAlliances: Alliance[] = [];

  private targets_: Target[] = [];

  private outgoingEmojis_: EmojiMessage[] = [];

  private sentDonations: Donation[] = [];

  private relations = new Map<Player, number>();

  // War/peace and aggression tracking
  private _wars: Set<PlayerID> = new Set();
  private _lastAggression: Map<PlayerID, Tick> = new Map();

  public _incomingAttacks: Attack[] = [];
  public _outgoingAttacks: Attack[] = [];
  public _outgoingLandAttacks: Attack[] = [];

  private _hasSpawned = false;
  private _isDisconnected = false;

  private bomberIntent: {
    targetPlayerID: string;
    structures: UnitType[];
    preferClosest: boolean;
  } | null = null;
  private _autoBombingEnabled: boolean = false;
  public bombersOnTarget = new Map<TileRef, number>();

  // Cached capital (geographic center) of player's territory
  private _capital: Cell | null = null;

  constructor(
    private mg: GameImpl,
    private _smallID: number,
    private readonly playerInfo: PlayerInfo,
    startTroops: number,
    private readonly _team: Team | null,
  ) {
    this._flag = playerInfo.flag;
    this._name = sanitizeUsername(playerInfo.name);
    this._targetTroopRatio = 60n;
    this._troops = toInt(startTroops);
    this._workers = 0n;
    this._gold = 0n;
    this._displayName = this._name;
    this._pseudo_random = new PseudoRandom(simpleHash(this.playerInfo.id));
  }

  toUpdate(): PlayerUpdate {
    const outgoingAllianceRequests = this.outgoingAllianceRequests().map((ar) =>
      ar.recipient().id(),
    );
    const stats = this.mg.stats().getPlayerStats(this);

    return {
      type: GameUpdateType.Player,
      clientID: this.clientID(),
      flag: this.flag(),
      name: this.name(),
      displayName: this.displayName(),
      id: this.id(),
      team: this.team() ?? undefined,
      smallID: this.smallID(),
      playerType: this.type(),
      isAlive: this.isAlive(),
      isDisconnected: this.isDisconnected(),
      capital:
        this._capital !== null
          ? { x: this._capital.x, y: this._capital.y }
          : undefined,
      tilesOwned: this.numTilesOwned(),
      gold: this._gold,
      industrialProduction: this.industrialProduction(),
      population: this.population(),
      totalPopulation: this.totalPopulation(),
      hospitalReturns: this.hospitalReturns(),
      workers: this.workers(),
      // Road KPIs exposed to client
      roadNetworkQuality: this.roadNetworkQuality(),
      roadNetworkCompletion: this.roadNetworkCompletion(),
      roadNetworkLength: this.mg.getRoadLengthForPlayer(this.id()),
      roadNetPixelsPerSecond: this.mg.getRoadNetPixelsPerSecond(this.id()),
      // Trade: expose current global demand queue length
      tradeDemandQueueLength: (this.mg as any).tradeDemandQueueLength?.() ?? 0,
      troops: this.troops(),
      attackingTroops: this.attackingTroops(),
      targetTroopRatio: this.targetTroopRatio(),
      productivity: this.productivity(),
      productivityGrowthPerMinute: this.productivityGrowthPerMinute(),
      investmentRate: this.investmentRate(),
      roadInvestmentRate: this.roadInvestmentRate(),
      researchInvestmentRate: this.researchInvestmentRate(),
      allies: this.alliances().map((a) => a.other(this).smallID()),
      wars: Array.from(this._wars).map((pid) => this.mg.player(pid).smallID()),
      embargoes: new Set([...this.embargoes.keys()].map((p) => p.toString())),
      isTraitor: this.isTraitor(),
      targets: this.targets().map((p) => p.smallID()),
      outgoingEmojis: this.outgoingEmojis(),
      outgoingAttacks: this._outgoingAttacks.map((a) => {
        return {
          attackerID: a.attacker().smallID(),
          targetID: a.target().smallID(),
          troops: a.troops(),
          id: a.id(),
          retreating: a.retreating(),
        } satisfies AttackUpdate;
      }),
      incomingAttacks: this._incomingAttacks.map((a) => {
        return {
          attackerID: a.attacker().smallID(),
          targetID: a.target().smallID(),
          troops: a.troops(),
          id: a.id(),
          retreating: a.retreating(),
        } satisfies AttackUpdate;
      }),
      outgoingAllianceRequests: outgoingAllianceRequests,
      hasSpawned: this.hasSpawned(),
      betrayals: stats?.betrayals,
      effectiveUnits: Object.values(UnitType).reduce(
        (acc, type) => {
          acc[type] = this.effectiveUnits(type);
          return acc;
        },
        {} as Record<UnitType, number>,
      ),
      unitsOwned: Object.values(UnitType).reduce(
        (acc, type) => {
          acc[type] = this.unitsOwned(type);
          return acc;
        },
        {} as Record<UnitType, number>,
      ),
      upgrades: Array.from(this._upgrades),
      researchTreeTechs: Array.from(this._researchTreeTechs),
      researchTreeBeakers:
        this._researchBeakers.size > 0
          ? Object.fromEntries(this._researchBeakers)
          : undefined,
      researchPriorityTech: this._researchPriority,
    };
  }

  smallID(): number {
    return this._smallID;
  }

  flag(): string | undefined {
    return this._flag;
  }

  name(): string {
    return this._name;
  }
  displayName(): string {
    return this._displayName;
  }

  clientID(): ClientID | null {
    return this.playerInfo.clientID;
  }

  id(): PlayerID {
    return this.playerInfo.id;
  }

  type(): PlayerType {
    return this.playerInfo.playerType;
  }

  // Economic: Industrial Production proxy (formerly GDP) as parameter * max population
  industrialProduction(): number {
    const factor = this.mg.config().industrialProductionFactor();
    const maxPop = this.mg.config().maxPopulation(this);
    const g = factor * maxPop;
    // Ensure finite, non-negative number
    if (!Number.isFinite(g) || g < 0) return 0;
    return Math.floor(g);
  }

  clan(): string | null {
    return this.playerInfo.clan;
  }

  units(...types: UnitType[]): Unit[] {
    if (types.length === 0) {
      return this._units;
    }
    const ts = new Set(types);
    return this._units.filter((u) => ts.has(u.type()));
  }

  private numUnitsConstructed: Partial<Record<UnitType, number>> = {};
  private recordUnitConstructed(type: UnitType): void {
    if (this.numUnitsConstructed[type] !== undefined) {
      this.numUnitsConstructed[type]++;
    } else {
      this.numUnitsConstructed[type] = 1;
    }
  }

  // Count of units built by the player, including construction
  unitsConstructed(type: UnitType): number {
    const built = this.numUnitsConstructed[type] ?? 0;
    let constructing = 0;
    for (const unit of this._units) {
      if (unit.type() !== UnitType.Construction) continue;
      if (unit.constructionType() !== type) continue;
      constructing++;
    }
    const total = constructing + built;
    return total;
  }

  // Count of units owned by the player, not including construction
  unitCount(type: UnitType): number {
    let total = 0;
    for (const unit of this._units) {
      if (unit.type() === type) {
        total++;
      }
    }
    return total;
  }

  // Count of units owned by the player, including construction
  unitsOwned(type: UnitType): number {
    let total = 0;
    for (const unit of this._units) {
      if (unit.type() === type) {
        if (
          type === UnitType.City ||
          type === UnitType.Port ||
          type === UnitType.Hospital ||
          type === UnitType.Academy ||
          type === UnitType.ResearchLab ||
          type === UnitType.Factory
        ) {
          // Upgraded cities, ports, hospitals, and academies count toward totals
          // (affects scaling like new build cost and display counts)
          total += (unit as any).level?.() ?? 1;
        } else {
          total++;
        }
        continue;
      }
      if (unit.type() !== UnitType.Construction) continue;
      if (unit.constructionType() !== type) continue;
      total++;
    }
    return total;
  }

  hasUpgrade(upgrade: UpgradeType): boolean {
    return this._upgrades.has(upgrade);
  }

  addUpgrade(upgrade: UpgradeType): void {
    this._upgrades.add(upgrade);
  }

  removeUpgrade(upgrade: UpgradeType): void {
    this._upgrades.delete(upgrade);
  }

  // Research tree (standalone) API
  addResearchedTech(techId: string): void {
    // Add tech to researched set
    this._researchTreeTechs.add(techId);

    // Apply centralized side-effects upon research completion
    applyTechCompletionEffects(this, this.mg, techId);
  }
  removeResearchedTechsByCategory(category: Category): void {
    const toRemove: string[] = [];
    for (const techId of this._researchTreeTechs) {
      const node = findTech(techId);
      if (!node) {
        console.warn(
          `[PlayerImpl] Unable to revoke unknown tech id '${techId}' while removing category '${category}'.`,
        );
        continue;
      }
      if (node.category === category) {
        toRemove.push(techId);
      }
    }

    const progressToClear: string[] = [];
    for (const [techId] of this._researchBeakers) {
      const node = findTech(techId);
      if (!node) continue;
      if (node.category === category) {
        progressToClear.push(techId);
      }
    }

    if (toRemove.length === 0 && progressToClear.length === 0) return;
    const priority = this._researchPriority;
    const cleared = new Set([...toRemove, ...progressToClear]);

    for (const techId of toRemove) {
      this._researchTreeTechs.delete(techId);
      revokeTechEffects(this, this.mg, techId);
    }
    for (const techId of progressToClear) {
      this._researchBeakers.delete(techId);
    }

    if (priority && cleared.has(priority)) {
      this._researchPriority = null;
    }
  }
  hasResearchedTech(techId: string): boolean {
    return this._researchTreeTechs.has(techId);
  }
  researchBeakers(techId: string): number {
    return this._researchBeakers.get(techId) ?? 0;
  }
  addResearchBeakers(
    techId: string,
    beakers: number,
    cost: number,
  ): {
    completed: boolean;
    newBeakers: number;
  } {
    const prev = this._researchBeakers.get(techId) ?? 0;
    const total = Math.min(cost, prev + beakers);
    this._researchBeakers.set(techId, total);
    const completed = total >= cost;
    if (completed) {
      // Route all completions through addResearchedTech to ensure side-effects fire consistently
      this.addResearchedTech(techId);
      // Do not carry over excess; keep capped at cost
    }
    return { completed, newBeakers: total };
  }
  setResearchPriority(techId: string | null): void {
    this._researchPriority = techId;
  }
  researchPriority(): string | null {
    return this._researchPriority;
  }

  invalidateEffectiveUnitsCache(type: UnitType): void {
    this._effectiveUnitsCache.delete(type);
  }

  effectiveUnits(type: UnitType): number {
    if (this._effectiveUnitsCache.has(type)) {
      return this._effectiveUnitsCache.get(type)!;
    }

    const calculatedValue = this._units
      .filter((u) => u.type() === type && u.isActive())
      .reduce((sum, u) => {
        // Use effective max for health ratio so city upgrades don't inflate ratios.
        const effectiveMax = u.effectiveMaxHealth();
        const healthRatio = u.hasHealth()
          ? Math.min(1, Number(u.health()) / Math.max(1, effectiveMax))
          : 1;
        const level = (u as any).level?.() ?? 1;
        return sum + healthRatio * level;
      }, 0);
    this._effectiveUnitsCache.set(type, calculatedValue);
    return calculatedValue;
  }

  sharesBorderWith(other: Player | TerraNullius): boolean {
    for (const border of this._borderTiles) {
      for (const neighbor of this.mg.map().neighbors(border)) {
        if (this.mg.map().ownerID(neighbor) === other.smallID()) {
          return true;
        }
      }
    }
    return false;
  }
  numTilesOwned(): number {
    return this._tiles.size;
  }

  tiles(): ReadonlySet<TileRef> {
    return new Set(this._tiles.values()) as Set<TileRef>;
  }

  borderTiles(): ReadonlySet<TileRef> {
    return this._borderTiles;
  }

  neighbors(): (Player | TerraNullius)[] {
    const ns: Set<Player | TerraNullius> = new Set();
    for (const border of this.borderTiles()) {
      for (const neighbor of this.mg.map().neighbors(border)) {
        if (this.mg.map().isLand(neighbor)) {
          const owner = this.mg.map().ownerID(neighbor);
          if (owner !== this.smallID()) {
            ns.add(
              this.mg.playerBySmallID(owner) satisfies Player | TerraNullius,
            );
          }
        }
      }
    }
    return Array.from(ns);
  }

  isPlayer(): this is Player {
    return true as const;
  }
  setTroops(troops: number) {
    this._troops = toInt(troops);
  }
  conquer(tile: TileRef) {
    this.mg.conquer(this, tile);
  }
  orderRetreat(id: string) {
    const attack = this._outgoingAttacks.filter((attack) => attack.id() === id);
    if (!attack || !attack[0]) {
      console.warn(`Didn't find outgoing attack with id ${id}`);
      return;
    }
    attack[0].orderRetreat();
  }
  executeRetreat(id: string): void {
    const attack = this._outgoingAttacks.filter((attack) => attack.id() === id);
    // Execution is delayed so it's not an error that the attack does not exist.
    if (!attack || !attack[0]) {
      return;
    }
    attack[0].executeRetreat();
  }
  relinquish(tile: TileRef) {
    if (this.mg.owner(tile) !== this) {
      throw new Error(`Cannot relinquish tile not owned by this player`);
    }
    this.mg.relinquish(tile);
  }
  info(): PlayerInfo {
    return this.playerInfo;
  }
  isAlive(): boolean {
    return this._tiles.size > 0;
  }

  hasSpawned(): boolean {
    return this._hasSpawned;
  }

  setHasSpawned(hasSpawned: boolean): void {
    this._hasSpawned = hasSpawned;
  }

  incomingAllianceRequests(): AllianceRequest[] {
    return this.mg.allianceRequests.filter((ar) => ar.recipient() === this);
  }

  outgoingAllianceRequests(): AllianceRequest[] {
    return this.mg.allianceRequests.filter((ar) => ar.requestor() === this);
  }

  alliances(): MutableAlliance[] {
    return this.mg.alliances_.filter(
      (a) => a.requestor() === this || a.recipient() === this,
    );
  }

  expiredAlliances(): Alliance[] {
    return [...this._expiredAlliances];
  }

  allies(): Player[] {
    return this.alliances().map((a) => a.other(this));
  }

  isAlliedWith(other: Player): boolean {
    if (other === this) {
      return false;
    }
    return this.allianceWith(other) !== null;
  }

  allianceWith(other: Player): MutableAlliance | null {
    if (other === this) {
      return null;
    }
    return (
      this.alliances().find(
        (a) => a.recipient() === other || a.requestor() === other,
      ) ?? null
    );
  }

  canSendAllianceRequest(other: Player): boolean {
    if (other === this) {
      return false;
    }
    if (this.isFriendly(other) || !this.isAlive()) {
      return false;
    }

    const hasPending =
      this.incomingAllianceRequests().some((ar) => ar.requestor() === other) ||
      this.outgoingAllianceRequests().some((ar) => ar.recipient() === other);

    if (hasPending) {
      return false;
    }

    const recent = this.pastOutgoingAllianceRequests
      .filter((ar) => ar.recipient() === other)
      .sort((a, b) => b.createdAt() - a.createdAt());

    if (recent.length === 0) {
      return true;
    }

    const delta = this.mg.ticks() - recent[0].createdAt();

    return delta >= this.mg.config().allianceRequestCooldown();
  }

  breakAlliance(alliance: Alliance): void {
    this.mg.breakAlliance(this, alliance);
  }

  isTraitor(): boolean {
    return (
      this.markedTraitorTick >= 0 &&
      this.mg.ticks() - this.markedTraitorTick <
        this.mg.config().traitorDuration()
    );
  }

  markTraitor(): void {
    this.markedTraitorTick = this.mg.ticks();

    // Record stats
    this.mg.stats().betray(this);
  }

  createAllianceRequest(recipient: Player): AllianceRequest | null {
    if (this.isAlliedWith(recipient)) {
      throw new Error(`cannot create alliance request, already allies`);
    }
    return this.mg.createAllianceRequest(this, recipient satisfies Player);
  }

  relation(other: Player): Relation {
    if (other === this) {
      throw new Error(`cannot get relation with self: ${this}`);
    }
    const relation = this.relations.get(other) ?? 0;
    return this.relationFromValue(relation);
  }

  private relationFromValue(relationValue: number): Relation {
    if (relationValue < -50) {
      return Relation.Hostile;
    }
    if (relationValue < 0) {
      return Relation.Distrustful;
    }
    if (relationValue < 50) {
      return Relation.Neutral;
    }
    return Relation.Friendly;
  }

  allRelationsSorted(): { player: Player; relation: Relation }[] {
    return Array.from(this.relations, ([k, v]) => ({ player: k, relation: v }))
      .sort((a, b) => a.relation - b.relation)
      .map((r) => ({
        player: r.player,
        relation: this.relationFromValue(r.relation),
      }));
  }

  // --- War/Peace API ---
  isAtWarWith(other: Player): boolean {
    if (other === this) return false;
    return this._wars.has(other.id());
  }

  setWarWith(other: Player): void {
    if (other === this) return;
    // Disable war mechanism for bots: never enter war state if either side is a Bot
    if (this.type() === PlayerType.Bot || other.type() === PlayerType.Bot) {
      return;
    }
    if (this._wars.has(other.id())) return;
    this._wars.add(other.id());
    // Auto-embargo while at war
    this.addEmbargo(other.id(), true);
    // Event: notify this player that they are at war with the other
    this.mg.displayMessage(
      `At war with ${other.displayName()}`,
      MessageType.WAR_DECLARED,
      this.id(),
    );
  }

  setNeutralWith(other: Player): void {
    if (other === this) return;
    if (!this._wars.has(other.id())) return;
    this._wars.delete(other.id());
    // End any embargo we have against the other as part of making peace
    this.stopEmbargo(other.id());
    // Event: notify this player that peace was made
    this.mg.displayMessage(
      `Peace made with ${other.displayName()}`,
      MessageType.PEACE_MADE,
      this.id(),
    );

    // Cancel all ongoing land attacks targeting the other player
    for (const a of [...this._outgoingAttacks]) {
      if (a.target() === other && a.isActive()) {
        // Use the same cancel flow as manual cancel: order then execute
        a.orderRetreat();
        a.executeRetreat();
      }
    }

    // Cancel only transport ships targeting the other player
    for (const boat of this.units(UnitType.TransportShip)) {
      const targetPID = (boat as any).boatTargetPlayerID?.();
      if (targetPID === other.id() && !boat.retreating()) {
        boat.orderBoatRetreat();
      }
    }
  }

  recordAggression(other: Player): void {
    if (other === this) return;
    this._lastAggression.set(other.id(), this.mg.ticks());
  }

  lastAggressionTick(other: Player): Tick {
    return this._lastAggression.get(other.id()) ?? -1;
  }

  updateRelation(other: Player, delta: number): void {
    if (other === this) {
      throw new Error(`cannot update relation with self: ${this}`);
    }
    const relation = this.relations.get(other) ?? 0;
    const newRelation = within(relation + delta, -100, 100);
    this.relations.set(other, newRelation);
  }

  decayRelations() {
    this.relations.forEach((r: number, p: Player) => {
      const sign = -1 * Math.sign(r);
      const delta = 0.05;
      r += sign * delta;
      if (Math.abs(r) < delta * 2) {
        r = 0;
      }
      this.relations.set(p, r);
    });
  }

  canTarget(other: Player): boolean {
    if (this === other) {
      return false;
    }
    if (this.isFriendly(other)) {
      return false;
    }
    for (const t of this.targets_) {
      if (this.mg.ticks() - t.tick < this.mg.config().targetCooldown()) {
        return false;
      }
    }
    return true;
  }

  target(other: Player): void {
    this.targets_.push({ tick: this.mg.ticks(), target: other });
    this.mg.target(this, other);
  }

  targets(): Player[] {
    return this.targets_
      .filter(
        (t) => this.mg.ticks() - t.tick < this.mg.config().targetDuration(),
      )
      .map((t) => t.target);
  }

  transitiveTargets(): Player[] {
    const ts = this.alliances()
      .map((a) => a.other(this))
      .flatMap((ally) => ally.targets());
    ts.push(...this.targets());
    return [...new Set(ts)] satisfies Player[];
  }

  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void {
    if (recipient === this) {
      throw Error(`Cannot send emoji to oneself: ${this}`);
    }
    const msg: EmojiMessage = {
      message: emoji,
      senderID: this.smallID(),
      recipientID: recipient === AllPlayers ? recipient : recipient.smallID(),
      createdAt: this.mg.ticks(),
    };
    this.outgoingEmojis_.push(msg);
    this.mg.sendEmojiUpdate(msg);
  }

  outgoingEmojis(): EmojiMessage[] {
    return this.outgoingEmojis_
      .filter(
        (e) =>
          this.mg.ticks() - e.createdAt <
          this.mg.config().emojiMessageDuration(),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  canSendEmoji(recipient: Player | typeof AllPlayers): boolean {
    const recipientID =
      recipient === AllPlayers ? AllPlayers : recipient.smallID();
    const prevMsgs = this.outgoingEmojis_.filter(
      (msg) => msg.recipientID === recipientID,
    );
    for (const msg of prevMsgs) {
      if (
        this.mg.ticks() - msg.createdAt <
        this.mg.config().emojiMessageCooldown()
      ) {
        return false;
      }
    }
    return true;
  }

  canDonate(recipient: Player): boolean {
    if (!this.isFriendly(recipient)) {
      return false;
    }
    if (
      recipient.type() === PlayerType.Human &&
      this.mg.config().gameConfig().gameMode === GameMode.FFA &&
      this.mg.config().gameConfig().gameType === GameType.Public
    ) {
      return false;
    }
    for (const donation of this.sentDonations) {
      if (donation.recipient === recipient) {
        if (
          this.mg.ticks() - donation.tick <
          this.mg.config().donateCooldown()
        ) {
          return false;
        }
      }
    }
    return true;
  }

  donateTroops(recipient: Player, troops: number): boolean {
    if (troops <= 0) return false;
    const removed = this.removeTroops(troops);
    if (removed === 0) return false;
    recipient.addTroops(removed);

    this.sentDonations.push(new Donation(recipient, this.mg.ticks()));
    this.mg.displayMessage(
      `Sent ${renderTroops(troops)} troops to ${recipient.name()}`,
      MessageType.SENT_TROOPS_TO_PLAYER,
      this.id(),
    );
    this.mg.displayMessage(
      `Received ${renderTroops(troops)} troops from ${this.name()}`,
      MessageType.RECEIVED_TROOPS_FROM_PLAYER,
      recipient.id(),
    );
    return true;
  }

  donateGold(recipient: Player, gold: Gold): boolean {
    if (gold <= 0n) return false;
    const removed = this.removeGold(gold);
    if (removed === 0n) return false;
    recipient.addGold(removed);

    this.sentDonations.push(new Donation(recipient, this.mg.ticks()));
    this.mg.displayMessage(
      `Sent ${renderNumber(gold)} gold to ${recipient.name()}`,
      MessageType.SENT_GOLD_TO_PLAYER,
      this.id(),
    );
    this.mg.displayMessage(
      `Received ${renderNumber(gold)} gold from ${this.name()}`,
      MessageType.RECEIVED_GOLD_FROM_PLAYER,
      recipient.id(),
      gold,
    );
    return true;
  }

  hasEmbargoAgainst(other: Player): boolean {
    return this.embargoes.has(other.id());
  }

  canTrade(other: Player): boolean {
    const embargo =
      other.hasEmbargoAgainst(this) || this.hasEmbargoAgainst(other);
    return !embargo && other.id() !== this.id();
  }

  addEmbargo(other: PlayerID, isTemporary: boolean): void {
    const embargo = this.embargoes.get(other);
    if (embargo !== undefined && !embargo.isTemporary) return;

    this.embargoes.set(other, {
      createdAt: this.mg.ticks(),
      isTemporary: isTemporary,
      target: other,
    });
  }

  getEmbargoes(): Embargo[] {
    return [...this.embargoes.values()];
  }

  stopEmbargo(other: PlayerID): void {
    this.embargoes.delete(other);
  }

  endTemporaryEmbargo(other: PlayerID): void {
    const embargo = this.embargoes.get(other);
    if (embargo !== undefined && !embargo.isTemporary) return;

    this.stopEmbargo(other);
  }

  tradingPartners(): Player[] {
    return this.mg
      .players()
      .filter((other) => other !== this && this.canTrade(other));
  }

  team(): Team | null {
    return this._team;
  }

  isOnSameTeam(other: Player): boolean {
    if (other === this) {
      return false;
    }
    if (this.team() === null || other.team() === null) {
      return false;
    }
    if (this.team() === ColoredTeams.Bot || other.team() === ColoredTeams.Bot) {
      return false;
    }
    return this._team === other.team();
  }

  isFriendly(other: Player): boolean {
    return this.isOnSameTeam(other) || this.isAlliedWith(other);
  }

  gold(): Gold {
    return this._gold;
  }

  addGold(toAdd: Gold): void {
    this._gold += toAdd;
  }

  removeGold(toRemove: Gold): Gold {
    if (toRemove <= 0n) {
      return 0n;
    }
    const actualRemoved = minInt(this._gold, toRemove);
    this._gold -= actualRemoved;
    return actualRemoved;
  }

  population(): number {
    return this.workers() + this.troops();
  }
  totalPopulation(): number {
    return this.population() + this.attackingTroops();
  }
  attackingTroops(): number {
    const landAttackTroops = this._outgoingAttacks
      .filter((a) => a.isActive())
      .reduce((sum, a) => sum + a.troops(), 0);

    const boatTroops = this.units(UnitType.TransportShip)
      .map((u) => u.troops())
      .reduce((sum, n) => sum + n, 0);

    return landAttackTroops + boatTroops;
  }

  workers(): number {
    return Math.max(1, Number(this._workers));
  }
  addWorkers(toAdd: number): void {
    this._workers += toInt(toAdd);
  }
  removeWorkers(toRemove: number): void {
    this._workers = maxInt(1n, this._workers - toInt(toRemove));
  }

  targetTroopRatio(): number {
    return Number(this._targetTroopRatio) / 100;
  }

  setTargetTroopRatio(target: number): void {
    if (target < 0 || target > 1) {
      throw new Error(
        `invalid targetTroopRatio ${target} set on player ${PlayerImpl}`,
      );
    }
    this._targetTroopRatio = toInt(target * 100);
  }
  investmentRate(): number {
    return this._investmentRate;
  }

  setInvestmentRate(rate: number): void {
    this._investmentRate = Math.min(
      this.mg.config().maxInvestmentRate(),
      Math.max(0, rate),
    );
  }

  // Road investment ratio (0..1)
  roadInvestmentRate(): number {
    return this._roadInvestmentRate;
  }
  setRoadInvestmentRate(rate: number): void {
    const clamped = Math.max(0, Math.min(1, rate));
    this._roadInvestmentRate = clamped;
  }

  // Research investment ratio (0..1)
  researchInvestmentRate(): number {
    return this._researchInvestmentRate;
  }
  setResearchInvestmentRate(rate: number): void {
    const clamped = Math.max(0, Math.min(1, rate));
    this._researchInvestmentRate = clamped;
  }

  troops(): number {
    return Number(this._troops);
  }

  addTroops(troops: number): void {
    if (troops < 0) {
      this.removeTroops(-1 * troops);
      return;
    }
    this._troops += toInt(troops);
  }
  removeTroops(troops: number): number {
    if (troops <= 0) {
      return 0;
    }
    const toRemove = minInt(this._troops, toInt(troops));
    this._troops -= toRemove;
    return Number(toRemove);
  }

  productivity(): number {
    return this._productivity;
  }
  productivityGrowthPerMinute(): number {
    return this._productivityGrowthPerMinute;
  }
  updateProductivity(): void {
    const alpha = 0.00035;
    const beta = 0.5;

    const maxPop = this.mg.config().maxPopulation(this);
    const workers = this.workers();
    const rate = (this._investmentRate * workers) / maxPop;
    const growth = alpha * Math.pow(rate, beta);

    if (!Number.isFinite(growth) || growth < 0) {
      console.warn("[updateProductivity] Invalid growth", {
        productivityBefore: this._productivity,
        investmentRate: this._investmentRate,
        workers,
        maxPop,
        rate,
        growth,
        player: this.name?.(),
      });
      return; // skip update
    }

    this._productivity *= 1 + growth;
    if (this._productivity >= this.mg.config().maxProductivity()) {
      this._productivity = this.mg.config().maxProductivity();
      this.setInvestmentRate(0);
    }
    // Store per-minute growth for display
    this._productivityGrowthPerMinute =
      ((1 + growth) ** 600 - 1) * this._productivity;
    if (this._productivity > this._maxproductivity) {
      this._maxproductivity = this._productivity;
    }
  }
  removeProductivity(amount: number): void {
    if (amount < 0) {
      throw new Error(`Cannot remove negative productivity: ${amount}`);
    }
    this._productivity = Math.max(0.33, this._productivity * (1 - amount));
  }
  setProductivity(p: number): void {
    this._productivity = p;
  }
  hospitalReturns(): number {
    return this._hospitalReturns;
  }
  // Roads - KPIs
  roadNetworkQuality(): number {
    // Delegate to RoadManager's computed weighted quality
    return this.mg.getRoadNetworkQualityForPlayer(this.id());
  }

  roadNetworkCompletion(): number {
    const { completed, queued, inProgress } =
      this.mg.getRoadCountsForPlayer(this);
    const total = completed + queued + inProgress;
    if (total === 0) return 100;
    return Math.round((completed / total) * 100);
  }

  // Roads - total network length (tile edges)
  roadNetworkLength(): number {
    // Delegate to authoritative RoadManager cache to avoid duplicate state
    return this.mg.getRoadLengthForPlayer(this.id());
  }

  addRoadNetworkLength(delta: number): void {
    // Deprecated: RoadManager is the single source of truth now.
    // Intentionally a no-op to avoid duplicate state.
    void delta;
  }
  addHospitalReturns(count: number): void {
    const effectiveHospitals = this.effectiveUnits(UnitType.Hospital);
    this._hospitalReturns += count * effectiveHospitals;
  }

  resetHospitalReturns(): void {
    this._hospitalReturns = 0;
  }

  captureUnit(unit: Unit): void {
    if (unit.owner() === this) {
      throw new Error(`Cannot capture unit, ${this} already owns ${unit}`);
    }
    unit.setOwner(this);
  }

  buildUnit<T extends UnitType>(
    type: T,
    spawnTile: TileRef,
    params: UnitParams<T>,
  ): Unit {
    if (this.mg.config().isUnitDisabled(type)) {
      throw new Error(
        `Attempted to build disabled unit ${type} at tile ${spawnTile} by player ${this.name()}`,
      );
    }

    const cost = this.mg.unitInfo(type).cost(this);
    const b = new UnitImpl(
      type,
      this.mg,
      spawnTile,
      this.mg.nextUnitID(),
      this,
      params,
    );
    this._units.push(b);
    this.recordUnitConstructed(type);
    this.removeGold(cost);
    this.removeTroops("troops" in params ? (params.troops ?? 0) : 0);
    this.mg.addUpdate(b.toUpdate());
    this.mg.addUnit(b);
    this.invalidateEffectiveUnitsCache(type);

    return b;
  }

  public buildableUnits(tile: TileRef): BuildableUnit[] {
    const validTiles = this.validStructureSpawnTiles(tile);
    return Object.values(UnitType).map((u) => {
      return {
        type: u,
        canBuild: this.mg.inSpawnPhase()
          ? false
          : this.canBuild(u, tile, validTiles),
        cost: this.mg.config().unitInfo(u).cost(this),
      } as BuildableUnit;
    });
  }

  canBuild(
    unitType: UnitType,
    targetTile: TileRef,
    validTiles: TileRef[] | null = null,
  ): TileRef | false {
    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;

    if (isPeaceTimerActive) {
      if (
        unitType === UnitType.AtomBomb ||
        unitType === UnitType.HydrogenBomb ||
        unitType === UnitType.MIRV
      ) {
        return false; // Cannot build nukes during peace timer
      }
    }

    // Test-specific override: Force canBuild for bombers if enabled in TestConfig
    if (
      this.mg.config().forceCanBuildBomberInTests?.() &&
      unitType === UnitType.Bomber
    ) {
      // Return the target tile (airfield location) for bomber spawn in tests
      return targetTile;
    }

    if (this.mg.config().isUnitDisabled(unitType)) {
      return false;
    }

    const cost = this.mg.unitInfo(unitType).cost(this);
    if (!this.isAlive() || this.gold() < cost) {
      return false;
    }
    switch (unitType) {
      case UnitType.MIRV:
        if (!this.mg.hasOwner(targetTile)) {
          return false;
        }
        return this.nukeSpawn(targetTile, unitType);
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        return this.nukeSpawn(targetTile, unitType);
      case UnitType.MIRVWarhead:
        return targetTile;
      case UnitType.Port:
        return this.portSpawn(targetTile, validTiles);
      case UnitType.Submarine:
      case UnitType.Warship:
        return this.warshipSpawn(targetTile);
      case UnitType.Shell:
      case UnitType.SAMMissile:
        return targetTile;
      case UnitType.TransportShip:
        return canBuildTransportShip(this.mg, this, targetTile);
      case UnitType.TradeShip:
        return this.tradeShipSpawn(targetTile);
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
      case UnitType.Hospital:
      case UnitType.ResearchLab:
      case UnitType.Academy:
      case UnitType.Factory:
      case UnitType.Construction:
      case UnitType.Airfield:
      case UnitType.DoomsdayDevice:
        return this.landBasedStructureSpawn(targetTile, validTiles);
      case UnitType.CargoPlane:
      case UnitType.Bomber:
      case UnitType.Paratrooper:
        return this.cargoPlaneSpawn(targetTile);
      case UnitType.FighterJet:
        return this.fighterJetSpawn(targetTile);
      default:
        assertNever(unitType);
    }
  }

  nukeSpawn(tile: TileRef, nukeType: UnitType): TileRef | false {
    const owner = this.mg.owner(tile);
    if (owner.isPlayer()) {
      if (this.isOnSameTeam(owner)) {
        return false;
      }
    }
    // only get missilesilos that are not on cooldown
    const potentialSpawns: Unit[] = this.units(UnitType.MissileSilo);
    if (
      nukeType === UnitType.AtomBomb &&
      this.hasUpgrade(UpgradeType.NuclearSubmarineResearch)
    ) {
      const nuclearSubmarines = this.units(UnitType.Submarine);
      potentialSpawns.push(...nuclearSubmarines);
    }

    const spawns = potentialSpawns
      .filter((unit) => {
        return !unit.isInCooldown();
      })
      .sort(distSortUnit(this.mg, tile));
    if (spawns.length === 0) {
      return false;
    }
    return spawns[0].tile();
  }

  portSpawn(tile: TileRef, validTiles: TileRef[] | null): TileRef | false {
    const spawns = Array.from(
      this.mg.bfs(
        tile,
        manhattanDistFN(tile, this.mg.config().radiusPortSpawn()),
      ),
    )
      .filter((t) => this.mg.owner(t) === this && this.mg.isOceanShore(t))
      .sort(
        (a, b) =>
          this.mg.manhattanDist(a, tile) - this.mg.manhattanDist(b, tile),
      );
    const validTileSet = new Set(
      validTiles ?? this.validStructureSpawnTiles(tile),
    );
    for (const t of spawns) {
      if (validTileSet.has(t)) {
        return t;
      }
    }
    return false;
  }

  warshipSpawn(tile: TileRef): TileRef | false {
    if (!this.mg.isOcean(tile)) {
      return false;
    }
    const spawns = this.units(UnitType.Port).sort(
      (a, b) =>
        this.mg.manhattanDist(a.tile(), tile) -
        this.mg.manhattanDist(b.tile(), tile),
    );
    if (spawns.length === 0) {
      return false;
    }
    const closestPort = spawns[0];
    const waterNeighbors = this.mg
      .neighbors(closestPort.tile())
      .filter((t) => this.mg.isOcean(t));
    if (waterNeighbors.length === 0) {
      // This should not happen if port placement is correct
      return false;
    }
    return waterNeighbors[0];
  }

  landBasedStructureSpawn(
    tile: TileRef,
    validTiles: TileRef[] | null = null,
  ): TileRef | false {
    const tiles = validTiles ?? this.validStructureSpawnTiles(tile);
    if (tiles.length === 0) {
      return false;
    }
    return tiles[0];
  }

  private validStructureSpawnTiles(tile: TileRef): TileRef[] {
    if (this.mg.owner(tile) !== this) {
      return [];
    }
    const searchRadius = 15;
    const searchRadiusSquared = searchRadius ** 2;
    const types = Object.values(UnitType).filter((unitTypeValue) => {
      return this.mg.config().unitInfo(unitTypeValue).territoryBound;
    });

    const nearbyUnits = this.mg.nearbyUnits(tile, searchRadius * 2, types);
    const nearbyTiles = this.mg.bfs(tile, (gm, t) => {
      return (
        this.mg.euclideanDistSquared(tile, t) < searchRadiusSquared &&
        gm.ownerID(t) === this.smallID()
      );
    });
    const validSet: Set<TileRef> = new Set(nearbyTiles);

    const minDistSquared = this.mg.config().structureMinDist() ** 2;
    for (const t of nearbyTiles) {
      for (const { unit } of nearbyUnits) {
        if (this.mg.euclideanDistSquared(unit.tile(), t) < minDistSquared) {
          validSet.delete(t);
          break;
        }
      }
    }
    const valid = Array.from(validSet);
    valid.sort(
      (a, b) =>
        this.mg.euclideanDistSquared(a, tile) -
        this.mg.euclideanDistSquared(b, tile),
    );
    return valid;
  }

  tradeShipSpawn(targetTile: TileRef): TileRef | false {
    const spawns = this.units(UnitType.Port).filter(
      (u) => u.tile() === targetTile,
    );
    if (spawns.length === 0) {
      return false;
    }
    return spawns[0].tile();
  }
  cargoPlaneSpawn(targetTile: TileRef): TileRef | false {
    const spawns = this.units(UnitType.Airfield).filter(
      (u) => u.tile() === targetTile,
    );
    if (spawns.length === 0) {
      return false;
    }
    return spawns[0].tile();
  }

  fighterJetSpawn(tile: TileRef): TileRef | false {
    const spawns = this.units(UnitType.Airfield).sort(
      (a, b) =>
        this.mg.manhattanDist(a.tile(), tile) -
        this.mg.manhattanDist(b.tile(), tile),
    );
    if (spawns.length === 0) {
      return false;
    }
    return spawns[0].tile();
  }
  lastTileChange(): Tick {
    return this._lastTileChange;
  }

  capital(): Cell | null {
    return this._capital;
  }

  /** Internal setter used by background executions */
  public _setCapital(capital: Cell | null): void {
    this._capital = capital;
  }

  isDisconnected(): boolean {
    return this._isDisconnected;
  }

  markDisconnected(isDisconnected: boolean): void {
    this._isDisconnected = isDisconnected;
  }

  hash(): number {
    return (
      simpleHash(this.id()) * (this.population() + this.numTilesOwned()) +
      this._units.reduce((acc, unit) => acc + unit.hash(), 0)
    );
  }
  toString(): string {
    return `Player:{name:${this.info().name},clientID:${
      this.info().clientID
    },isAlive:${this.isAlive()},troops:${
      this._troops
    },numTileOwned:${this.numTilesOwned()}}]`;
  }

  public playerProfile(): PlayerProfile {
    const rel = {
      relations: Object.fromEntries(
        this.allRelationsSorted().map(({ player, relation }) => [
          player.smallID(),
          relation,
        ]),
      ),
      alliances: this.alliances().map((a) => a.other(this).smallID()),
    };
    return rel;
  }

  createAttack(
    target: Player | TerraNullius,
    troops: number,
    sourceTile: TileRef | null,
    border: Set<number>,
  ): Attack {
    const attack = new AttackImpl(
      this._pseudo_random.nextID(),
      target,
      this,
      troops,
      sourceTile,
      border,
      this.mg,
    );
    this._outgoingAttacks.push(attack);
    if (target.isPlayer()) {
      (target as PlayerImpl)._incomingAttacks.push(attack);
    }
    return attack;
  }
  outgoingAttacks(): Attack[] {
    return this._outgoingAttacks;
  }
  incomingAttacks(): Attack[] {
    return this._incomingAttacks;
  }

  public canAttack(tile: TileRef): boolean {
    const isPeaceTimerActive =
      this.mg.peaceTimerEndsAtTick !== null &&
      this.mg.ticks() < this.mg.peaceTimerEndsAtTick;
    const other = this.mg.owner(tile);

    if (isPeaceTimerActive) {
      const attackerType = this.type();
      const defenderType = other.isPlayer() ? other.type() : null;

      if (
        (attackerType === PlayerType.Human ||
          attackerType === PlayerType.FakeHuman) &&
        (defenderType === PlayerType.Human ||
          defenderType === PlayerType.FakeHuman)
      ) {
        return false; // Block attack if peace timer is active and both are protected types
      }
    }

    if (
      this.mg.hasOwner(tile) &&
      this.mg.config().numSpawnPhaseTurns() +
        this.mg.config().spawnImmunityDuration() >
        this.mg.ticks()
    ) {
      return false;
    }

    if (this.mg.owner(tile) === this) {
      return false;
    }

    if (other.isPlayer()) {
      if (this.isFriendly(other)) {
        return false;
      }
    }

    if (!this.mg.isLand(tile)) {
      return false;
    }
    if (this.mg.hasOwner(tile)) {
      return this.sharesBorderWith(other);
    } else {
      for (const t of this.mg.bfs(
        tile,
        andFN(
          (gm, t) => !gm.hasOwner(t) && gm.isLand(t),
          manhattanDistFN(tile, 200),
        ),
      )) {
        for (const n of this.mg.neighbors(t)) {
          if (this.mg.owner(n) === this) {
            return true;
          }
        }
      }
      return false;
    }
  }

  bestTransportShipSpawn(targetTile: TileRef): TileRef | false {
    return bestShoreDeploymentSource(this.mg, this, targetTile);
  }

  // It's a probability list, so if an element appears twice it's because it's
  // twice more likely to be picked later.
  tradingPorts(port: Unit): Unit[] {
    const ports = this.mg
      .players()
      .filter((p) => p !== port.owner() && p.canTrade(port.owner()))
      .flatMap((p) => p.units(UnitType.Port))
      .sort((p1, p2) => {
        return (
          this.mg.manhattanDist(port.tile(), p1.tile()) -
          this.mg.manhattanDist(port.tile(), p2.tile())
        );
      });

    if (ports.length > 0) {
      // Make close ports twice more likely by putting them again
      for (
        let i = 0;
        i < this.mg.config().proximityBonusPortsNb(ports.length);
        i++
      ) {
        ports.push(ports[i]);
      }
    }

    // Make ally ports twice more likely by putting them again
    this.mg
      .players()
      .filter((p) => p !== port.owner() && p.canTrade(port.owner()))
      .filter((p) => p.isAlliedWith(port.owner()))
      .flatMap((p) => p.units(UnitType.Port))
      .forEach((p) => ports.push(p));

    return ports;
  }

  airfields(airfield: Unit): Unit[] {
    const airfields = this.mg
      .players()
      .filter((p) => p !== airfield.owner() && p.canTrade(airfield.owner()))
      .flatMap((p) => p.units(UnitType.Airfield))
      .sort((p1, p2) => {
        return (
          this.mg.manhattanDist(airfield.tile(), p1.tile()) -
          this.mg.manhattanDist(airfield.tile(), p2.tile())
        );
      });

    if (airfields.length > 0) {
      for (
        let i = 0;
        i < this.mg.config().proximityBonusAirfieldsNumber(airfields.length);
        i++
      ) {
        airfields.push(airfields[i]);
      }
    }

    this.mg
      .players()
      .filter((p) => p !== airfield.owner() && p.canTrade(airfield.owner()))
      .filter((p) => p.isAlliedWith(airfield.owner()))
      .flatMap((p) => p.units(UnitType.Airfield))
      .forEach((p) => airfields.push(p));

    return airfields;
  }
  public setBomberIntent(
    intent: {
      targetPlayerID: string;
      structures: UnitType[];
      preferClosest: boolean;
    } | null,
  ): void {
    this.bomberIntent = intent;
  }
  public getBomberIntent(): {
    targetPlayerID: string;
    structures: UnitType[];
    preferClosest: boolean;
  } | null {
    return this.bomberIntent;
  }

  public setAutoBombingEnabled(enabled: boolean): void {
    this._autoBombingEnabled = enabled;
  }

  public isAutoBombingEnabled(): boolean {
    return this._autoBombingEnabled;
  }
}
