import {
  AllianceRequest,
  Difficulty,
  Game,
  Player,
  PlayerType,
  Relation,
  TerraNullius,
  Tick,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { flattenedEmojiTable } from "../../Util";
import { AttackExecution } from "../AttackExecution";
import { EmojiExecution } from "../EmojiExecution";
import { BotPersonality } from "../FakeHumanExecution";
import { SetAutoBombingExecution } from "../SetAutoBombingExecution";

export class BotBehavior {
  private enemy: Player | null = null;
  private enemyUpdated: Tick;
  public enemySearchRadius = 100;

  private assistAcceptEmoji = flattenedEmojiTable.indexOf("👍");

  private firstAttackSent = false;

  // Performance cache for border tiles
  private borderTilesCache: Map<string, { tiles: TileRef[]; tick: Tick }> =
    new Map();

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private triggerRatio: number,
    private reserveRatio: number,
    private personality: BotPersonality = BotPersonality.Balanced,
  ) {}

  private getBorderTiles(player: Player): TileRef[] {
    const cached = this.borderTilesCache.get(player.id());
    // Cache valid for 100 ticks
    if (cached && this.game.ticks() - cached.tick < 100) {
      return cached.tiles;
    }
    const tiles = Array.from(player.borderTiles());
    this.borderTilesCache.set(player.id(), { tiles, tick: this.game.ticks() });
    return tiles;
  }

  handleAllianceRequests() {
    for (const req of this.player.incomingAllianceRequests()) {
      if (shouldAcceptAllianceRequest(this.game, this.player, req)) {
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
    const ourBordersAll = this.getBorderTiles(this.player);
    const ourBordersSample = this.random.sampleArray(ourBordersAll, 10); // ≤10 tiles
    const radSq = this.enemySearchRadius * this.enemySearchRadius;

    const candidates: Array<{ player: Player; score: number }> = [];

    for (const p of this.game.players()) {
      if (!p.isPlayer() || p === this.player || this.player.isFriendly(p))
        continue;

      // Base score = troop count (lower = better target)
      let score = p.troops();

      // Direct neighbour: strong preference
      if (this.player.neighbors().includes(p)) {
        score *= 0.7;
      } else {
        // Sample up to 10 of their border tiles for distance check
        const theirBorders = this.random.sampleArray(
          this.getBorderTiles(p),
          10,
        );
        if (!theirBorders.length) continue;

        // Check if close enough (≤100 distance checks per player)
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

        if (!closeEnough) continue;
        score *= 1.2; // Distance penalty for non-neighbors
      }

      // Personality-based targeting preferences
      if (this.personality === BotPersonality.LandWarfare) {
        // Prefer weaker targets more aggressively
        score *= p.troops() < this.player.troops() ? 0.6 : 1.4;
      } else if (this.personality === BotPersonality.AirSupremacy) {
        // Prefer targets with airfields (neutralize air threat)
        const airfieldCount = p.units(UnitType.Airfield).length;
        if (airfieldCount > 2) score *= 0.7;
      } else if (this.personality === BotPersonality.NavalPower) {
        // Prefer coastal players
        if (p.units(UnitType.Port).length > 0) score *= 0.8;
      }

      candidates.push({ player: p, score });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.score - b.score);
      this.setNewEnemy(candidates[0].player);
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

function shouldAcceptAllianceRequest(
  game: Game,
  player: Player,
  request: AllianceRequest,
) {
  const difficulty = game.config().gameConfig().difficulty;

  // Impossible: Never accept alliances
  if (difficulty === Difficulty.Impossible) {
    return false;
  }

  if (player.relation(request.requestor()) < Relation.Neutral) {
    return false; // Reject if hasMalice
  }
  if (request.requestor().isTraitor()) {
    return false; // Reject if isTraitor
  }

  const requestor = request.requestor();

  // Context 1: Accept if we're significantly weaker (need protection)
  const weAreMuchWeaker =
    player.numTilesOwned() < requestor.numTilesOwned() * 0.5;
  if (weAreMuchWeaker) return true;

  // Context 2: Accept if we're under active attack
  const underAttack = player.incomingAttacks().length > 0;
  if (underAttack) return true;

  // Context 3: Check if we share a border (mutual defense value)
  const sharesBorder = player.neighbors().includes(requestor);

  if (requestor.numTilesOwned() > player.numTilesOwned() * 3) {
    return true; // Accept if requestorIsMuchLarger
  }

  // Difficulty-based alliance limits
  let maxAlliances: number;
  switch (difficulty) {
    case Difficulty.Easy:
      maxAlliances = 3; // Original behavior
      break;
    case Difficulty.Medium:
      maxAlliances = 2;
      break;
    case Difficulty.Hard:
      maxAlliances = 1;
      break;
    default:
      maxAlliances = 3;
  }

  // More lenient if we share border
  const effectiveMax = sharesBorder ? maxAlliances + 1 : maxAlliances;

  if (requestor.alliances().length >= effectiveMax) {
    return false; // Reject if tooManyAlliances
  }
  return true; // Accept otherwise
}

export function shouldAcceptPeaceRequest(
  game: Game,
  player: Player,
  requestor: Player,
  personality: BotPersonality,
): boolean {
  const difficulty = game.config().gameConfig().difficulty;

  // Auto-accept if losing badly (need relief from war)
  const weAreLosing =
    player.numTilesOwned() < requestor.numTilesOwned() * 0.4 ||
    player.incomingAttacks().length > 3;
  if (weAreLosing) return true;

  // Auto-reject if winning decisively (press the advantage)
  const weAreWinning =
    requestor.numTilesOwned() < player.numTilesOwned() * 0.4 &&
    player.population() > requestor.population() * 1.5;
  if (weAreWinning) return false;

  // Personality-based decisions for balanced situations
  if (
    personality === BotPersonality.Nuclear ||
    personality === BotPersonality.LandWarfare
  ) {
    // Aggressive personalities: reject unless under pressure
    return player.incomingAttacks().length > 0;
  }

  if (
    personality === BotPersonality.NavalPower ||
    personality === BotPersonality.AirSupremacy
  ) {
    // Diplomatic personalities: accept readily
    return true;
  }

  // Balanced personality: Difficulty-based decision
  if (difficulty === Difficulty.Impossible) {
    return false; // Never accept on Impossible
  }

  return true; // Accept by default for Easy/Medium/Hard
}
