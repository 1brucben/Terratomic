/**
 * Per-structure score breakdown for the construction debug overlay.
 */
export interface ConstructionScoreEntry {
  unitType: string;
  score: number;
  upgradePreferred: boolean;
}

/**
 * Per-unit-candidate score entry for the unit debug overlay.
 */
export interface UnitScoreEntry {
  unitType: string;
  score: number;
}

/**
 * Nuke sequence state snapshot for the debug overlay.
 */
export interface NukeSequenceDebugInfo {
  phase: string;
  bombType: string;
  targetPlayerName: string;
  targetPlayerId: string;
  samNukesNeeded: number;
  siloCapacity: number;
  bombsNeeded: number;
  estimatedTotalCost: number;
  currentScore: number;
}

/**
 * Nuke scoring snapshot (best atom / hydrogen targets).
 */
export interface NukeScoreDebugInfo {
  bestAtomScore: number;
  bestAtomTargetPlayerName: string;
  bestHydrogenScore: number;
  bestHydrogenTargetPlayerName: string;
  /** The adjusted nuke score used for comparison against construction/unit scores. */
  adjustedBestNukeScore: number;
}

/**
 * Complete debug payload for a single AI player's construction decisions.
 */
export interface ConstructionDebugData {
  playerId: string;
  playerName: string;

  /** The current gold the AI has. */
  gold: number;
  /** Estimated gold income per minute. */
  goldPerMinute: number;

  /** Which spending category is currently winning. */
  spendingWinner: "construction" | "unit" | "nuke" | "none";

  /** Best construction composite score (the winner among all structure types). */
  bestConstructionScore: number;
  /** Best unit composite score. */
  bestUnitScore: number;

  /** Per-structure score breakdown. */
  constructionScores: ConstructionScoreEntry[];
  /** Per-unit score breakdown. */
  unitScores: UnitScoreEntry[];

  /** Nuke scoring info. */
  nukeScores: NukeScoreDebugInfo;

  /** Active nuke sequence info (null if idle). */
  nukeSequence: NukeSequenceDebugInfo | null;
}
