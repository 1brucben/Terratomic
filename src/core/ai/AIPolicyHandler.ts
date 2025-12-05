import { PolicyDirectiveSelectExecution } from "../execution/PolicyDirectiveSelectExecution";
import { Game, Player, PlayerID } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import {
  getUnlockedDirectives,
  POLICY_DIRECTIVE_IDS,
} from "../tech/PolicyDirectives";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles policy directive selections for AI players.
 */
export class AIPolicyHandler {
  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {}

  private getPlayer(): Player | null {
    if (!this.mg.hasPlayer(this.playerId)) {
      return null;
    }
    return this.mg.player(this.playerId);
  }

  handlePolicyDirectives(): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    // Get all unlocked directives that haven't been chosen yet
    const unlockedDirectives = getUnlockedDirectives((techId) =>
      player.hasResearchedTech(techId),
    );

    for (const directive of unlockedDirectives) {
      // Skip if already chosen
      if (player.getPolicyChoice(directive.id) !== null) {
        continue;
      }

      // Pick an option
      const optionId = this.pickOption(directive.id, directive.options);

      // Execute the selection
      this.mg.addExecution(
        new PolicyDirectiveSelectExecution(player, directive.id, optionId),
      );
    }
  }

  private pickOption(directiveId: string, options: { id: string }[]): string {
    // Special case: trade policy - use parameter to decide
    if (directiveId === POLICY_DIRECTIVE_IDS.TRADE_POLICY_FRAMEWORK) {
      const preferOpenTrade = this.params.preferOpenTrade ?? true;
      return preferOpenTrade ? "open_trade" : "autarky";
    }

    // For all other directives, pick randomly
    const index = this.random.nextInt(0, options.length - 1);
    return options[index].id;
  }
}
