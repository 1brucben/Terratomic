import {
  Game,
  Gold,
  Player,
  PlayerType,
  Tick,
  Unit,
  UnitType,
} from "../game/Game";
import { euclDistFN, manhattanDistFN, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { NukeExecution } from "./NukeExecution";
import { closestTwoTiles } from "./Util";

export class NukeExecutionHelper {
  private lastNukeSent: [Tick, TileRef][] = [];

  constructor(
    private random: PseudoRandom,
    private mg: Game,
    private player: Player,
  ) {}

  maybeSendNuke(other: Player) {
    const silos = this.player.units(UnitType.MissileSilo);
    const sams = this.player.units(UnitType.SAMLauncher);

    const protectedAssets =
      silos.length + this.player.units(UnitType.Airfield).length;
    if (sams.length < protectedAssets) return;
    if (
      silos.length === 0 ||
      this.player.gold() < this.cost(UnitType.AtomBomb) ||
      other.type() === PlayerType.Bot ||
      this.player.isOnSameTeam(other)
    ) {
      return;
    }

    const structures = other.units(
      UnitType.City,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.SAMLauncher,
      UnitType.Airfield,
      UnitType.Hospital,
      UnitType.Academy,
    );

    if (structures.length === 0) {
      return;
    }

    const structureTiles = structures.map((u) => u.tile());

    // If there are many candidates, only check a small sample to prevent performance issues.
    const sampleSize = 20;
    const tilesToScore =
      structureTiles.length > sampleSize
        ? this.random.sampleArray(structureTiles, sampleSize)
        : structureTiles;

    let bestTile: TileRef | null = null;
    let bestValue = -Infinity;
    this.removeOldNukeEvents();
    outer: for (const tile of new Set(tilesToScore)) {
      if (tile === null) continue;
      for (const t of this.mg.bfs(tile, manhattanDistFN(tile, 15))) {
        // Make sure we nuke at least 15 tiles in border
        if (this.mg.owner(t) !== other) {
          continue outer;
        }
      }
      if (!this.player.canBuild(UnitType.AtomBomb, tile)) continue;
      const value = this.nukeTileScore(tile, silos);
      if (value > bestValue) {
        bestTile = tile;
        bestValue = value;
      }
    }
    if (bestTile !== null) {
      this.sendNuke(bestTile);
    }
  }

  private removeOldNukeEvents() {
    const maxAge = 500;
    const tick = this.mg.ticks();
    while (
      this.lastNukeSent.length > 0 &&
      this.lastNukeSent[0][0] + maxAge < tick
    ) {
      this.lastNukeSent.shift();
    }
  }

  private sendNuke(tile: TileRef) {
    const tick = this.mg.ticks();
    this.lastNukeSent.push([tick, tile]);
    this.mg.addExecution(
      new NukeExecution(UnitType.AtomBomb, this.player, tile),
    );
  }

  private nukeTileScore(tile: TileRef, silos: Unit[]): number {
    // Potential damage in a 25-tile radius
    const blastRadius = 25;
    const nearbyTargets = this.mg.nearbyUnits(tile, blastRadius, [
      UnitType.City,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.Airfield,
      UnitType.Hospital,
      UnitType.Academy,
    ]);

    let tileValue = nearbyTargets
      .map(({ unit }) => {
        switch (unit.type()) {
          case UnitType.City:
            return 25_000;
          case UnitType.DefensePost:
            return 5_000;
          case UnitType.MissileSilo:
            return 50_000;
          case UnitType.Port:
            return 20_000;
          case UnitType.Airfield:
            return 12_000;
          case UnitType.Hospital:
            return 30_000;
          case UnitType.Academy:
            return 30_000;
          default:
            return 0;
        }
      })
      .reduce((prev, cur) => prev + cur, 0);

    // Avoid areas defended by SAM launchers
    const samCheckRadius = 50;
    const nearbySAMs = this.mg.nearbyUnits(
      tile,
      samCheckRadius,
      UnitType.SAMLauncher,
    );
    tileValue -= 50_000 * nearbySAMs.length;

    // Prefer tiles that are closer to a silo
    const siloTiles = silos.map((u) => u.tile());
    const result = closestTwoTiles(this.mg, siloTiles, [tile]);
    if (result === null) throw new Error("Missing result");
    const { x: closestSilo } = result;
    const distanceSquared = this.mg.euclideanDistSquared(tile, closestSilo);
    const distanceToClosestSilo = Math.sqrt(distanceSquared);
    tileValue -= distanceToClosestSilo * 30;

    // Don't target near recent targets
    const dist = euclDistFN(tile, 25, false);
    tileValue -= this.lastNukeSent
      .filter(([_tick, tile]) => dist(this.mg, tile))
      .map((_) => 1_000_000)
      .reduce((prev, cur) => prev + cur, 0);

    return tileValue;
  }

  private cost(type: UnitType): Gold {
    return this.mg.unitInfo(type).cost(this.player);
  }
}
