import { CityAAExecution } from "../execution/CityAAExecution";
import { Game, Player, UpgradeType } from "../game/Game";

// Central tech IDs for research tree items that have gameplay effects.
// Keep IDs aligned with ResearchTreeModal generation (e.g., "Land-1").
export const RESEARCH_TECH_IDS = {
  FIGHTER_JET_NAVAL_TARGETING: "Air-1",
  WARSHIP_ANTI_AIR: "Sea-1",
  WWII_LESSONS: "Land-1",
  URBAN_PLANNING: "Land-2",
  CITY_ANTI_AIR: "Air-2",
  SCORCHED_EARTH: "Land-2B",
  POST_WAR_RECONSTRUCTION: "Economy-1",
  INTERNATIONAL_TRADE: "Economy-2",
  STRUCTURE_INSURANCE: "Economy-3",
  AUTOMATION: "Economy-4",
  PARATROOPERS: "Air-2B",
  SUBMARINE_WARFARE: "Sea-2",
  NUCLEAR_SUBMARINES: "Sea-3",
} as const;

export interface TechMeta {
  name: string;
  description?: string;
}

export interface DefenseCasualtyModifiers {
  // Multiplier to apply to the attacker's troop loss when the defender is a player
  attackerLossMul: number;
  // Multiplier to apply to the defender's troop loss when the defender is a player
  defenderLossMul: number;
}

// Central registry shape for tech effects: on-complete side-effects and battle modifiers
export type TechEffect = {
  // Runs once when the tech is completed
  onComplete?: (player: Player, game: Game) => void;
  // Runs when the tech is revoked (e.g., via category reset)
  onRevoke?: (player: Player, game: Game) => void;
  // Applied each time casualty modifiers are computed while defending
  defense?: (mods: DefenseCasualtyModifiers) => void;
  // Applied each time casualty modifiers are computed while attacking
  attack?: (mods: DefenseCasualtyModifiers) => void;
};

export type TechDefinition = {
  meta: TechMeta;
  effects?: TechEffect;
};

// Unified registry containing both metadata and effects per tech
export const TECHS: Readonly<Record<string, TechDefinition>> = Object.freeze({
  [RESEARCH_TECH_IDS.WARSHIP_ANTI_AIR]: {
    meta: {
      name: "Warship Anti-Air",
      description:
        "Equips Warships with an anti-air (AA) missile system to engage nearby enemy aircraft (Bombers, Fighter Jets, Cargo Planes). Does not intercept nuclear missiles. Range: 60 tiles. Cooldown: 5.0 seconds. Hit Chance: 80% base.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.WarshipAntiAir)) {
          player.addUpgrade?.(UpgradeType.WarshipAntiAir);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.WarshipAntiAir)) {
          player.removeUpgrade?.(UpgradeType.WarshipAntiAir);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.WWII_LESSONS]: {
    meta: {
      name: "WWII Lessons Learned",
      description:
        "Doctrine refined by hard-won experience improves defensive readiness, logistics, and counter-attack planning. Effects: While defending, your troop losses are reduced by 10% and the attacker's troop losses are increased by 10%.",
    },
    effects: {
      defense: (mods) => {
        mods.attackerLossMul *= 1.1; // enemy (attacker) takes more losses
        mods.defenderLossMul *= 0.9; // defender takes fewer losses
      },
    },
  },
  [RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION]: {
    meta: {
      name: "Post-War Reconstruction",
      description:
        "Revitalize infrastructure and industry by mobilizing civilian labor and resources to rebuild the national economy. Effects: Unlocks Roads investment and enables construction/expansion of your road network.",
    },
    effects: {
      onComplete: (player, game) => {
        // Unlock Roads upgrade and trigger reconnection
        if (!player.hasUpgrade?.(UpgradeType.Roads)) {
          player.addUpgrade?.(UpgradeType.Roads);
          game.markPlayerNodesForReconnection?.(player);
        }
        if (player.hasUpgrade?.(UpgradeType.ScorchedEarth)) {
          player.removeUpgrade?.(UpgradeType.ScorchedEarth);
        }
      },
      onRevoke: (player, game) => {
        if (player.hasUpgrade?.(UpgradeType.Roads)) {
          player.removeUpgrade?.(UpgradeType.Roads);
          game.markPlayerNodesForReconnection?.(player);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.INTERNATIONAL_TRADE]: {
    meta: {
      name: "International Trade",
      description:
        "Establish formal trade agreements and routes with allied nations, enabling shared economic prosperity and strategic interdependence. Effects: Unlocks International Trade, allowing road connections to allied territories.",
    },
    effects: {
      onComplete: (player, game) => {
        if (!player.hasUpgrade?.(UpgradeType.InternationalTrade)) {
          player.addUpgrade?.(UpgradeType.InternationalTrade);
          game.markPlayerNodesForReconnection?.(player);
        }
      },
      onRevoke: (player, game) => {
        if (player.hasUpgrade?.(UpgradeType.InternationalTrade)) {
          player.removeUpgrade?.(UpgradeType.InternationalTrade);
          game.markPlayerNodesForReconnection?.(player);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.SCORCHED_EARTH]: {
    meta: {
      name: "Scorched Earth",
      description:
        "Unleash a scorched earth campaign: raze your road network and reset economic research to deny enemy logistics.",
    },
  },
  [RESEARCH_TECH_IDS.URBAN_PLANNING]: {
    meta: {
      name: "Urban Planning",
      description:
        "Revise zoning, utilities, and transport grids to support denser population hubs. Effects: Unlocks Urban Planning, increasing maximum population capacity by 25%.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.UrbanPlanning)) {
          player.addUpgrade?.(UpgradeType.UrbanPlanning);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.UrbanPlanning)) {
          player.removeUpgrade?.(UpgradeType.UrbanPlanning);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.CITY_ANTI_AIR]: {
    meta: {
      name: "City Anti-Air",
      description:
        "Allows cities to defend themselves against aerial threats with rapid-fire AA guns. Does not defend against MIRVs.",
    },
    effects: {
      onComplete: (player, game) => {
        if (!player.hasUpgrade?.(UpgradeType.CityAntiAir)) {
          player.addUpgrade?.(UpgradeType.CityAntiAir);
          // Start the city AA execution to fire bullets at planes
          game.addExecution(new CityAAExecution(player));
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.CityAntiAir)) {
          player.removeUpgrade?.(UpgradeType.CityAntiAir);
          // Note: CityAAExecution will deactivate itself when upgrade is removed
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.STRUCTURE_INSURANCE]: {
    meta: {
      name: "Structure Insurance",
      description:
        "Establish state-backed insurers to protect strategic structures. Effects: Unlocks Structure Insurance, refunding 33% of construction costs when self constructed buildings are lost.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.StructureInsurance)) {
          player.addUpgrade?.(UpgradeType.StructureInsurance);
        }
        try {
          const units = player.units?.() ?? [];
          for (const unit of units) {
            (unit as any).insure?.(player);
          }
        } catch {
          // Some player implementations may not expose units(); ignore.
        }
      },
      onRevoke: (player) => {
        try {
          const units = player.units?.() ?? [];
          for (const unit of units) {
            (unit as any).insure?.(null);
          }
        } catch {
          // ignore
        }
        if (player.hasUpgrade?.(UpgradeType.StructureInsurance)) {
          player.removeUpgrade?.(UpgradeType.StructureInsurance);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.AUTOMATION]: {
    meta: {
      name: "Automation",
      description:
        "Deploy advanced automation across industry to streamline logistics. Effects: Unlocks Automation, doubling domestic trade income while reducing troop regeneration by 20%.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.Automation)) {
          player.addUpgrade?.(UpgradeType.Automation);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.Automation)) {
          player.removeUpgrade?.(UpgradeType.Automation);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.FIGHTER_JET_NAVAL_TARGETING]: {
    meta: {
      name: "Fighter Anti-Ship",
      description:
        "Equips Fighter Jets with advanced targeting systems to engage and destroy enemy naval units (Warships, Transport Ships, Trade Ships).",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.FighterJetNavalTargeting)) {
          player.addUpgrade?.(UpgradeType.FighterJetNavalTargeting);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.FighterJetNavalTargeting)) {
          player.removeUpgrade?.(UpgradeType.FighterJetNavalTargeting);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.PARATROOPERS]: {
    meta: {
      name: "Paratroopers",
      description:
        "Unlocks Paratroopers, allowing you to launch surprise attacks from the sky. Requires an Airfield.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade(UpgradeType.AirUpgrade1)) {
          player.addUpgrade(UpgradeType.AirUpgrade1);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade(UpgradeType.AirUpgrade1)) {
          player.removeUpgrade(UpgradeType.AirUpgrade1);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.SUBMARINE_WARFARE]: {
    meta: {
      name: "Submarine Warfare",
      description: "Unlocks Submarines, which are invisible to most units.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.SubmarineResearch)) {
          player.addUpgrade?.(UpgradeType.SubmarineResearch);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.SubmarineResearch)) {
          player.removeUpgrade?.(UpgradeType.SubmarineResearch);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.NUCLEAR_SUBMARINES]: {
    meta: {
      name: "Nuclear Submarines",
      description: "Allows Submarines to launch Atomic Bombs.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.NuclearSubmarineResearch)) {
          player.addUpgrade?.(UpgradeType.NuclearSubmarineResearch);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.NuclearSubmarineResearch)) {
          player.removeUpgrade?.(UpgradeType.NuclearSubmarineResearch);
        }
      },
    },
  },
});
// Back-compat export for existing UI code: derive TECH_METADATA from TECHS
export const TECH_METADATA: Readonly<Record<string, TechMeta>> = Object.freeze(
  Object.fromEntries(Object.entries(TECHS).map(([id, def]) => [id, def.meta])),
);

// Helper accessors around TECHS for safe, typed consumption across the codebase
export type MissingBehavior = "throw" | "warn" | "silent";
export interface GetTechOptions {
  strict?: boolean; // when true, on missing -> throw
  onMissing?: MissingBehavior; // default: "warn" when strict=false
}

export function getTech(
  techId: string,
  opts: GetTechOptions = {},
): TechDefinition {
  const def = TECHS[techId];
  if (def) return def;
  const strict = opts.strict ?? false;
  const onMissing: MissingBehavior =
    opts.onMissing ?? (strict ? "throw" : "warn");
  const message = `[TechEffects] Unknown tech id: ${techId}`;
  if (strict || onMissing === "throw") {
    throw new Error(message);
  }
  // Return a stub definition to keep callers robust in non-strict mode
  return { meta: { name: techId } } satisfies TechDefinition;
}

export function getTechMeta(techId: string, opts?: GetTechOptions): TechMeta {
  return getTech(techId, opts).meta;
}

export function getTechEffects(
  techId: string,
  opts?: GetTechOptions,
): TechEffect | undefined {
  return getTech(techId, opts).effects;
}

export function listTechs(): Array<{ id: string; meta: TechMeta }> {
  return Object.entries(TECHS).map(([id, def]) => ({ id, meta: def.meta }));
}

export function forEachTech(
  fn: (id: string, def: TechDefinition) => void,
): void {
  for (const [id, def] of Object.entries(TECHS)) fn(id, def);
}

export function applyTechCompletionEffects(
  player: Player,
  game: Game,
  techId: string,
): void {
  const entry = TECHS[techId]?.effects;
  entry?.onComplete?.(player, game);
}

export function revokeTechEffects(
  player: Player,
  game: Game,
  techId: string,
): void {
  const entry = TECHS[techId]?.effects;
  entry?.onRevoke?.(player, game);
}

/**
 * Compute casualty multipliers when a player is defending, based on researched techs.
 * - attackerLossMul > 1 increases enemy losses
 * - defenderLossMul < 1 reduces own losses
 */
export function defenseCasualtyModifiers(
  defender: Player,
): DefenseCasualtyModifiers {
  const mods: DefenseCasualtyModifiers = {
    attackerLossMul: 1.0,
    defenderLossMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (defender.hasResearchedTech?.(techId)) {
      def.effects?.defense?.(mods);
    }
  }
  return mods;
}

/**
 * Compute casualty multipliers when a player is attacking, based on researched techs.
 * Returned multipliers stack multiplicatively with defender-side modifiers.
 * - attackerLossMul < 1 reduces own losses
 * - defenderLossMul > 1 increases enemy losses
 * Currently no attacker-side techs are defined; this is ready for future use.
 */
export function attackCasualtyModifiers(
  attacker: Player,
): DefenseCasualtyModifiers {
  const mods: DefenseCasualtyModifiers = {
    attackerLossMul: 1.0,
    defenderLossMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (attacker.hasResearchedTech?.(techId)) {
      def.effects?.attack?.(mods);
    }
  }
  return mods;
}
