import { Execution, Game, Player, PlayerType } from "../game/Game";
import { getTechNodes, isTechAvailable } from "../tech/ResearchTree";

// Execution to set the player's research priority tech in the tree.
export class ResearchTreeSelectExecution implements Execution {
  private _active = true;
  private mg: Game | null = null;

  constructor(
    private readonly player: Player,
    private readonly techId: string,
  ) {}

  isActive(): boolean {
    return this._active;
  }
  activeDuringSpawnPhase(): boolean {
    return true;
  }
  init(_mg: Game, _ticks: number): void {
    // Capture game reference for optional side-effects
    this.mg = _mg;
  }
  tick(_ticks: number): void {
    // If instant research for humans is enabled, research immediately for human players
    const instant = this.mg?.config().gameConfig().instantResearchHumanOnly;
    if (instant && this.player.type() === PlayerType.Human) {
      // Build researched set to verify prerequisites
      const researched = new Set<string>();
      const nodes = getTechNodes();
      for (const n of nodes) {
        if ((this.player as any).hasResearchedTech?.(n.id))
          researched.add(n.id);
      }
      if (
        !(this.player as any).hasResearchedTech?.(this.techId) &&
        isTechAvailable(this.techId, researched)
      ) {
        // Complete the research immediately; side-effects are handled by addResearchedTech()
        (this.player as any).addResearchedTech?.(this.techId);

        // Remove from priorities since research is completed
        const priorities = (this.player as any).researchPriorities?.();
        if (priorities?.has(this.techId)) {
          (this.player as any).setResearchPriority?.(this.techId); // Toggle off
        }
        this._active = false;
        return;
      }
      // Fall through to priority toggle if not available or already researched
    }

    // Default behavior: toggle research priority (add/remove from set)
    (this.player as any).setResearchPriority?.(this.techId);
    this._active = false;
  }
}
