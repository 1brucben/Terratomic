import { UnitType, UpgradeType } from "./Game";

// Interface for checking upgrades - works with both Player and PlayerView
interface HasUpgrade {
  hasUpgrade(type: UpgradeType): boolean;
}

export const UPGRADEABLE_STRUCTURES: ReadonlySet<UnitType> = new Set<UnitType>([
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

// Units that can be upgraded
export const UPGRADEABLE_UNITS: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.Warship,
  UnitType.FighterJet,
  UnitType.Submarine,
  UnitType.Bomber, // Bomber level affects airfield construction cost
]);

export function isUpgradeableStructure(type: UnitType): boolean {
  return UPGRADEABLE_STRUCTURES.has(type);
}

export function isUpgradeableUnit(type: UnitType): boolean {
  return UPGRADEABLE_UNITS.has(type);
}

export function maxStructureLevel(type: UnitType): number {
  if (type === UnitType.MissileSilo || type === UnitType.SAMLauncher) {
    return 3;
  }
  return isUpgradeableStructure(type) ? 99 : 1;
}

// Return maximum upgrade level for upgradeable combat units.
// Warship, Submarine & Bomber: 3 levels. Fighter Jet: 4 levels. Non-upgradeable units: 1.
export function maxUnitLevel(type: UnitType): number {
  switch (type) {
    case UnitType.FighterJet:
      return 4;
    case UnitType.Warship:
    case UnitType.Submarine:
    case UnitType.Bomber:
      return 3;
    default:
      return 1;
  }
}

// Return maximum upgrade level for a player based on their researched techs.
// For FighterJet: Jet Engines = level 1, Supersonic Flight = level 2,
// Pulse-Doppler Radar = level 3, Fly-By-Wire Systems = level 4.
export function playerMaxUnitLevel(player: HasUpgrade, type: UnitType): number {
  const globalMax = maxUnitLevel(type);

  if (type === UnitType.FighterJet) {
    if (player.hasUpgrade(UpgradeType.FighterLevel4))
      return Math.min(4, globalMax);
    if (player.hasUpgrade(UpgradeType.FighterLevel3))
      return Math.min(3, globalMax);
    if (player.hasUpgrade(UpgradeType.FighterLevel2))
      return Math.min(2, globalMax);
    // Jet Engines (required to build fighters) gives level 1
    return 1;
  }

  // For other unit types, return global max (can add bomber levels later)
  return globalMax;
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
    case UnitType.Submarine:
      return player.hasUpgrade(UpgradeType.SubmarineResearch);
    case UnitType.Airfield:
    case UnitType.FighterJet:
    case UnitType.Bomber:
      return player.hasUpgrade(UpgradeType.JetEngines);
    case UnitType.AtomBomb:
    case UnitType.MissileSilo:
      return player.hasUpgrade(UpgradeType.NuclearFission);
    case UnitType.HydrogenBomb:
      return player.hasUpgrade(UpgradeType.ThermonuclearStaging);
    case UnitType.MIRV:
      return player.hasUpgrade(UpgradeType.MIRVTechnology);
    case UnitType.DoomsdayDevice:
      return player.hasUpgrade(UpgradeType.DoomsdayDeviceResearch);
    default:
      return true;
  }
}
