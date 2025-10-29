import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";

export class PortExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private port: Unit | null = null;
  private random: PseudoRandom | null = null;
  private checkOffset: number | null = null;

  constructor(
    private player: Player,
    private tile: TileRef,
    private desiredLevel?: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.random === null || this.checkOffset === null) {
      throw new Error("Not initialized");
    }
    if (this.port === null) {
      const tile = this.tile;
      const spawn = this.player.canBuild(UnitType.Port, tile);
      if (spawn === false) {
        console.warn(
          `player ${this.player.id()} cannot build port at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.port = this.player.buildUnit(UnitType.Port, spawn, {});
      // Apply upgrades if requested
      const level = this.computeDesiredLevel(UnitType.Port, this.desiredLevel);
      this.applyUpgrades(this.port, level);
    }

    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

    if (this.player.id() !== this.port.owner().id()) {
      this.player = this.port.owner();
    }

    // Only check every 10 ticks for performance.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    // Trade rework: trade ships are assigned by TradeManager; ports no longer
    // spawn spontaneous trade routes here. Keep this execution responsible for
    // ensuring the port exists and remains active.
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private computeDesiredLevel(_type: UnitType, target?: number): number {
    if (target === undefined || target < 1) return 1;
    return Math.max(1, Math.min(10, target));
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
