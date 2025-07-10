import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";

export class BomberExecution implements Execution {
  private active = true;
  private mg: Game;
  private bomber!: Unit;
  private bombsLeft!: number;
  private returning = false;
  private pathFinder: StraightPathFinder;
  private dropTicker = 0;

  constructor(
    private origOwner: Player,
    private sourceAirfield: Unit,
    private targetTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new StraightPathFinder(mg);
    this.bombsLeft = mg.config().bomberPayload();
  }

  tick(_ticks: number): void {
    if (!this.bomber) {
      const spawn = this.origOwner.canBuild(
        UnitType.Bomber,
        this.sourceAirfield.tile(),
      );
      if (!spawn) {
        this.active = false;
        return;
      }
      this.bomber = this.origOwner.buildUnit(UnitType.Bomber, spawn, {
        targetTile: this.targetTile,
      });
    }
    if (!this.bomber.isActive()) {
      this.active = false;
      return;
    }
    if (!this.returning && this.bombsLeft > 0) {
      this.dropTicker++;
      if (
        this.dropTicker >= this.mg.config().bomberDropCadence() &&
        this.mg.euclideanDistSquared(this.bomber.tile(), this.targetTile) <= 1
      ) {
        this.dropBomb();
        this.dropTicker = 0;
        return;
      }
    }

    const destination = this.returning
      ? this.sourceAirfield.tile()
      : this.targetTile;

    const step = this.pathFinder.nextTile(this.bomber.tile(), destination, 2);

    if (step === true) {
      if (!this.returning && this.bombsLeft > 0) {
        this.dropBomb();
      } else if (this.returning) {
        this.bomber.delete(true);
        this.active = false;
      }
      return;
    }
    this.bomber.move(step);
  }

  private dropBomb(): void {
    this.mg.bomberExplosion(
      this.bomber.tile(),
      this.mg.config().bomberExplosionRadius(),
      this.origOwner,
    );
    this.bombsLeft--;
    if (this.bombsLeft === 0) this.returning = true;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
