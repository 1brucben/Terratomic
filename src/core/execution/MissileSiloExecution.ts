import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MissileSiloExecution implements Execution {
  private active = true;
  private mg: Game;
  private silo: Unit | null = null;

  constructor(
    private player: Player,
    private tile: TileRef,
    private desiredLevel?: number,
    private stackCount: number = 1,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.silo === null) {
      const spawn = this.player.canBuild(UnitType.MissileSilo, this.tile);
      if (spawn === false) {
        console.warn(
          `player ${this.player} cannot build missile silo at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.silo = this.player.buildUnit(UnitType.MissileSilo, spawn, {});

      // Apply stack count (multiple silos in one tile)
      if (this.stackCount > 1) {
        const impl = this.silo as any;
        if (typeof impl.setStackCount === "function") {
          impl.setStackCount(this.stackCount);
        }
        // Apply HP bonuses for stacking via upgradeStructure
        if (typeof impl.upgradeStructure === "function") {
          for (let i = 0; i < this.stackCount - 1; i++) {
            impl.upgradeStructure();
          }
        }
      }

      // Apply upgrades up to cap 3 if requested
      const level = this.computeDesiredLevel(
        UnitType.MissileSilo,
        this.desiredLevel,
      );
      this.applyUpgrades(this.silo, level);

      if (this.player !== this.silo.owner()) {
        this.player = this.silo.owner();
      }
    }

    const cooldown = this.silo.ticksLeftInCooldown();
    if (typeof cooldown === "number" && cooldown >= 0) {
      this.silo.touch();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private computeDesiredLevel(_type: UnitType, target?: number): number {
    if (target === undefined || target < 1) return 1;
    return Math.min(3, Math.max(1, target));
  }
  private applyUpgrades(unit: Unit, desiredLevel: number) {
    const steps = Math.max(0, desiredLevel - 1);
    if (steps <= 0) return;
    const impl = unit as any;
    if (typeof impl.upgradeStructure === "function") {
      for (let i = 0; i < steps; i++) impl.upgradeStructure();
    }
  }
}
