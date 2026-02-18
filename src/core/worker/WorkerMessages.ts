import { AttackDebugData } from "../ai/AIAttackHandler";
import { WarScoreDebugData } from "../ai/AIDiplomacyHandler";
import { TradeDebugPayload } from "../execution/TradeDebugData";
import {
  PlayerActions,
  PlayerBorderTiles,
  PlayerID,
  PlayerProfile,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateViewData } from "../game/GameUpdates";
import { ClientID, GameStartInfo, Turn } from "../Schemas";

export type WorkerMessageType =
  | "heartbeat"
  | "init"
  | "initialized"
  | "turn"
  | "game_update"
  | "player_actions"
  | "player_actions_result"
  | "player_profile"
  | "player_profile_result"
  | "player_border_tiles"
  | "player_border_tiles_result"
  | "attack_average_position"
  | "attack_average_position_result"
  | "transport_ship_spawn"
  | "transport_ship_spawn_result"
  | "set_metrics_enabled"
  | "execution_metrics"
  | "war_score_debug"
  | "war_score_debug_result"
  | "attack_debug"
  | "attack_debug_result"
  | "trade_debug"
  | "trade_debug_result";

// Base interface for all messages
interface BaseWorkerMessage {
  type: WorkerMessageType;
  id?: string;
}

export interface HeartbeatMessage extends BaseWorkerMessage {
  type: "heartbeat";
}

// Messages from main thread to worker
export interface InitMessage extends BaseWorkerMessage {
  type: "init";
  gameStartInfo: GameStartInfo;
  clientID: ClientID;
  // Calibration data for AI-vs-AI matches
  calibration?: {
    numPlayers: number;
    profileA: { id: string; name: string; params: Record<string, unknown> };
    profileB: { id: string; name: string; params: Record<string, unknown> };
  };
}

export interface TurnMessage extends BaseWorkerMessage {
  type: "turn";
  turn: Turn;
}

// Messages from worker to main thread
export interface InitializedMessage extends BaseWorkerMessage {
  type: "initialized";
}

export interface GameUpdateMessage extends BaseWorkerMessage {
  type: "game_update";
  gameUpdate: GameUpdateViewData;
}

export interface PlayerActionsMessage extends BaseWorkerMessage {
  type: "player_actions";
  playerID: PlayerID;
  x: number;
  y: number;
}

export interface PlayerActionsResultMessage extends BaseWorkerMessage {
  type: "player_actions_result";
  result: PlayerActions;
}

export interface PlayerProfileMessage extends BaseWorkerMessage {
  type: "player_profile";
  playerID: number;
}

export interface PlayerProfileResultMessage extends BaseWorkerMessage {
  type: "player_profile_result";
  result: PlayerProfile;
}

export interface PlayerBorderTilesMessage extends BaseWorkerMessage {
  type: "player_border_tiles";
  playerID: PlayerID;
}

export interface PlayerBorderTilesResultMessage extends BaseWorkerMessage {
  type: "player_border_tiles_result";
  result: PlayerBorderTiles;
}

export interface AttackAveragePositionMessage extends BaseWorkerMessage {
  type: "attack_average_position";
  playerID: number;
  attackID: string;
}

export interface AttackAveragePositionResultMessage extends BaseWorkerMessage {
  type: "attack_average_position_result";
  x: number | null;
  y: number | null;
}

export interface TransportShipSpawnMessage extends BaseWorkerMessage {
  type: "transport_ship_spawn";
  playerID: PlayerID;
  targetTile: TileRef;
}

export interface TransportShipSpawnResultMessage extends BaseWorkerMessage {
  type: "transport_ship_spawn_result";
  result: TileRef | false;
}

export interface SetMetricsEnabledMessage extends BaseWorkerMessage {
  type: "set_metrics_enabled";
  enabled: boolean;
}

export interface ExecutionMetricsMessage extends BaseWorkerMessage {
  type: "execution_metrics";
  metrics: Array<{ type: string; time: number; count: number }>;
}

export interface WarScoreDebugMessage extends BaseWorkerMessage {
  type: "war_score_debug";
}

export interface WarScoreDebugResultMessage extends BaseWorkerMessage {
  type: "war_score_debug_result";
  result: WarScoreDebugData[];
}

export interface AttackDebugMessage extends BaseWorkerMessage {
  type: "attack_debug";
}

export interface AttackDebugResultMessage extends BaseWorkerMessage {
  type: "attack_debug_result";
  result: AttackDebugData[];
}

export interface TradeDebugMessage extends BaseWorkerMessage {
  type: "trade_debug";
}

export interface TradeDebugResultMessage extends BaseWorkerMessage {
  type: "trade_debug_result";
  result: TradeDebugPayload;
}

// Union types for type safety
export type MainThreadMessage =
  | HeartbeatMessage
  | InitMessage
  | TurnMessage
  | PlayerActionsMessage
  | PlayerProfileMessage
  | PlayerBorderTilesMessage
  | AttackAveragePositionMessage
  | TransportShipSpawnMessage
  | SetMetricsEnabledMessage
  | WarScoreDebugMessage
  | AttackDebugMessage
  | TradeDebugMessage;

// Message send from worker
export type WorkerMessage =
  | InitializedMessage
  | GameUpdateMessage
  | PlayerActionsResultMessage
  | PlayerProfileResultMessage
  | PlayerBorderTilesResultMessage
  | AttackAveragePositionResultMessage
  | TransportShipSpawnResultMessage
  | ExecutionMetricsMessage
  | WarScoreDebugResultMessage
  | AttackDebugResultMessage
  | TradeDebugResultMessage;
