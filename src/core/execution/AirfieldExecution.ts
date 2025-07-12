import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { BomberExecution } from "./BomberExecution";
import { CargoPlaneExecution } from "./CargoPlaneExecution";

export class AirfieldExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private airfield: Unit | null = null;
  private random: PseudoRandom | null = null;
  private checkOffset: number | null = null;
  private spawnTicker = 0;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.random === null || this.checkOffset === null) {
      throw new Error("AirfieldExecution not initialized");
    }
    const mg = this.mg;

    if (this.airfield === null) {
      const spawn = this.player.canBuild(UnitType.Airfield, this.tile);
      if (!spawn) {
        console.warn(
          `Player ${this.player.id()} cannot build airfield at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.airfield = this.player.buildUnit(UnitType.Airfield, spawn, {});
    }

    if (!this.airfield.isActive()) {
      this.active = false;
      return;
    }

    if (this.player.id() !== this.airfield.owner().id()) {
      this.player = this.airfield.owner();
    }

    if ((mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    const airfieldUnit = this.airfield;
    const totalEffectiveAirfields = mg
      .players()
      .reduce((sum, p) => sum + p.effectiveUnits(UnitType.Airfield), 0);
    const activeBombers = this.player.units(UnitType.Bomber).length;

    if (activeBombers >= totalEffectiveAirfields) {
      return;
    }

    if (mg.config().cargoPlanesEnabled()) {
      if (
        this.random.chance(
          mg.config().cargoPlaneSpawnRate(totalEffectiveAirfields),
        )
      ) {
        const possiblePorts = this.player.airfields(airfieldUnit);
        if (possiblePorts.length > 0) {
          const destField = this.random.randElement(possiblePorts);
          mg.addExecution(
            new CargoPlaneExecution(this.player, airfieldUnit, destField),
          );
        }
      }
    }

    if (mg.config().bombersEnabled()) {
      this.spawnTicker++;
      if (this.spawnTicker < mg.config().bomberSpawnInterval()) {
        return;
      }
      this.spawnTicker = 0;

      const busyTargets = new Set<TileRef>(
        this.mg
          .units(UnitType.Bomber)
          .map((u) => u.targetTile())
          .filter((t): t is TileRef => t !== undefined),
      );

      const range = mg.config().bomberTargetRange();
      type Near = { unit: Unit; dist2: number };
      const enemies: Near[] = mg
        .nearbyUnits(airfieldUnit.tile(), range, [
          UnitType.SAMLauncher,
          UnitType.Airfield,
          UnitType.MissileSilo,
          UnitType.Port,
          UnitType.DefensePost,
          UnitType.City,
          UnitType.Academy,
          UnitType.Hospital,
        ])
        .filter(({ unit, distSquared }) => {
          const t = unit.tile();
          const o = this.mg!.owner(t);

          if (
            !o.isPlayer() ||
            o.id() === this.player.id() ||
            this.player.isFriendly(o)
          ) {
            return false;
          }

          if (busyTargets.has(t)) {
            return false;
          }

          return true;
        })
        .map(({ unit, distSquared }) => ({ unit, dist2: distSquared }));

      if (enemies.length === 0) return;

      const byPlayer = new Map<string, Near[]>();
      for (const e of enemies) {
        const pid = e.unit.owner().id();
        const arr = byPlayer.get(pid) ?? [];
        arr.push(e);
        byPlayer.set(pid, arr);
      }

      const playersByDist = Array.from(byPlayer.entries())
        .map(([pid, list]) => ({
          pid,
          list,
          minDist: Math.min(...list.map((e) => e.dist2)),
        }))
        .sort((a, b) => a.minDist - b.minDist);

      const priority: UnitType[] = [
        UnitType.SAMLauncher,
        UnitType.Airfield,
        UnitType.MissileSilo,
        UnitType.Port,
        UnitType.DefensePost,
        UnitType.City,
        UnitType.Academy,
        UnitType.Hospital,
      ];

      let targetTile: TileRef | null = null;
      for (const { list } of playersByDist) {
        for (const type of priority) {
          const ofType = list
            .filter((e) => e.unit.type() === type)
            .sort((a, b) => a.dist2 - b.dist2);
          if (ofType.length > 0) {
            targetTile = ofType[0].unit.tile();
            break;
          }
        }
        if (targetTile) break;
      }

      if (!targetTile) return;
      mg.addExecution(
        new BomberExecution(this.player, airfieldUnit, targetTile),
      );
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
