import { UnitType } from "../../core/game/Game";

export interface UIState {
  attackRatio: number;
  investmentRate: number;
  pendingBuildUnitType: UnitType | null;
  multibuildEnabled: boolean;
  // Whether the player is currently in city upgrade targeting mode
  upgradeMode: boolean;
  // Local client-side unit levels (id -> level)
  unitLevels: Record<number, number>;
}
