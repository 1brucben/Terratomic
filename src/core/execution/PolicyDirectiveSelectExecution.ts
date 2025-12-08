import { Execution, Game, Player, UpgradeType } from "../game/Game";
import {
  getPolicyDirective,
  isDirectiveUnlocked,
  type PolicyDirectiveId,
} from "../tech/PolicyDirectives";

/**
 * Execution to set the player's policy directive choice.
 */
export class PolicyDirectiveSelectExecution implements Execution {
  private _active = true;
  private mg: Game | null = null;

  constructor(
    private readonly player: Player,
    private readonly directiveId: string,
    private readonly optionId: string,
  ) {}

  isActive(): boolean {
    return this._active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  init(_mg: Game, _ticks: number): void {
    this.mg = _mg;
  }

  tick(_ticks: number): void {
    // Validate the directive exists
    const directive = getPolicyDirective(this.directiveId as PolicyDirectiveId);
    if (!directive) {
      console.warn(
        `[PolicyDirectiveSelectExecution] Unknown directive: ${this.directiveId}`,
      );
      this._active = false;
      return;
    }

    // Validate the directive is unlocked for this player
    if (
      !isDirectiveUnlocked(
        this.directiveId as PolicyDirectiveId,
        (techId) => this.player.hasResearchedTech?.(techId) ?? false,
      )
    ) {
      console.warn(
        `[PolicyDirectiveSelectExecution] Directive not unlocked: ${this.directiveId}`,
      );
      this._active = false;
      return;
    }

    // Validate the option exists
    const option = directive.options.find((o) => o.id === this.optionId);
    if (!option) {
      console.warn(
        `[PolicyDirectiveSelectExecution] Unknown option: ${this.optionId} for directive ${this.directiveId}`,
      );
      this._active = false;
      return;
    }

    // Check if a choice has already been made (policy directives are one-time choices)
    const existingChoice = this.player.getPolicyChoice(this.directiveId);
    if (existingChoice !== null) {
      console.warn(
        `[PolicyDirectiveSelectExecution] Choice already made for directive: ${this.directiveId}`,
      );
      this._active = false;
      return;
    }

    // Set the policy choice
    this.player.setPolicyChoice(this.directiveId, this.optionId);

    // Apply upgrade effects from the chosen option
    if (option.effects.grantsInternationalTrade) {
      this.player.addUpgrade(UpgradeType.InternationalTrade);
    }

    this._active = false;
  }
}
