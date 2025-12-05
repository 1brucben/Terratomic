export type Category = "Land" | "Sea" | "Air" | "Nuclear" | "Economy";

/**
 * Core tech node for tree structure - metadata (name, description) is in TechEffects.ts
 */
export interface TechNode {
  id: string;
  category: Category;
  level: number; // 1..5 top to bottom
  requiresAllOf?: string[]; // all these must be researched
  requiresOneOf?: string[]; // at least one of these researched
  cost: number; // beakers to complete
}

export const TECH_COST_DEFAULT = 10000;
export function costForLevel(level: number): number {
  // Level-based cost: L1=10000, L2=20000, ...
  return Math.max(1, level) * TECH_COST_DEFAULT;
}

// Central research tech tree definition used by both client and server.
// Keep aligned with any UI representation.
const mkId = (cat: Category, lvl: number) => `${cat}-${lvl}`;

const baseLevels: TechNode[] = (() => {
  const nodes: TechNode[] = [];
  // All categories now have explicit definitions
  return nodes;
})();

// Nuclear branch techs (explicit definitions)
const nuclearTechs: TechNode[] = [
  { id: "Nuclear-1", category: "Nuclear", level: 1, cost: costForLevel(1) },
  {
    id: "Nuclear-2",
    category: "Nuclear",
    level: 2,
    requiresAllOf: ["Nuclear-1"],
    cost: costForLevel(2),
  },
  {
    id: "Nuclear-3",
    category: "Nuclear",
    level: 3,
    requiresAllOf: ["Nuclear-2"],
    cost: costForLevel(3),
  },
  {
    id: "Nuclear-4",
    category: "Nuclear",
    level: 4,
    requiresAllOf: ["Nuclear-3"],
    cost: costForLevel(4),
  },
];

// Sea branch techs (explicit definitions)
const seaTechs: TechNode[] = [
  // Level 1 - Two parallel starting techs
  { id: "Sea-0", category: "Sea", level: 1, cost: costForLevel(1) },
  { id: "Sea-1", category: "Sea", level: 1, cost: costForLevel(1) },
  // Level 2
  {
    id: "Sea-2A",
    category: "Sea",
    level: 2,
    requiresAllOf: ["Sea-0"],
    cost: costForLevel(2),
  },
  {
    id: "Sea-2B",
    category: "Sea",
    level: 2,
    requiresAllOf: ["Sea-1"],
    cost: costForLevel(2),
  },
  {
    id: "Sea-2C",
    category: "Sea",
    level: 2,
    requiresAllOf: ["Sea-1"],
    cost: costForLevel(2),
  },
  // Level 3
  {
    id: "Sea-3A",
    category: "Sea",
    level: 3,
    requiresAllOf: ["Sea-2A"],
    cost: costForLevel(3),
  },
  {
    id: "Sea-3B",
    category: "Sea",
    level: 3,
    requiresAllOf: ["Sea-2B"],
    cost: costForLevel(3),
  },
  {
    id: "Sea-3C",
    category: "Sea",
    level: 3,
    requiresAllOf: ["Sea-2A"],
    cost: costForLevel(3),
  },
  // Level 4
  {
    id: "Sea-4A",
    category: "Sea",
    level: 4,
    requiresAllOf: ["Sea-3A"],
    cost: costForLevel(4),
  },
  {
    id: "Sea-4B",
    category: "Sea",
    level: 4,
    requiresAllOf: ["Sea-3B"],
    cost: costForLevel(4),
  },
];

// Land branch techs (explicit definitions)
const landTechs: TechNode[] = [
  // Level 1 - Post-WW2 Modernization (unlocks Military Academy)
  { id: "Land-1", category: "Land", level: 1, cost: costForLevel(1) },
  // Level 2 - Two parallel paths
  {
    id: "Land-2A",
    category: "Land",
    level: 2,
    requiresAllOf: ["Land-1"],
    cost: costForLevel(2),
  },
  {
    id: "Land-2B",
    category: "Land",
    level: 2,
    requiresAllOf: ["Land-1"],
    cost: costForLevel(2),
  },
  // Level 3 - Each follows its own path
  {
    id: "Land-3A",
    category: "Land",
    level: 3,
    requiresAllOf: ["Land-2A"],
    cost: costForLevel(3),
  },
  {
    id: "Land-3B",
    category: "Land",
    level: 3,
    requiresAllOf: ["Land-2B"],
    cost: costForLevel(3),
  },
  // Level 4 - Each follows its own path
  {
    id: "Land-4A",
    category: "Land",
    level: 4,
    requiresAllOf: ["Land-3A"],
    cost: costForLevel(4),
  },
  {
    id: "Land-4B",
    category: "Land",
    level: 4,
    requiresAllOf: ["Land-3B"],
    cost: costForLevel(4),
  },
];

// Parallel/branching techs as per current UI
const extras: TechNode[] = [
  // Air tech tree - Level 1
  { id: "Air-0", category: "Air", level: 1, cost: costForLevel(1) },
  // Air tech tree - Level 2 (three techs)
  {
    id: "Air-2A",
    category: "Air",
    level: 2,
    requiresAllOf: ["Air-0"],
    cost: costForLevel(2),
  },
  {
    id: "Air-2B",
    category: "Air",
    level: 2,
    requiresAllOf: ["Air-0"],
    cost: costForLevel(2),
  },
  {
    id: "Air-2C",
    category: "Air",
    level: 2,
    requiresAllOf: ["Air-0"],
    cost: costForLevel(2),
  },
  // Air tech tree - Level 3 (three techs)
  {
    id: "Air-3A",
    category: "Air",
    level: 3,
    requiresAllOf: ["Air-2A"],
    cost: costForLevel(3),
  },
  {
    id: "Air-3B",
    category: "Air",
    level: 3,
    requiresAllOf: ["Air-2A"],
    cost: costForLevel(3),
  },
  {
    id: "Air-3C",
    category: "Air",
    level: 3,
    requiresAllOf: ["Air-2B"],
    cost: costForLevel(3),
  },
  // Air tech tree - Level 4 (two techs)
  {
    id: "Air-4A",
    category: "Air",
    level: 4,
    requiresAllOf: ["Air-3A"],
    cost: costForLevel(4),
  },
  {
    id: "Air-4B",
    category: "Air",
    level: 4,
    requiresAllOf: ["Air-3C"],
    cost: costForLevel(4),
  },
];

// Economy branch techs (explicit definitions)
const economyTechs: TechNode[] = [
  // Level 1 - National Reconstruction Program (enables roads)
  { id: "Economy-1", category: "Economy", level: 1, cost: costForLevel(1) },
  // Level 2 - Two parallel paths
  {
    id: "Economy-2A",
    category: "Economy",
    level: 2,
    requiresAllOf: ["Economy-1"],
    cost: costForLevel(2),
  },
  {
    id: "Economy-2B",
    category: "Economy",
    level: 2,
    requiresAllOf: ["Economy-1"],
    cost: costForLevel(2),
  },
  // Level 3 - Each follows its own path
  {
    id: "Economy-3A",
    category: "Economy",
    level: 3,
    requiresAllOf: ["Economy-2A"],
    cost: costForLevel(3),
  },
  {
    id: "Economy-3B",
    category: "Economy",
    level: 3,
    requiresAllOf: ["Economy-2B"],
    cost: costForLevel(3),
  },
  // Level 4 - Each follows its own path
  {
    id: "Economy-4A",
    category: "Economy",
    level: 4,
    requiresAllOf: ["Economy-3A"],
    cost: costForLevel(4),
  },
  {
    id: "Economy-4B",
    category: "Economy",
    level: 4,
    requiresAllOf: ["Economy-3B"],
    cost: costForLevel(4),
  },
];

// Compose full tree
const tree: TechNode[] = [
  ...baseLevels,
  ...nuclearTechs,
  ...seaTechs,
  ...landTechs,
  ...economyTechs,
  ...extras,
];

export function getTechNodes(): ReadonlyArray<TechNode> {
  return tree;
}

export function findTech(id: string): TechNode | undefined {
  return tree.find((t) => t.id === id);
}

export function isTechAvailable(
  id: string,
  researched: ReadonlySet<string>,
): boolean {
  const n = findTech(id);
  if (!n) return false;
  if (n.level === 1) return true;
  const sameCat = (p: string) => findTech(p)?.category === n.category;
  const reqAll = (n.requiresAllOf ?? []).filter(sameCat);
  const reqOne = (n.requiresOneOf ?? []).filter(sameCat);
  if (reqAll.length && !reqAll.every((p) => researched.has(p))) return false;
  if (reqOne.length && !reqOne.some((p) => researched.has(p))) return false;
  return true;
}

/**
 * Compute the aggregate research tech level as a weighted blend of:
 *  - current additive completion (1 + sum over levels of r_i / n_i), and
 *  - the highest researched level (highestLevel + 1).
 * Specifically: 0.8 * additive + 0.2 * (highestLevel + 1).
 * This yields a value in [1, L+1], where L is the highest level in the tree.
 */
export function computeResearchLevel(
  researchedInput: ReadonlySet<string> | readonly string[],
  nodes: ReadonlyArray<TechNode> = getTechNodes(),
): number {
  const researched = Array.isArray(researchedInput)
    ? new Set(researchedInput)
    : (researchedInput as ReadonlySet<string>);
  if (nodes.length === 0) return 0;

  // Determine level bounds dynamically from the tech tree
  let L = 0;
  for (const n of nodes) if (n.level > L) L = n.level;
  if (L <= 0) return 0;

  // Precompute total counts per level and researched counts per level
  const totalPerLevel: number[] = Array(L + 1).fill(0); // 1..L used
  const researchedPerLevel: number[] = Array(L + 1).fill(0);
  for (const n of nodes) {
    totalPerLevel[n.level]++;
    if (researched.has(n.id)) researchedPerLevel[n.level]++;
  }

  // Sum per-level completion across 1..L and add 1
  let additive = 0;
  for (let lvl = 1; lvl <= L; lvl++) {
    const total = totalPerLevel[lvl];
    if (total <= 0) continue; // skip empty levels if any
    const ratio = researchedPerLevel[lvl] / total;
    const p = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
    additive += p;
  }
  const currentValue = additive + 1;

  // Find highest researched level among researched nodes
  let highestLevel = 0;
  for (let lvl = 1; lvl <= L; lvl++) {
    if (researchedPerLevel[lvl] > 0) highestLevel = Math.max(highestLevel, lvl);
  }
  const highestPlusOne = highestLevel + 1;

  // Weighted average
  const result = 0.8 * currentValue + 0.2 * highestPlusOne;
  // Clamp defensively to [1, L+1]
  const clamped = Math.max(1, Math.min(L + 1, result));
  return Number.isFinite(clamped) ? clamped : 0;
}
