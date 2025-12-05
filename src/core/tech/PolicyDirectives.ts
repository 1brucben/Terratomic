/**
 * Policy Directives are optional player choices that unlock when certain techs are researched.
 * Each directive offers a choice between two or more policy options, each with distinct effects.
 */

import { RESEARCH_TECH_IDS } from "./TechIds";

// Policy directive identifiers
export const POLICY_DIRECTIVE_IDS = {
  INDUSTRIAL_DEVELOPMENT_STRATEGY: "policy_industrial_development",
  TRADE_POLICY_FRAMEWORK: "policy_trade_policy",
  INFRASTRUCTURE_PRIORITIZATION: "policy_infrastructure",
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
  [POLICY_DIRECTIVE_IDS.INDUSTRIAL_DEVELOPMENT_STRATEGY]: {
    id: POLICY_DIRECTIVE_IDS.INDUSTRIAL_DEVELOPMENT_STRATEGY,
    name: "Industrial Development Strategy",
    description:
      "Choose your nation's industrial priority to shape economic growth.",
    unlockedByTech: RESEARCH_TECH_IDS.INDUSTRIAL_DEVELOPMENT_STRATEGY,
    options: [
      {
        id: "heavy_industry",
        name: "Heavy Industry Priority",
        description: "+7% domestic income, +3% construction speed",
        effects: {
          domesticIncomeMul: 1.07,
          constructionSpeedMul: 1.03,
        },
      },
      {
        id: "consumer_industry",
        name: "Consumer Industry Priority",
        description: "+3% domestic income", // TODO: +7% maintenance cost reduction when maintenance is implemented
        effects: {
          domesticIncomeMul: 1.03,
          // TODO: maintenanceCostMul: 0.93, // 7% reduction
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
        description:
          "Enables international trade, +5% trade income, +5% trade ship income",
        effects: {
          grantsInternationalTrade: true,
          tradeIncomeMul: 1.05,
          tradeShipIncomeMul: 1.05,
        },
      },
      {
        id: "autarky",
        name: "Autarky Doctrine",
        description: "No international trade, +30% domestic income",
        effects: {
          domesticIncomeMul: 1.3,
        },
      },
    ],
  },
  [POLICY_DIRECTIVE_IDS.INFRASTRUCTURE_PRIORITIZATION]: {
    id: POLICY_DIRECTIVE_IDS.INFRASTRUCTURE_PRIORITIZATION,
    name: "Infrastructure Prioritization",
    description: "Choose your nation's infrastructure development focus.",
    unlockedByTech: RESEARCH_TECH_IDS.INFRASTRUCTURE_PRIORITIZATION,
    options: [
      {
        id: "transport_priority",
        name: "Transport Priority",
        description: "+20% stronger road effects",
        effects: {
          roadEffectMul: 1.2,
        },
      },
      {
        id: "utilities_energy",
        name: "Utilities & Energy Priority",
        description: "+10% construction speed", // TODO: -10% maintenance costs when maintenance is implemented
        effects: {
          constructionSpeedMul: 1.1,
          // TODO: maintenanceCostMul: 0.90, // 10% reduction
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
