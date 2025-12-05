/**
 * Central tech IDs for research tree items.
 * This file has NO dependencies to prevent circular imports.
 * Keep IDs aligned with ResearchTreeModal generation (e.g., "Land-1").
 */
export const RESEARCH_TECH_IDS = {
  // Air techs - Level 1
  JET_ENGINES: "Air-0",
  // Air techs - Level 2
  SUPERSONIC_FLIGHT: "Air-2A",
  TURBOJET_BOMBERS: "Air-2B",
  AIRBORNE_OPERATIONS: "Air-2C",
  // Air techs - Level 3
  PULSE_DOPPLER_RADAR: "Air-3A",
  NAVAL_STRIKE_TARGETING: "Air-3B",
  SUPERSONIC_BOMBERS: "Air-3C",
  // Air techs - Level 4
  FLY_BY_WIRE_SYSTEMS: "Air-4A",
  PRECISION_GUIDED_MUNITIONS: "Air-4B",
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
  MECHANIZED_WARFARE_DOCTRINE: "Land-2A",
  SAM_DEPLOYMENT: "Land-2B",
  // Land techs - Level 3
  MAIN_BATTLE_TANK_STANDARDIZATION: "Land-3A",
  ADVANCED_SAM_SYSTEMS: "Land-3B",
  // Land techs - Level 4
  NIGHT_VISION_BATTLEFIELD_SENSORS: "Land-4A",
  INTEGRATED_C3I_SAM_NETWORKS: "Land-4B",
  // Economy techs - Level 1
  NATIONAL_RECONSTRUCTION_PROGRAM: "Economy-1",
  // Economy techs - Level 2
  INDUSTRIAL_DEVELOPMENT_STRATEGY: "Economy-2A",
  TRADE_POLICY_FRAMEWORK: "Economy-2B",
  // Economy techs - Level 3
  SCIENTIFIC_RESEARCH_NETWORK: "Economy-3A",
  INFRASTRUCTURE_PRIORITIZATION: "Economy-3B",
  // Economy techs - Level 4
  COMPUTING_DATA_SYSTEMS: "Economy-4A",
  NATIONAL_ECONOMIC_COORDINATION: "Economy-4B",
  // Nuclear techs
  NUCLEAR_FISSION: "Nuclear-1",
  THERMONUCLEAR_STAGING: "Nuclear-2",
  MIRV_TECHNOLOGY: "Nuclear-3",
  DOOMSDAY_DEVICE: "Nuclear-4",
} as const;

export type ResearchTechId =
  (typeof RESEARCH_TECH_IDS)[keyof typeof RESEARCH_TECH_IDS];
