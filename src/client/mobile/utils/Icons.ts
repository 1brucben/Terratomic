/**
 * Icon mappings for mobile UI - uses desktop image icons instead of emojis
 */

import { UnitType } from "../../../core/game/Game";

/**
 * Maps unit types to their corresponding icon image paths
 */
export const UNIT_ICONS: Partial<Record<UnitType, string>> = {
  // Structures
  [UnitType.City]: "/images/CityIconWhite.svg",
  [UnitType.Factory]: "/images/factoryicon.png",
  [UnitType.DefensePost]: "/images/ShieldIconWhite.svg",
  [UnitType.Airfield]: "/images/AirfieldIcon.svg",
  [UnitType.Hospital]: "/images/HospitalIconWhite.svg",
  [UnitType.MissileSilo]: "/images/MissileSiloIconWhite.svg",
  [UnitType.ResearchLab]: "/images/researchlab.png",
  [UnitType.Academy]: "/images/AcademyIconWhite.png",
  [UnitType.SAMLauncher]: "/images/SamLauncherIconWhite.svg",
  [UnitType.DoomsdayDevice]: "/images/doomsdayicon.png",
  [UnitType.Port]: "/images/PortIcon.svg",

  // Military units
  [UnitType.Warship]: "/images/BattleshipIconWhite.svg",
  [UnitType.FighterJet]: "/images/FighterJetIcon.svg",
  [UnitType.Artillery]: "/images/artillery-battery.png",
  [UnitType.AtomBomb]: "/images/NukeIconWhite.svg",
  [UnitType.MIRV]: "/images/MIRVIcon.svg",
  [UnitType.Submarine]: "/images/submarine.svg",
};

/**
 * Action-specific icons that don't correspond to unit types
 */
export const ACTION_ICONS = {
  // Spawn & build
  spawn: "/images/TargetIconWhite.svg",

  // Military actions
  attack: "/images/SwordIconWhite.svg",
  groundAttack: "/images/TroopIconWhite.png",
  navyAttack: "/images/BattleshipIconWhite.svg",
  navyAssault: "/images/BattleshipIconWhite.svg",
  airAttack: "/images/FighterJetIcon.svg",
  paratrooper: "/images/AirAttackIconWhite.svg",
  bomber: "/images/bomberv3.39cfac5d40bad7d635c9.png",
  artilleryAttack: "/images/artillery-battery.png",
  submarine: "/images/submarine.svg",

  // Nuclear weapons
  nuke: "/images/NukeIconWhite.svg",
  atomBomb: "/images/NukeIconWhite.svg",
  mirv: "/images/MIRVIcon.svg",
  hydrogenBomb: "/images/hydrogenbomb.81185aebfcd656ead5aa.png",
  hBomb: "/images/hydrogenbomb.81185aebfcd656ead5aa.png",

  // Diplomacy
  peace: "/images/dove.b5af4f12b19e5773feee.png",
  alliance: "/images/AllianceIconWhite.svg",
  breakAlliance: "/images/TraitorIconWhite.svg",
  declareWar: "/images/SwordIconWhite.svg",

  // Other
  troop: "/images/TroopIconWhite.png",
} as const;

/**
 * Gets the icon path for a unit type
 */
export function getUnitIcon(unitType: UnitType): string | undefined {
  return UNIT_ICONS[unitType];
}

/**
 * Gets the icon path for a specific action
 */
export function getActionIcon(action: keyof typeof ACTION_ICONS): string {
  return ACTION_ICONS[action];
}
