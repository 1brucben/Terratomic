import { SpawnExecution } from "../execution/SpawnExecution";
import { Game, Nation, Player, PlayerType, TerrainType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles all spawn-related behavior for AI players.
 */
export class AISpawnHandler {
  private snipeSpawnTick: number | null = null;
  private currentSpawnTile: TileRef | null = null;
  private spawnTick: number;

  constructor(
    private mg: Game,
    private nation: Nation,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {
    const hopRate = this.params.spawnHopRate ?? 40;
    this.spawnTick = this.random.nextInt(0, hopRate);
  }

  handleSpawnPhase(ticks: number): void {
    const sniping = this.params.spawnSniping ?? false;
    const avoidance = this.params.spawnAvoidance ?? false;

    if (sniping) {
      this.handleSnipingSpawn(ticks);
    } else if (avoidance) {
      this.handleAvoidanceSpawn(ticks);
    } else {
      this.handleNormalSpawn(ticks);
    }
  }

  private handleNormalSpawn(ticks: number): void {
    const hopping = this.params.spawnHopping ?? true;
    const hopRate = this.params.spawnHopRate ?? 40;

    if (hopping) {
      if (ticks % hopRate !== this.spawnTick) {
        return;
      }
    } else {
      if (ticks !== this.spawnTick) {
        return;
      }
    }

    const tile = this.randomLand();
    if (tile === null) {
      console.warn(`cannot spawn ${this.nation.playerInfo.name}`);
      return;
    }
    this.mg.addExecution(new SpawnExecution(this.nation.playerInfo, tile));
  }

  private handleSnipingSpawn(ticks: number): void {
    const spawnPhaseEnd = this.mg.config().numSpawnPhaseTurns();

    if (this.snipeSpawnTick === null) {
      this.snipeSpawnTick = this.random.nextInt(
        spawnPhaseEnd - 10,
        spawnPhaseEnd,
      );
    }

    if (ticks !== this.snipeSpawnTick) {
      return;
    }

    const targets = this.mg
      .players()
      .filter(
        (p) =>
          p.id() !== this.nation.playerInfo.id &&
          (p.type() === PlayerType.Human || p.type() === PlayerType.FakeHuman),
      );

    if (targets.length === 0) {
      const tile = this.randomLand();
      if (tile !== null) {
        this.mg.addExecution(new SpawnExecution(this.nation.playerInfo, tile));
      }
      return;
    }

    const target = this.random.randElement(targets);
    const tile = this.randomLandNearPlayer(target, 10);
    if (tile === null) {
      const fallbackTile = this.randomLand();
      if (fallbackTile !== null) {
        this.mg.addExecution(
          new SpawnExecution(this.nation.playerInfo, fallbackTile),
        );
      }
      return;
    }
    this.mg.addExecution(new SpawnExecution(this.nation.playerInfo, tile));
  }

  private randomLandNearPlayer(target: Player, radius: number): TileRef | null {
    const targetTiles = Array.from(target.tiles());
    if (targetTiles.length === 0) {
      return null;
    }
    const centerTile = this.random.randElement(targetTiles);
    const centerX = this.mg.x(centerTile);
    const centerY = this.mg.y(centerTile);

    for (let tries = 0; tries < 50; tries++) {
      const x = this.random.nextInt(centerX - radius, centerX + radius);
      const y = this.random.nextInt(centerY - radius, centerY + radius);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (this.mg.isLand(tile) && !this.mg.hasOwner(tile)) {
        if (
          this.mg.terrainType(tile) === TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }

  private handleAvoidanceSpawn(ticks: number): void {
    const hopping = this.params.spawnHopping ?? true;
    const hopRate = this.params.spawnHopRate ?? 40;
    const avoidanceDistance = this.params.spawnAvoidanceDistance ?? 50;

    const needsToMove = this.shouldAvoidCurrentPosition(avoidanceDistance);

    if (needsToMove) {
      const tile = this.findAvoidanceTile(avoidanceDistance);
      if (tile !== null) {
        this.currentSpawnTile = tile;
        this.mg.addExecution(new SpawnExecution(this.nation.playerInfo, tile));
      }
      return;
    }

    if (hopping) {
      if (ticks % hopRate !== this.spawnTick) {
        return;
      }
    } else {
      if (ticks !== this.spawnTick) {
        return;
      }
    }

    const tile = this.randomLand();
    if (tile === null) {
      console.warn(`cannot spawn ${this.nation.playerInfo.name}`);
      return;
    }
    this.currentSpawnTile = tile;
    this.mg.addExecution(new SpawnExecution(this.nation.playerInfo, tile));
  }

  private shouldAvoidCurrentPosition(avoidanceDistance: number): boolean {
    if (this.currentSpawnTile === null) {
      return false;
    }

    const nearestDist = this.distanceToNearestPlayer(this.currentSpawnTile);
    return nearestDist !== null && nearestDist < avoidanceDistance;
  }

  private distanceToNearestPlayer(tile: TileRef): number | null {
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    let nearestDist: number | null = null;

    for (const player of this.mg.players()) {
      if (player.id() === this.nation.playerInfo.id) continue;

      const playerTiles = Array.from(player.tiles());
      if (playerTiles.length === 0) continue;

      for (const pTile of playerTiles.slice(0, 10)) {
        const px = this.mg.x(pTile);
        const py = this.mg.y(pTile);
        const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
        if (nearestDist === null || dist < nearestDist) {
          nearestDist = dist;
        }
      }
    }

    return nearestDist;
  }

  private findAvoidanceTile(initialDistance: number): TileRef | null {
    let requiredDistance = initialDistance;
    const currentNearestDist = this.currentSpawnTile
      ? this.distanceToNearestPlayer(this.currentSpawnTile)
      : null;

    while (requiredDistance > 0) {
      if (
        currentNearestDist !== null &&
        requiredDistance < currentNearestDist
      ) {
        return null;
      }

      for (let tries = 0; tries < 50; tries++) {
        const tile = this.randomLand();
        if (tile === null) continue;

        const nearestDist = this.distanceToNearestPlayer(tile);
        if (nearestDist === null || nearestDist >= requiredDistance) {
          return tile;
        }
      }

      requiredDistance -= 5;
    }

    return null;
  }

  private randomLand(): TileRef | null {
    const delta = 25;
    let tries = 0;
    while (tries < 50) {
      tries++;
      const cell = this.nation.spawnCell;
      const x = this.random.nextInt(cell.x - delta, cell.x + delta);
      const y = this.random.nextInt(cell.y - delta, cell.y + delta);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (this.mg.isLand(tile) && !this.mg.hasOwner(tile)) {
        if (
          this.mg.terrainType(tile) === TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }
}
