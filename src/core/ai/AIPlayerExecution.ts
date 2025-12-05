import { Execution, Game, Nation, Player } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { AIAttackHandler } from "./AIAttackHandler";
import { AIBehaviorParams } from "./AIBehaviorParams";
import { AISpawnHandler } from "./AISpawnHandler";

/**
 * AI Player Execution - A configurable AI player with behavior parameters.
 */
export class AIPlayerExecution implements Execution {
  private active = true;
  private mg: Game;
  private player: Player | null = null;
  private random: PseudoRandom;
  private spawnHandler: AISpawnHandler | null = null;
  private attackHandler: AIAttackHandler | null = null;

  constructor(
    private gameID: GameID,
    private nation: Nation,
    private params: AIBehaviorParams = {},
  ) {
    this.random = new PseudoRandom(
      simpleHash(nation.playerInfo.id) + simpleHash(gameID),
    );
  }

  init(mg: Game): void {
    this.mg = mg;
    this.spawnHandler = new AISpawnHandler(
      mg,
      this.nation,
      this.random,
      this.params,
    );
    this.attackHandler = new AIAttackHandler(
      mg,
      this.nation.playerInfo.id,
      this.random,
      this.params,
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  tick(ticks: number): void {
    if (this.mg.inSpawnPhase()) {
      this.spawnHandler?.handleSpawnPhase(ticks);
      return;
    }

    // Find player if not found yet
    if (this.player === null) {
      this.player =
        this.mg.players().find((p) => p.id() === this.nation.playerInfo.id) ??
        null;
    }

    if (this.player === null || !this.player.isAlive()) {
      this.active = false;
      return;
    }

    // Handle attacks every tick
    this.attackHandler?.handleAttack();
  }
}
