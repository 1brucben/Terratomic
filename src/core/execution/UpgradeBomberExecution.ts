import { BOMBER_UPGRADE_COST_MULTIPLIER } from "../game/Costs";
import { Execution, Gold, Player, Unit, UnitType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { maxUnitLevel } from "../game/Upgradeables";
import { NoOpExecution } from "./NoOpExecution";

/**
 * Upgrades all bombers associated with an airfield.
 * Cost = 20% of new airfield cost × airfield level (number of bombers).
 */
export class UpgradeBomberExecution implements Execution {
  private mg!: GameImpl;
  private _isActive = true;

  constructor(
    private player: Player,
    private airfield: Unit,
  ) {}

  isActive(): boolean {
    return this._isActive;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  init(mg: GameImpl, _ticks: number): void {
    this.mg = mg;

    // Validate airfield
    if (!this.airfield.isUnit?.() || !this.airfield.isActive()) {
      this._isActive = false;
      return;
    }
    if (this.airfield.owner() !== this.player) {
      this._isActive = false;
      return;
    }
    if (this.airfield.type() !== UnitType.Airfield) {
      this._isActive = false;
      return;
    }

    // Get bombers for this airfield
    const bombers = this.player
      .units(UnitType.Bomber)
      .filter((b) => b.sourceAirfield?.()?.id() === this.airfield.id());

    if (bombers.length === 0) {
      this._isActive = false;
      return;
    }

    // Check if airfield's bomber level can be upgraded (not at max level)
    const currentBomberLevel = this.airfield.bomberLevel?.() ?? 1;
    if (currentBomberLevel >= maxUnitLevel(UnitType.Bomber)) {
      this._isActive = false;
      return;
    }

    // Calculate cost: 20% of airfield cost × airfield level
    const airfieldBaseCost: Gold = this.mg
      .unitInfo(UnitType.Airfield)
      .cost(this.player);
    const airfieldLevel = this.airfield.level?.() ?? 1;
    const upgradeCost: Gold =
      (airfieldBaseCost *
        BigInt(Math.round(BOMBER_UPGRADE_COST_MULTIPLIER * 100)) *
        BigInt(airfieldLevel)) /
      100n;

    if (this.player.gold() < upgradeCost) {
      this._isActive = false;
      return;
    }

    // Deduct cost and upgrade airfield's bomber level
    this.player.removeGold(upgradeCost);
    this.airfield.setBomberLevel?.(currentBomberLevel + 1);

    // Update existing bombers' max health to match new level
    const newLevel = currentBomberLevel + 1;
    const baseHealth = this.mg.unitInfo(UnitType.Bomber).maxHealth ?? 500;
    const newMaxHealth = this.mg.config().bomberMaxHealth(newLevel);
    const bonus = newMaxHealth - baseHealth;
    for (const bomber of bombers) {
      (bomber as any)._bonusMaxHealth = bonus > 0 ? bonus : 0;
      // Emit update so client sees new max health
      this.mg.addUpdate(bomber.toUpdate());
    }

    this._isActive = false;
  }

  tick(_ticks: number): void {
    // One-shot handled in init
  }

  static fromIntent(
    mg: GameImpl,
    intent: {
      type: "upgrade_bomber";
      airfieldId: number;
      clientID: string;
    },
  ): Execution {
    const player = mg.playerByClientID(intent.clientID);
    if (!player) return new NoOpExecution();
    const airfield = player
      .units(UnitType.Airfield)
      .find((u) => u.id() === intent.airfieldId);
    if (!airfield) return new NoOpExecution();
    return new UpgradeBomberExecution(player, airfield);
  }
}
