import { Gold, UnitType } from "./Game";
import { getUnitLevelCost, getUnitUpgradeData } from "./UnitUpgrades";
import { maxUnitLevel } from "./Upgradeables";

const SCALE = 100n; // two decimal places of precision

export function computeUpgradeStepCost(base: Gold, multiplier: number): Gold {
  const scaled = BigInt(Math.round(multiplier * Number(SCALE)));
  return (base * scaled) / SCALE;
}

type UnitInfoLike = { cost: (player: any) => Gold };
type UnitInfoProvider = { unitInfo: (t: UnitType) => UnitInfoLike };

function withUnitsOwned(
  player: any,
  type: UnitType,
  hypotheticalCount: number,
): any {
  // Proxy to override unitsOwned for a specific type; forward everything else
  return new Proxy(player, {
    get(target, prop, receiver) {
      if (prop === "unitsOwned") {
        return (t: UnitType) =>
          t === type ? hypotheticalCount : target.unitsOwned(t);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function aggregateStructureBuildCost(
  unitInfoProvider: UnitInfoProvider,
  player: any,
  type: UnitType,
  desiredLevel: number,
  multiplier: number,
): Gold {
  // For upgradeable units (Bomber, Fighter, Warship, Submarine), use hardcoded total costs
  const unitUpgrades = getUnitUpgradeData(type);
  if (unitUpgrades) {
    // UnitUpgrades now stores total cost at each level, just return it directly
    return getUnitLevelCost(type, desiredLevel);
  }

  // For structures, use the existing multiplier-based calculation
  const base = unitInfoProvider.unitInfo(type).cost(player);
  const steps = Math.max(0, desiredLevel - 1);
  if (steps === 0) return base;
  const currentCount =
    typeof player.unitsOwned === "function" ? player.unitsOwned(type) : 0;
  let total: Gold = base;
  for (let j = 1; j <= steps; j++) {
    const hypoCount = currentCount + j;
    const hypoPlayer = withUnitsOwned(player, type, hypoCount);
    const stepBase = unitInfoProvider.unitInfo(type).cost(hypoPlayer);
    total += computeUpgradeStepCost(stepBase, multiplier);
  }
  return total;
}

type AirfieldCostProvider = {
  unitInfo: (t: UnitType) => { cost: (player: any) => Gold };
};

/**
 * Compute bomber upgrade cost for airfields during construction.
 * Now uses hardcoded costs from UnitUpgrades instead of calculating.
 */
export function computeBomberUpgradeCost(
  _provider: AirfieldCostProvider,
  _player: any,
  bomberLevel: number,
  _airfieldLevel: number = 1,
): Gold {
  const bLevel = Math.min(
    maxUnitLevel(UnitType.Bomber),
    Math.max(1, bomberLevel),
  );
  if (bLevel <= 1) return 0n;
  // Use hardcoded total cost from UnitUpgrades
  return getUnitLevelCost(UnitType.Bomber, bLevel);
}
