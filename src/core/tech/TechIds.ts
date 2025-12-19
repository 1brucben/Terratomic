/**
 * Central tech IDs for research tree items.
 * This file has NO dependencies to prevent circular imports.
 * Keep IDs aligned with ResearchTree definitions (e.g., "Land-1").
 */
export const RESEARCH_TECH_IDS = {
  // Air techs
  AIR_PARATROOPERS: "Air-1",
  AIR_ADVANCED_JETS: "Air-2",
  AIR_NAVAL_STRIKE: "Air-3",
  AIR_TBD_LEVEL4: "Air-4",
  // Sea techs
  SEA_MISSILE_NAVY: "Sea-1",
  SEA_ADVANCED_FLEET: "Sea-2",
  SEA_NUCLEAR_SUBMARINES: "Sea-3",
  SEA_TBD_LEVEL4: "Sea-4",
  // Land techs
  LAND_ROADS_HOSPITALS: "Land-1",
  LAND_MILITARY_ACADEMY: "Land-2",
  LAND_SAM_SYSTEMS: "Land-3",
  LAND_DOOMSDAY_DEVICE: "Land-4",
  // Economy techs (legacy; category removed, kept for backwards compatibility)
  ECONOMY_ROADS_HOSPITALS: "Land-1",
  // Nuclear techs
  NUCLEAR_FISSION: "Nuclear-1",
  THERMONUCLEAR_STAGING: "Nuclear-2",
  MIRV_TECHNOLOGY: "Nuclear-3",
  NUCLEAR_TBD_LEVEL4: "Nuclear-4",

  // Legacy mappings for backwards compatibility during migration
  EARLY_JET_AVIATION_FRAMEWORK: "Air-1",
  SUPERSONIC_AIRFRAME_DEVELOPMENT: "Air-2",
  PULSE_DOPPLER_RADAR_BVR: "Air-3",
  FLY_BY_WIRE_PLATFORMS: "Air-4",
  EARLY_MISSILE_NAVY: "Sea-1",
  SUBMARINE_SILENT_SERVICE: "Sea-2",
  SSBN_PROGRAMS: "Sea-3",
  MODERN_FLEET_SENSOR_SAM: "Sea-4",
  POST_WW2_GROUND_FORCES_MODERNIZATION: "Land-1",
  MECHANIZED_WARFARE_DOCTRINE: "Land-2",
  AIR_DEFENSE_GRID_EXPANSION: "Land-3",
  INTEGRATED_SAM_BATTLEFIELD_COMMAND: "Land-4",
  NIGHT_VISION_THERMAL_C3I: "Land-5",
  NATIONAL_RECONSTRUCTION_PROGRAM: "Economy-1",
  DOOMSDAY_DEVICE: "Nuclear-4",
} as const;

export type ResearchTechId =
  (typeof RESEARCH_TECH_IDS)[keyof typeof RESEARCH_TECH_IDS];
