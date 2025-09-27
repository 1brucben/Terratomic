import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import {
  attemptInterception,
  findEligibleCitiesForBomber,
} from "./utils/CityAntiAirUtils";

export class BomberExecution implements Execution {
  private active = true;
  private mg: Game;
  private bomber!: Unit;
  private bombsLeft!: number;
  private returning = false;
  private pathFinder: StraightPathFinder;
  private dropTicker = 0;
  private eligibleCities: Unit[] = [];
  private random: PseudoRandom;

  constructor(
    private origOwner: Player,
    private sourceAirfield: Unit,
    private targetTile: TileRef,
    private bombersOnTarget: Map<TileRef, number>,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new StraightPathFinder(mg);
    this.bombsLeft = mg.config().bomberPayload();
    this.random = new PseudoRandom(ticks);
  }

  tick(_ticks: number): void {
    if (!this.bomber) {
      const spawn = this.origOwner.canBuild(
        UnitType.Bomber,
        this.sourceAirfield.tile(),
      );
      if (!spawn) {
        this.active = false;
        this.bombersOnTarget.set(
          this.targetTile,
          (this.bombersOnTarget.get(this.targetTile) ?? 1) - 1,
        );
        return;
      }
      this.bomber = this.origOwner.buildUnit(UnitType.Bomber, spawn, {
        targetTile: this.targetTile,
      });
      this.eligibleCities = findEligibleCitiesForBomber(this.bomber, this.mg);
    }
    if (!this.bomber.isActive()) {
      this.active = false;
      this.bombersOnTarget.set(
        this.targetTile,
        (this.bombersOnTarget.get(this.targetTile) ?? 1) - 1,
      );
      return;
    }

    const destination = this.returning
      ? this.sourceAirfield.tile()
      : this.targetTile;

    const speed = this.mg.config().bomberSpeed();
    for (let i = 0; i < speed; i++) {
      const step = this.pathFinder.nextTile(this.bomber.tile(), destination, 1);

      if (step === true) {
        if (!this.returning && this.bombsLeft > 0) {
          this.dropBomb();
        } else if (this.returning) {
          this.bomber.delete(true);
          this.active = false;
          this.bombersOnTarget.set(
            this.targetTile,
            (this.bombersOnTarget.get(this.targetTile) ?? 1) - 1,
          );
        }
        return;
      }

      this.bomber.move(step);

      if (this.bomber === null || this.bomber.targetedBySAM()) return;

      const currentBomber = this.bomber;
      const readyInterceptors = this.eligibleCities.filter(
        (city) =>
          !this.mg.isCitySamOnCooldown(city.id()) &&
          this.mg.euclideanDistSquared(currentBomber.tile(), city.tile()) <=
            this.mg.config().citySamLaunchRange() *
              this.mg.config().citySamLaunchRange(),
      );

      if (readyInterceptors.length > 0) {
        readyInterceptors.sort(
          (a, b) =>
            this.mg.euclideanDistSquared(currentBomber.tile(), a.tile()) -
            this.mg.euclideanDistSquared(currentBomber.tile(), b.tile()),
        );

        const closestInterceptor = readyInterceptors[0];
        attemptInterception(currentBomber, this.mg, closestInterceptor);
      }

      if (
        !this.returning &&
        this.bombsLeft > 0 &&
        ++this.dropTicker >= this.mg.config().bomberDropCadence() &&
        this.mg.euclideanDistSquared(this.bomber.tile(), this.targetTile) <= 1
      ) {
        this.dropBomb();
        this.dropTicker = 0;
        return;
      }
    }
  }

  private dropBomb(): void {
    this.mg.bomberExplosion(
      this.bomber.tile(),
      this.mg.config().bomberExplosionRadius(),
      this.origOwner,
    );
    this.bombsLeft--;
    if (this.bombsLeft === 0) {
      this.returning = true;
      this.bomber.setReturning(true);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
