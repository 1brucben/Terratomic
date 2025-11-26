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
    // Nuclear, Air, Sea, and Land techs are defined separately as explicit nodes
    for (const cat of ["Economy"] as const) {
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

// Nuclear branch techs (explicit definitions)
const nuclearTechs: TechNode[] = [
  {
    id: "Nuclear-1",
    name:
      getTechMeta("Nuclear-1", { strict: false })?.name ?? "Nuclear Fission",
    category: "Nuclear",
    level: 1,
    description:
      getTechMeta("Nuclear-1", { strict: false })?.description ??
      "Enables: Atom Bomb",
    cost: costForLevel(1),
  },
  {
    id: "Nuclear-2",
    name:
      getTechMeta("Nuclear-2", { strict: false })?.name ??
      "Thermonuclear Staging",
    category: "Nuclear",
    level: 2,
    requiresAllOf: ["Nuclear-1"],
    description:
      getTechMeta("Nuclear-2", { strict: false })?.description ??
      "Enables: Hydrogen Bomb",
    cost: costForLevel(2),
  },
  {
    id: "Nuclear-3",
    name:
      getTechMeta("Nuclear-3", { strict: false })?.name ?? "MIRV Technology",
    category: "Nuclear",
    level: 3,
    requiresAllOf: ["Nuclear-2"],
    description:
      getTechMeta("Nuclear-3", { strict: false })?.description ??
      "Enables: MIRV",
    cost: costForLevel(3),
  },
  {
    id: "Nuclear-4",
    name:
      getTechMeta("Nuclear-4", { strict: false })?.name ?? "Doomsday Device",
    category: "Nuclear",
    level: 4,
    requiresAllOf: ["Nuclear-3"],
    description:
      getTechMeta("Nuclear-4", { strict: false })?.description ??
      "Enables: Doomsday Device",
    cost: costForLevel(4),
  },
];

// Sea branch techs (explicit definitions)
const seaTechs: TechNode[] = [
  // Level 1 - Two parallel starting techs
  {
    id: "Sea-0",
    name:
      getTechMeta("Sea-0", { strict: false })?.name ??
      "Early Cold War Cruisers",
    category: "Sea",
    level: 1,
    description:
      getTechMeta("Sea-0", { strict: false })?.description ??
      "Enables Level 1 Warships.",
    cost: costForLevel(1),
  },
  {
    id: "Sea-1",
    name:
      getTechMeta("Sea-1", { strict: false })?.name ?? "Diesel-Electric Subs",
    category: "Sea",
    level: 1,
    description:
      getTechMeta("Sea-1", { strict: false })?.description ??
      "Enables Level 1 Submarines.",
    cost: costForLevel(1),
  },
  // Level 2
  {
    id: "Sea-2A",
    name:
      getTechMeta("Sea-2A", { strict: false })?.name ??
      "First-Missile Cruisers",
    category: "Sea",
    level: 2,
    requiresAllOf: ["Sea-0"],
    description:
      getTechMeta("Sea-2A", { strict: false })?.description ??
      "Enables Level 2 Warships.",
    cost: costForLevel(2),
  },
  {
    id: "Sea-2B",
    name:
      getTechMeta("Sea-2B", { strict: false })?.name ??
      "Nuclear Attack Submarines",
    category: "Sea",
    level: 2,
    requiresAllOf: ["Sea-1"],
    description:
      getTechMeta("Sea-2B", { strict: false })?.description ??
      "Enables Level 2 Submarines.",
    cost: costForLevel(2),
  },
  {
    id: "Sea-2C",
    name:
      getTechMeta("Sea-2C", { strict: false })?.name ??
      "Ballistic Missile Submarines",
    category: "Sea",
    level: 2,
    requiresAllOf: ["Sea-1"],
    description:
      getTechMeta("Sea-2C", { strict: false })?.description ??
      "Allows Submarines to launch Atomic Bombs.",
    cost: costForLevel(2),
  },
  // Level 3
  {
    id: "Sea-3A",
    name:
      getTechMeta("Sea-3A", { strict: false })?.name ??
      "Advanced Missile Cruisers",
    category: "Sea",
    level: 3,
    requiresAllOf: ["Sea-2A"],
    description:
      getTechMeta("Sea-3A", { strict: false })?.description ??
      "Enables Level 3 Warships.",
    cost: costForLevel(3),
  },
  {
    id: "Sea-3B",
    name:
      getTechMeta("Sea-3B", { strict: false })?.name ??
      "Advanced Nuclear Attack Subs",
    category: "Sea",
    level: 3,
    requiresAllOf: ["Sea-2B"],
    description:
      getTechMeta("Sea-3B", { strict: false })?.description ??
      "Enables Level 3 Submarines.",
    cost: costForLevel(3),
  },
  {
    id: "Sea-3C",
    name: getTechMeta("Sea-3C", { strict: false })?.name ?? "Naval SAM Systems",
    category: "Sea",
    level: 3,
    requiresAllOf: ["Sea-2A"],
    description:
      getTechMeta("Sea-3C", { strict: false })?.description ??
      "Equips Warships with anti-air missile systems.",
    cost: costForLevel(3),
  },
  // Level 4
  {
    id: "Sea-4A",
    name:
      getTechMeta("Sea-4A", { strict: false })?.name ?? "Aegis Warship Systems",
    category: "Sea",
    level: 4,
    requiresAllOf: ["Sea-3A"],
    description:
      getTechMeta("Sea-4A", { strict: false })?.description ??
      "Advanced integrated naval weapons systems.",
    cost: costForLevel(4),
  },
  {
    id: "Sea-4B",
    name:
      getTechMeta("Sea-4B", { strict: false })?.name ??
      "Quieting and Acoustic Stealth",
    category: "Sea",
    level: 4,
    requiresAllOf: ["Sea-3B"],
    description:
      getTechMeta("Sea-4B", { strict: false })?.description ??
      "Advanced submarine stealth technology.",
    cost: costForLevel(4),
  },
];

// Land branch techs (explicit definitions)
const landTechs: TechNode[] = [
  // Level 1
  {
    id: "Land-1",
    name:
      getTechMeta("Land-1", { strict: false })?.name ?? "WWII Lessons Learned",
    category: "Land",
    level: 1,
    description:
      getTechMeta("Land-1", { strict: false })?.description ??
      "Enables Military Academy. Defensive combat bonuses.",
    cost: costForLevel(1),
  },
  // Level 2 - Three parallel techs, all require Land-1
  {
    id: "Land-2A",
    name:
      getTechMeta("Land-2A", { strict: false })?.name ?? "Early Mechanization",
    category: "Land",
    level: 2,
    requiresAllOf: ["Land-1"],
    description:
      getTechMeta("Land-2A", { strict: false })?.description ??
      "Introduce mechanized infantry and motorized transport.",
    cost: costForLevel(2),
  },
  {
    id: "Land-2B",
    name:
      getTechMeta("Land-2B", { strict: false })?.name ??
      "Improved Artillery Systems",
    category: "Land",
    level: 2,
    requiresAllOf: ["Land-1"],
    description:
      getTechMeta("Land-2B", { strict: false })?.description ??
      "More accurate and powerful artillery with improved range.",
    cost: costForLevel(2),
  },
  {
    id: "Land-2C",
    name:
      getTechMeta("Land-2C", { strict: false })?.name ??
      "Integrated Logistics Corps",
    category: "Land",
    level: 2,
    requiresAllOf: ["Land-1"],
    description:
      getTechMeta("Land-2C", { strict: false })?.description ??
      "Unified supply chains for efficient resource distribution.",
    cost: costForLevel(2),
  },
  // Level 3 - Three techs, each requires any one of the Level 2 techs
  {
    id: "Land-3A",
    name:
      getTechMeta("Land-3A", { strict: false })?.name ??
      "Main Battle Tank Standardization",
    category: "Land",
    level: 3,
    requiresOneOf: ["Land-2A", "Land-2B", "Land-2C"],
    description:
      getTechMeta("Land-3A", { strict: false })?.description ??
      "Standardized tank designs for improved coordination.",
    cost: costForLevel(3),
  },
  {
    id: "Land-3B",
    name:
      getTechMeta("Land-3B", { strict: false })?.name ??
      "Composite Armor & HEAT Munitions",
    category: "Land",
    level: 3,
    requiresOneOf: ["Land-2A", "Land-2B", "Land-2C"],
    description:
      getTechMeta("Land-3B", { strict: false })?.description ??
      "Advanced armor materials and anti-tank warheads.",
    cost: costForLevel(3),
  },
  {
    id: "Land-3C",
    name:
      getTechMeta("Land-3C", { strict: false })?.name ??
      "Self-Propelled Artillery",
    category: "Land",
    level: 3,
    requiresOneOf: ["Land-2A", "Land-2B", "Land-2C"],
    description:
      getTechMeta("Land-3C", { strict: false })?.description ??
      "Mobile artillery platforms for rapid deployment.",
    cost: costForLevel(3),
  },
  // Level 4 - Three techs, each requires any one of the Level 3 techs
  {
    id: "Land-4A",
    name:
      getTechMeta("Land-4A", { strict: false })?.name ??
      "Night Vision & Battlefield Sensors",
    category: "Land",
    level: 4,
    requiresOneOf: ["Land-3A", "Land-3B", "Land-3C"],
    description:
      getTechMeta("Land-4A", { strict: false })?.description ??
      "Infrared and thermal imaging for 24-hour combat.",
    cost: costForLevel(4),
  },
  {
    id: "Land-4B",
    name:
      getTechMeta("Land-4B", { strict: false })?.name ??
      "Precision-Guided Munitions (Land)",
    category: "Land",
    level: 4,
    requiresOneOf: ["Land-3A", "Land-3B", "Land-3C"],
    description:
      getTechMeta("Land-4B", { strict: false })?.description ??
      "Laser and GPS-guided munitions for pinpoint accuracy.",
    cost: costForLevel(4),
  },
  {
    id: "Land-4C",
    name: getTechMeta("Land-4C", { strict: false })?.name ?? "C3I Systems",
    category: "Land",
    level: 4,
    requiresOneOf: ["Land-3A", "Land-3B", "Land-3C"],
    description:
      getTechMeta("Land-4C", { strict: false })?.description ??
      "Command, Control, Communications, and Intelligence systems.",
    cost: costForLevel(4),
  },
];

// Parallel/branching techs as per current UI
const extras: TechNode[] = [
  // Air tech tree - Level 1 (two parallel starting techs)
  {
    id: "Air-0",
    name: getTechMeta("Air-0", { strict: false })?.name ?? "Jet Engines",
    category: "Air",
    level: 1,
    description:
      getTechMeta("Air-0", { strict: false })?.description ??
      "Enables: Fighters, Bombers, Airfields",
    cost: costForLevel(1),
  },
  {
    id: "Air-1",
    name: getTechMeta("Air-1", { strict: false })?.name ?? "Anti-Air Guns",
    category: "Air",
    level: 1,
    description:
      getTechMeta("Air-1", { strict: false })?.description ??
      "Allows cities to defend themselves against aerial threats.",
    cost: costForLevel(1),
  },
  // Air tech tree - Level 2 (four techs)
  {
    id: "Air-2A",
    name: getTechMeta("Air-2A", { strict: false })?.name ?? "Supersonic Flight",
    category: "Air",
    level: 2,
    requiresAllOf: ["Air-0"],
    description:
      getTechMeta("Air-2A", { strict: false })?.description ??
      "Equips Fighter Jets with advanced targeting systems to engage enemy naval units.",
    cost: costForLevel(2),
  },
  {
    id: "Air-2B",
    name: getTechMeta("Air-2B", { strict: false })?.name ?? "Turbojet Bombers",
    category: "Air",
    level: 2,
    requiresAllOf: ["Air-0"],
    description:
      getTechMeta("Air-2B", { strict: false })?.description ??
      "Advanced bomber technology improving bomber effectiveness and capabilities.",
    cost: costForLevel(2),
  },
  {
    id: "Air-2C",
    name:
      getTechMeta("Air-2C", { strict: false })?.name ?? "Airborne Operations",
    category: "Air",
    level: 2,
    requiresAllOf: ["Air-0"],
    description:
      getTechMeta("Air-2C", { strict: false })?.description ??
      "Unlocks Paratroopers, allowing you to launch surprise attacks from the sky.",
    cost: costForLevel(2),
  },
  {
    id: "Air-2D",
    name:
      getTechMeta("Air-2D", { strict: false })?.name ??
      "Surface-to-Air Missiles",
    category: "Air",
    level: 2,
    requiresAllOf: ["Air-1"],
    description:
      getTechMeta("Air-2D", { strict: false })?.description ??
      "Advanced SAM technology for enhanced air defense capabilities.",
    cost: costForLevel(2),
  },
  // Air tech tree - Level 3 (four techs)
  {
    id: "Air-3A",
    name:
      getTechMeta("Air-3A", { strict: false })?.name ?? "Pulse-Doppler Radar",
    category: "Air",
    level: 3,
    requiresAllOf: ["Air-2A"],
    description:
      getTechMeta("Air-3A", { strict: false })?.description ??
      "Advanced radar technology for improved aircraft detection and tracking.",
    cost: costForLevel(3),
  },
  {
    id: "Air-3B",
    name:
      getTechMeta("Air-3B", { strict: false })?.name ??
      "Naval Strike Targeting",
    category: "Air",
    level: 3,
    requiresAllOf: ["Air-2A"],
    description:
      getTechMeta("Air-3B", { strict: false })?.description ??
      "Precision targeting systems for anti-ship operations.",
    cost: costForLevel(3),
  },
  {
    id: "Air-3C",
    name:
      getTechMeta("Air-3C", { strict: false })?.name ?? "Supersonic Bombers",
    category: "Air",
    level: 3,
    requiresAllOf: ["Air-2B"],
    description:
      getTechMeta("Air-3C", { strict: false })?.description ??
      "High-speed bomber aircraft capable of evading enemy defenses.",
    cost: costForLevel(3),
  },
  {
    id: "Air-3D",
    name: getTechMeta("Air-3D", { strict: false })?.name ?? "Radar-Guided SAMs",
    category: "Air",
    level: 3,
    requiresAllOf: ["Air-2D"],
    description:
      getTechMeta("Air-3D", { strict: false })?.description ??
      "Advanced radar-guided surface-to-air missiles with improved accuracy.",
    cost: costForLevel(3),
  },
  // Air tech tree - Level 4 (three techs)
  {
    id: "Air-4A",
    name:
      getTechMeta("Air-4A", { strict: false })?.name ?? "Fly-By-Wire Systems",
    category: "Air",
    level: 4,
    requiresAllOf: ["Air-3A"],
    description:
      getTechMeta("Air-4A", { strict: false })?.description ??
      "Digital flight control systems for enhanced aircraft maneuverability and stability.",
    cost: costForLevel(4),
  },
  {
    id: "Air-4B",
    name:
      getTechMeta("Air-4B", { strict: false })?.name ??
      "Precision-Guided Munitions",
    category: "Air",
    level: 4,
    requiresAllOf: ["Air-3C"],
    description:
      getTechMeta("Air-4B", { strict: false })?.description ??
      "Smart bombs and missiles with pinpoint accuracy for strategic targets.",
    cost: costForLevel(4),
  },
  {
    id: "Air-4C",
    name:
      getTechMeta("Air-4C", { strict: false })?.name ?? "Strategic SAM Systems",
    category: "Air",
    level: 4,
    requiresAllOf: ["Air-3D"],
    description:
      getTechMeta("Air-4C", { strict: false })?.description ??
      "Long-range surface-to-air missile systems for area denial and strategic defense.",
    cost: costForLevel(4),
  },
  // Economy branch techs
  {
    id: "Economy-2B",
    name:
      getTechMeta("Economy-2B", { strict: false })?.name ?? "Urban Planning",
    category: "Economy",
    level: 2,
    requiresAllOf: ["Economy-1"],
    description:
      getTechMeta("Economy-2B", { strict: false })?.description ??
      "Increases maximum population capacity by 25%.",
    cost: costForLevel(2),
  },
  {
    id: "Economy-3B",
    name:
      getTechMeta("Economy-3B", { strict: false })?.name ?? "Scorched Earth",
    category: "Economy",
    level: 3,
    requiresAllOf: ["Economy-2"],
    description:
      getTechMeta("Economy-3B", { strict: false })?.description ??
      "Unlocks the Scorched Earth decision.",
    cost: costForLevel(3),
  },
];

// Compose full tree
const tree: TechNode[] = [
  ...baseLevels,
  ...nuclearTechs,
  ...seaTechs,
  ...landTechs,
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
