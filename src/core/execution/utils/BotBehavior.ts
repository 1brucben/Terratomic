import {
  AllianceRequest,
  Game,
  Player,
  PlayerType,
  Relation,
  TerraNullius,
  Tick,
  UnitType,
} from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { flattenedEmojiTable } from "../../Util";
import { AttackExecution } from "../AttackExecution";
import { EmojiExecution } from "../EmojiExecution";
import { SetAutoBombingExecution } from "../SetAutoBombingExecution";

export class BotBehavior {
  private enemy: Player | null = null;
  private enemyUpdated: Tick;
  public enemySearchRadius = 100;

  private assistAcceptEmoji = flattenedEmojiTable.indexOf("👍");

  private firstAttackSent = false;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private triggerRatio: number,
    private reserveRatio: number,
  ) {}

  handleAllianceRequests() {
    for (const req of this.player.incomingAllianceRequests()) {
      if (shouldAcceptAllianceRequest(this.player, req)) {
        req.accept();
      } else {
        req.reject();
      }
    }
  }

  handleBombers() {
    if (this.player.units(UnitType.Airfield).length > 0) {
      if (!this.player.isAutoBombingEnabled()) {
        this.game.addExecution(new SetAutoBombingExecution(this.player, true));
      }
    }
  }

  private emoji(player: Player, emoji: number) {
    if (player.type() !== PlayerType.Human) return;
    this.game.addExecution(new EmojiExecution(this.player, player.id(), emoji));
  }

  private setNewEnemy(newEnemy: Player | null) {
    this.enemySearchRadius = 100;
    this.enemy = newEnemy;
    this.enemyUpdated = this.game.ticks();
  }

  public clearEnemy() {
    this.enemy = null;
  }

  forgetOldEnemies() {
    // Forget old enemies
    if (this.game.ticks() - this.enemyUpdated > 200) {
      this.clearEnemy();
    }
  }

  private hasSufficientTroops(): boolean {
    const maxPop = this.game.config().maxPopulation(this.player);
    const ratio = this.player.population() / maxPop;
    return ratio >= this.triggerRatio;
  }

  private checkIncomingAttacks() {
    // Switch enemies if we're under attack
    const incomingAttacks = this.player.incomingAttacks();
    let largestAttack = 0;
    let largestAttacker: Player | undefined;
    for (const attack of incomingAttacks) {
      if (attack.troops() <= largestAttack) continue;
      largestAttack = attack.troops();
      largestAttacker = attack.attacker();
    }
    if (largestAttacker !== undefined) {
      this.setNewEnemy(largestAttacker);
    }
  }

  assistAllies() {
    outer: for (const ally of this.player.allies()) {
      if (ally.targets().length === 0) continue;
      if (this.player.relation(ally) < Relation.Friendly) {
        // this.emoji(ally, "🤦");
        continue;
      }
      for (const target of ally.targets()) {
        if (target === this.player) {
          // this.emoji(ally, "💀");
          continue;
        }
        if (this.player.isAlliedWith(target)) {
          // this.emoji(ally, "👎");
          continue;
        }
        // All checks passed, assist them
        this.player.updateRelation(ally, -20);
        this.setNewEnemy(target);
        this.emoji(ally, this.assistAcceptEmoji);
        break outer;
      }
    }
  }

  selectEnemy(): Player | null {
    if (this.enemy !== null) return this.enemySanityCheck();
    if (!this.hasSufficientTroops()) return null;

    /* ---------- 1. lowest-density neighbouring bot (unchanged) ---------- */
    const bots = this.player
      .neighbors()
      .filter((n): n is Player => n.isPlayer() && n.type() === PlayerType.Bot);

    if (bots.length) {
      const density = (p: Player) => p.troops() / p.numTilesOwned();
      let best: Player | null = null;
      let bestD = Infinity;
      for (const b of bots) {
        const d = density(b);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (best) {
        this.setNewEnemy(best);
        return this.enemySanityCheck();
      }
    }

    /* ---------- 2. retaliation if attacked (unchanged) ---------- */
    this.checkIncomingAttacks();
    if (this.enemy) return this.enemySanityCheck();

    /* ---------- 3. weakest nearby player, using *sampled* border tiles ---------- */
    const ourBordersAll = Array.from(this.player.borderTiles());
    const ourBordersSample = this.random.sampleArray(ourBordersAll, 10); // ≤10 tiles
    const radSq = this.enemySearchRadius * this.enemySearchRadius;

    let weakest: Player | null = null;
    let weakestTroops = Infinity;

    for (const p of this.game.players()) {
      if (!p.isPlayer() || p === this.player || this.player.isFriendly(p))
        continue;

      // Direct neighbour counts immediately
      if (this.player.neighbors().includes(p)) {
        if (p.troops() < weakestTroops) {
          weakest = p;
          weakestTroops = p.troops();
        }
        continue;
      }

      // Sample up to 10 of their border tiles
      const theirBorders = this.random.sampleArray(
        Array.from(p.borderTiles()),
        10,
      );
      if (!theirBorders.length) continue;

      // Cheap nested loop: ≤100 distance checks per player
      let closeEnough = false;
      outer: for (const tb of theirBorders) {
        for (const ob of ourBordersSample) {
          const dx = this.game.x(ob) - this.game.x(tb);
          const dy = this.game.y(ob) - this.game.y(tb);
          if (dx * dx + dy * dy <= radSq) {
            closeEnough = true;
            break outer;
          }
        }
      }

      if (closeEnough && p.troops() < weakestTroops) {
        weakest = p;
        weakestTroops = p.troops();
      }
    }

    if (weakest) {
      this.setNewEnemy(weakest); // resets radius to 100
    } else {
      this.enemySearchRadius += 50; // widen search next tick
    }

    return this.enemySanityCheck();
  }

  private enemySanityCheck(): Player | null {
    if (this.enemy && this.player.isFriendly(this.enemy)) {
      this.clearEnemy();
    }
    return this.enemy;
  }

  sendAttack(target: Player | TerraNullius) {
    if (target.isPlayer() && this.player.isOnSameTeam(target)) return;

    if (target.isPlayer()) {
      const isPeaceTimerActive =
        this.game.peaceTimerEndsAtTick !== null &&
        this.game.ticks() < this.game.peaceTimerEndsAtTick;

      const attackerType = this.player.type();
      const defenderType = target.type();

      if (
        isPeaceTimerActive &&
        (attackerType === PlayerType.Human ||
          attackerType === PlayerType.FakeHuman) &&
        (defenderType === PlayerType.Human ||
          defenderType === PlayerType.FakeHuman)
      ) {
        // Do not send attack if peace timer is active and both are protected types
        return;
      }
    }

    const maxPop = this.game.config().maxPopulation(this.player);
    const maxTroops = maxPop * this.player.targetTroopRatio();
    const targetTroops = maxTroops * this.reserveRatio;
    // Don't wait until it has sufficient reserves to send the first attack
    // to prevent the bot from waiting too long at the start of the game.
    let troops = this.firstAttackSent
      ? this.player.troops() - targetTroops
      : this.player.troops() / 5;
    if (target.isPlayer()) {
      troops = Math.min(troops, target.troops() * 3);
    }
    if (troops < 1) return;
    this.firstAttackSent = true;
    this.game.addExecution(
      new AttackExecution(
        troops,
        this.player,
        target.isPlayer() ? target.id() : null,
      ),
    );
  }
}

function shouldAcceptAllianceRequest(player: Player, request: AllianceRequest) {
  if (player.relation(request.requestor()) < Relation.Neutral) {
    return false; // Reject if hasMalice
  }
  if (request.requestor().isTraitor()) {
    return false; // Reject if isTraitor
  }
  if (request.requestor().numTilesOwned() > player.numTilesOwned() * 3) {
    return true; // Accept if requestorIsMuchLarger
  }
  if (request.requestor().alliances().length >= 3) {
    return false; // Reject if tooManyAlliances
  }
  return true; // Accept otherwise
}
