import { Execution, Player, Unit } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { maxUnitLevel } from "../game/Upgradeables";

export class UpgradeUnitExecution implements Execution {
  private mg: GameImpl;
  private _isActive = true;

  constructor(
    private player: Player,
    private unitId: number,
  ) {}

  public static fromIntent(
    game: GameImpl,
    intent: {
      type: "upgrade_unit";
      unitId: number;
      clientID: string;
    },
  ): UpgradeUnitExecution | null {
    const player = game.playerByClientID(intent.clientID);
    if (!player) return null;
    return new UpgradeUnitExecution(player, intent.unitId);
  }

  public isActive(): boolean {
    return this._isActive;
  }

  public activeDuringSpawnPhase(): boolean {
    return true;
  }

  public init(mg: GameImpl, _ticks: number): void {
    this.mg = mg;
    const unit = this.findUnit();
    if (!unit) {
      this._isActive = false;
      return;
    }

    const type = unit.type();
    const maxLevel = maxUnitLevel(type);
    // Only upgrade supported unit types
    if (maxLevel <= 1) {
      this._isActive = false;
      return;
    }

    const currentLevel = unit.level();
    if (currentLevel >= maxLevel) {
      this._isActive = false;
      return;
    }

    // Increment unit level and emit update.
    (unit as unknown as any)._level = currentLevel + 1;
    this.mg.addUpdate(unit.toUpdate());

    this._isActive = false;
  }

  public tick(_ticks: number): void {
    // All logic handled in init
  }

  private findUnit(): (Unit & { level(): number }) | null {
    const unit = this.player.units().find((u) => u.id() === this.unitId);
    if (!unit) return null;
    if (unit.owner() !== this.player) return null;
    return unit as Unit & { level(): number };
  }
}
