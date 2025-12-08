import { CityAAExecution } from "../execution/CityAAExecution";
import { Game, Player, UpgradeType } from "../game/Game";
import {
  getAllPolicyDirectives,
  getPolicyOption,
  type PolicyDirectiveId,
} from "./PolicyDirectives";
import { RESEARCH_TECH_IDS } from "./TechIds";
// Re-export for backward compatibility with existing imports
export { RESEARCH_TECH_IDS } from "./TechIds";

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

export interface AttackSpeedModifiers {
  // Multiplier to apply to attack speed (tiles conquered per tick)
  speedMul: number;
}

export interface ConstructionSpeedModifiers {
  // Multiplier to apply to construction speed (higher = faster)
  speedMul: number;
}

export interface ResearchEffectivenessModifiers {
  // Multiplier to apply to research effectiveness (higher = faster research)
  effectivenessMul: number;
}

export interface IncomeModifiers {
  // Multiplier for domestic income (non-trade income from population/industry)
  domesticIncomeMul: number;
}

export interface InfrastructureEffectivenessModifiers {
  // Multiplier to apply to infrastructure spending effectiveness (higher = more roads per gold)
  effectivenessMul: number;
}

export interface TradeIncomeModifiers {
  // Multiplier to apply to trade income (from roads and trade ships)
  incomeMul: number;
  // Additional multiplier for trade ship income specifically (stacks with incomeMul)
  tradeShipIncomeMul: number;
}

export interface RoadEffectModifiers {
  // Multiplier to apply to road effects (higher = stronger road bonuses)
  effectMul: number;
}

// Central registry shape for tech effects: on-complete side-effects and battle modifiers
export type TechEffect = {
  // Runs once when the tech is completed
  onComplete?: (player: Player, game: Game) => void;
  // Applied each time casualty modifiers are computed while defending
  defense?: (mods: DefenseCasualtyModifiers) => void;
  // Applied each time casualty modifiers are computed while attacking
  attack?: (mods: DefenseCasualtyModifiers) => void;
  // Applied to modify offensive attack speed
  attackSpeed?: (mods: AttackSpeedModifiers) => void;
  // Applied to modify construction speed
  constructionSpeed?: (mods: ConstructionSpeedModifiers) => void;
  // Applied to modify research effectiveness
  researchEffectiveness?: (mods: ResearchEffectivenessModifiers) => void;
  // Applied to modify gross gold income
  income?: (mods: IncomeModifiers) => void;
  // Applied to modify infrastructure spending effectiveness
  infrastructureEffectiveness?: (
    mods: InfrastructureEffectivenessModifiers,
  ) => void;
  // Applied to modify trade income
  tradeIncome?: (mods: TradeIncomeModifiers) => void;
  // Applied to modify road effects (bonuses from roads)
  roadEffect?: (mods: RoadEffectModifiers) => void;
};

export type TechDefinition = {
  meta: TechMeta;
  effects?: TechEffect;
};

// Unified registry containing both metadata and effects per tech
export const TECHS: Readonly<Record<string, TechDefinition>> = Object.freeze({
  // Sea techs - Level 1: Early Missile Navy
  [RESEARCH_TECH_IDS.EARLY_MISSILE_NAVY]: {
    meta: {
      name: "Early Missile Navy",
      description:
        "Develop guided missile technology for naval warfare. Unlocks Warship Level 2, Submarine Level 2.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.WarshipLevel2)) {
          player.addUpgrade?.(UpgradeType.WarshipLevel2);
        }
        if (!player.hasUpgrade?.(UpgradeType.SubmarineLevel2)) {
          player.addUpgrade?.(UpgradeType.SubmarineLevel2);
        }
      },
    },
  },
  // Sea techs - Level 2: Submarine Silent Service Modernization
  [RESEARCH_TECH_IDS.SUBMARINE_SILENT_SERVICE]: {
    meta: {
      name: "Submarine Silent Service Modernization",
      description:
        "Advanced quieting and acoustic stealth for submarines. Unlocks Submarine Level 3.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.SubmarineLevel3)) {
          player.addUpgrade?.(UpgradeType.SubmarineLevel3);
        }
      },
    },
  },
  // Sea techs - Level 3: SSBN Programs
  [RESEARCH_TECH_IDS.SSBN_PROGRAMS]: {
    meta: {
      name: "SSBN Programs",
      description:
        "Ballistic missile submarine programs for strategic deterrence. Unlocks SSBNs (Submarines can launch nuclear weapons).",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.NuclearSubmarineResearch)) {
          player.addUpgrade?.(UpgradeType.NuclearSubmarineResearch);
        }
      },
    },
  },
  // Sea techs - Level 4: Modern Fleet Sensor & SAM Integration
  [RESEARCH_TECH_IDS.MODERN_FLEET_SENSOR_SAM]: {
    meta: {
      name: "Modern Fleet Sensor & SAM Integration",
      description:
        "Advanced sensor suites and integrated air defense systems for the fleet. Unlocks Warship Level 3, Ship SAM Systems.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.WarshipLevel3)) {
          player.addUpgrade?.(UpgradeType.WarshipLevel3);
        }
        if (!player.hasUpgrade?.(UpgradeType.WarshipAntiAir)) {
          player.addUpgrade?.(UpgradeType.WarshipAntiAir);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.POST_WW2_GROUND_FORCES_MODERNIZATION]: {
    meta: {
      name: "Post-WW2 Ground Forces Modernization",
      description:
        "Doctrine refined by hard-won experience improves offensive capabilities and tactical efficiency. Effects: Enables Military Academy, AA Guns. +5% offensive speed. Casualty Effects (20%): +10% enemy losses when you attack, -10% your losses when defending.",
    },
    effects: {
      onComplete: (player, game) => {
        if (!player.hasUpgrade?.(UpgradeType.MilitaryAcademy)) {
          player.addUpgrade?.(UpgradeType.MilitaryAcademy);
        }
        if (!player.hasUpgrade?.(UpgradeType.CityAntiAir)) {
          player.addUpgrade?.(UpgradeType.CityAntiAir);
          // Start the city AA execution to fire bullets at planes
          game.addExecution(new CityAAExecution(player));
        }
      },
      attack: (mods) => {
        mods.defenderLossMul *= 1.1; // enemy (defender) takes 10% more losses when we attack
      },
      defense: (mods) => {
        mods.defenderLossMul *= 0.9; // we take 10% less losses when defending
      },
      attackSpeed: (mods) => {
        mods.speedMul *= 1.05; // 5% faster offensive speed
      },
    },
  },
  [RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM]: {
    meta: {
      name: "National Reconstruction Program",
      description:
        "Revitalize infrastructure and industry by mobilizing civilian labor and resources to rebuild the national economy. Effects: Enables Roads, Hospitals. +20% infrastructure spending effectiveness, +20% stronger road effects.",
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
        // Unlock Hospitals
        if (!player.hasUpgrade?.(UpgradeType.HospitalResearch)) {
          player.addUpgrade?.(UpgradeType.HospitalResearch);
        }
      },
      infrastructureEffectiveness: (mods) => {
        mods.effectivenessMul *= 1.2; // +20% infrastructure spending effectiveness
      },
      roadEffect: (mods) => {
        mods.effectMul *= 1.2; // +20% stronger road effects
      },
    },
  },
  // Economy Level 2 tech - National Research & Industrial Foundations (1960s)
  [RESEARCH_TECH_IDS.NATIONAL_RESEARCH_INDUSTRIAL_FOUNDATIONS]: {
    meta: {
      name: "National Research & Industrial Foundations",
      description:
        "Establish national research institutions and industrial base. Effects: Enables Research Labs. Policy Directive: Industrial Expansion Priority (+5% domestic income, +20% construction speed) or Scientific Institution Priority (+30% research spending effectiveness).",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.ResearchLabResearch)) {
          player.addUpgrade?.(UpgradeType.ResearchLabResearch);
        }
      },
      // Policy directive effects are applied via getPolicyChoice
    },
  },
  // Economy Level 3 tech - Trade Policy Framework (1970s)
  [RESEARCH_TECH_IDS.TRADE_POLICY_FRAMEWORK]: {
    meta: {
      name: "Trade Policy Framework",
      description:
        "Establish trade agreements and commercial policies. Policy Directive: Open Trade Policy (+5% trade income, +5% trade ship income) or Autarky Doctrine (disables international trade, +20% domestic income).",
    },
    effects: {
      // Policy directive effects are applied via getPolicyChoice
    },
  },
  // Economy Level 4 tech - National Infrastructure Modernization (1980s)
  [RESEARCH_TECH_IDS.NATIONAL_INFRASTRUCTURE_MODERNIZATION]: {
    meta: {
      name: "National Infrastructure Modernization",
      description:
        "Modernize national infrastructure with advanced technology. Effects: +20% infrastructure spending effectiveness, -20% maintenance costs, +10% construction speed.",
    },
    effects: {
      infrastructureEffectiveness: (mods) => {
        mods.effectivenessMul *= 1.2; // +20% infrastructure spending effectiveness
      },
      constructionSpeed: (mods) => {
        mods.speedMul *= 1.1; // +10% construction speed
      },
      // TODO: -20% maintenance costs when maintenance is implemented
    },
  },
  // Economy Level 5 tech - Digital Administration & Economic Coordination Systems (Early 1990s)
  [RESEARCH_TECH_IDS.DIGITAL_ADMINISTRATION_SYSTEMS]: {
    meta: {
      name: "Digital Administration & Economic Coordination Systems",
      description:
        "Digital systems for administration and economic coordination. Policy Directive: Market Optimization Systems (+10% domestic income, -10% maintenance costs) or Central Planning Automation (+5% domestic income, +20% infrastructure spending effectiveness, +10% construction speed).",
    },
    effects: {
      // Policy directive effects are applied via getPolicyChoice
    },
  },
  // Land Level 2 tech - Mechanized Warfare Doctrine (1960s)
  [RESEARCH_TECH_IDS.MECHANIZED_WARFARE_DOCTRINE]: {
    meta: {
      name: "Mechanized Warfare Doctrine",
      description:
        "Develop doctrine for mechanized infantry and armored operations. Effects: Unlocks Scorched Earth. +5% offensive speed. Policy Directive (20%): Mobile Infantry Tactics (-10% your losses attacking, +10% enemy losses when they attack you) or Armored Breakthrough Doctrine (+10% enemy losses when you attack, -10% your losses when defending).",
    },
    effects: {
      attackSpeed: (mods) => {
        mods.speedMul *= 1.05; // 5% faster offensive speed
      },
      // Policy directive effects are applied via getPolicyChoice
    },
  },
  // Land Level 3 tech - Air-Defense Grid Expansion (1970s)
  [RESEARCH_TECH_IDS.AIR_DEFENSE_GRID_EXPANSION]: {
    meta: {
      name: "Air-Defense Grid Expansion",
      description:
        "Expand air defense networks with improved SAM coverage. Effects: Enables SAM Level 2. +5% offensive speed. Casualty Effects (20%): +15% enemy losses when they attack you, -5% your losses when defending.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.SAMLevel2)) {
          player.addUpgrade?.(UpgradeType.SAMLevel2);
        }
      },
      defense: (mods) => {
        mods.attackerLossMul *= 1.15; // enemy takes 15% more losses when they attack us
        mods.defenderLossMul *= 0.95; // we take 5% less losses when defending
      },
      attackSpeed: (mods) => {
        mods.speedMul *= 1.05; // 5% faster offensive speed
      },
    },
  },
  // Land Level 4 tech - Integrated SAM & Battlefield Command Systems (1980s)
  [RESEARCH_TECH_IDS.INTEGRATED_SAM_BATTLEFIELD_COMMAND]: {
    meta: {
      name: "Integrated SAM & Battlefield Command Systems",
      description:
        "Integrate SA-10, Patriot-era SAM platforms with C3I systems. Effects: Enables SAM Level 3. +5% offensive speed. Casualty Effects (20%): +10% enemy losses when they attack you, -10% your losses when attacking.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.SAMLevel3)) {
          player.addUpgrade?.(UpgradeType.SAMLevel3);
        }
      },
      defense: (mods) => {
        mods.attackerLossMul *= 1.1; // enemy takes 10% more losses when they attack us
      },
      attack: (mods) => {
        mods.attackerLossMul *= 0.9; // we take 10% less losses when attacking
      },
      attackSpeed: (mods) => {
        mods.speedMul *= 1.05; // 5% faster offensive speed
      },
    },
  },
  // Land Level 5 tech - Night Vision, Thermal Imaging & Digital C3I (Early 1990s)
  [RESEARCH_TECH_IDS.NIGHT_VISION_THERMAL_C3I]: {
    meta: {
      name: "Night Vision, Thermal Imaging & Digital C3I",
      description:
        "Equip forces with night vision, thermal imaging, and digital command systems for 24-hour combat capability. Effects: +5% offensive speed. Policy Directive (20%): High-Tempo Maneuver Warfare (+10% enemy losses when you attack, -10% your losses when attacking) or Precision Defensive Fire Doctrine (+10% enemy losses when they attack you, -10% your losses when defending).",
    },
    effects: {
      attackSpeed: (mods) => {
        mods.speedMul *= 1.05; // 5% faster offensive speed
      },
      // Policy directive effects are applied via getPolicyChoice
    },
  },
  // Air techs - Level 1: Early Jet Aviation Framework
  [RESEARCH_TECH_IDS.EARLY_JET_AVIATION_FRAMEWORK]: {
    meta: {
      name: "Early Jet Aviation Framework",
      description:
        "Establish jet aviation infrastructure and doctrine. Unlocks Paratroopers.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.AirUpgrade1)) {
          player.addUpgrade?.(UpgradeType.AirUpgrade1);
        }
      },
    },
  },
  // Air techs - Level 2: Supersonic Airframe Development
  [RESEARCH_TECH_IDS.SUPERSONIC_AIRFRAME_DEVELOPMENT]: {
    meta: {
      name: "Supersonic Airframe Development",
      description:
        "Develop supersonic aircraft designs. Unlocks Fighter Level 2, Bomber Level 2.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.FighterLevel2)) {
          player.addUpgrade?.(UpgradeType.FighterLevel2);
        }
        if (!player.hasUpgrade?.(UpgradeType.BomberLevel2)) {
          player.addUpgrade?.(UpgradeType.BomberLevel2);
        }
      },
    },
  },
  // Air techs - Level 3: Pulse-Doppler Radar & BVR Combat
  [RESEARCH_TECH_IDS.PULSE_DOPPLER_RADAR_BVR]: {
    meta: {
      name: "Pulse-Doppler Radar & BVR Combat",
      description:
        "Advanced radar and beyond-visual-range combat systems. Unlocks Fighter Level 3, Naval Strike Capability.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.FighterLevel3)) {
          player.addUpgrade?.(UpgradeType.FighterLevel3);
        }
        if (!player.hasUpgrade?.(UpgradeType.FighterJetNavalTargeting)) {
          player.addUpgrade?.(UpgradeType.FighterJetNavalTargeting);
        }
      },
    },
  },
  // Air techs - Level 4: Fly-By-Wire Platforms & Advanced Maneuverability
  [RESEARCH_TECH_IDS.FLY_BY_WIRE_PLATFORMS]: {
    meta: {
      name: "Fly-By-Wire Platforms & Advanced Maneuverability",
      description:
        "Digital flight control systems for maximum aircraft performance. Unlocks Fighter Level 4, Bomber Level 3.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.FighterLevel4)) {
          player.addUpgrade?.(UpgradeType.FighterLevel4);
        }
        if (!player.hasUpgrade?.(UpgradeType.BomberLevel3)) {
          player.addUpgrade?.(UpgradeType.BomberLevel3);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.NUCLEAR_FISSION]: {
    meta: {
      name: "Nuclear Fission",
      description: "Enables: Atom Bomb",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.NuclearFission)) {
          player.addUpgrade?.(UpgradeType.NuclearFission);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.THERMONUCLEAR_STAGING]: {
    meta: {
      name: "Thermonuclear Staging",
      description: "Enables: Hydrogen Bomb",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.ThermonuclearStaging)) {
          player.addUpgrade?.(UpgradeType.ThermonuclearStaging);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.MIRV_TECHNOLOGY]: {
    meta: {
      name: "MIRV Technology",
      description: "Enables: MIRV",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.MIRVTechnology)) {
          player.addUpgrade?.(UpgradeType.MIRVTechnology);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.DOOMSDAY_DEVICE]: {
    meta: {
      name: "Doomsday Device",
      description: "Enables: Doomsday Device",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.DoomsdayDeviceResearch)) {
          player.addUpgrade?.(UpgradeType.DoomsdayDeviceResearch);
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

/**
 * Compute casualty multipliers when a player is defending, based on researched techs and policy directives.
 * - attackerLossMul > 1 increases enemy losses
 * - defenderLossMul < 1 reduces own losses
 */
export function defenseCasualtyModifiers(defender: {
  hasResearchedTech?(techId: string): boolean;
  getPolicyChoice?(directiveId: string): string | null;
}): DefenseCasualtyModifiers {
  const mods: DefenseCasualtyModifiers = {
    attackerLossMul: 1.0,
    defenderLossMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (defender.hasResearchedTech?.(techId)) {
      def.effects?.defense?.(mods);
    }
  }
  // Apply policy directive effects
  for (const directive of getAllPolicyDirectives()) {
    const chosenOptionId = defender.getPolicyChoice?.(directive.id);
    if (chosenOptionId) {
      const option = getPolicyOption(
        directive.id as PolicyDirectiveId,
        chosenOptionId,
      );
      if (option?.effects.defenderLossMul) {
        mods.defenderLossMul *= option.effects.defenderLossMul;
      }
      if (option?.effects.attackerLossMulOnDefense) {
        mods.attackerLossMul *= option.effects.attackerLossMulOnDefense;
      }
    }
  }
  return mods;
}

/**
 * Compute casualty multipliers when a player is attacking, based on researched techs and policy directives.
 * Returned multipliers stack multiplicatively with defender-side modifiers.
 * - attackerLossMul < 1 reduces own losses
 * - defenderLossMul > 1 increases enemy losses
 */
export function attackCasualtyModifiers(attacker: {
  hasResearchedTech?(techId: string): boolean;
  getPolicyChoice?(directiveId: string): string | null;
}): DefenseCasualtyModifiers {
  const mods: DefenseCasualtyModifiers = {
    attackerLossMul: 1.0,
    defenderLossMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (attacker.hasResearchedTech?.(techId)) {
      def.effects?.attack?.(mods);
    }
  }
  // Apply policy directive effects
  for (const directive of getAllPolicyDirectives()) {
    const chosenOptionId = attacker.getPolicyChoice?.(directive.id);
    if (chosenOptionId) {
      const option = getPolicyOption(
        directive.id as PolicyDirectiveId,
        chosenOptionId,
      );
      if (option?.effects.attackerLossMul) {
        mods.attackerLossMul *= option.effects.attackerLossMul;
      }
      if (option?.effects.enemyLossMulOnAttack) {
        mods.defenderLossMul *= option.effects.enemyLossMulOnAttack;
      }
    }
  }
  return mods;
}

/**
 * Compute attack speed multiplier based on researched techs and policy directives.
 * speedMul > 1 increases tiles conquered per tick (faster attacks).
 */
export function attackSpeedModifiers(attacker: {
  hasResearchedTech?(techId: string): boolean;
  getPolicyChoice?(directiveId: string): string | null;
}): AttackSpeedModifiers {
  const mods: AttackSpeedModifiers = {
    speedMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (attacker.hasResearchedTech?.(techId)) {
      def.effects?.attackSpeed?.(mods);
    }
  }
  // Apply policy directive effects
  for (const directive of getAllPolicyDirectives()) {
    const chosenOptionId = attacker.getPolicyChoice?.(directive.id);
    if (chosenOptionId) {
      const option = getPolicyOption(
        directive.id as PolicyDirectiveId,
        chosenOptionId,
      );
      if (option?.effects.attackSpeedMul) {
        mods.speedMul *= option.effects.attackSpeedMul;
      }
    }
  }
  return mods;
}

/**
 * Compute construction speed multiplier based on researched techs and policy directives.
 * speedMul > 1 means construction completes faster (fewer ticks).
 */
export function constructionSpeedModifiers(player: {
  hasResearchedTech?(techId: string): boolean;
  getPolicyChoice?(directiveId: string): string | null;
}): ConstructionSpeedModifiers {
  const mods: ConstructionSpeedModifiers = {
    speedMul: 1.0,
  };
  // Apply tech effects
  for (const [techId, def] of Object.entries(TECHS)) {
    if (player.hasResearchedTech?.(techId)) {
      def.effects?.constructionSpeed?.(mods);
    }
  }
  // Apply policy directive effects
  for (const directive of getAllPolicyDirectives()) {
    const chosenOptionId = player.getPolicyChoice?.(directive.id);
    if (chosenOptionId) {
      const option = getPolicyOption(
        directive.id as PolicyDirectiveId,
        chosenOptionId,
      );
      if (option?.effects.constructionSpeedMul) {
        mods.speedMul *= option.effects.constructionSpeedMul;
      }
    }
  }
  return mods;
}

/**
 * Compute research effectiveness multiplier based on researched techs.
 * effectivenessMul > 1 means research progresses faster.
 */
export function researchEffectivenessModifiers(
  player: Player,
): ResearchEffectivenessModifiers {
  const mods: ResearchEffectivenessModifiers = {
    effectivenessMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (player.hasResearchedTech?.(techId)) {
      def.effects?.researchEffectiveness?.(mods);
    }
  }
  return mods;
}

/**
 * Compute income multiplier based on researched techs and policy directives.
 * incomeMul > 1 means higher gross gold income.
 * domesticIncomeMul > 1 means higher domestic (non-trade) income.
 */
export function incomeModifiers(player: {
  hasResearchedTech?(techId: string): boolean;
  getPolicyChoice?(directiveId: string): string | null;
}): IncomeModifiers {
  const mods: IncomeModifiers = {
    domesticIncomeMul: 1.0,
  };
  // Apply tech effects
  for (const [techId, def] of Object.entries(TECHS)) {
    if (player.hasResearchedTech?.(techId)) {
      def.effects?.income?.(mods);
    }
  }
  // Apply policy directive effects
  for (const directive of getAllPolicyDirectives()) {
    const chosenOptionId = player.getPolicyChoice?.(directive.id);
    if (chosenOptionId) {
      const option = getPolicyOption(
        directive.id as PolicyDirectiveId,
        chosenOptionId,
      );
      if (option?.effects.domesticIncomeMul) {
        mods.domesticIncomeMul *= option.effects.domesticIncomeMul;
      }
    }
  }
  return mods;
}

/**
 * Compute infrastructure spending effectiveness multiplier based on researched techs and policy directives.
 * effectivenessMul > 1 means more roads per gold spent.
 */
export function infrastructureEffectivenessModifiers(player: {
  hasResearchedTech?(techId: string): boolean;
  getPolicyChoice?(directiveId: string): string | null;
}): InfrastructureEffectivenessModifiers {
  const mods: InfrastructureEffectivenessModifiers = {
    effectivenessMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (player.hasResearchedTech?.(techId)) {
      def.effects?.infrastructureEffectiveness?.(mods);
    }
  }
  // Apply policy directive effects
  for (const directive of getAllPolicyDirectives()) {
    const chosenOptionId = player.getPolicyChoice?.(directive.id);
    if (chosenOptionId) {
      const option = getPolicyOption(
        directive.id as PolicyDirectiveId,
        chosenOptionId,
      );
      if (option?.effects.infrastructureSpendingEffectivenessMul) {
        mods.effectivenessMul *=
          option.effects.infrastructureSpendingEffectivenessMul;
      }
    }
  }
  return mods;
}

/**
 * Compute trade income multiplier based on researched techs and policy directives.
 * incomeMul > 1 means higher trade income.
 * tradeShipIncomeMul > 1 means higher income for trade ship owners.
 */
export function tradeIncomeModifiers(player: {
  hasResearchedTech?(techId: string): boolean;
  getPolicyChoice?(directiveId: string): string | null;
}): TradeIncomeModifiers {
  const mods: TradeIncomeModifiers = {
    incomeMul: 1.0,
    tradeShipIncomeMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (player.hasResearchedTech?.(techId)) {
      def.effects?.tradeIncome?.(mods);
    }
  }
  // Apply policy directive effects
  for (const directive of getAllPolicyDirectives()) {
    const chosenOptionId = player.getPolicyChoice?.(directive.id);
    if (chosenOptionId) {
      const option = getPolicyOption(
        directive.id as PolicyDirectiveId,
        chosenOptionId,
      );
      if (option?.effects.tradeIncomeMul) {
        mods.incomeMul *= option.effects.tradeIncomeMul;
      }
      if (option?.effects.tradeShipIncomeMul) {
        mods.tradeShipIncomeMul *= option.effects.tradeShipIncomeMul;
      }
    }
  }
  return mods;
}

/**
 * Compute road effect multiplier based on researched techs and policy directives.
 * effectMul > 1 means roads provide stronger bonuses.
 */
export function roadEffectModifiers(player: {
  hasResearchedTech?(techId: string): boolean;
  getPolicyChoice?(directiveId: string): string | null;
}): RoadEffectModifiers {
  const mods: RoadEffectModifiers = {
    effectMul: 1.0,
  };
  // Apply tech effects
  for (const [techId, def] of Object.entries(TECHS)) {
    if (player.hasResearchedTech?.(techId)) {
      def.effects?.roadEffect?.(mods);
    }
  }
  // Apply policy directive effects
  for (const directive of getAllPolicyDirectives()) {
    const chosenOptionId = player.getPolicyChoice?.(directive.id);
    if (chosenOptionId) {
      const option = getPolicyOption(
        directive.id as PolicyDirectiveId,
        chosenOptionId,
      );
      if (option?.effects.roadEffectMul) {
        mods.effectMul *= option.effects.roadEffectMul;
      }
    }
  }
  return mods;
}
