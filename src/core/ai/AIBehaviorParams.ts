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
  /**
   * How much the boat search range grows per failed attempt.
   * Default 0.5 (tiles per attempt).
   */
  botAttackBoatSearchRangeGrowth?: number;

  // === AI/Human Attack Behavior ===
  /** Minimum troop ratio (troops / maxTroops) before attacking AI/Human players (0-1) */
  attackTroopThreshold?: number;
  /** Percent of own troops to use in attack (alpha) */
  attackOwnTroopPercent?: number;
  /** Multiplier of enemy troops to cap attack size (beta) */
  attackEnemyTroopMultiplier?: number;

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
   * If the best construction target score is less than this multiplier times
   * the best nuke score, skip construction in favor of saving for nukes.
   * Set to 0 to disable. Default 0 (disabled).
   */
  nukeScoreConstructionThreshold?: number;

  /**
   * Weight multiplier for collateral damage to non-enemy player structures
   * when evaluating nuke targets. Higher values make the AI more cautious
   * about hitting friendly/neutral structures. Default 1.0.
   */
  nukeFriendlyDamageWeight?: number;

  /**
   * Multiplier applied to the nuke score when comparing against construction
   * scores to decide whether to start a nuke sequence. Default 1.0.
   */
  nukeScoreMultiplier?: number;

  /**
   * Minimum distance (in tiles) required between non-defense-post structures.
   * This is applied by the AI on top of the game's own placement rules.
   */
  aiStructureMinDistance?: number;

  /**
   * Minimum distance (in tiles) to keep away from other players when placing
   * non-defense-post structures.
   */
  aiAvoidPlayerDistance?: number;

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
  /**
   * Decay rate for SAM coverage penalty sigmoid.
   * score *= sigmoid(-samCoverageDecay * existingCoverage).
   * Higher values penalize redundant SAM coverage more sharply.
   * Default 0.05.
   */
  samCoverageDecay?: number;
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
  /**
   * Base score for building the first port (when AI has 0 ports).
   * Default 1.0.
   */
  aiFirstPortScore?: number;

  // === Port Tile Scoring ===
  /**
   * Percentage penalty (0-1) for port tile if within avoid player distance from another player.
   * Default 0.5 (50% penalty).
   */
  portTileNearPlayerPenalty?: number;
  /**
   * Maximum percentage penalty (0-1) for port tile based on distance to closest own structure.
   * Penalty scales linearly from this value at distance 0 to 0 at maxDistance.
   * Default 0.3 (30% max penalty).
   */
  portTileNearStructurePenalty?: number;
  /**
   * Percentage penalty per tile of distance from capital (0-1).
   * Tiles farther from capital get penalized. Default 0.01 (1% penalty per tile).
   */
  portTileCapitalDistancePenalty?: number;

  // === Other Tile Scoring (non-port, non-defense post, non-SAM structures) ===
  /**
   * Percentage penalty (0-1) for other tile if within avoid player distance from another player.
   * Default 0.5 (50% penalty).
   */
  otherTileNearPlayerPenalty?: number;
  /**
   * Maximum percentage penalty (0-1) for other tile based on distance to closest own structure.
   * Penalty scales linearly from this value at distance 0 to 0 at maxDistance.
   * Default 0.3 (30% max penalty).
   */
  otherTileNearStructurePenalty?: number;
  /**
   * Percentage penalty per tile of distance from capital (0-1).
   * Tiles farther from capital get penalized. Default 0.01 (1% penalty per tile).
   */
  otherTileCapitalDistancePenalty?: number;
  /**
   * Distance (in tiles) to check for nearby water.
   * Default 5.
   */
  otherTileWaterCheckDistance?: number;
  /**
   * Percentage penalty (0-1) if water is within the water check distance.
   * Default 0.2 (20% penalty).
   */
  otherTileNearWaterPenalty?: number;

  // === Diplomacy ===
  /**
   * War score threshold above which the AI will declare war on another player.
   * Higher values make the AI less aggressive. Default 1.0.
   */
  warDeclarationThreshold?: number;

  /**
   * Weight for shared border length ratio in war score calculation.
   * Score contribution = weight * (sharedBorderLength / ownTotalBorderLength).
   * Default 0.
   */
  warScoreSharedBorderWeight?: number;

  /**
   * Weight for military strength ratio in war score calculation.
   * Score contribution = weight * (ownMilitaryStrength / totalEnemyStrength).
   * totalEnemyStrength includes target plus current war enemies (weighted by border).
   * Default 0.
   */
  warScoreMilitaryStrengthWeight?: number;

  /**
   * Weight multiplier for non-reachable enemies in military strength calculation.
   * Enemies that can't reach us are less threatening (can't attack directly).
   * Value between 0-1; default 0.2 means non-reachable enemies count as 20% threat.
   */
  warScoreNonReachableEnemyWeight?: number;

  /**
   * Discount factor applied to the sum of co-belligerent contributions in the
   * military strength numerator. Value between 0-1; default 0.9 means
   * co-belligerents' effective contribution is multiplied by 0.9.
   */
  warScoreCoBelligerentDiscount?: number;

  /**
   * Penalty applied to war score if target is an ally.
   * Score contribution = -penalty (subtracted from total).
   * Default 0.
   */
  warScoreAllyPenalty?: number;

  /**
   * Weight for distance penalty when target is only reachable by boat.
   * Penalty = weight * (shoreDistance / sqrt(mapWidth * mapHeight))^2.
   * Higher values discourage attacking distant ocean targets.
   * Default 0.
   */
  warScoreDistancePenaltyWeight?: number;

  /**
   * Weight for dominance bonus when target is the strongest player in the game.
   * Only applies if the target has the highest military strength.
   * Score contribution = weight * gapPercent / (0.8 - targetShare), where:
   *   gapPercent = (targetStrength - secondHighestStrength) / secondHighestStrength
   *   targetShare = targetStrength / totalGameStrength
   * Encourages AI to gang up on runaway leaders. Default 0.
   */
  warScoreDominanceWeight?: number;

  /**
   * Percentage of troops to send on boat attacks against AI/Human players.
   * Lower than land attacks since boats are riskier.
   * Default 0.1 (10%).
   */
  attackBoatTroopPercent?: number;

  /**
   * Gap below warDeclarationThreshold at which the AI will seek/accept peace.
   * Peace threshold = warDeclarationThreshold - peaceThresholdGap.
   * If a war score for an enemy falls below this threshold, the AI is willing
   * to make peace. Default 30.
   */
  peaceThresholdGap?: number;

  // === General ===
  /**
   * Discount factor applied to future rewards when evaluating decisions.
   * Lower values make the AI more short-sighted; higher values make it
   * plan further ahead. Default 0.1.
   */
  discountFactor?: number;
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

export function getAllAIProfiles(): AIProfile[] {
  return [...aiProfiles];
}
