import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { BomberExecution } from "./BomberExecution";
import { CargoPlaneExecution } from "./CargoPlaneExecution";

/**
 * Manages the behavior and lifecycle of an Airfield.
 * This includes building the airfield, spawning bomber planes, cargo planes, and fighter jets.
 */
export class AirfieldExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private airfield: Unit | null = null;
  private random: PseudoRandom | null = null;
  private checkOffset: number | null = null;
  private spawnTicker = 0; // Ticker for bomber spawning.

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

    // 1) Build the Airfield if it hasn't been built yet.
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

    // 2) If the airfield unit becomes inactive (e.g., destroyed), deactivate this execution.
    if (!this.airfield.isActive()) {
      this.active = false;
      return;
    }

    // 3) Update the owner if the airfield has been conquered.
    if (this.player.id() !== this.airfield.owner().id()) {
      this.player = this.airfield.owner();
    }

    // 4) Only run the spawning logic every 10 ticks to reduce overhead.
    if ((mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    // Ensure airfieldUnit is not null for subsequent operations.
    const airfieldUnit = this.airfield;
    const totalAirfields = mg.units(UnitType.Airfield).length;

    // 3.3: Limit active Bombers per airfield.
    const activeBombers = this.player.units(UnitType.Bomber).length;

    if (activeBombers >= totalAirfields) {
      return; // Already “one-per-field” in the air, no more bombers needed.
    }

    // Cargo-plane spawn logic.
    if (this.random.chance(mg.config().cargoPlaneSpawnRate(totalAirfields))) {
      const possiblePorts = this.player.airfields(airfieldUnit);
      if (possiblePorts.length > 0) {
        const destField = this.random.randElement(possiblePorts);
        mg.addExecution(
          new CargoPlaneExecution(this.player, airfieldUnit, destField),
        );
      }
    }

    // 3.4: Bomber spawn chance and logic.
    this.spawnTicker++;
    if (this.spawnTicker < mg.config().bomberSpawnInterval()) {
      return;
    }
    this.spawnTicker = 0;

    // Get tiles occupied by existing bombers to avoid targeting the same location.
    const busyTargets = new Set<TileRef>(
      this.mg
        .units(UnitType.Bomber)
        .map((u) => u.targetTile())
        .filter((t): t is TileRef => t !== undefined),
    );

    // 3.4a: Gather all enemy units in range that can be targeted by bombers.
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

        // Only target enemy units that are players and not friendly.
        if (
          !o.isPlayer() ||
          o.id() === this.player.id() ||
          this.player.isFriendly(o)
        ) {
          return false;
        }

        // Only target locations not already targeted by other bombers.
        if (busyTargets.has(t)) {
          return false;
        }

        return true;
      })
      .map(({ unit, distSquared }) => ({ unit, dist2: distSquared }));

    if (enemies.length === 0) return;

    // Group enemy units by owner.
    const byPlayer = new Map<string, Near[]>();
    for (const e of enemies) {
      const pid = e.unit.owner().id();
      const arr = byPlayer.get(pid) ?? [];
      arr.push(e);
      byPlayer.set(pid, arr);
    }

    // Sort players by the distance to their nearest targetable unit.
    const playersByDist = Array.from(byPlayer.entries())
      .map(([pid, list]) => ({
        pid,
        list,
        minDist: Math.min(...list.map((e) => e.dist2)),
      }))
      .sort((a, b) => a.minDist - b.minDist);

    // Define priority order for unit types to target.
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

    // Iterate through players and unit types to find the best target tile.
    let targetTile: TileRef | null = null;
    for (const { list } of playersByDist) {
      for (const type of priority) {
        // Find units of the current type for the current player, sorted by distance.
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

    // If no target is found, give up for this tick.
    if (!targetTile) return;
    // 3.4b: Launch the Bomber towards the selected target.
    mg.addExecution(new BomberExecution(this.player, airfieldUnit, targetTile));
  }

  /**
   * Checks if the AirfieldExecution is currently active.
   * @returns True if active, false otherwise.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Indicates whether this execution should be active during the spawn phase.
   * @returns Always false.
   */
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
