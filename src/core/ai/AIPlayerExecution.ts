import { Execution, Game, Nation, Player } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
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
    // TODO: Implement post-spawn behavior
  }
}
