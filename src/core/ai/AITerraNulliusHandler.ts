import { AttackExecution } from "../execution/AttackExecution";
import { Game, Player, PlayerID } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles expansion attacks against Terra Nullius (unclaimed land).
 */
export class AITerraNulliusHandler {
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

  handleTerraNulliusAttack(): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    const attackThreshold = this.params.terraNulliusTroopThreshold ?? 0.3;
    const maxPop = this.mg.config().maxPopulation(player);
    const maxTroops = maxPop * player.targetTroopRatio();
    const totalTroops = player.troops() + player.attackingTroops();
    const troopRatio = totalTroops / maxTroops;

    // Only expand if we have enough troops
    if (troopRatio < attackThreshold) {
      return;
    }

    // Check if we border Terra Nullius
    const tn = this.mg.terraNullius();
    if (!player.sharesBorderWith(tn)) {
      return;
    }

    // Calculate troops to send
    const ownTroopPercent = this.params.terraNulliusOwnTroopPercent ?? 0.1;
    const troops = player.troops() * ownTroopPercent;

    if (troops < 1) {
      return;
    }

    // Send attack against Terra Nullius (null target ID)
    this.mg.addExecution(new AttackExecution(troops, player, null));
  }
}
