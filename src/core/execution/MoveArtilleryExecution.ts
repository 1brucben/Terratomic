import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { getArtilleryMaxDistance } from "../game/UnitUpgrades";

export class MoveArtilleryExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly position: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    const artillery = this.owner
      .units(UnitType.Artillery)
      .find((u) => u.id() === this.unitId);
    if (!artillery) {
      return;
    }
    if (!artillery.isActive()) {
      return;
    }

    // Clamp send distance by artillery level to avoid expensive long-range paths
    const lvl = artillery.level ? artillery.level() : 1;
    const maxDist = getArtilleryMaxDistance(lvl);
    const distSq = mg.euclideanDistSquared(artillery.tile(), this.position);
    if (distSq > maxDist * maxDist) {
      return;
    }
    // Move intent should immediately head toward the clicked tile, while
    // also updating the patrol anchor so future roaming centers there.
    artillery.setPatrolTile(this.position);
    artillery.setTargetTile(this.position);
    // Clear any current target unit so movement isn't preempted by combat.
    artillery.setTargetUnit(undefined);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
