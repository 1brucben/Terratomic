import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinder.Straight";

/**
 * Execution for a single AA bullet fired from a city at an enemy plane.
 * Bullets travel in a straight line using predictive targeting to intercept
 * moving targets.
 */
export class CityAABulletExecution implements Execution {
  executionName = "CityAABulletExecution";
  private active = true;
  private pathFinder: StraightPathFinder;
  private bullet: Unit | undefined;
  private mg: Game;
  private speed: number = 0;
  private damage: number = 0;
  private predictedTile: TileRef | null = null;
  private maxRangeSquared: number = 0;

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
    // Max range slightly larger than scan range to allow bullets to reach edge targets
    const maxRange = 100;
    this.maxRangeSquared = maxRange * maxRange;

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

    // Simplified intercept calculation: time = distance / bullet_speed
    // This assumes bullet is much faster than target (15 vs 2-4)
    const timeToIntercept = dist / this.speed;

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
    const targetOwner = this.target.owner();
    if (
      !this.target.isActive() ||
      targetOwner === this.bullet.owner() ||
      this._owner.isFriendly(targetOwner) ||
      !this.canEngageTarget(targetOwner, this.target) ||
      this.target.isAtSourceAirfield()
    ) {
      this.bullet.delete(false);
      this.active = false;
      return;
    }

    // Check if bullet has exceeded max range from source city
    if (!this.sourceCity.isActive() || this.isOutOfRange()) {
      this.bullet.delete(false);
      this.active = false;
      return;
    }

    // Move bullet toward target's ACTUAL position
    // Direct pursuit is more reliable than predictive targeting for direction-changing targets
    for (let i = 0; i < this.speed; i++) {
      const bulletTile = this.bullet.tile();
      const targetTile = this.target.tile();

      // Check for hit BEFORE moving
      if (bulletTile === targetTile) {
        this.applyDamage();
        return;
      }

      // Check if we're adjacent (within 1 Manhattan distance) before moving
      const map = this.mg.map();
      let bx = map.x(bulletTile);
      let by = map.y(bulletTile);
      const tx = map.x(targetTile);
      const ty = map.y(targetTile);
      let distToTarget = Math.abs(bx - tx) + Math.abs(by - ty);

      if (distToTarget <= 1) {
        // Adjacent - move to target and hit!
        this.bullet.move(targetTile);
        this.applyDamage();
        return;
      }

      // Move toward target's ACTUAL current position (not predicted)
      const result = this.pathFinder.nextTile(bulletTile, targetTile, 1);

      if (result === true) {
        // Reached target!
        this.applyDamage();
        return;
      } else {
        this.bullet.move(result);
      }

      // Check for hit AFTER moving
      const newBulletTile = this.bullet.tile();
      if (newBulletTile === targetTile) {
        this.applyDamage();
        return;
      }

      // Check if adjacent after moving
      bx = map.x(newBulletTile);
      by = map.y(newBulletTile);
      distToTarget = Math.abs(bx - tx) + Math.abs(by - ty);

      if (distToTarget <= 1) {
        // Adjacent after move - hit!
        this.bullet.move(targetTile);
        this.applyDamage();
        return;
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

  private canEngageTarget(targetOwner: Player, target: Unit): boolean {
    if (this.isAtWarEffective(targetOwner)) {
      return true;
    }

    // Neutral behavior: only defend against explicit incoming attacks.
    if (
      target.type() !== UnitType.Bomber &&
      target.type() !== UnitType.Paratrooper
    ) {
      return false;
    }

    const targetTile = target.targetTile();
    if (targetTile === undefined) {
      return false;
    }

    return this.mg.owner(targetTile) === this._owner;
  }

  private isAtWarEffective(other: Player): boolean {
    return this._owner.isAtWarWith(other);
  }

  private isOutOfRange(): boolean {
    const map = this.mg.map();
    const bulletX = map.x(this.bullet!.tile());
    const bulletY = map.y(this.bullet!.tile());
    const cityX = map.x(this.sourceCity.tile());
    const cityY = map.y(this.sourceCity.tile());

    const dx = bulletX - cityX;
    const dy = bulletY - cityY;
    const distSquared = dx * dx + dy * dy;

    return distSquared > this.maxRangeSquared;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
