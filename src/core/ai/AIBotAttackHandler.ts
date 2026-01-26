import { AttackExecution } from "../execution/AttackExecution";
import { TransportShipExecution } from "../execution/TransportShipExecution";
import { closestTwoTiles } from "../execution/Util";
import { Game, Player, PlayerID, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles attack behavior against Bot players only.
 * Player attacks (Human, AI, etc.) are handled separately.
 */
export class AIBotAttackHandler {
  private currentBotTarget: Player | null = null;
  private unreachableBots: Map<PlayerID, number> = new Map(); // PlayerID -> tick when marked unreachable
  private allNeighborsCache: { neighbors: Set<PlayerID>; tick: number } | null =
    null;
  private playerShoreCache: { tiles: TileRef[]; tick: number } | null = null;
  private targetShoreCache: Map<PlayerID, { tiles: TileRef[]; tick: number }> =
    new Map();
  private static readonly UNREACHABLE_RECHECK_INTERVAL = 100;
  private static readonly NEIGHBOR_CACHE_INTERVAL = 10;
  private static readonly SHORE_CACHE_INTERVAL = 10;

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
    private readonly thresholdOffset: number,
  ) {}

  private getPlayer(): Player | null {
    if (!this.mg.hasPlayer(this.playerId)) {
      return null;
    }
    return this.mg.player(this.playerId);
  }

  handleBotAttack(): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    const attackThreshold =
      (this.params.botAttackTroopThreshold ?? 0.5) + this.thresholdOffset;
    const maxPop = this.mg.config().maxPopulation(player);
    const maxTroops = maxPop * player.targetTroopRatio();
    const totalTroops = player.troops() + player.attackingTroops();
    const troopRatio = totalTroops / maxTroops;

    // Only attack bots if we have enough troops
    if (troopRatio < attackThreshold) {
      return;
    }

    // Check if we have enough defending troops at home
    const defendingTroopTarget = this.params.defendingTroopTarget ?? 0.5;
    const defendingRatio = player.troops() / totalTroops;
    if (defendingRatio < defendingTroopTarget) {
      return;
    }

    // If no bot target, or target is dead, or target became unreachable, find a new one
    if (
      this.currentBotTarget === null ||
      !this.currentBotTarget.isAlive() ||
      !this.isReachable(player, this.currentBotTarget)
    ) {
      this.currentBotTarget = this.findBotTarget(player);
    }

    if (this.currentBotTarget === null) {
      return;
    }

    this.launchBotAttack(player, this.currentBotTarget);
  }

  private findBotTarget(player: Player): Player | null {
    const maxDistance = this.params.botAttackMaxDistance ?? 200;
    const playerCapital = player.capital();

    if (playerCapital === null) {
      return null;
    }

    // Get all bots sorted by distance to our capital
    const candidates: { player: Player; distanceSq: number }[] = [];
    const currentTick = this.mg.ticks();

    // Clean up expired unreachable entries
    for (const [botId, markedTick] of this.unreachableBots) {
      if (
        currentTick - markedTick >=
        AIBotAttackHandler.UNREACHABLE_RECHECK_INTERVAL
      ) {
        this.unreachableBots.delete(botId);
      }
    }

    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (other.type() !== PlayerType.Bot) continue;
      if (!other.isAlive()) continue;
      // Skip bots marked as unreachable (not yet expired)
      if (this.unreachableBots.has(other.id())) continue;

      const otherCapital = other.capital();
      if (otherCapital === null) continue;

      // Use squared distance to avoid expensive sqrt
      const distanceSq =
        (playerCapital.x - otherCapital.x) ** 2 +
        (playerCapital.y - otherCapital.y) ** 2;

      // Check cached neighbor status or compute if expired/missing
      const isNeighbor = this.isNeighborCached(player, other, currentTick);
      if (isNeighbor || distanceSq <= maxDistance * maxDistance) {
        candidates.push({ player: other, distanceSq });
      }
    }

    // Sort by distance (nearest first)
    candidates.sort((a, b) => a.distanceSq - b.distanceSq);

    // Find the first reachable target, marking unreachable ones
    for (const candidate of candidates) {
      if (this.isReachable(player, candidate.player)) {
        return candidate.player;
      } else {
        // Mark as unreachable for 100 ticks
        this.unreachableBots.set(candidate.player.id(), currentTick);
      }
    }

    return null;
  }

  /**
   * Get all neighboring player IDs with caching.
   * This is more efficient than checking each target individually since
   * we only iterate border tiles once.
   */
  private getAllNeighborsCached(
    player: Player,
    currentTick: number,
  ): Set<PlayerID> {
    if (
      this.allNeighborsCache &&
      currentTick - this.allNeighborsCache.tick <
        AIBotAttackHandler.NEIGHBOR_CACHE_INTERVAL
    ) {
      return this.allNeighborsCache.neighbors;
    }

    // Compute all neighbors in one pass through border tiles
    const neighbors = new Set<PlayerID>();
    const myId = player.smallID();

    for (const border of player.borderTiles()) {
      for (const neighbor of this.mg.neighbors(border)) {
        if (this.mg.isLand(neighbor)) {
          const ownerId = this.mg.ownerID(neighbor);
          if (ownerId !== 0 && ownerId !== myId) {
            const owner = this.mg.owner(neighbor);
            const ownersId = owner.id();
            if (ownersId !== null) {
              neighbors.add(ownersId);
            }
          }
        }
      }
    }

    this.allNeighborsCache = { neighbors, tick: currentTick };
    return neighbors;
  }

  /**
   * Check if player shares border with target using the all-neighbors cache.
   */
  private isNeighborCached(
    player: Player,
    target: Player,
    currentTick: number,
  ): boolean {
    const allNeighbors = this.getAllNeighborsCached(player, currentTick);
    return allNeighbors.has(target.id());
  }

  private isReachable(player: Player, target: Player): boolean {
    // Check if shares land border (use cache)
    const currentTick = this.mg.ticks();
    if (this.isNeighborCached(player, target, currentTick)) {
      return true;
    }

    // Check if reachable by boat (both have ocean shore tiles)
    const playerShore = this.getPlayerShoreCached(player, currentTick);
    const targetShore = this.getTargetShoreCached(target, currentTick);

    // If both have ocean shore, they're reachable by boat
    return playerShore.length > 0 && targetShore.length > 0;
  }

  /**
   * Get target player's ocean shore tiles with caching.
   */
  private getTargetShoreCached(target: Player, currentTick: number): TileRef[] {
    const cached = this.targetShoreCache.get(target.id());
    if (
      cached &&
      currentTick - cached.tick < AIBotAttackHandler.SHORE_CACHE_INTERVAL
    ) {
      return cached.tiles;
    }

    const tiles = Array.from(target.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    this.targetShoreCache.set(target.id(), { tiles, tick: currentTick });
    return tiles;
  }

  /**
   * Get player's ocean shore tiles with caching.
   */
  private getPlayerShoreCached(player: Player, currentTick: number): TileRef[] {
    if (
      this.playerShoreCache &&
      currentTick - this.playerShoreCache.tick <
        AIBotAttackHandler.SHORE_CACHE_INTERVAL
    ) {
      return this.playerShoreCache.tiles;
    }

    const tiles = Array.from(player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    this.playerShoreCache = { tiles, tick: currentTick };
    return tiles;
  }

  private launchBotAttack(player: Player, target: Player): void {
    const alpha = this.params.botAttackOwnTroopPercent ?? 0.2;
    const beta = this.params.botAttackEnemyTroopMultiplier ?? 1.5;

    const troopsFromOwn = player.troops() * alpha;
    const troopsFromEnemy = target.troops() * beta;
    const troops = Math.min(troopsFromOwn, troopsFromEnemy);

    if (troops < 1) {
      return;
    }

    const currentTick = this.mg.ticks();

    // Check if we share a land border - if so, use land attack
    if (this.isNeighborCached(player, target, currentTick)) {
      this.mg.addExecution(new AttackExecution(troops, player, target.id()));
      return;
    }

    // Otherwise, try boat attack against the bot
    const playerShore = this.getPlayerShoreCached(player, currentTick);
    const targetShore = this.getTargetShoreCached(target, currentTick);

    const closest = closestTwoTiles(this.mg, playerShore, targetShore);
    if (closest !== null) {
      this.mg.addExecution(
        new TransportShipExecution(
          player,
          target.id(),
          closest.y,
          troops,
          null,
        ),
      );
    }
  }
}
