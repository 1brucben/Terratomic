/**
 * Debug data structures for the Trade Debug Overlay (F11).
 * Exported from a separate file to keep TradeManagerExecution lean.
 */

/** Per-ship diagnostic snapshot */
export interface TradeShipDebug {
  shipId: number;
  ownerName: string;
  ownerId: string;
  /** Current tile position */
  x: number;
  y: number;
  /** Whether the tile the ship is on is ocean */
  isOnOcean: boolean;
  /** Whether the ship is co-located with a port unit */
  isAtPort: boolean;
  /** Port id if docked, else null */
  dockedPortId: number | null;
  /** Trade phase: toStart, toEnd, or idle (null) */
  phase: "toStart" | "toEnd" | "idle";
  /** Whether the ship is flagged as returning */
  returning: boolean;
  /** Target unit id (port being navigated to), if any */
  targetUnitId: number | null;
  /** Target unit position, if any */
  targetX: number | null;
  targetY: number | null;
  /** Manhattan distance to target, if target set */
  distToTarget: number | null;
  /** Trade route start owner name */
  startOwner: string | null;
  /** Trade route end owner name */
  endOwner: string | null;
  /** Cargo gold on the ship */
  cargoGold: string; // bigint serialized as string
  /** Whether tile === lastTile (ship didn't move this tick) */
  stationaryThisTick: boolean;
  /** Number of adjacent ocean tiles from the ship's current position */
  adjacentOceanCount: number;
}

/** Per-player summary with its ships */
export interface TradePlayerDebug {
  playerId: string;
  playerName: string;
  totalShips: number;
  idleShips: number;
  toStartShips: number;
  toEndShips: number;
  returningShips: number;
  stuckAtPort: number; // ships that are at a port AND have a target but distToTarget <= 1 for extended time (heuristic: stationary + at port + has target)
  stationaryShips: number; // ships that didn't move this tick
  goldPerMinute: number;
  portCount: number;
  ships: TradeShipDebug[];
}

/** Top-level debug payload */
export interface TradeDebugPayload {
  tick: number;
  queueLength: number;
  totalTradeShips: number;
  players: TradePlayerDebug[];
}
