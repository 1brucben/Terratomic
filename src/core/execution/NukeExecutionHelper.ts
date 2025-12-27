import {
  Cell,
  Difficulty,
  Game,
  Gold,
  Player,
  PlayerID,
  PlayerType,
  Tick,
  Unit,
  UnitType,
} from "../game/Game";
import { euclDistFN, manhattanDistFN, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { calculateBoundingBox } from "../Util";
import { BotPersonality } from "./FakeHumanExecution";
import { NukeExecution } from "./NukeExecution";
import { closestTwoTiles } from "./Util";

export class NukeExecutionHelper {
  private lastNukeSent: [Tick, TileRef][] = [];
  private nukedBy: Set<PlayerID> = new Set();
  private lastMultiNukeTick: Tick = -1000;
  private nukesLaunchedThisCycle = 0;

  constructor(
    private random: PseudoRandom,
    private mg: Game,
    private player: Player,
    private personality: BotPersonality,
    private difficulty: Difficulty,
  ) {}

  markNukedBy(attackerID: PlayerID) {
    this.nukedBy.add(attackerID);
  }

  maybeSendNuke(other: Player) {
    const silos = this.player.units(UnitType.MissileSilo);
    const sams = this.player.units(UnitType.SAMLauncher);

    // Check if we can launch multiple nukes this cycle
    const currentTick = this.mg.ticks();
    if (currentTick - this.lastMultiNukeTick > 10) {
      this.nukesLaunchedThisCycle = 0;
      this.lastMultiNukeTick = currentTick;
    }

    const maxNukesPerCycle = this.getMaxNukesPerCycle();
    if (this.nukesLaunchedThisCycle >= maxNukesPerCycle) return;

    // SAM protection requirements (personality + difficulty based)
    const protectedAssets =
      silos.length + this.player.units(UnitType.Airfield).length;
    const requiredSAMPercentage = this.getSAMRequirement();
    const requiredSAMs = Math.ceil(protectedAssets * requiredSAMPercentage);
    if (sams.length < requiredSAMs) return;

    // Basic checks
    if (silos.length === 0 || this.player.isOnSameTeam(other)) {
      return;
    }

    // Check if we're allowed to nuke this target type
    if (!this.canNukeTarget(other)) return;

    // Select nuke type and check affordability
    const nukeType = this.selectNukeType();
    if (nukeType === null) return;

    const nukeCost = this.cost(nukeType);
    const maxSpend =
      Number(this.player.gold()) * (this.getCostThreshold() / 100);
    if (Number(nukeCost) > maxSpend) return;

    const structures = other.units(
      UnitType.City,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.SAMLauncher,
      UnitType.Airfield,
      UnitType.Hospital,
      UnitType.Academy,
      UnitType.Factory,
      UnitType.ResearchLab,
      UnitType.DoomsdayDevice,
    );
    const structureTiles = structures.map((u) => u.tile());
    const randomTiles: (TileRef | null)[] = new Array(10);
    for (let i = 0; i < randomTiles.length; i++) {
      randomTiles[i] = this.randTerritoryTile(other);
    }
    const allTiles = randomTiles.concat(structureTiles);

    let bestTile: TileRef | null = null;
    let bestValue = -Infinity;
    this.removeOldNukeEvents();
    outer: for (const tile of new Set(allTiles)) {
      if (tile === null) continue;
      for (const t of this.mg.bfs(tile, manhattanDistFN(tile, 15))) {
        // Make sure we nuke at least 15 tiles in border
        if (this.mg.owner(t) !== other) {
          continue outer;
        }
      }
      // Reuse already-selected nukeType from line 68 instead of calling selectNukeType() again
      if (!this.player.canBuild(nukeType, tile)) continue;
      const value = this.nukeTileScore(tile, silos, structures, other);
      if (value > bestValue) {
        bestTile = tile;
        bestValue = value;
      }
    }
    if (bestTile !== null) {
      this.sendNuke(bestTile, nukeType);
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

  private sendNuke(tile: TileRef, nukeType: UnitType) {
    const tick = this.mg.ticks();
    this.lastNukeSent.push([tick, tile]);
    this.nukesLaunchedThisCycle++;
    this.mg.addExecution(new NukeExecution(nukeType as any, this.player, tile));
  }

  private selectNukeType(): UnitType | null {
    const priorities = this.getNukePriorities();
    for (const nukeType of priorities) {
      if (this.player.gold() >= this.cost(nukeType)) {
        return nukeType;
      }
    }
    return null;
  }

  private getNukePriorities(): UnitType[] {
    // Based on personality and difficulty from config table
    switch (this.personality) {
      case BotPersonality.Nuclear:
        switch (this.difficulty) {
          case Difficulty.Easy:
            return [UnitType.AtomBomb];
          case Difficulty.Medium:
            return [UnitType.MIRV, UnitType.HydrogenBomb, UnitType.AtomBomb];
          case Difficulty.Hard:
          case Difficulty.Impossible:
            return [UnitType.MIRV, UnitType.HydrogenBomb, UnitType.AtomBomb];
        }
        break;
      case BotPersonality.Balanced:
      case BotPersonality.LandWarfare:
      case BotPersonality.AirSupremacy:
      case BotPersonality.NavalPower:
        switch (this.difficulty) {
          case Difficulty.Easy:
          case Difficulty.Medium:
          case Difficulty.Hard:
            return [UnitType.AtomBomb];
          case Difficulty.Impossible:
            return [UnitType.HydrogenBomb, UnitType.AtomBomb];
        }
        break;
    }
    return [UnitType.AtomBomb];
  }

  private getSAMRequirement(): number {
    // Returns percentage (0.0 to 1.0) of assets that must be protected
    switch (this.personality) {
      case BotPersonality.Nuclear:
        switch (this.difficulty) {
          case Difficulty.Easy:
            return 0.75;
          case Difficulty.Medium:
            return 0.5;
          case Difficulty.Hard:
            return 0.35;
          case Difficulty.Impossible:
            return 0.25;
        }
        break;
      case BotPersonality.LandWarfare:
        switch (this.difficulty) {
          case Difficulty.Easy:
          case Difficulty.Medium:
            return 1.0;
          case Difficulty.Hard:
          case Difficulty.Impossible:
            return 0.5;
        }
        break;
      case BotPersonality.AirSupremacy:
        switch (this.difficulty) {
          case Difficulty.Easy:
          case Difficulty.Medium:
          case Difficulty.Hard:
            return 1.0;
          case Difficulty.Impossible:
            return 0.75;
        }
        break;
      case BotPersonality.NavalPower:
      case BotPersonality.Balanced:
        switch (this.difficulty) {
          case Difficulty.Easy:
          case Difficulty.Medium:
            return 1.0;
          case Difficulty.Hard:
            return 0.75;
          case Difficulty.Impossible:
            return 0.5;
        }
        break;
    }
    return 1.0;
  }

  private canNukeTarget(other: Player): boolean {
    const isBot = other.type() === PlayerType.Bot;

    switch (this.personality) {
      case BotPersonality.LandWarfare:
      case BotPersonality.Nuclear:
        return true; // Can nuke both humans and bots at all difficulties
      case BotPersonality.Balanced:
      case BotPersonality.AirSupremacy:
      case BotPersonality.NavalPower:
        return !isBot; // Only nuke humans
    }
    return !isBot;
  }

  private getCostThreshold(): number {
    // Returns percentage of gold willing to spend
    switch (this.personality) {
      case BotPersonality.Nuclear:
        switch (this.difficulty) {
          case Difficulty.Easy:
            return 20;
          case Difficulty.Medium:
            return 30;
          case Difficulty.Hard:
            return 40;
          case Difficulty.Impossible:
            return 60;
        }
        break;
      case BotPersonality.LandWarfare:
        switch (this.difficulty) {
          case Difficulty.Easy:
            return 10;
          case Difficulty.Medium:
            return 15;
          case Difficulty.Hard:
            return 25;
          case Difficulty.Impossible:
            return 35;
        }
        break;
      case BotPersonality.AirSupremacy:
      case BotPersonality.NavalPower:
        switch (this.difficulty) {
          case Difficulty.Easy:
            return 10;
          case Difficulty.Medium:
            return 12;
          case Difficulty.Hard:
            return 15;
          case Difficulty.Impossible:
            return 20;
        }
        break;
      case BotPersonality.Balanced:
        switch (this.difficulty) {
          case Difficulty.Easy:
            return 10;
          case Difficulty.Medium:
            return 15;
          case Difficulty.Hard:
            return 20;
          case Difficulty.Impossible:
            return 30;
        }
        break;
    }
    return 10;
  }

  private getMaxNukesPerCycle(): number {
    switch (this.personality) {
      case BotPersonality.Nuclear:
        switch (this.difficulty) {
          case Difficulty.Easy:
            return 1;
          case Difficulty.Medium:
            return 2;
          case Difficulty.Hard:
            return 3;
          case Difficulty.Impossible:
            return 5;
        }
        break;
      case BotPersonality.LandWarfare:
        switch (this.difficulty) {
          case Difficulty.Easy:
          case Difficulty.Medium:
            return 1;
          case Difficulty.Hard:
            return 2;
          case Difficulty.Impossible:
            return 3;
        }
        break;
      case BotPersonality.NavalPower:
      case BotPersonality.Balanced:
        switch (this.difficulty) {
          case Difficulty.Easy:
          case Difficulty.Medium:
          case Difficulty.Hard:
            return 1;
          case Difficulty.Impossible:
            return 2;
        }
        break;
      case BotPersonality.AirSupremacy:
        return 1; // Always 1
    }
    return 1;
  }

  private shouldRetaliate(): boolean {
    switch (this.personality) {
      case BotPersonality.Nuclear:
        return true; // Always retaliates
      case BotPersonality.LandWarfare:
        return this.difficulty >= Difficulty.Medium;
      case BotPersonality.AirSupremacy:
        return this.difficulty === Difficulty.Impossible;
      case BotPersonality.NavalPower:
      case BotPersonality.Balanced:
        return this.difficulty >= Difficulty.Hard;
    }
    return false;
  }

  private nukeTileScore(
    tile: TileRef,
    silos: Unit[],
    targets: Unit[],
    targetPlayer: Player,
  ): number {
    // Potential damage in a 25-tile radius
    const dist = euclDistFN(tile, 25, false);

    // Check for retaliation bonus
    const retaliationBonus =
      this.shouldRetaliate() && this.nukedBy.has(targetPlayer.id()) ? 2.0 : 1.0;

    let tileValue = targets
      .filter((unit) => dist(this.mg, unit.tile()))
      .map((unit) => {
        const baseValue = this.getBaseTargetValue(unit.type());
        const personalityMultiplier = this.getPersonalityMultiplier(
          unit.type(),
        );
        return baseValue * personalityMultiplier;
      })
      .reduce((prev, cur) => prev + cur, 0);

    // Apply retaliation bonus
    tileValue *= retaliationBonus;

    // Avoid areas defended by SAM launchers
    const dist50 = euclDistFN(tile, 50, false);
    tileValue -=
      50_000 *
      targets.filter(
        (unit) =>
          unit.type() === UnitType.SAMLauncher && dist50(this.mg, unit.tile()),
      ).length;

    // Prefer tiles that are closer to a silo
    const siloTiles = silos.map((u) => u.tile());
    const result = closestTwoTiles(this.mg, siloTiles, [tile]);
    if (result === null) throw new Error("Missing result");
    const { x: closestSilo } = result;
    const distanceSquared = this.mg.euclideanDistSquared(tile, closestSilo);
    const distanceToClosestSilo = Math.sqrt(distanceSquared);
    tileValue -= distanceToClosestSilo * 30;

    // Don't target near recent targets
    tileValue -= this.lastNukeSent
      .filter(([_tick, tile]) => dist(this.mg, tile))
      .map((_) => 1_000_000)
      .reduce((prev, cur) => prev + cur, 0);

    return tileValue;
  }

  private getBaseTargetValue(unitType: UnitType): number {
    switch (unitType) {
      case UnitType.MissileSilo:
        return 50_000;
      case UnitType.Hospital:
      case UnitType.Academy:
      case UnitType.ResearchLab:
        return 30_000;
      case UnitType.City:
      case UnitType.Factory:
        return 25_000;
      case UnitType.Port:
        return 20_000;
      case UnitType.Airfield:
        return 12_000;
      case UnitType.DefensePost:
        return 5_000;
      default:
        return 0;
    }
  }

  private getPersonalityMultiplier(unitType: UnitType): number {
    switch (this.personality) {
      case BotPersonality.Nuclear:
        switch (unitType) {
          case UnitType.MissileSilo:
            return 2.0;
          case UnitType.ResearchLab:
            return 1.5;
          default:
            return 1.0;
        }
      case BotPersonality.LandWarfare:
        switch (unitType) {
          case UnitType.Academy:
          case UnitType.Factory:
            return 1.5;
          case UnitType.Port:
          case UnitType.Airfield:
            return 0.8;
          default:
            return 1.0;
        }
      case BotPersonality.AirSupremacy:
        switch (unitType) {
          case UnitType.Airfield:
            return 2.0;
          case UnitType.Port:
            return 0.8;
          case UnitType.DefensePost:
            return 0.5;
          default:
            return 1.0;
        }
      case BotPersonality.NavalPower:
        switch (unitType) {
          case UnitType.Port:
            return 2.0;
          case UnitType.Factory:
          case UnitType.Airfield:
            return 0.8;
          default:
            return 1.0;
        }
      case BotPersonality.Balanced:
      default:
        return 1.0;
    }
  }

  private cost(type: UnitType): Gold {
    return this.mg.unitInfo(type).cost(this.player);
  }

  private randTerritoryTile(p: Player): TileRef | null {
    const boundingBox = calculateBoundingBox(this.mg, p.borderTiles());
    for (let i = 0; i < 100; i++) {
      const randX = this.random.nextInt(boundingBox.min.x, boundingBox.max.x);
      const randY = this.random.nextInt(boundingBox.min.y, boundingBox.max.y);
      if (!this.mg.isOnMap(new Cell(randX, randY))) {
        // Sanity check should never happen
        continue;
      }
      const randTile = this.mg.ref(randX, randY);
      if (this.mg.owner(randTile) === p) {
        return randTile;
      }
    }
    return null;
  }
}
