/**
 * Web Worker entry point for running a single headless calibration match.
 * Runs synchronously without yielding so it performs at full speed
 * even in background tabs.
 */
import {
  CalibrationConfig,
  CalibrationResult,
  runCalibrationMatch,
} from "./CalibrationRunner";

export interface CalibrationWorkerRequest {
  type: "run";
  matchIndex: number;
  config: CalibrationConfig;
}

export interface CalibrationWorkerResponse {
  type: "result";
  matchIndex: number;
  result: CalibrationResult;
}

export interface CalibrationWorkerError {
  type: "error";
  matchIndex: number;
  error: string;
}

export type CalibrationWorkerMessage =
  | CalibrationWorkerResponse
  | CalibrationWorkerError;

const ctx: Worker = self as any;

ctx.addEventListener(
  "message",
  async (e: MessageEvent<CalibrationWorkerRequest>) => {
    const { matchIndex, config } = e.data;

    try {
      // Run without progress callback — no yields, maximum speed
      const result = await runCalibrationMatch(config);

      const response: CalibrationWorkerResponse = {
        type: "result",
        matchIndex,
        result,
      };
      ctx.postMessage(response);
    } catch (err) {
      const errorResponse: CalibrationWorkerError = {
        type: "error",
        matchIndex,
        error: err instanceof Error ? err.message : String(err),
      };
      ctx.postMessage(errorResponse);
    }
  },
);
