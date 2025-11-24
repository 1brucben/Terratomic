import { Execution, Game, UnitType } from "../game/Game";

export class BomberTargetExecution implements Execution {
  constructor(
    private readonly player: any, // or Player if typed
    private readonly targetPlayerID: string | null, // who to attack
    private readonly structures: UnitType[] | null, // what to bomb
    private readonly preferClosest: boolean = true, // target closest or furthest
  ) {}

  init(_mg: Game, _ticks: number): void {
    this.player.bomberIntent =
      this.targetPlayerID && this.structures && this.structures.length > 0
        ? {
            targetPlayerID: this.targetPlayerID,
            structures: this.structures,
            preferClosest: this.preferClosest,
          }
        : null;
  }

  tick(): void {
    // No-op
  }

  isActive(): boolean {
    return false; // immediately completed
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
