import { AllPlayersStats, ClientID, Winner } from "../Schemas";
import {
  EmojiMessage,
  GameUpdates,
  Gold,
  MapPos,
  MessageType,
  NameViewData,
  PlayerID,
  PlayerType,
  Team,
  Tick,
  UnitType,
  UpgradeType,
} from "./Game";
import { TileRef, TileUpdate } from "./GameMap";

export interface GameUpdateViewData {
  updates: GameUpdates;
  packedTileUpdates: BigUint64Array;
  playerNameViewData: Record<PlayerID, NameViewData>;
  peaceTimerEndsAtTick: Tick | null;
  alliances: AllianceViewData[];
  tick: Tick;
}

export interface ErrorUpdate {
  errMsg: string;
  stack?: string;
}

export enum GameUpdateType {
  Tile,
  Unit,
  Player,
  DisplayEvent,
  DisplayChatEvent,
  AllianceRequest,
  AllianceRequestReply,
  BrokeAlliance,
  AllianceExpired,
  TargetPlayer,
  Emoji,
  Win,
  Hash,
  UnitIncoming,
  AllianceExtensionPrompt,
  AllianceExtensionAccepted,
  BomberExplosion,
  DoomsdayExplosion,
  Roads,
  CargoTrucks,
  TileOwnerChanged,
}

export interface SerializedCargoTruck {
  id: number;
  ownerID: number;
  path: TileRef[];
  progress: number;
  position: [number, number];
  isInternational?: boolean;
  destinationOwnerID?: number;
}

export interface CargoTrucksUpdate {
  type: GameUpdateType.CargoTrucks;
  added: SerializedCargoTruck[];
  removed: number[];
  updated: { id: number; progress: number; position: [number, number] }[];
}

export interface RoadsUpdate {
  type: GameUpdateType.Roads;
  added: string[];
  removed: string[];
}

export type GameUpdate =
  | TileUpdateWrapper
  | UnitUpdate
  | PlayerUpdate
  | AllianceRequestUpdate
  | AllianceRequestReplyUpdate
  | BrokeAllianceUpdate
  | AllianceExpiredUpdate
  | AllianceExtensionAcceptedUpdate
  | DisplayMessageUpdate
  | DisplayChatMessageUpdate
  | TargetPlayerUpdate
  | EmojiUpdate
  | WinUpdate
  | HashUpdate
  | UnitIncomingUpdate
  | BomberExplosionUpdate
  | DoomsdayExplosionUpdate
  | RoadsUpdate
  | CargoTrucksUpdate
  | TileOwnerChangedUpdate;

export interface BomberExplosionUpdate {
  type: GameUpdateType.BomberExplosion;
  x: number;
  y: number;
  radius: number;
}

export interface DoomsdayExplosionUpdate {
  type: GameUpdateType.DoomsdayExplosion;
  x: number;
  y: number;
  radius: number; // base radius for FX; client animates slowly
}

export interface TileUpdateWrapper {
  type: GameUpdateType.Tile;
  update: TileUpdate;
}

export interface UnitUpdate {
  type: GameUpdateType.Unit;
  unitType: UnitType;
  troops: number;
  id: number;
  ownerID: number;
  lastOwnerID?: number;
  // TODO: make these tilerefs
  pos: TileRef;
  lastPos: TileRef;
  isActive: boolean;
  reachedTarget: boolean;
  retreating: boolean;
  targetable: boolean;
  targetUnitId?: number; // Only for trade ships
  targetTile?: TileRef; // Only for nukes
  health?: number;
  maxHealth?: number; // Effective max health (base + bonuses)
  constructionType?: UnitType;
  constructionTargetLevel?: number; // Target level for construction units
  // Deprecated: ticksLeftInCooldown is replaced by cooldownEndsAt
  ticksLeftInCooldown?: Tick;
  // Unified cooldown end tick; client derives remaining as (endsAt - currentTick)
  cooldownEndsAt?: Tick;
  returning?: boolean;
  cooldownDuration?: Tick;
  isAttacking?: boolean;
  isDetectedByNavalUnit?: boolean;
  targetedBySAM?: boolean;
  // Client-only hint: this update represents a ghosted last-known position
  ghost?: boolean;
  ghostExpiresAt?: Tick;
  // Structure upgrade level (>=1). Cities increase level by 1 per upgrade.
  level?: number;
  // Trade-ship specific, for precise UI without heuristics
  tradeRouteStartOwnerID?: number; // smallID of start port owner
  tradeRouteEndOwnerID?: number; // smallID of end port owner
  tradePhase?: "toStart" | "toEnd"; // current navigation phase (returning is provided separately)
  dockedAtPortOwnerID?: number; // smallID of the owner of the port the ship is currently docked at (if any)
  // Port-specific: when a trade ship is scheduled from this port, its construction completion tick
  pendingTradeShipDueTick?: Tick;
  // Port-specific: support multiple concurrent trade ship constructions
  pendingTradeShipDueTicks?: Tick[];
  // Airfield-specific: bomber upgrade level
  bomberLevel?: number;
}

export interface AttackUpdate {
  attackerID: number;
  targetID: number;
  troops: number;
  id: string;
  retreating: boolean;
}

export interface PlayerUpdate {
  type: GameUpdateType.Player;
  nameViewData?: NameViewData;
  clientID: ClientID | null;
  flag: string | undefined;
  name: string;
  displayName: string;
  id: PlayerID;
  team?: Team;
  smallID: number;
  playerType: PlayerType;
  isAlive: boolean;
  isDisconnected: boolean;
  // Geographic capital (center) of player's territory
  capital?: MapPos;
  tilesOwned: number;
  gold: Gold;
  // Economic: Industrial Production proxy (formerly GDP) = config.industrialProductionFactor() * maxPopulation(player)
  industrialProduction: number;
  population: number;
  totalPopulation: number;
  hospitalReturns: number;
  workers: number;
  productivity: number;
  productivityGrowthPerMinute: number;
  investmentRate: number;
  // Investment sliders (fractions 0..1)
  roadInvestmentRate?: number;
  researchInvestmentRate?: number;
  // Trade: current global demand queue length (for UI indicators)
  tradeDemandQueueLength?: number;
  // Road KPIs (percent values 0..100)
  roadNetworkQuality?: number;
  roadNetworkCompletion?: number;
  // Road: credited network length for this player (fractional tiles)
  roadNetworkLength?: number;
  // Road: server-computed net build speed in pixels per second
  roadNetPixelsPerSecond?: number;
  troops: number;
  attackingTroops: number;
  targetTroopRatio: number;
  allies: number[];
  // Diplomacy: explicit wars (smallIDs), separate from trade embargoes
  wars?: number[];
  embargoes: Set<PlayerID>;
  isTraitor: boolean;
  targets: number[];
  outgoingEmojis: EmojiMessage[];
  outgoingAttacks: AttackUpdate[];
  incomingAttacks: AttackUpdate[];
  outgoingAllianceRequests: PlayerID[];
  hasSpawned: boolean;
  betrayals?: bigint;
  effectiveUnits: Record<UnitType, number>;
  unitsOwned: Record<UnitType, number>;
  upgrades: UpgradeType[];
  // Techs researched in the standalone research tree (per-match only)
  researchTreeTechs: string[];
  // Research progress (beakers) per tech id (optional; omitted if none)
  researchTreeBeakers?: Record<string, number>;
  // Currently selected research priority tech id (optional)
  researchPriorityTech?: string | null;
  // Policy directive choices: directiveId -> optionId (optional; omitted if none)
  policyChoices?: Record<string, string>;
  // Whether the player has unseen policy directives to review
  hasUnseenPolicyDirectives?: boolean;
}

export interface AllianceRequestUpdate {
  type: GameUpdateType.AllianceRequest;
  requestorID: number;
  recipientID: number;
  createdAt: Tick;
}

export interface AllianceRequestReplyUpdate {
  type: GameUpdateType.AllianceRequestReply;
  request: AllianceRequestUpdate;
  accepted: boolean;
}

export interface BrokeAllianceUpdate {
  type: GameUpdateType.BrokeAlliance;
  traitorID: number;
  betrayedID: number;
}

export interface AllianceExpiredUpdate {
  type: GameUpdateType.AllianceExpired;
  player1ID: number;
  player2ID: number;
}

export interface TargetPlayerUpdate {
  type: GameUpdateType.TargetPlayer;
  playerID: number;
  targetID: number;
}

export interface EmojiUpdate {
  type: GameUpdateType.Emoji;
  emoji: EmojiMessage;
}

export interface DisplayMessageUpdate {
  type: GameUpdateType.DisplayEvent;
  message: string;
  messageType: MessageType;
  goldAmount?: bigint;
  playerID: number | null;
  params?: Record<string, string | number>;
}

export type DisplayChatMessageUpdate = {
  type: GameUpdateType.DisplayChatEvent;
  key: string;
  category: string;
  target: string | undefined;
  playerID: number | null;
  isFrom: boolean;
  recipient: string;
};

export interface WinUpdate {
  type: GameUpdateType.Win;
  allPlayersStats: AllPlayersStats;
  winner: Winner;
}

export interface HashUpdate {
  type: GameUpdateType.Hash;
  tick: Tick;
  hash: number;
}

export interface UnitIncomingUpdate {
  type: GameUpdateType.UnitIncoming;
  unitID: number;
  message: string;
  messageType: MessageType;
  playerID: number;
}

export interface AllianceExtensionAcceptedUpdate {
  type: GameUpdateType.AllianceExtensionAccepted;
  playerID: number;
  allianceID: number;
}

export interface TileOwnerChangedUpdate {
  type: GameUpdateType.TileOwnerChanged;
  tile: TileRef;
  newOwnerID: PlayerID;
}

export interface AllianceViewData {
  requestorID: number;
  recipientID: number;
  createdAt: number;
  extensionRequestedByMe: boolean;
  extensionRequestedByOther: boolean;
}
