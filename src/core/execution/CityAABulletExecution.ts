import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";

/**
 * Execution for a single AA bullet fired from a city at an enemy plane.
 * Bullets travel in a straight line using predictive targeting to intercept
 * moving targets.
 */
export class CityAABulletExecution implements Execution {
  private active = true;
  private pathFinder: StraightPathFinder;
  private bullet: Unit | undefined;
  private mg: Game;
  private speed: number = 0;
  private damage: number = 0;
  private predictedTile: TileRef | null = null;

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

    // Calculate initial predicted intercept point
    this.updatePredictedTile(this.spawn);
  }

  /**
   * Calculate the predicted intercept point based on target velocity.
   * Uses leading shot calculation to aim where the target will be.
   */
  private updatePredictedTile(bulletTile: TileRef): void {
    const map = this.mg.map();

    // Get target position and velocity
    const targetX = map.x(this.target.tile());
    const targetY = map.y(this.target.tile());
    const lastTargetX = map.x(this.target.lastTile());
    const lastTargetY = map.y(this.target.lastTile());

    // Target velocity (tiles per tick)
    const targetVx = targetX - lastTargetX;
    const targetVy = targetY - lastTargetY;

    // Bullet position
    const bulletX = map.x(bulletTile);
    const bulletY = map.y(bulletTile);

    // Distance to target
    const dx = targetX - bulletX;
    const dy = targetY - bulletY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) {
      this.predictedTile = this.target.tile();
      return;
    }

    // Estimate time to intercept (simple approximation)
    // Time = distance / (bullet speed - closing rate component)
    const closingRate = (dx * targetVx + dy * targetVy) / dist;
    const effectiveSpeed = Math.max(1, this.speed - closingRate);
    const timeToIntercept = dist / effectiveSpeed;

    // Predict where target will be
    const predictedX = Math.round(targetX + targetVx * timeToIntercept);
    const predictedY = Math.round(targetY + targetVy * timeToIntercept);

    // Clamp to map bounds
    const clampedX = Math.max(0, Math.min(map.width() - 1, predictedX));
    const clampedY = Math.max(0, Math.min(map.height() - 1, predictedY));

    this.predictedTile = map.ref(clampedX, clampedY);
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
      console.log(
        `AA bullet missed: target ${!this.target.isActive() ? "destroyed" : "became friendly"}`,
      );
      this.bullet.delete(false);
      this.active = false;
      return;
    }

    // Update predicted intercept point each tick
    this.updatePredictedTile(this.bullet.tile());

    // Move bullet toward predicted position
    for (let i = 0; i < this.speed; i++) {
      // Check if we've reached the actual target (not just predicted position)
      const bulletTile = this.bullet.tile();
      const targetTile = this.target.tile();

      if (bulletTile === targetTile) {
        // Hit the target!
        this.applyDamage();
        return;
      }

      // Move toward predicted position
      const result = this.pathFinder.nextTile(
        bulletTile,
        this.predictedTile!,
        1,
      );

      if (result === true) {
        // Reached predicted position but target might have moved
        // Check if target is adjacent or at this position
        const map = this.mg.map();
        const bx = map.x(bulletTile);
        const by = map.y(bulletTile);
        const tx = map.x(targetTile);
        const ty = map.y(targetTile);
        const distToTarget = Math.abs(bx - tx) + Math.abs(by - ty);

        if (distToTarget <= 1) {
          // Close enough - hit!
          this.bullet.move(targetTile);
          this.applyDamage();
          return;
        }

        // Target moved away from predicted position, recalculate
        this.updatePredictedTile(bulletTile);
      } else {
        this.bullet.move(result);
      }
    }
  }

  private applyDamage(): void {
    // Move bullet to target's exact position for visual sync
    this.bullet!.move(this.target.tile());

    // Deal damage - don't damage planes at their airfield
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

    this.bullet!.setReachedTarget();
    this.bullet!.delete(false);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
