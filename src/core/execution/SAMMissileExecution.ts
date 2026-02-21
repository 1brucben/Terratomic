import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { NukeType } from "../StatsSchemas";

export class SAMMissileExecution implements Execution {
  executionName = "SAMMissileExecution";
  private active = true;
  private pathFinder: SteppingPathFinder<TileRef>;
  private SAMMissile: Unit | undefined;
  private mg: Game;
  private speed: number = 0;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private targetTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinding.Air(mg);
    this.mg = mg;
    this.speed = this.mg.config().defaultSamMissileSpeed();
  }

  tick(ticks: number): void {
    this.SAMMissile ??= this._owner.buildUnit(
      UnitType.SAMMissile,
      this.spawn,
      {},
    );
    if (!this.SAMMissile.isActive()) {
      this.active = false;
      return;
    }

    // MIRV warheads are too fast and MIRVs should not be stopped by SAMs.
    const Whitelist = [
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.CargoPlane,
      UnitType.Bomber,
      UnitType.FighterJet,
      UnitType.Paratrooper,
    ];

    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() === this.SAMMissile.owner() ||
      !Whitelist.includes(this.target.type())
    ) {
      try {
        this.target.setTargetedBySAM(false);
      } catch (e) {
        // If the target is already gone or invalid, ignore.
      }

      this.SAMMissile.delete(false);
      this.active = false;
      return;
    }

    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.next(
        this.SAMMissile.tile(),
        this.targetTile,
      );
      if (result.status === PathStatus.COMPLETE) {
        if (
          this.target.type() === UnitType.AtomBomb ||
          this.target.type() === UnitType.HydrogenBomb
        ) {
          this.mg.displayMessage(
            `Missile intercepted ${this.target.type()}`,
            MessageType.SAM_HIT,
            this._owner.id(),
          );

          this.mg
            .stats()
            .bombIntercept(this._owner, this.target.type() as NukeType, 1);
        }
        this.active = false;
        this.target.delete(true, this._owner);
        this.SAMMissile.delete(false);

        return;
      } else if (result.status === PathStatus.NEXT) {
        this.SAMMissile.move(result.node);
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
