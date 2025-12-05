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

  // === Bot Attack Behavior ===
  /** Minimum troop ratio (troops / maxTroops) before attacking bots (0-1) */
  botAttackTroopThreshold?: number;
  /** Maximum distance (in tiles) to consider a bot target */
  botAttackMaxDistance?: number;
  /** Percent of own troops to use in bot attack (alpha) */
  botAttackOwnTroopPercent?: number;
  /** Multiplier of bot troops to cap attack size (beta) */
  botAttackEnemyTroopMultiplier?: number;
}

export interface AIProfile {
  id: string;
  name: string;
  params: AIBehaviorParams;
}

const aiProfiles: AIProfile[] = aiProfilesData.profiles;

export function getAIProfile(id: string): AIProfile | undefined {
  return aiProfiles.find((p) => p.id === id);
}
