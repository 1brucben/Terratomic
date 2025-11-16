import { Gold } from "./Game";

const SCALE = 100n; // two decimal places of precision

export function computeUpgradeStepCost(base: Gold, multiplier: number): Gold {
  const scaled = BigInt(Math.round(multiplier * Number(SCALE)));
  return (base * scaled) / SCALE;
}

export function aggregateStructureBuildCost(
  base: Gold,
  desiredLevel: number,
  multiplier: number,
): Gold {
  if (desiredLevel <= 1) return base;
  const step = computeUpgradeStepCost(base, multiplier);
  return base + step * BigInt(desiredLevel - 1);
}
