import {
  Execution,
  Game,
  Player,
  Unit,
  UnitType,
  UpgradeType,
} from "../game/Game";
import { CityAABulletExecution } from "./CityAABulletExecution";

// Plane types that can be targeted by city AA
const PLANE_TYPES: UnitType[] = [
  UnitType.Bomber,
  UnitType.FighterJet,
  UnitType.CargoPlane,
  UnitType.Paratrooper,
];

/**
 * Execution that manages city anti-aircraft fire for a player.
 * Cities with the CityAntiAir upgrade will fire bullets at enemy planes
 * every few ticks.
 */
export class CityAAExecution implements Execution {
  private active = true;
  private mg: Game;
  private lastFireTick: Map<number, number> = new Map(); // cityId -> last fire tick

  constructor(private player: Player) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    // Check if player is still active and has the upgrade
    if (
      !this.player.isPlayer() ||
      !this.player.hasUpgrade(UpgradeType.CityAntiAir)
    ) {
      this.active = false;
      return;
    }

    const cities = this.player.units(UnitType.City);
    const fireRate = this.mg.config().cityAAFireRate();
    const rangeSquared =
      this.mg.config().cityAARange() * this.mg.config().cityAARange();

    for (const city of cities) {
      if (!city.isActive()) continue;

      // Check cooldown for this city
      const lastFire = this.lastFireTick.get(city.id()) ?? 0;
      if (ticks - lastFire < fireRate) continue;

      // Find enemy planes in range
      const target = this.findNearestEnemyPlane(city, rangeSquared);
      if (target) {
        // Fire a bullet at the target
        this.mg.addExecution(
          new CityAABulletExecution(city.tile(), this.player, city, target),
        );
        this.lastFireTick.set(city.id(), ticks);
      }
    }

    // Clean up old city entries (for destroyed cities)
    for (const cityId of this.lastFireTick.keys()) {
      const exists = cities.some((c) => c.id() === cityId && c.isActive());
      if (!exists) {
        this.lastFireTick.delete(cityId);
      }
    }
  }

  private findNearestEnemyPlane(city: Unit, rangeSquared: number): Unit | null {
    let nearestPlane: Unit | null = null;
    let nearestDistSquared = Infinity;

    for (const planeType of PLANE_TYPES) {
      const planes = this.mg
        .nearbyUnits(city.tile(), Math.sqrt(rangeSquared), planeType)
        .filter(({ unit }) => {
          const owner = unit.owner();
          return (
            unit.isActive() &&
            owner !== this.player &&
            !this.player.isFriendly(owner) &&
            !unit.isAtSourceAirfield() // Don't target planes at their airfield
          );
        });

      for (const { unit, distSquared } of planes) {
        if (distSquared < nearestDistSquared) {
          nearestDistSquared = distSquared;
          nearestPlane = unit;
        }
      }
    }

    return nearestPlane;
  }

  isActive(): boolean {
    return this.active && this.player.isPlayer();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  /** Called when this execution should be deactivated */
  deactivate(): void {
    this.active = false;
  }
}
