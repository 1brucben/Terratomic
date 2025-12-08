import { Gold, UnitType } from "./Game";

/**
 * Hardcoded unit upgrade data for combat units.
 * These upgrades apply to: Bomber, Fighter, Submarine, Warship.
 *
 * Each level specifies:
 * - cost: The TOTAL gold cost to build/upgrade to this level (not incremental).
 * - maintenance: Gold cost per tick to maintain this unit (for future use).
 * - maxHealth: The maximum health at this level.
 * - damageMin: Minimum damage dealt per attack.
 * - damageMax: Maximum damage dealt per attack.
 *
 * Additional unit-specific bonuses can be added per level.
 */

/** Single level upgrade data */
export interface UnitLevelData {
  /** Total gold cost to build a unit at this level */
  cost: Gold;
  /** Maintenance cost per tick (for future use) */
  maintenance: Gold;
  /** Maximum health at this level */
  maxHealth: number;
  /** Minimum damage per attack */
  damageMin: number;
  /** Maximum damage per attack */
  damageMax: number;
}

/** Extended bomber level data with bomber-specific stats */
export interface BomberLevelData extends UnitLevelData {
  /** Target acquisition range at this level */
  targetRange: number;
  /** Movement speed at this level */
  speed: number;
}

/** Fighter level data (uses base UnitLevelData, no additional stats) */
export type FighterLevelData = UnitLevelData;

/** Warship level data (uses base UnitLevelData, no additional stats) */
export type WarshipLevelData = UnitLevelData;

/** Submarine level data (uses base UnitLevelData, no additional stats) */
export type SubmarineLevelData = UnitLevelData;

// ============================================================================
// BOMBER UPGRADES (3 levels)
// Bombers have no base cost (spawned from airfields)
// ============================================================================

export const BOMBER_UPGRADES: readonly BomberLevelData[] = [
  // Level 1 (base)
  {
    cost: 0n,
    maintenance: 0n,
    maxHealth: 500,
    damageMin: 250,
    damageMax: 250,
    targetRange: 250,
    speed: 2,
  },
  // Level 2
  {
    cost: 200_000n,
    maintenance: 0n,
    maxHealth: 600,
    damageMin: 300,
    damageMax: 300,
    targetRange: 350,
    speed: 3,
  },
  // Level 3
  {
    cost: 400_000n,
    maintenance: 0n,
    maxHealth: 700,
    damageMin: 350,
    damageMax: 350,
    targetRange: 450,
    speed: 4,
  },
] as const;

// ============================================================================
// FIGHTER JET UPGRADES (4 levels)
// Base cost: 500,000
// ============================================================================

export const FIGHTER_UPGRADES: readonly FighterLevelData[] = [
  // Level 1 (base)
  {
    cost: 500_000n,
    maintenance: 0n,
    maxHealth: 750,
    damageMin: 200,
    damageMax: 325,
  },
  // Level 2
  {
    cost: 600_000n,
    maintenance: 0n,
    maxHealth: 1000,
    damageMin: 300,
    damageMax: 425,
  },
  // Level 3
  {
    cost: 700_000n,
    maintenance: 0n,
    maxHealth: 1250,
    damageMin: 400,
    damageMax: 525,
  },
  // Level 4
  {
    cost: 800_000n,
    maintenance: 0n,
    maxHealth: 1500,
    damageMin: 500,
    damageMax: 625,
  },
] as const;

// ============================================================================
// WARSHIP UPGRADES (3 levels)
// Base cost: 500,000
// ============================================================================

export const WARSHIP_UPGRADES: readonly WarshipLevelData[] = [
  // Level 1 (base)
  {
    cost: 500_000n,
    maintenance: 0n,
    maxHealth: 1000,
    damageMin: 200,
    damageMax: 325,
  },
  // Level 2
  {
    cost: 600_000n,
    maintenance: 0n,
    maxHealth: 1250,
    damageMin: 270,
    damageMax: 395,
  },
  // Level 3
  {
    cost: 700_000n,
    maintenance: 0n,
    maxHealth: 1500,
    damageMin: 340,
    damageMax: 465,
  },
] as const;

// ============================================================================
// SUBMARINE UPGRADES (3 levels)
// Base cost: 500,000
// ============================================================================

export const SUBMARINE_UPGRADES: readonly SubmarineLevelData[] = [
  // Level 1 (base)
  {
    cost: 500_000n,
    maintenance: 0n,
    maxHealth: 1000,
    damageMin: 200,
    damageMax: 325,
  },
  // Level 2
  {
    cost: 600_000n,
    maintenance: 0n,
    maxHealth: 1250,
    damageMin: 270,
    damageMax: 395,
  },
  // Level 3
  {
    cost: 700_000n,
    maintenance: 0n,
    maxHealth: 1500,
    damageMin: 340,
    damageMax: 465,
  },
] as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the upgrade data array for a given unit type.
 * Returns undefined for non-upgradeable units.
 */
export function getUnitUpgradeData(
  type: UnitType,
): readonly UnitLevelData[] | undefined {
  switch (type) {
    case UnitType.Bomber:
      return BOMBER_UPGRADES;
    case UnitType.FighterJet:
      return FIGHTER_UPGRADES;
    case UnitType.Warship:
      return WARSHIP_UPGRADES;
    case UnitType.Submarine:
      return SUBMARINE_UPGRADES;
    default:
      return undefined;
  }
}

/**
 * Get upgrade data for a specific level (1-indexed).
 * Returns level 1 data if level is out of bounds.
 */
export function getUnitLevelData(
  type: UnitType,
  level: number,
): UnitLevelData | undefined {
  const upgrades = getUnitUpgradeData(type);
  if (!upgrades) return undefined;
  const idx = Math.max(0, Math.min(level - 1, upgrades.length - 1));
  return upgrades[idx];
}

/**
 * Get the total cost to build a unit at a specific level.
 * This is the full cost, not incremental.
 */
export function getUnitLevelCost(type: UnitType, level: number): Gold {
  const upgrades = getUnitUpgradeData(type);
  if (!upgrades) return 0n;
  const idx = Math.max(0, Math.min(level - 1, upgrades.length - 1));
  return upgrades[idx].cost;
}

/**
 * Get the cost to upgrade a unit from its current level to the next level.
 * Returns the difference between next level cost and current level cost.
 * Returns 0n if at max level or non-upgradeable.
 */
export function getUnitUpgradeCost(type: UnitType, fromLevel: number): Gold {
  const upgrades = getUnitUpgradeData(type);
  if (!upgrades) return 0n;
  const fromIdx = Math.max(0, Math.min(fromLevel - 1, upgrades.length - 1));
  const toIdx = fromIdx + 1;
  if (toIdx >= upgrades.length) return 0n;
  return upgrades[toIdx].cost - upgrades[fromIdx].cost;
}

/**
 * Get bomber-specific upgrade data.
 */
export function getBomberLevelData(level: number): BomberLevelData {
  const idx = Math.max(0, Math.min(level - 1, BOMBER_UPGRADES.length - 1));
  return BOMBER_UPGRADES[idx];
}

/**
 * Get fighter-specific upgrade data.
 */
export function getFighterLevelData(level: number): FighterLevelData {
  const idx = Math.max(0, Math.min(level - 1, FIGHTER_UPGRADES.length - 1));
  return FIGHTER_UPGRADES[idx];
}

/**
 * Get warship-specific upgrade data.
 */
export function getWarshipLevelData(level: number): WarshipLevelData {
  const idx = Math.max(0, Math.min(level - 1, WARSHIP_UPGRADES.length - 1));
  return WARSHIP_UPGRADES[idx];
}

/**
 * Get submarine-specific upgrade data.
 */
export function getSubmarineLevelData(level: number): SubmarineLevelData {
  const idx = Math.max(0, Math.min(level - 1, SUBMARINE_UPGRADES.length - 1));
  return SUBMARINE_UPGRADES[idx];
}
