/**
 * Central tech IDs for research tree items.
 * This file has NO dependencies to prevent circular imports.
 * Keep IDs aligned with ResearchTreeModal generation (e.g., "Land-1").
 */
export const RESEARCH_TECH_IDS = {
  // Air techs - Level 1
  EARLY_JET_AVIATION_FRAMEWORK: "Air-1",
  // Air techs - Level 2
  SUPERSONIC_AIRFRAME_DEVELOPMENT: "Air-2",
  // Air techs - Level 3
  PULSE_DOPPLER_RADAR_BVR: "Air-3",
  // Air techs - Level 4
  FLY_BY_WIRE_PLATFORMS: "Air-4",
  // Sea techs - Level 1
  EARLY_MISSILE_NAVY: "Sea-1",
  // Sea techs - Level 2
  SUBMARINE_SILENT_SERVICE: "Sea-2",
  // Sea techs - Level 3
  SSBN_PROGRAMS: "Sea-3",
  // Sea techs - Level 4
  MODERN_FLEET_SENSOR_SAM: "Sea-4",
  // Land techs - Level 1
  POST_WW2_GROUND_FORCES_MODERNIZATION: "Land-1",
  // Land techs - Level 2
  MECHANIZED_WARFARE_DOCTRINE: "Land-2",
  // Land techs - Level 3
  AIR_DEFENSE_GRID_EXPANSION: "Land-3",
  // Land techs - Level 4
  INTEGRATED_SAM_BATTLEFIELD_COMMAND: "Land-4",
  // Land techs - Level 5
  NIGHT_VISION_THERMAL_C3I: "Land-5",
  // Economy techs - Level 1 (1950s)
  NATIONAL_RECONSTRUCTION_PROGRAM: "Economy-1",
  // Economy techs - Level 2 (1960s)
  NATIONAL_RESEARCH_INDUSTRIAL_FOUNDATIONS: "Economy-2",
  // Economy techs - Level 3 (1970s)
  TRADE_POLICY_FRAMEWORK: "Economy-3",
  // Economy techs - Level 4 (1980s)
  NATIONAL_INFRASTRUCTURE_MODERNIZATION: "Economy-4",
  // Economy techs - Level 5 (Early 1990s)
  DIGITAL_ADMINISTRATION_SYSTEMS: "Economy-5",
  // Nuclear techs
  NUCLEAR_FISSION: "Nuclear-1",
  THERMONUCLEAR_STAGING: "Nuclear-2",
  MIRV_TECHNOLOGY: "Nuclear-3",
  DOOMSDAY_DEVICE: "Nuclear-4",
} as const;

export type ResearchTechId =
  (typeof RESEARCH_TECH_IDS)[keyof typeof RESEARCH_TECH_IDS];
