import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class HospitalExecution implements Execution {
  private mg: Game;
  private hospital: Unit | null = null;
  private active: boolean = true;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.hospital === null) {
      const spawnTile = this.player.canBuild(UnitType.Hospital, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build hospital");
        this.active = false;
        return;
      }
      this.hospital = this.player.buildUnit(UnitType.Hospital, spawnTile, {});
    }
    if (!this.hospital.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.hospital.owner()) {
      this.player = this.hospital.owner();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
