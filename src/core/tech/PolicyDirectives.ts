/**
 * Policy Directives are optional player choices that unlock when certain techs are researched.
 * Each directive offers a choice between two or more policy options, each with distinct effects.
 */

import { RESEARCH_TECH_IDS } from "./TechIds";

// Policy directive identifiers
export const POLICY_DIRECTIVE_IDS = {
  NATIONAL_RESEARCH_INDUSTRIAL_FOUNDATIONS: "policy_research_industrial",
  TRADE_POLICY_FRAMEWORK: "policy_trade_policy",
  DIGITAL_ADMINISTRATION_SYSTEMS: "policy_digital_administration",
  MECHANIZED_WARFARE_DOCTRINE: "policy_mechanized_warfare",
  NIGHT_VISION_THERMAL_C3I: "policy_night_vision_thermal",
} as const;

export type PolicyDirectiveId =
  (typeof POLICY_DIRECTIVE_IDS)[keyof typeof POLICY_DIRECTIVE_IDS];

// Option identifiers within a directive
export type PolicyOptionId = string;

export interface PolicyOption {
  id: PolicyOptionId;
  name: string;
  description: string;
  effects: PolicyEffects;
}

export interface PolicyEffects {
  // Multiplier for construction speed (e.g., 1.03 = +3% faster)
  constructionSpeedMul?: number;
  // Multiplier for trade income from roads and trade ships (e.g., 1.05 = +5%)
  tradeIncomeMul?: number;
  // Multiplier for trade ship income specifically (stacks with tradeIncomeMul)
  tradeShipIncomeMul?: number;
  // Multiplier for domestic income (non-trade income from population/industry)
  domesticIncomeMul?: number;
  // If true, grants the InternationalTrade upgrade (enables international road/sea trade)
  grantsInternationalTrade?: boolean;
  // Multiplier for road effects (e.g., 1.2 = +20% stronger road bonuses)
  roadEffectMul?: number;
  // Multiplier for infrastructure spending effectiveness (e.g., 1.2 = +20% more roads per gold)
  infrastructureSpendingEffectivenessMul?: number;
  // Multiplier for research spending effectiveness (e.g., 1.3 = +30% research effectiveness)
  researchEffectivenessMul?: number;
  // Multiplier for attack speed (e.g., 1.1 = +10% faster offensive speed)
  attackSpeedMul?: number;
  // Multiplier for attacker losses when attacking (e.g., 0.9 = -10% losses)
  attackerLossMul?: number;
  // Multiplier for defender losses when defending (e.g., 0.9 = -10% losses)
  defenderLossMul?: number;
  // Multiplier for enemy (defender) losses when you attack (e.g., 1.1 = +10% enemy losses)
  enemyLossMulOnAttack?: number;
  // Multiplier for attacker (enemy) losses when you defend (e.g., 1.1 = +10% enemy losses when they attack you)
  attackerLossMulOnDefense?: number;
  // Multiplier for maintenance cost reduction (e.g., 0.90 = -10% maintenance)
  // TODO: Commented out until maintenance is implemented
  // maintenanceCostMul?: number;
}

export interface PolicyDirective {
  id: PolicyDirectiveId;
  name: string;
  description: string;
  // Tech that must be researched to unlock this directive
  unlockedByTech: string;
  // Available options to choose from
  options: PolicyOption[];
}

// Central registry of all policy directives
export const POLICY_DIRECTIVES: Readonly<
  Record<PolicyDirectiveId, PolicyDirective>
> = Object.freeze({
  [POLICY_DIRECTIVE_IDS.NATIONAL_RESEARCH_INDUSTRIAL_FOUNDATIONS]: {
    id: POLICY_DIRECTIVE_IDS.NATIONAL_RESEARCH_INDUSTRIAL_FOUNDATIONS,
    name: "National Research & Industrial Foundations",
    description:
      "Choose your nation's priority between industrial expansion and scientific institutions.",
    unlockedByTech: RESEARCH_TECH_IDS.NATIONAL_RESEARCH_INDUSTRIAL_FOUNDATIONS,
    options: [
      {
        id: "industrial_expansion",
        name: "Industrial Expansion Priority",
        description: "+5% domestic income, +20% construction speed",
        effects: {
          domesticIncomeMul: 1.05,
          constructionSpeedMul: 1.2,
        },
      },
      {
        id: "scientific_institution",
        name: "Scientific Institution Priority",
        description: "+30% research spending effectiveness",
        effects: {
          researchEffectivenessMul: 1.3,
        },
      },
    ],
  },
  [POLICY_DIRECTIVE_IDS.TRADE_POLICY_FRAMEWORK]: {
    id: POLICY_DIRECTIVE_IDS.TRADE_POLICY_FRAMEWORK,
    name: "Trade Policy Framework",
    description:
      "Choose your nation's approach to international commerce and trade relations.",
    unlockedByTech: RESEARCH_TECH_IDS.TRADE_POLICY_FRAMEWORK,
    options: [
      {
        id: "open_trade",
        name: "Open Trade Policy",
        description: "+5% trade income, +5% income from owned trade ships",
        effects: {
          grantsInternationalTrade: true,
          tradeIncomeMul: 1.05,
          tradeShipIncomeMul: 1.05,
        },
      },
      {
        id: "autarky",
        name: "Autarky Doctrine",
        description: "Disables international trade, +20% domestic income",
        effects: {
          domesticIncomeMul: 1.2,
        },
      },
    ],
  },
  [POLICY_DIRECTIVE_IDS.DIGITAL_ADMINISTRATION_SYSTEMS]: {
    id: POLICY_DIRECTIVE_IDS.DIGITAL_ADMINISTRATION_SYSTEMS,
    name: "Digital Administration & Economic Coordination Systems",
    description:
      "Choose your nation's approach to digital administration and economic coordination.",
    unlockedByTech: RESEARCH_TECH_IDS.DIGITAL_ADMINISTRATION_SYSTEMS,
    options: [
      {
        id: "market_optimization",
        name: "Market Optimization Systems",
        description: "+10% domestic income, -10% maintenance costs",
        effects: {
          domesticIncomeMul: 1.1,
          // TODO: maintenanceCostMul: 0.90, // 10% reduction when maintenance is implemented
        },
      },
      {
        id: "central_planning",
        name: "Central Planning Automation",
        description:
          "+5% domestic income, +20% infrastructure spending effectiveness, +10% construction speed",
        effects: {
          domesticIncomeMul: 1.05,
          infrastructureSpendingEffectivenessMul: 1.2,
          constructionSpeedMul: 1.1,
        },
      },
    ],
  },
  [POLICY_DIRECTIVE_IDS.MECHANIZED_WARFARE_DOCTRINE]: {
    id: POLICY_DIRECTIVE_IDS.MECHANIZED_WARFARE_DOCTRINE,
    name: "Mechanized Warfare Doctrine",
    description:
      "Choose your tactical doctrine emphasis for mechanized operations.",
    unlockedByTech: RESEARCH_TECH_IDS.MECHANIZED_WARFARE_DOCTRINE,
    options: [
      {
        id: "mobile_infantry",
        name: "Mobile Infantry Tactics",
        description:
          "-10% your losses when attacking, +10% enemy losses when they attack you",
        effects: {
          attackerLossMul: 0.9,
          attackerLossMulOnDefense: 1.1,
        },
      },
      {
        id: "armored_breakthrough",
        name: "Armored Breakthrough Doctrine",
        description:
          "+10% enemy losses when you attack, -10% your losses when defending",
        effects: {
          enemyLossMulOnAttack: 1.1,
          defenderLossMul: 0.9,
        },
      },
    ],
  },
  [POLICY_DIRECTIVE_IDS.NIGHT_VISION_THERMAL_C3I]: {
    id: POLICY_DIRECTIVE_IDS.NIGHT_VISION_THERMAL_C3I,
    name: "Night Vision, Thermal Imaging & Digital C3I",
    description:
      "Choose your night combat doctrine with thermal imaging and digital command systems.",
    unlockedByTech: RESEARCH_TECH_IDS.NIGHT_VISION_THERMAL_C3I,
    options: [
      {
        id: "high_tempo_maneuver",
        name: "High-Tempo Maneuver Warfare",
        description:
          "+10% enemy losses when you attack, -10% your losses when attacking",
        effects: {
          enemyLossMulOnAttack: 1.1,
          attackerLossMul: 0.9,
        },
      },
      {
        id: "precision_defensive",
        name: "Precision Defensive Fire Doctrine",
        description:
          "+10% enemy losses when they attack you, -10% your losses when defending",
        effects: {
          attackerLossMulOnDefense: 1.1,
          defenderLossMul: 0.9,
        },
      },
    ],
  },
});

/**
 * Get all policy directives.
 */
export function getAllPolicyDirectives(): PolicyDirective[] {
  return Object.values(POLICY_DIRECTIVES);
}

/**
 * Get a policy directive by ID.
 */
export function getPolicyDirective(
  id: PolicyDirectiveId,
): PolicyDirective | undefined {
  return POLICY_DIRECTIVES[id];
}

/**
 * Get policy directives unlocked by a specific tech.
 */
export function getDirectivesUnlockedByTech(techId: string): PolicyDirective[] {
  return Object.values(POLICY_DIRECTIVES).filter(
    (d) => d.unlockedByTech === techId,
  );
}

/**
 * Get a specific option from a directive.
 */
export function getPolicyOption(
  directiveId: PolicyDirectiveId,
  optionId: PolicyOptionId,
): PolicyOption | undefined {
  const directive = POLICY_DIRECTIVES[directiveId];
  return directive?.options.find((o) => o.id === optionId);
}

/**
 * Check if a player has unlocked a policy directive based on researched techs.
 */
export function isDirectiveUnlocked(
  directiveId: PolicyDirectiveId,
  hasResearchedTech: (techId: string) => boolean,
): boolean {
  const directive = POLICY_DIRECTIVES[directiveId];
  if (!directive) return false;
  return hasResearchedTech(directive.unlockedByTech);
}

/**
 * Get all directives that are unlocked based on researched techs.
 */
export function getUnlockedDirectives(
  hasResearchedTech: (techId: string) => boolean,
): PolicyDirective[] {
  return Object.values(POLICY_DIRECTIVES).filter((d) =>
    hasResearchedTech(d.unlockedByTech),
  );
}
