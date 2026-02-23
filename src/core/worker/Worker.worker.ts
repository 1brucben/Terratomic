import { PerformanceMetrics } from "../../client/utilities/PerformanceMetrics";
import { createGameRunner, GameRunner } from "../GameRunner";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import {
  AttackAveragePositionResultMessage,
  AttackDebugResultMessage,
  ConstructionDebugResultMessage,
  ExecutionMetricsMessage,
  InitializedMessage,
  MainThreadMessage,
  PlayerActionsResultMessage,
  PlayerBorderTilesResultMessage,
  PlayerProfileResultMessage,
  TradeDebugResultMessage,
  TransportShipSpawnResultMessage,
  WarScoreDebugResultMessage,
  WorkerMessage,
} from "./WorkerMessages";

const ctx: Worker = self as any;

// Make PerformanceMetrics available in worker context
(self as any).__PERF_METRICS__ = PerformanceMetrics.getInstance();
let gameRunner: Promise<GameRunner> | null = null;
let lastMetricsSendTime = 0;
const METRICS_SEND_INTERVAL = 200; // Send metrics every 200ms

function gameUpdate(gu: GameUpdateViewData | ErrorUpdate) {
  // skip if ErrorUpdate
  if (!("updates" in gu)) {
    return;
  }
  sendMessage({
    type: "game_update",
    gameUpdate: gu,
  });
}

function sendMessage(message: WorkerMessage) {
  if (message.type === "game_update") {
    // Transfer the packed tile updates buffer to avoid structured-clone copies and
    // reduce worker-side memory churn during long runs / catch-up.
    ctx.postMessage(message, [message.gameUpdate.packedTileUpdates.buffer]);
    return;
  }
  ctx.postMessage(message);
}

ctx.addEventListener("message", async (e: MessageEvent<MainThreadMessage>) => {
  const message = e.data;

  switch (message.type) {
    case "set_metrics_enabled": {
      const metrics = (self as any).__PERF_METRICS__;
      if (metrics) {
        metrics.enabled = message.enabled;
        console.log("[Worker] Metrics enabled set to:", message.enabled);
      }
      break;
    }
    case "heartbeat": {
      (await gameRunner)?.executeNextTick();

      // Send execution metrics to main thread periodically if enabled
      const metrics = (self as any).__PERF_METRICS__;
      if (metrics?.enabled) {
        const now = performance.now();
        if (now - lastMetricsSendTime >= METRICS_SEND_INTERVAL) {
          const execMetrics = metrics.getExecutionMetrics();
          if (execMetrics.length > 0) {
            sendMessage({
              type: "execution_metrics",
              metrics: execMetrics,
            } as ExecutionMetricsMessage);
          }
          lastMetricsSendTime = now;
        }
      }
      break;
    }
    case "init":
      try {
        gameRunner = createGameRunner(
          message.gameStartInfo,
          message.clientID,
          gameUpdate,
          message.calibration as any,
        ).then((gr) => {
          sendMessage({
            type: "initialized",
            id: message.id,
          } as InitializedMessage);
          return gr;
        });
      } catch (error) {
        console.error("Failed to initialize game runner:", error);
        throw error;
      }
      break;

    case "turn":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const gr = await gameRunner;
        await gr.addTurn(message.turn);
      } catch (error) {
        console.error("Failed to process turn:", error);
        throw error;
      }
      break;

    case "player_actions":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const actions = (await gameRunner).playerActions(
          message.playerID,
          message.x,
          message.y,
        );
        sendMessage({
          type: "player_actions_result",
          id: message.id,
          result: actions,
        } as PlayerActionsResultMessage);
      } catch (error) {
        console.error("Failed to check borders:", error);
        throw error;
      }
      break;
    case "player_profile":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const profile = (await gameRunner).playerProfile(message.playerID);
        sendMessage({
          type: "player_profile_result",
          id: message.id,
          result: profile,
        } as PlayerProfileResultMessage);
      } catch (error) {
        console.error("Failed to check borders:", error);
        throw error;
      }
      break;
    case "player_border_tiles":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const borderTiles = (await gameRunner).playerBorderTiles(
          message.playerID,
        );
        sendMessage({
          type: "player_border_tiles_result",
          id: message.id,
          result: borderTiles,
        } as PlayerBorderTilesResultMessage);
      } catch (error) {
        console.error("Failed to get border tiles:", error);
        throw error;
      }
      break;
    case "attack_average_position":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const averagePosition = (await gameRunner).attackAveragePosition(
          message.playerID,
          message.attackID,
        );
        sendMessage({
          type: "attack_average_position_result",
          id: message.id,
          x: averagePosition ? averagePosition.x : null,
          y: averagePosition ? averagePosition.y : null,
        } as AttackAveragePositionResultMessage);
      } catch (error) {
        console.error("Failed to get attack average position:", error);
        throw error;
      }
      break;
    case "transport_ship_spawn":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const spawnTile = (await gameRunner).bestTransportShipSpawn(
          message.playerID,
          message.targetTile,
        );
        sendMessage({
          type: "transport_ship_spawn_result",
          id: message.id,
          result: spawnTile,
        } as TransportShipSpawnResultMessage);
      } catch (error) {
        console.error("Failed to spawn transport ship:", error);
      }
      break;
    case "war_score_debug":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const debugData = (await gameRunner).warScoreDebug();
        sendMessage({
          type: "war_score_debug_result",
          id: message.id,
          result: debugData,
        } as WarScoreDebugResultMessage);
      } catch (error) {
        console.error("Failed to get war score debug:", error);
        throw error;
      }
      break;
    case "attack_debug":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const attackData = (await gameRunner).attackDebug();
        sendMessage({
          type: "attack_debug_result",
          id: message.id,
          result: attackData,
        } as AttackDebugResultMessage);
      } catch (error) {
        console.error("Failed to get attack debug:", error);
        throw error;
      }
      break;
    case "trade_debug":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const tradeData = (await gameRunner).tradeDebug();
        sendMessage({
          type: "trade_debug_result",
          id: message.id,
          result: tradeData,
        } as TradeDebugResultMessage);
      } catch (error) {
        console.error("Failed to get trade debug:", error);
        throw error;
      }
      break;
    case "construction_debug":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const constructionData = (await gameRunner).constructionDebug();
        sendMessage({
          type: "construction_debug_result",
          id: message.id,
          result: constructionData,
        } as ConstructionDebugResultMessage);
      } catch (error) {
        console.error("Failed to get construction debug:", error);
        throw error;
      }
      break;
    default:
      console.warn("Unknown message :", message);
  }
});

// Error handling
ctx.addEventListener("error", (error) => {
  console.error("Worker error:", error);
});

ctx.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection in worker:", event);
});
