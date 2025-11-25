import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";

/**
 * Execution for a single AA bullet fired from a city at an enemy plane.
 * Bullets travel in a straight line directly to the target.
 */
export class CityAABulletExecution implements Execution {
  private active = true;
  private pathFinder: StraightPathFinder;
  private bullet: Unit | undefined;
  private mg: Game;
  private speed: number = 0;
  private damage: number = 0;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private sourceCity: Unit,
    private target: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new StraightPathFinder(mg.map());
    this.speed = mg.config().cityAABulletSpeed();
    this.damage = mg.config().cityAABulletDamage();
  }

  tick(ticks: number): void {
    // Create bullet on first tick
    this.bullet ??= this._owner.buildUnit(UnitType.AABullet, this.spawn, {});

    if (!this.bullet.isActive()) {
      this.active = false;
      return;
    }

    // Check if target is still valid
    if (
      !this.target.isActive() ||
      this.target.owner() === this.bullet.owner() ||
      this._owner.isFriendly(this.target.owner())
    ) {
      this.bullet.delete(false);
      this.active = false;
      return;
    }

    // Move bullet toward target
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.nextTile(
        this.bullet.tile(),
        this.target.tile(),
        1,
      );

      if (result === true) {
        // Move bullet to target's exact position for visual sync
        // This ensures the explosion appears on the plane, not behind it
        this.bullet.move(this.target.tile());

        // Bullet reached target - deal damage
        // Don't damage planes that have landed at their airfield
        if (!this.target.isAtSourceAirfield()) {
          this.target.modifyHealth(-this.damage, this._owner);

          // Aggression tracking
          const targetOwner = this.target.owner();
          if (targetOwner.isPlayer() && this._owner.isPlayer()) {
            const tp = targetOwner as Player;
            this._owner.recordAggression(tp);
            tp.recordAggression(this._owner);
          }
        }

        this.bullet.setReachedTarget();
        this.bullet.delete(false);
        this.active = false;
        return;
      } else {
        this.bullet.move(result);
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
