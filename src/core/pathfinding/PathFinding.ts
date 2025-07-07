import { Game } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { DistanceBasedBezierCurve } from "../utilities/Line";
import { AStar, AStarResult, PathFindResultType } from "./AStar";
import { MiniAStar } from "./MiniAStar";
export { AStar, AStarResult, PathFindResultType };

const parabolaMinHeight = 50;

/**
 * PathFinder for units that move along a parabolic trajectory (e.g., shells).
 */
export class ParabolaPathFinder {
  constructor(private mg: GameMap) {}
  private curve: DistanceBasedBezierCurve | undefined;

  /**
   * Computes the control points for a Bezier curve to define the parabolic path.
   * @param orig The origin tile.
   * @param dst The destination tile.
   * @param distanceBasedHeight Whether the height of the parabola should be based on distance.
   */
  computeControlPoints(
    orig: TileRef,
    dst: TileRef,
    distanceBasedHeight = true,
  ) {
    const p0 = { x: this.mg.x(orig), y: this.mg.y(orig) };
    const p3 = { x: this.mg.x(dst), y: this.mg.y(dst) };
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxHeight = distanceBasedHeight
      ? Math.max(distance / 3, parabolaMinHeight)
      : 0;
    // Use a bezier curve always pointing up.
    const p1 = {
      x: p0.x + (p3.x - p0.x) / 4,
      y: Math.max(p0.y + (p3.y - p0.y) / 4 - maxHeight, 0),
    };
    const p2 = {
      x: p0.x + ((p3.x - p0.x) * 3) / 4,
      y: Math.max(p0.y + ((p3.y - p0.y) * 3) / 4 - maxHeight, 0),
    };

    this.curve = new DistanceBasedBezierCurve(p0, p1, p2, p3);
  }

  /**
   * Calculates the next tile along the parabolic path.
   * @param speed The speed of movement.
   * @returns The next TileRef in the path, or true if the destination is reached.
   */
  nextTile(speed: number): TileRef | true {
    if (!this.curve) {
      throw new Error("ParabolaPathFinder not initialized");
    }
    const nextPoint = this.curve.increment(speed);
    if (!nextPoint) {
      return true;
    }
    return this.mg.ref(Math.floor(nextPoint.x), Math.floor(nextPoint.y));
  }
}

/**
 * PathFinder for units that move directly through the air (e.g., SAM missiles).
 */
export class AirPathFinder {
  constructor(
    private mg: GameMap,
    private random: PseudoRandom,
  ) {}

  /**
   * Calculates the next tile for direct air movement.
   * @param tile The current tile.
   * @param dst The destination tile.
   * @returns The next TileRef in the path, or true if the destination is reached.
   */
  nextTile(tile: TileRef, dst: TileRef): TileRef | true {
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    const dstX = this.mg.x(dst);
    const dstY = this.mg.y(dst);

    if (x === dstX && y === dstY) {
      return true;
    }

    let nextX = x;
    let nextY = y;

    const ratio = Math.floor(1 + Math.abs(dstY - y) / (Math.abs(dstX - x) + 1));

    if (this.random.chance(ratio) && x !== dstX) {
      if (x < dstX) nextX++;
      else if (x > dstX) nextX--;
    } else {
      if (y < dstY) nextY++;
      else if (y > dstY) nextY--;
    }
    if (nextX === x && nextY === y) {
      return true;
    }
    return this.mg.ref(nextX, nextY);
  }
}

/**
 * PathFinder for units that move in a straight line towards a target (e.g., Cargo Planes, Fighter Jets).
 */
export class StraightPathFinder {
  constructor(private mg: GameMap) {}

  /**
   * Calculates the next tile for straight-line movement.
   * @param curr The current tile.
   * @param dst The destination tile.
   * @param speed The movement speed.
   * @returns The next TileRef in the path, or true if the destination is reached.
   */
  nextTile(curr: TileRef, dst: TileRef, speed: number): TileRef | true {
    const currX = this.mg.x(curr);
    const currY = this.mg.y(curr);

    const dstX = this.mg.x(dst);
    const dstY = this.mg.y(dst);

    const dx = dstX - currX;
    const dy = dstY - currY;

    const dist = Math.hypot(dx, dy);

    // If the distance to destination is less than or equal to speed, snap to destination.
    if (dist <= speed) {
      return true;
    }

    const dirX = dx / dist;
    const dirY = dy / dist;

    const nextX = Math.round(currX + dirX * speed);
    const nextY = Math.round(currY + dirY * speed);

    const remainingDx = dstX - nextX;
    const remainingDy = dstY - nextY;
    const remainingDist = Math.hypot(remainingDx, remainingDy);

    // If the remaining distance is less than or equal to speed, snap to destination.
    if (remainingDist <= speed) {
      return true;
    } else {
      return this.mg.ref(nextX, nextY);
    }
  }
}

/**
 * Generic PathFinder class that uses an A* algorithm for pathfinding.
 */
export class PathFinder {
  private curr: TileRef | null = null;
  private dst: TileRef | null = null;
  private path: TileRef[] | null = null;
  private aStar: AStar<TileRef>;
  private computeFinished = true;

  private constructor(
    private game: Game,
    private newAStar: (curr: TileRef, dst: TileRef) => AStar<TileRef>,
  ) {}

  /**
   * Static factory method to create a MiniAStar-based PathFinder.
   * This is used for general pathfinding where terrain restrictions apply.
   * @param game The game instance.
   * @param iterations The maximum number of iterations for the A* algorithm.
   * @param waterPath Whether to allow pathfinding over water (true for ships, false for land units).
   * @param maxTries The maximum number of tries for pathfinding.
   * @returns A new PathFinder instance.
   */
  public static Mini(
    game: Game,
    iterations: number,
    waterPath: boolean = true,
    maxTries: number = 20,
  ) {
    return new PathFinder(game, (curr: TileRef, dst: TileRef) => {
      return new MiniAStar(
        game.map(),
        game.miniMap(),
        curr,
        dst,
        iterations,
        maxTries,
        waterPath,
      );
    });
  }

  /**
   * Calculates the next tile in the path.
   * @param curr The current tile.
   * @param dst The destination tile.
   * @param dist The distance to move in this step (default is 1).
   * @returns An AStarResult indicating the pathfinding status and the next node.
   */
  nextTile(
    curr: TileRef | null,
    dst: TileRef | null,
    dist: number = 1,
  ): AStarResult<TileRef> {
    if (curr === null) {
      console.error("Current tile is null");
      return { type: PathFindResultType.PathNotFound };
    }
    if (dst === null) {
      console.error("Destination tile is null");
      return { type: PathFindResultType.PathNotFound };
    }

    // If close enough to destination, consider it reached.
    if (this.game.manhattanDist(curr, dst) < dist) {
      return { type: PathFindResultType.Completed, node: curr };
    }

    if (this.computeFinished) {
      // Recompute path if necessary.
      if (this.shouldRecompute(curr, dst)) {
        this.curr = curr;
        this.dst = dst;
        this.path = null;
        this.aStar = this.newAStar(curr, dst);
        this.computeFinished = false;
        return this.nextTile(curr, dst);
      } else {
        // Return the next tile from the precomputed path.
        const tile = this.path?.shift();
        if (tile === undefined) {
          throw new Error("Missing tile in path");
        }
        return { type: PathFindResultType.NextTile, node: tile };
      }
    }

    // Continue computing the A* path.
    switch (this.aStar.compute()) {
      case PathFindResultType.Completed:
        this.computeFinished = true;
        this.path = this.aStar.reconstructPath();
        // Remove the start tile from the path as it's the current position.
        this.path.shift();

        return this.nextTile(curr, dst);
      case PathFindResultType.Pending:
        return { type: PathFindResultType.Pending };
      case PathFindResultType.PathNotFound:
        return { type: PathFindResultType.PathNotFound };
      default:
        throw new Error("Unexpected compute result");
    }
  }

  /**
   * Reconstructs the full path found by the A* algorithm.
   * @returns An array of TileRef representing the path.
   */
  public reconstructPath(): TileRef[] {
    if (this.path === null) {
      return [];
    }
    return this.path;
  }

  /**
   * Determines if the path needs to be recomputed.
   * Recomputation occurs if there's no current path, or if the destination has significantly changed.
   * @param curr The current tile.
   * @param dst The destination tile.
   * @returns True if the path needs recomputation, false otherwise.
   */
  private shouldRecompute(curr: TileRef, dst: TileRef) {
    if (this.path === null || this.curr === null || this.dst === null) {
      return true;
    }
    const dist = this.game.manhattanDist(curr, dst);
    let tolerance = 10;
    if (dist > 50) {
      tolerance = 10;
    } else if (dist > 25) {
      tolerance = 5;
    } else {
      tolerance = 0;
    }
    if (this.game.manhattanDist(this.dst, dst) > tolerance) {
      return true;
    }
    return false;
  }
}
