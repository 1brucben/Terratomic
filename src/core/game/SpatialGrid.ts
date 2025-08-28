import { Unit } from "./Game";
import { GameMap } from "./GameMap";

export class SpatialGrid {
  private grid: Unit[][][] = [];
  private cellSize: number;

  constructor(
    private gameMap: GameMap,
    cellSize: number,
  ) {
    this.cellSize = cellSize;
    for (let i = 0; i < this.gameMap.width() / this.cellSize; i++) {
      this.grid[i] = [];
      for (let j = 0; j < this.gameMap.height() / this.cellSize; j++) {
        this.grid[i][j] = [];
      }
    }
  }

  public add(unit: Unit): void {
    const cell = this.gameMap.cell(unit.tile());
    const x = Math.floor(cell.x / this.cellSize);
    const y = Math.floor(cell.y / this.cellSize);
    this.grid[x][y].push(unit);
  }

  public remove(unit: Unit): void {
    const cell = this.gameMap.cell(unit.tile());
    const x = Math.floor(cell.x / this.cellSize);
    const y = Math.floor(cell.y / this.cellSize);
    const index = this.grid[x][y].indexOf(unit);
    if (index > -1) {
      this.grid[x][y].splice(index, 1);
    }
  }

  public getNearby(unit: Unit, radius: number): Unit[] {
    const cell = this.gameMap.cell(unit.tile());
    const x = Math.floor(cell.x / this.cellSize);
    const y = Math.floor(cell.y / this.cellSize);
    const searchRadius = Math.ceil(radius / this.cellSize);

    const nearby: Unit[] = [];
    for (let i = x - searchRadius; i <= x + searchRadius; i++) {
      for (let j = y - searchRadius; j <= y + searchRadius; j++) {
        if (
          i >= 0 &&
          i < this.grid.length &&
          j >= 0 &&
          j < this.grid[i].length
        ) {
          for (const other of this.grid[i][j]) {
            if (
              this.gameMap.euclideanDistSquared(unit.tile(), other.tile()) <=
              radius * radius
            ) {
              nearby.push(other);
            }
          }
        }
      }
    }
    return nearby;
  }
}
