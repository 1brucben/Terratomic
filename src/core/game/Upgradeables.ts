import { UnitType, UpgradeType } from "./Game";

// Interface for checking upgrades - works with both Player and PlayerView
interface HasUpgrade {
  hasUpgrade(type: UpgradeType): boolean;
}

// STACKABLE structures: can have multiple "instances" in one tile (user-controlled stack count)
// Stacking adds HP and counts as multiple buildings.
export const STACKABLE_STRUCTURES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.City,
  UnitType.Port,
  UnitType.Airfield,
  UnitType.Hospital,
  UnitType.Academy,
  UnitType.ResearchLab,
  UnitType.Factory,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
]);

// TECH-UPGRADEABLE structures: level is determined by researched techs (auto-applied)
// SAM and Airfield have tech-based upgrade levels that affect their capabilities.
export const TECH_UPGRADEABLE_STRUCTURES: ReadonlySet<UnitType> =
  new Set<UnitType>([UnitType.SAMLauncher, UnitType.Airfield]);

// Legacy alias for backwards compatibility
export const UPGRADEABLE_STRUCTURES: ReadonlySet<UnitType> =
  STACKABLE_STRUCTURES;

// Units that can be upgraded via tech
export const UPGRADEABLE_UNITS: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.Warship,
  UnitType.FighterJet,
  UnitType.Submarine,
  UnitType.Bomber, // Bomber level affects airfield construction cost
  UnitType.Artillery,
]);

export function isStackableStructure(type: UnitType): boolean {
  return STACKABLE_STRUCTURES.has(type);
}

export function isTechUpgradeableStructure(type: UnitType): boolean {
  return TECH_UPGRADEABLE_STRUCTURES.has(type);
}

export function isUpgradeableStructure(type: UnitType): boolean {
  return STACKABLE_STRUCTURES.has(type);
}

export function isUpgradeableUnit(type: UnitType): boolean {
  return UPGRADEABLE_UNITS.has(type);
}

const MAX_STACK_COUNT = 25;

// Maximum TECH upgrade level for structures (SAM, Airfield)
// This is NOT the stack count - it's the quality tier from research.
export function maxStructureTechLevel(type: UnitType): number {
  if (type === UnitType.SAMLauncher) return 3;
  if (type === UnitType.Airfield) return 3; // Based on bomber level
  return 1;
}

// Maximum stack count for stackable structures
export function maxStackCount(type: UnitType): number {
  return isStackableStructure(type) ? MAX_STACK_COUNT : 1;
}

// Legacy function - returns max stack count (25 for all stackable structures)
export function maxStructureLevel(type: UnitType): number {
  return isStackableStructure(type) ? MAX_STACK_COUNT : 1;
}

// Return maximum upgrade level for upgradeable combat units.
// Warship, Submarine & Bomber: 3 levels. Fighter Jet: 4 levels. Non-upgradeable units: 1.
export function maxUnitLevel(type: UnitType): number {
  switch (type) {
    case UnitType.FighterJet:
      return 4;
    case UnitType.Warship:
    case UnitType.Submarine:
    case UnitType.Artillery:
    case UnitType.Bomber:
      return 3;
    default:
      return 1;
  }
}

// Return maximum upgrade level for a player based on their researched techs.
// For FighterJet: Level 1 by default, Supersonic Airframe = level 2,
// Pulse-Doppler Radar = level 3, Fly-By-Wire = level 4.
// For Bomber: Level 1 by default, Supersonic Airframe = level 2,
// Fly-By-Wire = level 3.
// For Warship: Level 1 by default, Early Missile Navy = level 2,
// Modern Fleet Sensor & SAM = level 3.
// For Submarine: Level 1 by default, Early Missile Navy = level 2,
// Submarine Silent Service = level 3.
export function playerMaxUnitLevel(player: HasUpgrade, type: UnitType): number {
  const globalMax = maxUnitLevel(type);

  if (type === UnitType.FighterJet) {
    if (player.hasUpgrade(UpgradeType.FighterLevel4))
      return Math.min(4, globalMax);
    if (player.hasUpgrade(UpgradeType.FighterLevel3))
      return Math.min(3, globalMax);
    if (player.hasUpgrade(UpgradeType.FighterLevel2))
      return Math.min(2, globalMax);
    // Fighter Level 1 is available by default at game start
    return 1;
  }

  if (type === UnitType.Bomber) {
    if (player.hasUpgrade(UpgradeType.BomberLevel3))
      return Math.min(3, globalMax);
    if (player.hasUpgrade(UpgradeType.BomberLevel2))
      return Math.min(2, globalMax);
    // Bomber Level 1 is available by default at game start
    return 1;
  }

  if (type === UnitType.Warship) {
    if (player.hasUpgrade(UpgradeType.WarshipLevel3))
      return Math.min(3, globalMax);
    if (player.hasUpgrade(UpgradeType.WarshipLevel2))
      return Math.min(2, globalMax);
    // Warship Level 1 is available by default at game start
    return 1;
  }

  if (type === UnitType.Submarine) {
    if (player.hasUpgrade(UpgradeType.SubmarineLevel3))
      return Math.min(3, globalMax);
    if (player.hasUpgrade(UpgradeType.SubmarineLevel2))
      return Math.min(2, globalMax);
    // Submarine Level 1 is available by default at game start
    return 1;
  }

  if (type === UnitType.Artillery) {
    if (player.hasUpgrade(UpgradeType.ArtilleryLevel3))
      return Math.min(3, globalMax);
    if (player.hasUpgrade(UpgradeType.ArtilleryLevel2))
      return Math.min(2, globalMax);
    if (player.hasUpgrade(UpgradeType.ArtilleryResearch))
      return Math.min(1, globalMax);
    // Artillery not unlocked yet
    return 0;
  }

  // For other unit types, return global max
  return globalMax;
}

// Return maximum level for a structure based on stacking capability.
// All stackable structures (including SAM, Airfield, MissileSilo) can stack up to 25.
// Note: SAM and Airfield have separate tech upgrades (SAMLevel1-3, BomberLevel1-3)
// that affect the quality/stats, but stacking is independent.
export function playerMaxStructureLevel(
  _player: HasUpgrade,
  type: UnitType,
): number {
  // All stackable structures can go up to 25 stacks
  if (isUpgradeableStructure(type)) {
    return MAX_STACK_COUNT;
  }

  // Non-stackable structures have max level 1
  return 1;
}

// Return the maximum TECH level for a structure based on player's researched techs.
// For SAMLauncher: 1-3 based on SAM upgrades.
// For Airfield: 1-3 based on bomber upgrades.
// This is for quality/stats upgrades, NOT stacking.
export function playerMaxStructureTechLevel(
  player: HasUpgrade,
  type: UnitType,
): number {
  if (type === UnitType.SAMLauncher) {
    if (player.hasUpgrade(UpgradeType.SAMLevel3)) return 3;
    if (player.hasUpgrade(UpgradeType.SAMLevel2)) return 2;
    return 1;
  }

  if (type === UnitType.Airfield) {
    if (player.hasUpgrade(UpgradeType.BomberLevel3)) return 3;
    if (player.hasUpgrade(UpgradeType.BomberLevel2)) return 2;
    return 1;
  }

  // Non-tech-upgradeable structures always have tech level 1
  return 1;
}

// Resolve a UnitType value from a stored string value (String(UnitType.X))
export function tryParseUnitType(value: string): UnitType | null {
  for (const v of Object.values(UnitType) as UnitType[]) {
    if (String(v) === value) return v;
  }
  return null;
}

// Check if a unit/structure type is available to the player based on researched techs.
// Returns true if the player has the required upgrade to build/use this unit type.
export function isUnitAvailable(player: HasUpgrade, type: UnitType): boolean {
  switch (type) {
    case UnitType.Warship:
      // Warship Level 1 is available by default at game start
      return true;
    case UnitType.Submarine:
      // Diesel Sub unlocks with Sea Level 1 (Submarine research)
      return (
        player.hasUpgrade(UpgradeType.SubmarineResearch) ||
        player.hasUpgrade(UpgradeType.SubmarineLevel1)
      );
    case UnitType.Airfield:
    case UnitType.FighterJet:
    case UnitType.Bomber:
      // Fighter and Bomber Level 1 are available by default at game start
      return true;
    case UnitType.AtomBomb:
    case UnitType.MissileSilo:
      return player.hasUpgrade(UpgradeType.NuclearFission);
    case UnitType.HydrogenBomb:
      return player.hasUpgrade(UpgradeType.ThermonuclearStaging);
    case UnitType.MIRV:
      return player.hasUpgrade(UpgradeType.MIRVTechnology);
    case UnitType.DoomsdayDevice:
      return player.hasUpgrade(UpgradeType.DoomsdayDeviceResearch);
    case UnitType.SAMLauncher:
      // SAM Level 1 is available by default at game start
      return true;
    case UnitType.Academy:
      return player.hasUpgrade(UpgradeType.MilitaryAcademy);
    case UnitType.Hospital:
      return player.hasUpgrade(UpgradeType.HospitalResearch);
    case UnitType.ResearchLab:
      // Research Lab is available without a tech gate
      return true;
    default:
      return true;
  }
}
