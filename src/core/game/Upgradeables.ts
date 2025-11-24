import { UnitType } from "./Game";

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

// Resolve a UnitType value from a stored string value (String(UnitType.X))
export function tryParseUnitType(value: string): UnitType | null {
  for (const v of Object.values(UnitType) as UnitType[]) {
    if (String(v) === value) return v;
  }
  return null;
}
