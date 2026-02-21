import { GameMap, TileRef } from "../game/GameMap";

export class StraightPathFinder {
  constructor(private mg: GameMap) {}

  nextTile(curr: TileRef, dst: TileRef, speed: number): TileRef | true {
    const currX = this.mg.x(curr);
    const currY = this.mg.y(curr);

    const dstX = this.mg.x(dst);
    const dstY = this.mg.y(dst);

    const dx = dstX - currX;
    const dy = dstY - currY;

    const distSq = dx * dx + dy * dy;

    if (distSq <= speed * speed) {
      return true;
    }

    const dist = Math.sqrt(distSq);

    const dirX = dx / dist;
    const dirY = dy / dist;

    let nextX = Math.round(currX + dirX * speed);
    let nextY = Math.round(currY + dirY * speed);

    // Clamp to map bounds to prevent invalid coordinates
    nextX = Math.max(0, Math.min(this.mg.width() - 1, nextX));
    nextY = Math.max(0, Math.min(this.mg.height() - 1, nextY));

    const remainingDx = dstX - nextX;
    const remainingDy = dstY - nextY;
    const remainingDist = Math.hypot(remainingDx, remainingDy);

    if (remainingDist <= speed) {
      return true;
    } else {
      return this.mg.ref(nextX, nextY);
    }
  }
}
