import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { maxUnitLevel } from "../game/Upgradeables";
import { PseudoRandom } from "../PseudoRandom";
import { BomberExecution } from "./BomberExecution";
import { CargoPlaneExecution } from "./CargoPlaneExecution";

export class AirfieldExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private airfield: Unit | null = null;
  private random: PseudoRandom | null = null;
  private checkOffset: number | null = null;
  private lastLevel = 0; // Track airfield level to detect upgrades

  constructor(
    private player: Player,
    private tile: TileRef,
    private initialBomberLevel: number = 1, // Bomber upgrade level
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
      this.lastLevel = this.airfield.level?.() ?? 1;

      // Set initial bomber upgrade level if specified (clamped to max)
      const bomberLvl = Math.min(
        maxUnitLevel(UnitType.Bomber),
        Math.max(1, this.initialBomberLevel),
      );
      if (bomberLvl > 1) {
        this.airfield.setBomberLevel?.(bomberLvl);
      }

      // Spawn initial bombers when airfield is built
      this.spawnBombersForLevel(mg);
    }

    if (!this.airfield.isActive()) {
      this.active = false;
      return;
    }

    if (this.player.id() !== this.airfield.owner().id()) {
      this.player = this.airfield.owner();
    }

    // Check if airfield was upgraded - spawn additional bombers
    const currentLevel = this.airfield.level?.() ?? 1;
    if (currentLevel > this.lastLevel) {
      const bombersToAdd = currentLevel - this.lastLevel;
      for (let i = 0; i < bombersToAdd; i++) {
        mg.addExecution(new BomberExecution(this.player, this.airfield));
      }
      this.lastLevel = currentLevel;
    }

    if ((mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    const airfieldUnit = this.airfield;

    // Handle cargo planes
    if (mg.config().cargoPlanesEnabled()) {
      const totalEffectiveAirfields = mg
        .players()
        .reduce((sum, p) => sum + p.effectiveUnits(UnitType.Airfield), 0);
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
  }

  private spawnBombersForLevel(mg: Game): void {
    const level = this.airfield?.level?.() ?? 1;
    for (let i = 0; i < level; i++) {
      mg.addExecution(new BomberExecution(this.player, this.airfield!));
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
