import { Execution, Player, UnitType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { TileRef } from "../game/GameMap";

export class MoveFighterJetExecution implements Execution {
  executionName = "MoveFighterJetExecution";
  private mg: GameImpl;

  constructor(
    private owner: Player,
    private unitId: number,
    private position: TileRef,
  ) {}

  init(mg: GameImpl): void {
    this.mg = mg;
    const fighterJet = this.owner
      .units(UnitType.FighterJet)
      .find((u) => u.id() === this.unitId);

    if (!fighterJet) {
      console.warn("MoveFighterJetExecution: fighter jet not found");
      return;
    }
    if (!fighterJet.isActive()) {
      console.warn("MoveFighterJetExecution: fighter jet is not active");
      return;
    }

    // Make fighter jet head immediately to the clicked tile while updating patrol anchor.
    fighterJet.setPatrolTile(this.position);
    fighterJet.setTargetTile(this.position);
    // Clear any active target so movement isn't preempted by combat.
    fighterJet.setTargetUnit(undefined);
  }

  tick(): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
