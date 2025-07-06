import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { BomberExecution } from "./BomberExecution";
import { CargoPlaneExecution } from "./CargoPlaneExecution";

import { FighterJetExecution } from "./FighterJetExecution";

export class AirfieldExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private airfield: Unit | null = null;
  private random: PseudoRandom | null = null;
  private checkOffset: number | null = null;
  private spawnTicker = 0;
  private fighterSpawnTicker = 0;

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
      throw new Error("Not initialized");
    }
    const mg = this.mg;

    // 1) Build the Airfield if we haven't yet
    if (this.airfield === null) {
      const spawn = this.player.canBuild(UnitType.Airfield, this.tile);
      if (!spawn) {
        console.warn(
          `player ${this.player.id()} cannot build airfield at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.airfield = this.player.buildUnit(UnitType.Airfield, spawn, {});
    }

    // 2) If it ever goes inactive, kill this execution
    if (!this.airfield.isActive()) {
      this.active = false;
      return;
    }

    // 3) Owner might’ve changed via conquest
    if (this.player.id() !== this.airfield.owner().id()) {
      this.player = this.airfield.owner();
    }

    // 4) Only run every 10 ticks
    if ((mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    // ——> Capture non-null Airfield exactly once
    const airfieldUnit = this.airfield;
    const totalAirfields = mg.units(UnitType.Airfield).length;

    // 3.3: Limit active Bombers per airfield
    const activeBombers = this.player.units(UnitType.Bomber).length;

    if (activeBombers >= totalAirfields) {
      return; // already “one-per-field” in the air
    }

    // Cargo-plane spawn
    if (this.random.chance(mg.config().cargoPlaneSpawnRate(totalAirfields))) {
      const possiblePorts = this.player.airfields(airfieldUnit);
      if (possiblePorts.length > 0) {
        const destField = this.random.randElement(possiblePorts);
        mg.addExecution(
          new CargoPlaneExecution(this.player, airfieldUnit, destField),
        );
      }
    }

    // 3.4: Bomber spawn chance
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

    // 3.4a: Gather all enemy units in range, with their owner and distance²
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

        // a) Only enemy units
        if (
          !o.isPlayer() ||
          o.id() === this.player.id() ||
          this.player.isFriendly(o)
        ) {
          return false;
        }

        // b) only targets free of other Bombers
        if (busyTargets.has(t)) {
          return false;
        }

        return true;
      })
      .map(({ unit, distSquared }) => ({ unit, dist2: distSquared }));

    if (enemies.length === 0) return;

    // Group by owner
    const byPlayer = new Map<string, Near[]>();
    for (const e of enemies) {
      const pid = e.unit.owner().id();
      const arr = byPlayer.get(pid) ?? [];
      arr.push(e);
      byPlayer.set(pid, arr);
    }

    // Sort players by nearest-unit distance
    const playersByDist = Array.from(byPlayer.entries())
      .map(([pid, list]) => ({
        pid,
        list,
        minDist: Math.min(...list.map((e) => e.dist2)),
      }))
      .sort((a, b) => a.minDist - b.minDist);

    // Priority order of UnitTypes
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

    // For each player in order, try each type in order
    let targetTile: TileRef | null = null;
    for (const { list } of playersByDist) {
      for (const type of priority) {
        // find all of this type for that player, sorted by dist
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

    // no match? give up
    if (!targetTile) return;

    // 3.4b: Actually launch the Bomber
    mg.addExecution(new BomberExecution(this.player, airfieldUnit, targetTile));

    // 3.5: Fighter Jet spawn chance
    this.fighterSpawnTicker++;
    if (this.fighterSpawnTicker < mg.config().fighterJetSpawnInterval()) {
      return;
    }
    this.fighterSpawnTicker = 0;

    const activeFighters = this.player.units(UnitType.FighterJet).length;
    if (activeFighters >= totalAirfields) {
      return; // already “one-per-field” in the air
    }

    const enemyAirUnits = mg
      .nearbyUnits(
        airfieldUnit.tile(),
        mg.config().fighterJetTargettingRange(),
        [UnitType.Bomber, UnitType.FighterJet],
      )
      .filter(({ unit }) => {
        const o = this.mg!.owner(unit.tile());
        return (
          o.isPlayer() &&
          o.id() !== this.player.id() &&
          !this.player.isFriendly(o)
        );
      });

    if (enemyAirUnits.length > 0) {
      mg.addExecution(
        new FighterJetExecution({
          owner: this.player,
          patrolTile: airfieldUnit.tile(),
        }),
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
