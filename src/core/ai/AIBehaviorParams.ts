import aiProfilesData from "../../../resources/ai-profiles.json" with { type: "json" };

/**
 * Behavior parameters that define how an AI player acts.
 */
export interface AIBehaviorParams {
  // === Spawn Behavior ===
  /** Whether to move spawn point around during spawn phase */
  spawnHopping?: boolean;
  /** How often (in ticks) to move spawn point when spawnHopping is enabled */
  spawnHopRate?: number;
  /** Whether to wait until end of spawn phase and spawn near another player */
  spawnSniping?: boolean;
  /** Whether to move away when another player spawns nearby */
  spawnAvoidance?: boolean;
  /** Minimum distance to maintain from other players when spawnAvoidance is enabled */
  spawnAvoidanceDistance?: number;

  // === Terra Nullius Expansion ===
  /** Minimum troop ratio (troops / maxTroops) before expanding into unclaimed land (0-1) */
  terraNulliusTroopThreshold?: number;
  /** Percent of own troops to use when expanding into Terra Nullius by land */
  terraNulliusOwnTroopPercent?: number;
  /** Percent of own troops to use when boating to Terra Nullius */
  terraNulliusBoatTroopPercent?: number;
  /** Maximum distance from capital to attack TN (bypassed if shares land border) */
  terraNulliusMaxDistance?: number;
  /** Minimum spacing between TN boat targets to prevent clustering */
  terraNulliusBoatSpacing?: number;

  // === Bot Attack Behavior ===
  /** Minimum troop ratio (troops / maxTroops) before attacking bots (0-1) */
  botAttackTroopThreshold?: number;
  /** Maximum distance (in tiles) to consider a bot target */
  botAttackMaxDistance?: number;
  /** Percent of own troops to use in bot attack (alpha) */
  botAttackOwnTroopPercent?: number;
  /** Multiplier of bot troops to cap attack size (beta) */
  botAttackEnemyTroopMultiplier?: number;

  // === Defense ===
  /** Minimum ratio of defending troops (player.troops() / totalTroops) required before attacking (0-1) */
  defendingTroopTarget?: number;

  // === Investment Rates ===
  /** Productivity investment rate (0-1), set at game start */
  productivityInvestmentRate?: number;
  /** Research investment rate (0-1), set at game start */
  researchInvestmentRate?: number;
  /** Road investment rate (0-1), set once roads are researched */
  roadInvestmentRate?: number;
  /** Target troop ratio (0-1), troops share out of workers and troops, set at game start */
  targetTroopRatio?: number;
  /** If true, cap road investment to maintenance cost (or exact maintenance if at max quality) */
  roadInvestmentCapToMaintenance?: boolean;
  /** Extra investment above maintenance when road network is incomplete (0-1), default 0.1 */
  roadBuildBoost?: number;
  /** Investment adjustment above/below maintenance based on quality vs target (0-1), default 0.01 */
  roadQualityAdjust?: number;
  /** Target road quality (0-150), invest more when below, less when above, default 100 */
  targetRoadQuality?: number;

  // === Construction ===
  /** Whether to build cities */
  buildCities?: boolean;
  /** Whether to build factories */
  buildFactories?: boolean;
  /** Whether to build ports */
  buildPorts?: boolean;
  /** Whether to build hospitals */
  buildHospitals?: boolean;
  /** Whether to build academies */
  buildAcademies?: boolean;
  /** Whether to build airfields */
  buildAirfields?: boolean;
  /** Whether to build research labs */
  buildResearchLabs?: boolean;
  /** Whether to build missile silos */
  buildMissileSilos?: boolean;
  /** Whether to build SAM launchers */
  buildSAMLaunchers?: boolean;
  /** Whether to build defense posts */
  buildDefensePosts?: boolean;
  /** Whether to build doomsday devices */
  buildDoomsdayDevices?: boolean;

  /**
   * Minimum distance (in tiles) required between non-defense-post structures.
   * This is applied by the AI on top of the game's own placement rules.
   */
  aiStructureMinDistance?: number;

  /**
   * Minimum distance (in tiles) to keep away from Human/AI players when placing
   * non-defense-post structures.
   */
  aiAvoidHumanAiDistance?: number;

  /**
   * When no valid placement tile is found for a stackable structure and the AI
   * already owns at least one of that structure type, decide which existing one
   * to upgrade.
   * - "weighted": random selection weighted by current level/stackCount
   * - "lowest": pick the lowest level/stackCount (ties broken randomly)
   */
  aiStackUpgradeStrategy?: "weighted" | "lowest";

  // === Structure Build Weights ===
  // Multipliers for structure build scoring (default 1 for all)
  /** Weight for city build priority */
  weightCity?: number;
  /** Weight for factory build priority */
  weightFactory?: number;
  /** Weight for port build priority */
  weightPort?: number;
  /** Weight for hospital build priority */
  weightHospital?: number;
  /** Weight for academy build priority */
  weightAcademy?: number;
  /** Weight for airfield build priority */
  weightAirfield?: number;
  /** Weight for research lab build priority */
  weightResearchLab?: number;
  /** Weight for missile silo build priority */
  weightMissileSilo?: number;
  /** Weight for SAM launcher build priority */
  weightSAMLauncher?: number;
  /** Weight for defense post build priority */
  weightDefensePost?: number;
  /** Weight for doomsday device build priority */
  weightDoomsdayDevice?: number;

  // === Structure Scoring ===
  /**
   * Assumed population percentage of max pop when scoring structures.
   * Default 0.7 (70%).
   */
  aiAssumedPopPercent?: number;
}

export interface AIProfile {
  id: string;
  name: string;
  params: AIBehaviorParams;
}

const aiProfiles = aiProfilesData.profiles as AIProfile[];

export function getAIProfile(id: string): AIProfile | undefined {
  return aiProfiles.find((p) => p.id === id);
}
