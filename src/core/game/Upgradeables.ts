import { UnitType } from "./Game";

export const UPGRADEABLE_STRUCTURES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.City,
  UnitType.Port,
  UnitType.Hospital,
  UnitType.Academy,
  UnitType.ResearchLab,
  UnitType.Factory,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
]);

export function isUpgradeableStructure(type: UnitType): boolean {
  return UPGRADEABLE_STRUCTURES.has(type);
}

export function maxStructureLevel(type: UnitType): number {
  if (type === UnitType.MissileSilo || type === UnitType.SAMLauncher) {
    return 3;
  }
  return isUpgradeableStructure(type) ? 99 : 1;
}

// Resolve a UnitType value from a stored string value (String(UnitType.X))
export function tryParseUnitType(value: string): UnitType | null {
  for (const v of Object.values(UnitType) as UnitType[]) {
    if (String(v) === value) return v;
  }
  return null;
}
