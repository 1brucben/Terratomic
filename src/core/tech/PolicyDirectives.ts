/**
 * Policy Directives are optional player choices that unlock when certain techs are researched.
 * Each directive offers a choice between two or more policy options, each with distinct effects.
 */

import { RESEARCH_TECH_IDS } from "./TechIds";

// Policy directive identifiers
export const POLICY_DIRECTIVE_IDS = {
  INDUSTRIAL_DEVELOPMENT_STRATEGY: "policy_industrial_development",
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
  // Multiplier for gold income (e.g., 1.07 = +7%)
  incomeMul?: number;
  // Multiplier for construction speed (e.g., 1.03 = +3% faster)
  constructionSpeedMul?: number;
  // Multiplier for maintenance cost reduction (e.g., 0.93 = -7% maintenance)
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
        description: "+7% gold income, +3% construction speed",
        effects: {
          incomeMul: 1.07,
          constructionSpeedMul: 1.03,
        },
      },
      {
        id: "consumer_industry",
        name: "Consumer Industry Priority",
        description: "+3% gold income", // TODO: +7% maintenance cost reduction when maintenance is implemented
        effects: {
          incomeMul: 1.03,
          // TODO: maintenanceCostMul: 0.93, // 7% reduction
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
