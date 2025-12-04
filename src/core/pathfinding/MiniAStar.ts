import { Cell, GameMap, TerrainType, TileRef } from "../game/GameMap";
import { AStar, PathFindResultType } from "./AStar";
import { GraphAdapter, SerialAStar } from "./SerialAStar";

export class GameMapAdapter implements GraphAdapter<TileRef> {
  constructor(
    private gameMap: GameMap,
    private waterPath: boolean,
  ) {}

  neighbors(node: TileRef): Iterable<TileRef> {
    return this.gameMap.neighbors(node);
  }

  cost(node: TileRef): number {
    return this.gameMap.cost(node);
  }

  position(node: TileRef): { x: number; y: number } {
    return { x: this.gameMap.x(node), y: this.gameMap.y(node) };
  }

  isTraversable(from: TileRef, to: TileRef): boolean {
    const isWater = this.gameMap.isWater(to);
    if (this.gameMap.terrainType(to) === TerrainType.Barrier) {
      return false;
    }
    return this.waterPath ? isWater : !isWater;
  }
}
export class MiniAStar implements AStar<TileRef> {
  private aStar: AStar<TileRef>;

  constructor(
    private gameMap: GameMap,
    private miniMap: GameMap,
    private src: TileRef | TileRef[],
    private dst: TileRef,
    iterations: number,
    maxTries: number,
    waterPath: boolean = true,
    directionChangePenalty: number = 0,
  ) {
    const srcArray: TileRef[] = Array.isArray(src) ? src : [src];
    const miniSrc = srcArray.map((srcPoint) =>
      this.miniMap.ref(
        Math.floor(gameMap.x(srcPoint) / 2),
        Math.floor(gameMap.y(srcPoint) / 2),
      ),
    );

    const miniDst = this.miniMap.ref(
      Math.floor(gameMap.x(dst) / 2),
      Math.floor(gameMap.y(dst) / 2),
    );

    this.aStar = new SerialAStar(
      miniSrc,
      miniDst,
      iterations,
      maxTries,
      new GameMapAdapter(miniMap, waterPath),
      directionChangePenalty,
    );
  }

  compute(): PathFindResultType {
    return this.aStar.compute();
  }

  reconstructPath(): TileRef[] {
    // Build start and destination cells at full resolution
    let cellSrc: Cell | undefined;
    if (!Array.isArray(this.src)) {
      cellSrc = new Cell(this.gameMap.x(this.src), this.gameMap.y(this.src));
    }
    const cellDst = new Cell(
      this.gameMap.x(this.dst),
      this.gameMap.y(this.dst),
    );

    // Get path in mini-map coords, upscale to full grid coordinates
    const coarseCells = this.aStar
      .reconstructPath()
      .map((tr) => new Cell(this.miniMap.x(tr), this.miniMap.y(tr)));
    const upscaled = fixExtremes(upscalePath(coarseCells), cellDst, cellSrc);

    // Convert to an orthogonal, water-preferred path on the full grid
    const waterOrthogonal: Cell[] = [];
    if (upscaled.length > 0) {
      let curr = upscaled[0];
      waterOrthogonal.push(curr);
      for (let i = 1; i < upscaled.length; i++) {
        const target = upscaled[i];
        while (curr.x !== target.x || curr.y !== target.y) {
          const stepX = Math.sign(target.x - curr.x);
          const stepY = Math.sign(target.y - curr.y);
          const candidates: Cell[] = [];
          if (stepX !== 0) candidates.push(new Cell(curr.x + stepX, curr.y));
          if (stepY !== 0) candidates.push(new Cell(curr.x, curr.y + stepY));

          // Prefer candidates that are water and reduce manhattan distance
          let best: Cell | null = null;
          let bestScore = Number.POSITIVE_INFINITY;
          for (const cand of candidates) {
            const ref = this.gameMap.ref(cand.x, cand.y);
            const isWater = this.gameMap.isWater(ref);
            const dist =
              Math.abs(target.x - cand.x) + Math.abs(target.y - cand.y);
            const score = (isWater ? 0 : 1000) + dist; // strong preference for water
            if (score < bestScore) {
              best = cand;
              bestScore = score;
            }
          }
          // If no candidates (shouldn't happen), break to avoid infinite loop
          if (best === null) break;
          curr = best;
          waterOrthogonal.push(curr);
        }
      }
    }

    // Remove any residual non-water cells if present (belt-and-suspenders)
    let finalCells = waterOrthogonal.filter((c) =>
      this.gameMap.isWater(this.gameMap.ref(c.x, c.y)),
    );

    // Robustness: ensure path includes src and dst and has at least 2 cells
    const srcCell = cellSrc ?? (upscaled.length > 0 ? upscaled[0] : undefined);
    if (finalCells.length === 0) {
      // Fallback to upscaled (pre-orthogonal) if filtering removed everything
      finalCells = [...upscaled];
    }
    if (srcCell) {
      const first = finalCells[0];
      if (!first || first.x !== srcCell.x || first.y !== srcCell.y) {
        finalCells.unshift(srcCell);
      }
    }
    const last = finalCells[finalCells.length - 1];
    if (!last || last.x !== cellDst.x || last.y !== cellDst.y) {
      finalCells.push(cellDst);
    }
    if (finalCells.length < 2) {
      // Create a single orthogonal step toward dst
      const start = finalCells[0];
      if (!start) {
        finalCells = [cellDst];
      } else if (start.x !== cellDst.x || start.y !== cellDst.y) {
        const stepX = Math.sign(cellDst.x - start.x);
        const stepY = Math.sign(cellDst.y - start.y);
        const candidates: Cell[] = [];
        if (stepX !== 0) candidates.push(new Cell(start.x + stepX, start.y));
        if (stepY !== 0) candidates.push(new Cell(start.x, start.y + stepY));
        let best: Cell | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const cand of candidates) {
          const ref = this.gameMap.ref(cand.x, cand.y);
          const isWater = this.gameMap.isWater(ref);
          const dist =
            Math.abs(cellDst.x - cand.x) + Math.abs(cellDst.y - cand.y);
          const score = (isWater ? 0 : 1000) + dist;
          if (score < bestScore) {
            best = cand;
            bestScore = score;
          }
        }
        if (best) finalCells.push(best);
      }
      if (finalCells.length < 2) {
        // As a final guard, ensure there are at least two cells
        finalCells.push(cellDst);
      }
    }

    // Map to tile refs
    return finalCells.map((c) => this.gameMap.ref(c.x, c.y));
  }
}

function fixExtremes(upscaled: Cell[], cellDst: Cell, cellSrc?: Cell): Cell[] {
  if (cellSrc !== undefined) {
    const srcIndex = findCell(upscaled, cellSrc);
    if (srcIndex === -1) {
      // didnt find the start tile in the path
      upscaled.unshift(cellSrc);
    } else if (srcIndex !== 0) {
      // found start tile but not at the start
      // remove all tiles before the start tile
      upscaled = upscaled.slice(srcIndex);
    }
  }

  const dstIndex = findCell(upscaled, cellDst);
  if (dstIndex === -1) {
    // didnt find the dst tile in the path
    upscaled.push(cellDst);
  } else if (dstIndex !== upscaled.length - 1) {
    // found dst tile but not at the end
    // remove all tiles after the dst tile
    upscaled = upscaled.slice(0, dstIndex + 1);
  }
  return upscaled;
}

function upscalePath(path: Cell[], scaleFactor: number = 2): Cell[] {
  // Scale up each point
  const scaledPath = path.map(
    (point) => new Cell(point.x * scaleFactor, point.y * scaleFactor),
  );

  const smoothPath: Cell[] = [];

  for (let i = 0; i < scaledPath.length - 1; i++) {
    const current = scaledPath[i];
    const next = scaledPath[i + 1];

    // Add the current point
    smoothPath.push(current);

    // Always interpolate between scaled points
    const dx = next.x - current.x;
    const dy = next.y - current.y;

    // Calculate number of steps needed
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = distance;

    // Add intermediate points
    for (let step = 1; step < steps; step++) {
      smoothPath.push(
        new Cell(
          Math.round(current.x + (dx * step) / steps),
          Math.round(current.y + (dy * step) / steps),
        ),
      );
    }
  }

  // Add the last point
  if (scaledPath.length > 0) {
    smoothPath.push(scaledPath[scaledPath.length - 1]);
  }

  return smoothPath;
}

function findCell(upscaled: Cell[], cellDst: Cell): number {
  for (let i = 0; i < upscaled.length; i++) {
    if (upscaled[i].x === cellDst.x && upscaled[i].y === cellDst.y) {
      return i;
    }
  }
  return -1;
}
