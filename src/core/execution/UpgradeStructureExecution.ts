import { Execution, Gold, Player, Unit, UnitType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { UnitImpl } from "../game/UnitImpl";
import { NoOpExecution } from "./NoOpExecution";

/**
 * Generic structure upgrade execution.
 * Supports City, Port, Hospital, and Academy upgrades.
 */
export class UpgradeStructureExecution implements Execution {
  private mg!: GameImpl;
  private _isActive = true;

  constructor(
    private player: Player,
    private unit: Unit,
  ) {}

  isActive(): boolean {
    return this._isActive;
  }

  activeDuringSpawnPhase(): boolean {
    return true; // Allow upgrades during spawn phase (mirrors build behavior)
  }

  init(mg: GameImpl, _ticks: number): void {
    this.mg = mg;
    if (!this.unit.isUnit || !this.unit.isUnit()) {
      this._isActive = false;
      return;
    }
    if (this.unit.owner() !== this.player) {
      this._isActive = false;
      return;
    }

    switch (this.unit.type()) {
      case UnitType.City:
      case UnitType.Port:
      case UnitType.Hospital:
      case UnitType.Academy:
      case UnitType.MissileSilo:
      case UnitType.SAMLauncher: {
        const unitType = this.unit.type();
        // Enforce missile silo max level 3 on the executor side to avoid charging when capped
        if (
          (unitType === UnitType.MissileSilo ||
            unitType === UnitType.SAMLauncher) &&
          (this.unit.level?.call(this.unit) ?? 1) >= 3
        ) {
          this._isActive = false;
          return;
        }
        const baseCost: Gold = this.mg.unitInfo(unitType).cost(this.player);
        // Use decimal multiplier; compute BigInt-safe using fixed scale
        const multiplier = this.mg
          .config()
          .structureUpgradeCostMultiplier(unitType);
        const scale = 100n; // two decimal digits of precision
        const scaledMultiplier = BigInt(Math.round(multiplier * Number(scale)));
        const upgradeCost: Gold = (baseCost * scaledMultiplier) / scale;
        if (this.player.gold() < upgradeCost) {
          this._isActive = false;
          return;
        }
        this.player.removeGold(upgradeCost);
        (this.unit as UnitImpl).upgradeStructure();
        this._isActive = false;
        return;
      }
      default: {
        // Unsupported structure type for upgrade at this time
        this._isActive = false;
        return;
      }
    }
  }

  tick(_ticks: number): void {
    // One-shot handled in init
  }

  static fromIntent(
    mg: GameImpl,
    intent: {
      type: "upgrade_structure";
      unitId: number;
      unitType: UnitType;
      clientID: string;
    },
  ): Execution {
    const player = mg.playerByClientID(intent.clientID);
    if (!player) return new NoOpExecution();
    const unit = player.units().find((u) => u.id() === intent.unitId);
    if (!unit || unit.type() !== intent.unitType) return new NoOpExecution();
    return new UpgradeStructureExecution(player, unit);
  }
}
