import {
  Execution,
  Game,
  Player,
  PlayerType,
  TerraNullius,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { AttackExecution } from "./AttackExecution";

export class BotExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private mg: Game;
  private neighborsTerraNullius = true;

  private firstAttackSent = false;
  private attackRate: number;
  private attackTick: number;
  private reserveRatio: number;

  constructor(private bot: Player) {
    this.random = new PseudoRandom(simpleHash(bot.id()));
    this.attackRate = this.random.nextInt(40, 80);
    this.attackTick = this.random.nextInt(0, this.attackRate);
    this.reserveRatio = this.random.nextInt(30, 60) / 100;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game) {
    this.mg = mg;
    this.bot.setTargetTroopRatio(0.7);
    this.bot.setInvestmentRate(0);
  }

  tick(ticks: number) {
    if (ticks % this.attackRate !== this.attackTick) return;

    if (!this.bot.isAlive()) {
      this.active = false;
      return;
    }

    this.maybeAttack();
  }

  private sendAttack(target: Player | TerraNullius) {
    if (target.isPlayer() && this.bot.isOnSameTeam(target)) return;

    const maxPop = this.mg.config().maxPopulation(this.bot);
    const maxTroops = maxPop * this.bot.targetTroopRatio();
    const targetTroops = maxTroops * this.reserveRatio;

    // Don't wait until it has sufficient reserves to send the first attack
    // to prevent the bot from waiting too long at the start of the game.
    let troops = this.firstAttackSent
      ? this.bot.troops() - targetTroops
      : this.bot.troops() / 5;

    if (target.isPlayer()) {
      troops = Math.min(troops, target.troops() * 3);
    }
    if (troops < 1) return;
    this.firstAttackSent = true;

    this.mg.addExecution(
      new AttackExecution(
        troops,
        this.bot,
        target.isPlayer() ? target.id() : null,
        null,
      ),
    );
  }

  private maybeAttack() {
    if (this.neighborsTerraNullius) {
      if (this.bot.sharesBorderWith(this.mg.terraNullius())) {
        this.sendAttack(this.mg.terraNullius());
        return;
      }
      this.neighborsTerraNullius = false;
    }

    const neighbors = this.bot
      .neighbors()
      .filter((n): n is Player => n.isPlayer() && n.type() === PlayerType.Bot);

    if (neighbors.length > 0) {
      const target = this.random.randElement(neighbors);
      this.sendAttack(target);
    }
  }

  isActive(): boolean {
    return this.active;
  }
}
