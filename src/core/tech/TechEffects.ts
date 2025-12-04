import { CityAAExecution } from "../execution/CityAAExecution";
import { Game, Player, UpgradeType } from "../game/Game";

// Central tech IDs for research tree items that have gameplay effects.
// Keep IDs aligned with ResearchTreeModal generation (e.g., "Land-1").
export const RESEARCH_TECH_IDS = {
  // Air techs - Level 1
  JET_ENGINES: "Air-0",
  ANTI_AIR_GUNS: "Air-1",
  // Air techs - Level 2
  SUPERSONIC_FLIGHT: "Air-2A",
  TURBOJET_BOMBERS: "Air-2B",
  AIRBORNE_OPERATIONS: "Air-2C",
  SURFACE_TO_AIR_MISSILES: "Air-2D",
  // Air techs - Level 3
  PULSE_DOPPLER_RADAR: "Air-3A",
  NAVAL_STRIKE_TARGETING: "Air-3B",
  SUPERSONIC_BOMBERS: "Air-3C",
  RADAR_GUIDED_SAMS: "Air-3D",
  // Air techs - Level 4
  FLY_BY_WIRE_SYSTEMS: "Air-4A",
  PRECISION_GUIDED_MUNITIONS: "Air-4B",
  STRATEGIC_SAM_SYSTEMS: "Air-4C",
  // Sea techs - Level 1
  EARLY_COLD_WAR_CRUISERS: "Sea-0",
  DIESEL_ELECTRIC_SUBS: "Sea-1",
  // Sea techs - Level 2
  FIRST_MISSILE_CRUISERS: "Sea-2A",
  NUCLEAR_ATTACK_SUBMARINES: "Sea-2B",
  BALLISTIC_MISSILE_SUBMARINES: "Sea-2C",
  // Sea techs - Level 3
  ADVANCED_MISSILE_CRUISERS: "Sea-3A",
  ADVANCED_NUCLEAR_ATTACK_SUBS: "Sea-3B",
  NAVAL_SAM_SYSTEMS: "Sea-3C",
  // Sea techs - Level 4
  AEGIS_WARSHIP_SYSTEMS: "Sea-4A",
  QUIETING_ACOUSTIC_STEALTH: "Sea-4B",
  // Land techs - Level 1
  POST_WW2_MODERNIZATION: "Land-1",
  // Land techs - Level 2
  EARLY_MECHANIZATION: "Land-2A",
  IMPROVED_ARTILLERY_SYSTEMS: "Land-2B",
  INTEGRATED_LOGISTICS_CORPS: "Land-2C",
  // Land techs - Level 3
  MAIN_BATTLE_TANK_STANDARDIZATION: "Land-3A",
  COMPOSITE_ARMOR_HEAT_MUNITIONS: "Land-3B",
  SELF_PROPELLED_ARTILLERY: "Land-3C",
  // Land techs - Level 4
  NIGHT_VISION_BATTLEFIELD_SENSORS: "Land-4A",
  PRECISION_GUIDED_MUNITIONS_LAND: "Land-4B",
  C3I_SYSTEMS: "Land-4C",
  // Economy techs - Level 1
  POST_WAR_RECONSTRUCTION: "Economy-1",
  // Economy techs - Level 2
  NATIONAL_HIGHWAY_EXPANSION: "Economy-2A",
  PORT_TRANSPORT_MODERNIZATION: "Economy-2B",
  CIVIL_DEFENSE_MEASURES: "Economy-2C",
  INFRASTRUCTURE_RECOVERY_FUND: "Economy-2D",
  // Economy techs - Level 3
  SCIENTIFIC_RESEARCH_NETWORK: "Economy-3A",
  ADVANCED_MACHINE_TOOLS_AUTOMATION: "Economy-3B",
  ENERGY_INFRASTRUCTURE_EXPANSION: "Economy-3C",
  NATIONAL_HEALTH_SYSTEM: "Economy-3D",
  // Economy techs - Level 4
  COMPUTING_DATA_SYSTEMS: "Economy-4A",
  TELECOMMUNICATIONS_INTEGRATION: "Economy-4B",
  ECONOMIC_COORDINATION_SYSTEMS: "Economy-4C",
  // Special Economy actions (not research nodes)
  SCORCHED_EARTH: "Economy-Action-ScorchedEarth",
  // Nuclear techs
  NUCLEAR_FISSION: "Nuclear-1",
  THERMONUCLEAR_STAGING: "Nuclear-2",
  MIRV_TECHNOLOGY: "Nuclear-3",
  DOOMSDAY_DEVICE: "Nuclear-4",
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
  // Multiplier to apply to gross gold income
  incomeMul: number;
}

export interface InfrastructureEffectivenessModifiers {
  // Multiplier to apply to infrastructure spending effectiveness (higher = more roads per gold)
  effectivenessMul: number;
}

export interface TradeIncomeModifiers {
  // Multiplier to apply to trade income
  incomeMul: number;
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
};

export type TechDefinition = {
  meta: TechMeta;
  effects?: TechEffect;
};

// Unified registry containing both metadata and effects per tech
export const TECHS: Readonly<Record<string, TechDefinition>> = Object.freeze({
  // Sea techs - Level 1
  [RESEARCH_TECH_IDS.EARLY_COLD_WAR_CRUISERS]: {
    meta: {
      name: "Early Cold War Cruisers",
      description:
        "Enables Level 1 Warships. Post-war cruiser designs with improved armament and fire control systems.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.WarshipLevel1)) {
          player.addUpgrade?.(UpgradeType.WarshipLevel1);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.WarshipLevel1)) {
          player.removeUpgrade?.(UpgradeType.WarshipLevel1);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.DIESEL_ELECTRIC_SUBS]: {
    meta: {
      name: "Diesel-Electric Subs",
      description:
        "Enables Level 1 Submarines. Conventional submarines with improved stealth and endurance.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.SubmarineLevel1)) {
          player.addUpgrade?.(UpgradeType.SubmarineLevel1);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.SubmarineLevel1)) {
          player.removeUpgrade?.(UpgradeType.SubmarineLevel1);
        }
      },
    },
  },
  // Sea techs - Level 2
  [RESEARCH_TECH_IDS.FIRST_MISSILE_CRUISERS]: {
    meta: {
      name: "First-Missile Cruisers",
      description:
        "Enables Level 2 Warships. Guided missile cruisers with long-range anti-ship capabilities.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.WarshipLevel2)) {
          player.addUpgrade?.(UpgradeType.WarshipLevel2);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.WarshipLevel2)) {
          player.removeUpgrade?.(UpgradeType.WarshipLevel2);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.NUCLEAR_ATTACK_SUBMARINES]: {
    meta: {
      name: "Nuclear Attack Submarines",
      description:
        "Enables Level 2 Submarines. Nuclear-powered attack submarines with unlimited range and improved speed.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.SubmarineLevel2)) {
          player.addUpgrade?.(UpgradeType.SubmarineLevel2);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.SubmarineLevel2)) {
          player.removeUpgrade?.(UpgradeType.SubmarineLevel2);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.BALLISTIC_MISSILE_SUBMARINES]: {
    meta: {
      name: "Ballistic Missile Submarines",
      description:
        "Allows Submarines to launch Atomic Bombs. Nuclear-powered ballistic missile submarines for strategic deterrence.",
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
  // Sea techs - Level 3
  [RESEARCH_TECH_IDS.ADVANCED_MISSILE_CRUISERS]: {
    meta: {
      name: "Advanced Missile Cruisers",
      description:
        "Enables Level 3 Warships. Modern guided missile cruisers with advanced combat systems.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.WarshipLevel3)) {
          player.addUpgrade?.(UpgradeType.WarshipLevel3);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.WarshipLevel3)) {
          player.removeUpgrade?.(UpgradeType.WarshipLevel3);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.ADVANCED_NUCLEAR_ATTACK_SUBS]: {
    meta: {
      name: "Advanced Nuclear Attack Subs",
      description:
        "Enables Level 3 Submarines. Next-generation nuclear attack submarines with improved stealth and weapons.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.SubmarineLevel3)) {
          player.addUpgrade?.(UpgradeType.SubmarineLevel3);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.SubmarineLevel3)) {
          player.removeUpgrade?.(UpgradeType.SubmarineLevel3);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.NAVAL_SAM_SYSTEMS]: {
    meta: {
      name: "Naval SAM Systems",
      description:
        "Equips Warships with an anti-air (AA) missile system to engage nearby enemy aircraft. Does not intercept nuclear missiles.",
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
  // Sea techs - Level 4
  [RESEARCH_TECH_IDS.AEGIS_WARSHIP_SYSTEMS]: {
    meta: {
      name: "Aegis Warship Systems",
      description:
        "Advanced integrated naval weapons system with multi-target tracking and engagement capabilities.",
    },
    effects: {
      // Placeholder - no effect for now
    },
  },
  [RESEARCH_TECH_IDS.QUIETING_ACOUSTIC_STEALTH]: {
    meta: {
      name: "Quieting and Acoustic Stealth",
      description:
        "Advanced noise reduction and acoustic signature management for improved submarine stealth.",
    },
    effects: {
      // Placeholder - no effect for now
    },
  },
  [RESEARCH_TECH_IDS.POST_WW2_MODERNIZATION]: {
    meta: {
      name: "Post-WW2 Modernization",
      description:
        "Doctrine refined by hard-won experience improves offensive capabilities and tactical efficiency. Effects: Enables Military Academy. Enemy takes +5% more losses when you attack them. Your offensive speed +5%.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.MilitaryAcademy)) {
          player.addUpgrade?.(UpgradeType.MilitaryAcademy);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.MilitaryAcademy)) {
          player.removeUpgrade?.(UpgradeType.MilitaryAcademy);
        }
      },
      attack: (mods) => {
        mods.defenderLossMul *= 1.05; // enemy (defender) takes 5% more losses when we attack
      },
      attackSpeed: (mods) => {
        mods.speedMul *= 1.05; // 5% faster offensive speed
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
  // Economy Level 2 techs
  [RESEARCH_TECH_IDS.NATIONAL_HIGHWAY_EXPANSION]: {
    meta: {
      name: "National Highway Expansion",
      description:
        "Expand national highway networks for improved logistics and troop movement. Effects: Construction speed +10%.",
    },
    effects: {
      constructionSpeed: (mods) => {
        mods.speedMul *= 1.1; // 10% faster construction
      },
      // TODO: Stronger road effects +5% (roads boost structure output more effectively)
    },
  },
  [RESEARCH_TECH_IDS.PORT_TRANSPORT_MODERNIZATION]: {
    meta: {
      name: "Port & Transport Modernization",
      description:
        "Modernize ports and transport infrastructure. Effects: Unlocks International Trade income from cargo trucks.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.InternationalTrade)) {
          player.addUpgrade?.(UpgradeType.InternationalTrade);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.InternationalTrade)) {
          player.removeUpgrade?.(UpgradeType.InternationalTrade);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.CIVIL_DEFENSE_MEASURES]: {
    meta: {
      name: "Civil Defense Measures",
      description:
        "Establish civil defense protocols. Effects: Enables the Scorched Earth decision.",
    },
    effects: {
      // TODO: Maintenance cost reduction +5%
    },
  },
  [RESEARCH_TECH_IDS.INFRASTRUCTURE_RECOVERY_FUND]: {
    meta: {
      name: "Infrastructure Recovery Fund",
      description:
        "Establish state-backed recovery funds. Effects: Unlocks Structure Insurance, refunding 33% of construction costs when self-constructed buildings are lost.",
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
  // Economy Level 3 techs
  [RESEARCH_TECH_IDS.SCIENTIFIC_RESEARCH_NETWORK]: {
    meta: {
      name: "Scientific Research Network",
      description:
        "Establish national research networks for scientific advancement. Effects: Unlocks Research Lab structures.",
    },
    effects: {
      onComplete: (player) => {
        player.addUpgrade?.(UpgradeType.ResearchLabResearch);
      },
      onRevoke: (player) => {
        player.removeUpgrade?.(UpgradeType.ResearchLabResearch);
      },
    },
  },
  [RESEARCH_TECH_IDS.ADVANCED_MACHINE_TOOLS_AUTOMATION]: {
    meta: {
      name: "Advanced Machine Tools & Automation",
      description:
        "Develop advanced manufacturing and automation systems. Effects: Construction speed +10%.",
    },
    effects: {
      constructionSpeed: (mods) => {
        mods.speedMul *= 1.1; // 10% faster construction
      },
      // TODO: Infrastructure spending effectiveness +30%
    },
  },
  [RESEARCH_TECH_IDS.ENERGY_INFRASTRUCTURE_EXPANSION]: {
    meta: {
      name: "Energy Infrastructure Expansion",
      description:
        "Expand power generation and distribution networks. Effects: Income +10%.",
    },
    effects: {
      income: (mods) => {
        mods.incomeMul *= 1.1; // 10% more income
      },
      // TODO: Maintenance cost reduction +5%
    },
  },
  [RESEARCH_TECH_IDS.NATIONAL_HEALTH_SYSTEM]: {
    meta: {
      name: "National Health System",
      description:
        "Establish a comprehensive national health system. Effects: Enables Hospital construction. Income +5%.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.HospitalResearch)) {
          player.addUpgrade?.(UpgradeType.HospitalResearch);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.HospitalResearch)) {
          player.removeUpgrade?.(UpgradeType.HospitalResearch);
        }
      },
      income: (mods) => {
        mods.incomeMul *= 1.05; // 5% more income
      },
    },
  },
  // Economy Level 4 techs
  [RESEARCH_TECH_IDS.COMPUTING_DATA_SYSTEMS]: {
    meta: {
      name: "Computing & Data Systems",
      description:
        "Develop computing infrastructure and data processing systems. Effects: Research spending effectiveness +20%. Infrastructure spending effectiveness +20%.",
    },
    effects: {
      researchEffectiveness: (mods) => {
        mods.effectivenessMul *= 1.2; // 20% more effective research
      },
      infrastructureEffectiveness: (mods) => {
        mods.effectivenessMul *= 1.2; // 20% more effective infrastructure spending
      },
    },
  },
  [RESEARCH_TECH_IDS.TELECOMMUNICATIONS_INTEGRATION]: {
    meta: {
      name: "Telecommunications Integration",
      description:
        "Integrate telecommunications networks nationally. Effects: Trade income +20%.",
    },
    effects: {
      tradeIncome: (mods) => {
        mods.incomeMul *= 1.2; // 20% more trade income
      },
    },
  },
  [RESEARCH_TECH_IDS.ECONOMIC_COORDINATION_SYSTEMS]: {
    meta: {
      name: "Economic Coordination Systems",
      description:
        "National systems for economic planning and coordination. Better allocation of resources reduces waste. Effects: Income +10%.",
    },
    effects: {
      income: (mods) => {
        mods.incomeMul *= 1.1; // 10% more income
      },
      // TODO: Maintenance cost reduction +10%
    },
  },
  [RESEARCH_TECH_IDS.SCORCHED_EARTH]: {
    meta: {
      name: "Scorched Earth",
      description:
        "Unleash a scorched earth campaign: raze your road network and reset economic research to deny enemy logistics.",
    },
  },
  // Land Level 2 techs
  [RESEARCH_TECH_IDS.EARLY_MECHANIZATION]: {
    meta: {
      name: "Early Mechanization",
      description:
        "Introduce mechanized infantry and motorized transport to increase battlefield mobility. Effects: Your offensive speed +10%. Your army takes 10% fewer losses when you attack.",
    },
    effects: {
      attack: (mods) => {
        mods.attackerLossMul *= 0.9; // our army takes 10% fewer losses when attacking
      },
      attackSpeed: (mods) => {
        mods.speedMul *= 1.1; // 10% faster offensive speed
      },
    },
  },
  [RESEARCH_TECH_IDS.IMPROVED_ARTILLERY_SYSTEMS]: {
    meta: {
      name: "Improved Artillery Systems",
      description:
        "Develop more accurate and powerful artillery pieces with improved range and fire rates. Effects: Enemy takes +10% more losses when they attack you. Your army takes 10% fewer losses when defending.",
    },
    effects: {
      defense: (mods) => {
        mods.attackerLossMul *= 1.1; // enemy (attacker) takes 10% more losses
        mods.defenderLossMul *= 0.9; // our army takes 10% fewer losses when defending
      },
    },
  },
  [RESEARCH_TECH_IDS.INTEGRATED_LOGISTICS_CORPS]: {
    meta: {
      name: "Integrated Logistics Corps",
      description:
        "Establish unified supply chains and logistics networks for efficient resource distribution. Effects: Your offensive speed +10%. Your army takes 5% fewer losses when you attack. Your army takes 5% fewer losses when defending.",
    },
    effects: {
      attack: (mods) => {
        mods.attackerLossMul *= 0.95; // our army takes 5% fewer losses when attacking
      },
      defense: (mods) => {
        mods.defenderLossMul *= 0.95; // our army takes 5% fewer losses when defending
      },
      attackSpeed: (mods) => {
        mods.speedMul *= 1.1; // 10% faster offensive speed
      },
    },
  },
  // Land Level 3 techs
  [RESEARCH_TECH_IDS.MAIN_BATTLE_TANK_STANDARDIZATION]: {
    meta: {
      name: "Main Battle Tank Standardization",
      description:
        "Adopt standardized tank designs for improved maintenance and battlefield coordination. Effects: Your army takes 10% fewer losses when you attack. Your army takes 10% fewer losses when defending.",
    },
    effects: {
      attack: (mods) => {
        mods.attackerLossMul *= 0.9; // our army takes 10% fewer losses when attacking
      },
      defense: (mods) => {
        mods.defenderLossMul *= 0.9; // our army takes 10% fewer losses when defending
      },
    },
  },
  [RESEARCH_TECH_IDS.COMPOSITE_ARMOR_HEAT_MUNITIONS]: {
    meta: {
      name: "Composite Armor & HEAT Munitions",
      description:
        "Develop advanced armor materials and high-explosive anti-tank warheads. Effects: Enemy takes +10% more losses when you attack them. Your army takes 5% fewer losses when you attack.",
    },
    effects: {
      attack: (mods) => {
        mods.defenderLossMul *= 1.1; // enemy (defender) takes 10% more losses when we attack
        mods.attackerLossMul *= 0.95; // our army takes 5% fewer losses when attacking
      },
    },
  },
  [RESEARCH_TECH_IDS.SELF_PROPELLED_ARTILLERY]: {
    meta: {
      name: "Self-Propelled Artillery",
      description:
        "Mount artillery on mobile platforms for rapid deployment and shoot-and-scoot tactics. Effects: Enemy takes +10% more losses when you attack them. Your offensive speed +10%.",
    },
    effects: {
      attack: (mods) => {
        mods.defenderLossMul *= 1.1; // enemy (defender) takes 10% more losses when we attack
      },
      attackSpeed: (mods) => {
        mods.speedMul *= 1.1; // 10% faster offensive speed
      },
    },
  },
  // Land Level 4 techs
  [RESEARCH_TECH_IDS.NIGHT_VISION_BATTLEFIELD_SENSORS]: {
    meta: {
      name: "Night Vision & Battlefield Sensors",
      description:
        "Equip forces with infrared and thermal imaging for 24-hour combat capability. Effects: Your offensive speed +10%. Enemy takes +10% more losses when you attack them.",
    },
    effects: {
      attack: (mods) => {
        mods.defenderLossMul *= 1.1; // enemy (defender) takes 10% more losses when we attack
      },
      attackSpeed: (mods) => {
        mods.speedMul *= 1.1; // 10% faster offensive speed
      },
    },
  },
  [RESEARCH_TECH_IDS.PRECISION_GUIDED_MUNITIONS_LAND]: {
    meta: {
      name: "Precision-Guided Munitions (Land)",
      description:
        "Develop laser and GPS-guided artillery shells and missiles for pinpoint accuracy. Effects: Enemy takes +15% more losses when they attack you. Enemy takes +15% more losses when you attack them.",
    },
    effects: {
      attack: (mods) => {
        mods.defenderLossMul *= 1.15; // enemy (defender) takes 15% more losses when we attack
      },
      defense: (mods) => {
        mods.attackerLossMul *= 1.15; // enemy (attacker) takes 15% more losses when they attack us
      },
    },
  },
  [RESEARCH_TECH_IDS.C3I_SYSTEMS]: {
    meta: {
      name: "C3I Systems",
      description:
        "Command, Control, Communications, and Intelligence systems for integrated battlefield awareness. Effects: Your army takes 10% fewer losses when you attack. Your army takes 10% fewer losses when defending.",
    },
    effects: {
      attack: (mods) => {
        mods.attackerLossMul *= 0.9; // our army takes 10% fewer losses when attacking
      },
      defense: (mods) => {
        mods.defenderLossMul *= 0.9; // our army takes 10% fewer losses when defending
      },
    },
  },
  [RESEARCH_TECH_IDS.ANTI_AIR_GUNS]: {
    meta: {
      name: "Anti-Air Guns",
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
  [RESEARCH_TECH_IDS.JET_ENGINES]: {
    meta: {
      name: "Jet Engines",
      description: "Enables: Fighters, Bombers, Airfields",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.JetEngines)) {
          player.addUpgrade?.(UpgradeType.JetEngines);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.JetEngines)) {
          player.removeUpgrade?.(UpgradeType.JetEngines);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.SUPERSONIC_FLIGHT]: {
    meta: {
      name: "Supersonic Flight",
      description:
        "Enables Level 2 Fighters. Advanced supersonic aircraft with improved speed and maneuverability.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.FighterLevel2)) {
          player.addUpgrade?.(UpgradeType.FighterLevel2);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.FighterLevel2)) {
          player.removeUpgrade?.(UpgradeType.FighterLevel2);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.TURBOJET_BOMBERS]: {
    meta: {
      name: "Turbojet Bombers",
      description:
        "Enables Level 2 Bombers. Advanced bomber technology improving bomber effectiveness and capabilities.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.BomberLevel2)) {
          player.addUpgrade?.(UpgradeType.BomberLevel2);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.BomberLevel2)) {
          player.removeUpgrade?.(UpgradeType.BomberLevel2);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.AIRBORNE_OPERATIONS]: {
    meta: {
      name: "Airborne Operations",
      description:
        "Unlocks Paratroopers, allowing you to launch surprise attacks from the sky. Requires an Airfield.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.AirUpgrade1)) {
          player.addUpgrade?.(UpgradeType.AirUpgrade1);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.AirUpgrade1)) {
          player.removeUpgrade?.(UpgradeType.AirUpgrade1);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.SURFACE_TO_AIR_MISSILES]: {
    meta: {
      name: "Surface-to-Air Missiles",
      description:
        "Enables Level 1 SAM Launchers. Advanced SAM technology for enhanced air defense capabilities.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.SAMLevel1)) {
          player.addUpgrade?.(UpgradeType.SAMLevel1);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.SAMLevel1)) {
          player.removeUpgrade?.(UpgradeType.SAMLevel1);
        }
      },
    },
  },
  // Air techs - Level 3
  [RESEARCH_TECH_IDS.PULSE_DOPPLER_RADAR]: {
    meta: {
      name: "Pulse-Doppler Radar",
      description:
        "Enables Level 3 Fighters. Advanced radar technology for improved aircraft detection and tracking.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.FighterLevel3)) {
          player.addUpgrade?.(UpgradeType.FighterLevel3);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.FighterLevel3)) {
          player.removeUpgrade?.(UpgradeType.FighterLevel3);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.NAVAL_STRIKE_TARGETING]: {
    meta: {
      name: "Naval Strike Targeting",
      description:
        "Equips Fighter Jets with advanced targeting systems to engage and destroy enemy naval units.",
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
  [RESEARCH_TECH_IDS.SUPERSONIC_BOMBERS]: {
    meta: {
      name: "Supersonic Bombers",
      description:
        "Enables Level 3 Bombers. High-speed bomber aircraft capable of evading enemy defenses.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.BomberLevel3)) {
          player.addUpgrade?.(UpgradeType.BomberLevel3);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.BomberLevel3)) {
          player.removeUpgrade?.(UpgradeType.BomberLevel3);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.RADAR_GUIDED_SAMS]: {
    meta: {
      name: "Radar-Guided SAMs",
      description:
        "Enables Level 2 SAM Launchers. Advanced radar-guided surface-to-air missiles with improved accuracy.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.SAMLevel2)) {
          player.addUpgrade?.(UpgradeType.SAMLevel2);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.SAMLevel2)) {
          player.removeUpgrade?.(UpgradeType.SAMLevel2);
        }
      },
    },
  },
  // Air techs - Level 4
  [RESEARCH_TECH_IDS.FLY_BY_WIRE_SYSTEMS]: {
    meta: {
      name: "Fly-By-Wire Systems",
      description:
        "Enables Level 4 Fighters. Digital flight control systems for enhanced aircraft maneuverability and stability.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.FighterLevel4)) {
          player.addUpgrade?.(UpgradeType.FighterLevel4);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.FighterLevel4)) {
          player.removeUpgrade?.(UpgradeType.FighterLevel4);
        }
      },
    },
  },
  [RESEARCH_TECH_IDS.PRECISION_GUIDED_MUNITIONS]: {
    meta: {
      name: "Precision-Guided Munitions",
      description:
        "Smart bombs and missiles with pinpoint accuracy for strategic targets.",
    },
    effects: {
      // Placeholder - add specific upgrade when needed
    },
  },
  [RESEARCH_TECH_IDS.STRATEGIC_SAM_SYSTEMS]: {
    meta: {
      name: "Strategic SAM Systems",
      description:
        "Enables Level 3 SAM Launchers. Long-range surface-to-air missile systems for area denial and strategic defense.",
    },
    effects: {
      onComplete: (player) => {
        if (!player.hasUpgrade?.(UpgradeType.SAMLevel3)) {
          player.addUpgrade?.(UpgradeType.SAMLevel3);
        }
      },
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.SAMLevel3)) {
          player.removeUpgrade?.(UpgradeType.SAMLevel3);
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
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.NuclearFission)) {
          player.removeUpgrade?.(UpgradeType.NuclearFission);
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
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.ThermonuclearStaging)) {
          player.removeUpgrade?.(UpgradeType.ThermonuclearStaging);
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
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.MIRVTechnology)) {
          player.removeUpgrade?.(UpgradeType.MIRVTechnology);
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
      onRevoke: (player) => {
        if (player.hasUpgrade?.(UpgradeType.DoomsdayDeviceResearch)) {
          player.removeUpgrade?.(UpgradeType.DoomsdayDeviceResearch);
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

/**
 * Compute attack speed multiplier based on researched techs.
 * speedMul > 1 increases tiles conquered per tick (faster attacks).
 */
export function attackSpeedModifiers(attacker: Player): AttackSpeedModifiers {
  const mods: AttackSpeedModifiers = {
    speedMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (attacker.hasResearchedTech?.(techId)) {
      def.effects?.attackSpeed?.(mods);
    }
  }
  return mods;
}

/**
 * Compute construction speed multiplier based on researched techs.
 * speedMul > 1 means construction completes faster (fewer ticks).
 */
export function constructionSpeedModifiers(
  player: Player,
): ConstructionSpeedModifiers {
  const mods: ConstructionSpeedModifiers = {
    speedMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (player.hasResearchedTech?.(techId)) {
      def.effects?.constructionSpeed?.(mods);
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
 * Compute income multiplier based on researched techs.
 * incomeMul > 1 means higher gross gold income.
 */
export function incomeModifiers(player: {
  hasResearchedTech?(techId: string): boolean;
}): IncomeModifiers {
  const mods: IncomeModifiers = {
    incomeMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (player.hasResearchedTech?.(techId)) {
      def.effects?.income?.(mods);
    }
  }
  return mods;
}

/**
 * Compute infrastructure spending effectiveness multiplier based on researched techs.
 * effectivenessMul > 1 means more roads per gold spent.
 */
export function infrastructureEffectivenessModifiers(player: {
  hasResearchedTech?(techId: string): boolean;
}): InfrastructureEffectivenessModifiers {
  const mods: InfrastructureEffectivenessModifiers = {
    effectivenessMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (player.hasResearchedTech?.(techId)) {
      def.effects?.infrastructureEffectiveness?.(mods);
    }
  }
  return mods;
}

/**
 * Compute trade income multiplier based on researched techs.
 * incomeMul > 1 means higher trade income.
 */
export function tradeIncomeModifiers(player: {
  hasResearchedTech?(techId: string): boolean;
}): TradeIncomeModifiers {
  const mods: TradeIncomeModifiers = {
    incomeMul: 1.0,
  };
  for (const [techId, def] of Object.entries(TECHS)) {
    if (player.hasResearchedTech?.(techId)) {
      def.effects?.tradeIncome?.(mods);
    }
  }
  return mods;
}
