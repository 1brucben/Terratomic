import { AllPlayersStats, ClientID, Winner } from "../Schemas";
import {
  EmojiMessage,
  GameUpdates,
  Gold,
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
  Roads,
  CargoTrucks,
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
  | RoadsUpdate
  | CargoTrucksUpdate;

export interface BomberExplosionUpdate {
  type: GameUpdateType.BomberExplosion;
  x: number;
  y: number;
  radius: number;
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
  constructionType?: UnitType;
  ticksLeftInCooldown?: Tick;
  returning?: boolean;
  cooldownDuration?: Tick;
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
  tilesOwned: number;
  gold: Gold;
  population: number;
  totalPopulation: number;
  hospitalReturns: number;
  workers: number;
  productivity: number;
  productivityGrowthPerMinute: number;
  investmentRate: number;
  troops: number;
  attackingTroops: number;
  targetTroopRatio: number;
  allies: number[];
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

export interface AllianceViewData {
  requestorID: number;
  recipientID: number;
  createdAt: number;
  extensionRequestedByMe: boolean;
  extensionRequestedByOther: boolean;
}
