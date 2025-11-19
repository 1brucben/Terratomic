import {
  Execution,
  Game,
  isStructureType,
  MessageType,
  Player,
  TerraNullius,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ParabolaPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { NukeType } from "../StatsSchemas";
import { DoomsdayActivationExecution } from "./DoomsdayActivationExecution";
import {
  attemptInterception,
  findEligibleCitiesForNuke,
} from "./utils/CityAntiAirUtils";

const SPRITE_RADIUS = 16;

export class NukeExecution implements Execution {
  private active = true;
  private mg: Game;
  private nuke: Unit | null = null;
  private tilesToDestroyCache: Set<TileRef> | undefined;
  private eligibleCities: Unit[] = [];
  private pathFinder: ParabolaPathFinder;

  constructor(
    private nukeType: NukeType,
    private player: Player,
    private dst: TileRef,
    private src?: TileRef | null,
    private speed: number = -1,
    private waitTicks = 0,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.speed === -1) {
      this.speed = this.mg.config().defaultNukeSpeed();
    }
    this.pathFinder = new ParabolaPathFinder(mg);
  }

  public target(): Player | TerraNullius {
    return this.mg.owner(this.dst);
  }

  private tilesToDestroy(): Set<TileRef> {
    if (this.tilesToDestroyCache !== undefined) {
      return this.tilesToDestroyCache;
    }
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const rand = new PseudoRandom(this.mg.ticks());
    const inner2 = magnitude.inner * magnitude.inner;
    const outer2 = magnitude.outer * magnitude.outer;
    this.tilesToDestroyCache = this.mg.bfs(this.dst, (_, n: TileRef) => {
      const d2 = this.mg?.euclideanDistSquared(this.dst, n) ?? 0;
      return d2 <= outer2 && (d2 <= inner2 || rand.chance(2));
    });
    return this.tilesToDestroyCache;
  }

  private maybeBreakAlliances(toDestroy: Set<TileRef>) {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    const attacked = new Map<Player, number>();
    for (const tile of toDestroy) {
      const owner = this.mg.owner(tile);
      if (owner.isPlayer()) {
        const prev = attacked.get(owner) ?? 0;
        attacked.set(owner, prev + 1);
      }
    }

    const threshold = this.mg.config().nukeAllianceBreakThreshold();
    for (const [other, tilesDestroyed] of attacked) {
      if (
        tilesDestroyed > threshold &&
        this.nuke.type() !== UnitType.MIRVWarhead
      ) {
        // Mirv warheads shouldn't break alliances
        const alliance = this.player.allianceWith(other);
        if (alliance !== null) {
          this.player.breakAlliance(alliance);
        }
        if (other !== this.player) {
          other.updateRelation(this.player, -100);
        }
      }
    }
  }

  tick(ticks: number): void {
    if (this.nuke === null) {
      const spawn = this.src ?? this.player.canBuild(this.nukeType, this.dst);
      if (spawn === false) {
        console.warn(`cannot build Nuke`);
        this.active = false;
        return;
      }
      this.src = spawn;
      this.pathFinder.computeControlPoints(
        spawn,
        this.dst,
        this.speed,
        this.nukeType !== UnitType.MIRVWarhead,
      );
      this.nuke = this.player.buildUnit(this.nukeType, spawn, {
        targetTile: this.dst,
        trajectory: this.getTrajectory(this.dst),
      });
      this.maybeBreakAlliances(this.tilesToDestroy());
      if (this.mg.hasOwner(this.dst)) {
        const target = this.mg.owner(this.dst);
        if (!target.isPlayer()) {
          // Ignore terra nullius
        } else if (this.nukeType === UnitType.AtomBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            // TODO TranslateText
            `${this.player.name()} - atom bomb inbound`,
            MessageType.NUKE_INBOUND,
            target.id(),
          );
        } else if (this.nukeType === UnitType.HydrogenBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            // TODO TranslateText
            `${this.player.name()} - hydrogen bomb inbound`,
            MessageType.HYDROGEN_BOMB_INBOUND,
            target.id(),
          );
        }

        // Record stats
        this.mg.stats().bombLaunch(this.player, target, this.nukeType);

        // War declaration and aggression tracking for nuclear attack
        if (target.isPlayer()) {
          const tp = target as Player;
          this.player.setWarWith(tp);
          tp.setWarWith(this.player);
          this.player.recordAggression(tp);
          tp.recordAggression(this.player);
        }
      }

      // after sending a nuke set the launcher on cooldown
      const launcher = this.player
        .units()
        .find((unit) => unit.tile() === spawn);
      if (launcher) {
        launcher.launch();
      }

      if (
        this.nuke.type() === UnitType.AtomBomb ||
        this.nuke.type() === UnitType.HydrogenBomb
      ) {
        this.eligibleCities = findEligibleCitiesForNuke(this.nuke, this.mg);
      }

      return;
    }

    // make the nuke unactive if it was intercepted
    if (!this.nuke.isActive()) {
      console.log(`Nuke destroyed before reaching target`);
      this.active = false;
      return;
    }

    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }

    // Move to next tile
    const nextTile = this.pathFinder.nextTile(this.speed);
    if (nextTile === true) {
      this.detonate();
      return;
    } else {
      this.updateNukeTargetable();
      this.nuke.move(nextTile);
      // Update index so SAM can interpolate future position
      this.nuke.setTrajectoryIndex(this.pathFinder.currentIndex());

      // City-based interception: attempt if in range and off cooldown
      if (this.nuke !== null && !this.nuke.targetedBySAM()) {
        const currentNuke = this.nuke;
        const readyInterceptors = this.eligibleCities.filter(
          (city) =>
            (city.ticksLeftInCooldown() ?? 0) <= 0 &&
            this.mg.euclideanDistSquared(currentNuke.tile(), city.tile()) <=
              this.mg.config().citySamLaunchRange() *
                this.mg.config().citySamLaunchRange(),
        );

        if (readyInterceptors.length > 0) {
          readyInterceptors.sort(
            (a, b) =>
              this.mg.euclideanDistSquared(currentNuke.tile(), a.tile()) -
              this.mg.euclideanDistSquared(currentNuke.tile(), b.tile()),
          );

          const closestInterceptor = readyInterceptors[0];
          attemptInterception(currentNuke, this.mg, closestInterceptor);
        }
      }
    }
  }

  public getNuke(): Unit | null {
    return this.nuke;
  }

  private getTrajectory(target: TileRef): TrajectoryTile[] {
    const trajectoryTiles: TrajectoryTile[] = [];
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const allTiles: TileRef[] = this.pathFinder.allTiles();
    for (const tile of allTiles) {
      trajectoryTiles.push({
        tile,
        targetable: this.isTargetable(target, tile, targetRangeSquared),
      });
    }

    return trajectoryTiles;
  }

  private isTargetable(
    targetTile: TileRef,
    nukeTile: TileRef,
    targetRangeSquared: number,
  ): boolean {
    return (
      this.mg.euclideanDistSquared(nukeTile, targetTile) < targetRangeSquared ||
      (this.src !== undefined &&
        this.src !== null &&
        this.mg.euclideanDistSquared(this.src, nukeTile) < targetRangeSquared)
    );
  }

  private updateNukeTargetable() {
    if (this.nuke === null || this.nuke.targetTile() === undefined) {
      return;
    }
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const targetTile = this.nuke.targetTile();
    this.nuke.setTargetable(
      this.isTargetable(targetTile!, this.nuke.tile(), targetRangeSquared),
    );
  }

  private maybeActivateDoomsdayDevice(player: Player): void {
    // Find all doomsday devices owned by this player
    const doomsdayDevices = player.units(UnitType.DoomsdayDevice);

    if (doomsdayDevices.length > 0) {
      // Activate the first doomsday device
      const device = doomsdayDevices[0];
      const deviceTile = device.tile();

      // Create activation execution
      const activation = new DoomsdayActivationExecution(
        player,
        device,
        deviceTile,
      );
      this.mg.addExecution(activation);
    }
  }

  private detonate() {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }

    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const toDestroy = this.tilesToDestroy();
    this.maybeBreakAlliances(toDestroy);

    // Check for doomsday device activation
    const playersHit = new Set<Player>();
    for (const tile of toDestroy) {
      const owner = this.mg.owner(tile);
      if (owner.isPlayer()) {
        playersHit.add(owner);
      }
    }

    // Activate doomsday devices for players whose territory was hit
    for (const player of playersHit) {
      this.maybeActivateDoomsdayDevice(player);
    }

    for (const tile of toDestroy) {
      const owner = this.mg.owner(tile);
      if (owner.isPlayer()) {
        owner.relinquish(tile);
        const tileCount = owner.numTilesOwned();
        if (tileCount > 0) {
          owner.removeProductivity(3 / tileCount);
        }
        owner.removeTroops(
          this.mg
            .config()
            .nukeDeathFactor(owner.troops(), owner.numTilesOwned()),
        );
        owner.removeWorkers(
          this.mg
            .config()
            .nukeDeathFactor(owner.workers(), owner.numTilesOwned()),
        );
        owner.outgoingAttacks().forEach((attack) => {
          const deaths =
            this.mg
              ?.config()
              .nukeDeathFactor(attack.troops(), owner.numTilesOwned()) ?? 0;
          attack.setTroops(attack.troops() - deaths);
        });
        owner.units(UnitType.TransportShip).forEach((attack) => {
          const deaths =
            this.mg
              ?.config()
              .nukeDeathFactor(attack.troops(), owner.numTilesOwned()) ?? 0;
          attack.setTroops(attack.troops() - deaths);
        });
      }

      if (this.mg.isLand(tile)) {
        this.mg.setFallout(tile, true);
      }
    }

    const outer2 = magnitude.outer * magnitude.outer;
    for (const unit of this.mg.units()) {
      if (
        unit.type() !== UnitType.AtomBomb &&
        unit.type() !== UnitType.HydrogenBomb &&
        unit.type() !== UnitType.MIRVWarhead &&
        unit.type() !== UnitType.MIRV
      ) {
        if (this.mg.euclideanDistSquared(this.dst, unit.tile()) < outer2) {
          unit.delete(true, this.player);
        }
      }
    }

    this.redrawBuildings(magnitude.outer + SPRITE_RADIUS);
    this.active = false;
    this.nuke.setReachedTarget();
    this.nuke.delete(false);

    // Record stats
    this.mg
      .stats()
      .bombLand(this.player, this.target(), this.nuke.type() as NukeType);
  }

  private redrawBuildings(range: number) {
    const rangeSquared = range * range;
    for (const unit of this.mg.units()) {
      if (isStructureType(unit.type())) {
        if (
          this.mg.euclideanDistSquared(this.dst, unit.tile()) < rangeSquared
        ) {
          unit.touch();
        }
      }
    }
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
