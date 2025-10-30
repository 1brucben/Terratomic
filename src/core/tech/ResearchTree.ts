import { getTechMeta } from "./TechEffects";

export type Category = "Land" | "Sea" | "Air" | "Nuclear" | "Economy";

export interface TechNode {
  id: string;
  name: string;
  category: Category;
  level: number; // 1..5 top to bottom
  requiresAllOf?: string[]; // all these must be researched
  requiresOneOf?: string[]; // at least one of these researched
  description?: string; // Optional hover description
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
  for (let lvl = 1; lvl <= 5; lvl++) {
    for (const cat of ["Land", "Sea", "Air", "Nuclear", "Economy"] as const) {
      const id = mkId(cat, lvl);
      const meta = getTechMeta(id, { strict: false });
      const node: TechNode = {
        id,
        name: meta?.name ?? `${cat} Tech ${lvl}`,
        category: cat,
        level: lvl,
        description: meta?.description,
        requiresAllOf: lvl > 1 ? [mkId(cat, lvl - 1)] : undefined,
        cost: costForLevel(lvl),
      };
      nodes.push(node);
    }
  }
  return nodes;
})();

// Parallel/branching techs as per current UI
const extras: TechNode[] = [
  {
    id: "Land-2B",
    name: getTechMeta("Land-2B", { strict: false })?.name ?? "Scorched Earth",
    category: "Land",
    level: 2,
    requiresAllOf: ["Land-1"],
    description:
      getTechMeta("Land-2B", { strict: false })?.description ??
      "Unlocks the Scorched Earth decision, letting you raze roads and reset economic techs.",
    cost: costForLevel(2),
  },
  {
    id: "Air-2B",
    name: "Paratroopers",
    category: "Air",
    level: 2,
    requiresAllOf: ["Air-1"],
    description:
      "Unlocks Paratroopers, allowing you to launch surprise attacks from the sky. Requires an Airfield.",
    cost: costForLevel(2),
  },
  {
    id: "Sea-4B",
    name: getTechMeta("Sea-4B", { strict: false })?.name ?? "Sea Tech 4B",
    category: "Sea",
    level: 4,
    requiresAllOf: ["Sea-3"],
    description: getTechMeta("Sea-4B", { strict: false })?.description,
    cost: costForLevel(4),
  },
  {
    id: "Economy-3B",
    name:
      getTechMeta("Economy-3B", { strict: false })?.name ?? "Economy Tech 3B",
    category: "Economy",
    level: 3,
    requiresAllOf: ["Economy-2"],
    description: getTechMeta("Economy-3B", { strict: false })?.description,
    cost: costForLevel(3),
  },
];

// Compose full tree and tweak special prerequisites
const tree: TechNode[] = (() => {
  const t = [...baseLevels, ...extras];
  // Nuclear-5 requires Nuclear-4 only (remove cross-category remnants)
  const n5 = t.find((x) => x.id === "Nuclear-5");
  if (n5) n5.requiresAllOf = ["Nuclear-4"];
  // Sea-5 can require one of Sea-4 or Sea-4B
  const sea5 = t.find((x) => x.id === "Sea-5");
  if (sea5) {
    sea5.requiresAllOf = undefined;
    sea5.requiresOneOf = ["Sea-4", "Sea-4B"];
  }
  const air3 = t.find((x) => x.id === "Air-3");
  if (air3) {
    air3.requiresAllOf = undefined;
    air3.requiresOneOf = ["Air-2", "Air-2B"];
  }
  return t;
})();

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
