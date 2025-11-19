import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class DoomsdayDeviceExecution implements Execution {
  private active = true;
  private mg: Game;
  private device: Unit | null = null;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.device === null) {
      const spawn = this.player.canBuild(UnitType.DoomsdayDevice, this.tile);
      if (spawn === false) {
        console.warn(
          `player ${this.player} cannot build doomsday device at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.device = this.player.buildUnit(UnitType.DoomsdayDevice, spawn, {});

      if (this.player !== this.device.owner()) {
        this.player = this.device.owner();
      }
    }

    if (!this.device.isActive()) {
      this.active = false;
      return;
    }

    // For now, the Doomsday Device has no special effects
    // Future functionality can be added here
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
