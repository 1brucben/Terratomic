import { UnitType } from "../../core/game/Game";

export function parseBuildAction(action: string): UnitType | null {
  if (!action.startsWith("build:")) {
    return action as UnitType;
  }

  const unitType = action.slice("build:".length) as UnitType;
  return unitType || null;
}

export function getBomberTargetStructures(): UnitType[] {
  return [
    UnitType.City,
    UnitType.DefensePost,
    UnitType.SAMLauncher,
    UnitType.MissileSilo,
    UnitType.Port,
    UnitType.Airfield,
    UnitType.Hospital,
    UnitType.Academy,
    UnitType.ResearchLab,
    UnitType.Factory,
    UnitType.DoomsdayDevice,
  ];
}
