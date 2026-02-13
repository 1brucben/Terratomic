import { Game, Player, PlayerID, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Cached ocean shore sample for a player.
 * Contains extremum tiles (min/max X/Y) plus a random sample.
 */
interface OceanShoreSample {
  extrema: TileRef[]; // Up to 4 tiles: minX, maxX, minY, maxY
  randomSample: TileRef[]; // Small random sample
  closestRandom: TileRef | null; // Best random tile from last calculation
  lastUpdate: number; // Tick when extrema were last refreshed
}

/**
 * Handles AI diplomacy decisions: war declarations, peace requests, etc.
 */
export class AIDiplomacyHandler {
  // 10 ticks/second * 5 seconds = 50 ticks between evaluations
  private static readonly WAR_SCORE_EVALUATION_INTERVAL = 50;
  // 30 seconds / 5 seconds per sample = 6 samples for moving average
  private static readonly WAR_SCORE_HISTORY_LENGTH = 6;
  // Invalidate shore sample cache every 100 ticks (10 seconds)
  private static readonly SHORE_SAMPLE_CACHE_TTL = 100;
  // Number of random shore tiles to sample (in addition to 4 extrema)
  private static readonly RANDOM_SHORE_SAMPLE_SIZE = 4;
  // Peace score evaluation interval (100 ticks = 10 seconds)
  private static readonly PEACE_SCORE_EVALUATION_INTERVAL = 100;

  // Static registry of all active handlers for cross-AI peace request evaluation
  private static readonly registry = new Map<PlayerID, AIDiplomacyHandler>();

  // Phase seed for spreading periodic actions across AIs
  private readonly phaseSeed: number;

  // Current war scores for each player (keyed by PlayerID)
  private _warScores: Map<PlayerID, number> = new Map();

  // Historical war scores for moving average (keyed by PlayerID -> circular buffer of scores)
  private _warScoreHistory: Map<PlayerID, number[]> = new Map();

  // Cache for shore distances between player pairs (keyed by "fromId:toId")
  private _shoreDistanceCache: Map<string, number | null> = new Map();

  // Cache for ocean shore samples per player (keyed by PlayerID)
  private _oceanShoreSampleCache: Map<PlayerID, OceanShoreSample> = new Map();

  // Ordered list of peace candidate PlayerIDs (sorted by peace score ascending)
  private _pendingPeaceCandidates: PlayerID[] = [];
  // Current index into the pending peace candidates list
  private _currentPeaceCandidateIndex = 0;
  // Whether peace was successfully made this evaluation cycle
  private _peaceCompletedThisCycle = false;

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
  ) {
    // Stagger periodic actions across AIs using random offset
    this.phaseSeed = random.nextInt(0, 0x7fffffff);
    // Register this handler for cross-AI peace request evaluation
    AIDiplomacyHandler.registry.set(this.playerId, this);
  }

  private periodicOffset(period: number): number {
    const p = Math.max(1, Math.floor(period));
    return this.phaseSeed % p;
  }

  private shouldRunPeriodic(ticks: number, period: number): boolean {
    const p = Math.max(1, Math.floor(period));
    return ticks % p === this.periodicOffset(p);
  }

  private getPlayer(): Player | null {
    if (!this.mg.hasPlayer(this.playerId)) {
      return null;
    }
    return this.mg.player(this.playerId);
  }

  /**
   * Determines if one player can reach another for military purposes.
   * Players are reachable if they share a border OR both border the ocean.
   */
  private isReachable(from: Player, to: Player): boolean {
    if (from.sharesBorderWith(to)) {
      return true;
    }
    // Check ocean reachability: both must border ocean (uses cached values)
    return from.bordersOcean() && to.bordersOcean();
  }

  /**
   * Gets the closest manhattan distance between ocean shore tiles of two players.
   * Returns null if either player doesn't border the ocean.
   * Uses extremum tiles + random sampling for efficiency.
   */
  private closestOceanShoreDistance(
    from: Player,
    to: Player,
    currentTick: number,
  ): number | null {
    // Check cache first
    const cacheKey = `${from.id()}:${to.id()}`;
    if (this._shoreDistanceCache.has(cacheKey)) {
      return this._shoreDistanceCache.get(cacheKey)!;
    }

    // Fast path: check if either doesn't border ocean
    if (!from.bordersOcean() || !to.bordersOcean()) {
      this._shoreDistanceCache.set(cacheKey, null);
      return null;
    }

    // Get shore samples for both players
    const fromSample = this.getOceanShoreSample(from, currentTick);
    const toSample = this.getOceanShoreSample(to, currentTick);

    if (fromSample === null || toSample === null) {
      this._shoreDistanceCache.set(cacheKey, null);
      return null;
    }

    // Combine extrema + closestRandom + randomSample for each player
    const fromTiles = this.getSampleTiles(fromSample);
    const toTiles = this.getSampleTiles(toSample);

    if (fromTiles.length === 0 || toTiles.length === 0) {
      this._shoreDistanceCache.set(cacheKey, null);
      return null;
    }

    // Find minimum distance and track closest random tiles
    let minDist = Infinity;
    let closestFromRandom: TileRef | null = null;
    let closestToRandom: TileRef | null = null;

    for (const fromTile of fromTiles) {
      const isFromRandom = fromSample.randomSample.includes(fromTile);
      for (const toTile of toTiles) {
        const dist = this.mg.manhattanDist(fromTile, toTile);
        if (dist < minDist) {
          minDist = dist;
          if (isFromRandom) closestFromRandom = fromTile;
          if (toSample.randomSample.includes(toTile)) closestToRandom = toTile;
        }
      }
    }

    // Update closestRandom for future iterations
    if (closestFromRandom !== null) {
      fromSample.closestRandom = closestFromRandom;
    }
    if (closestToRandom !== null) {
      toSample.closestRandom = closestToRandom;
    }

    this._shoreDistanceCache.set(cacheKey, minDist);
    return minDist;
  }

  /**
   * Gets combined sample tiles: extrema + closestRandom (if any) + randomSample.
   */
  private getSampleTiles(sample: OceanShoreSample): TileRef[] {
    const tiles = [...sample.extrema];
    if (sample.closestRandom !== null) {
      tiles.push(sample.closestRandom);
    }
    tiles.push(...sample.randomSample);
    return tiles;
  }

  /**
   * Gets or creates an ocean shore sample for a player.
   * Refreshes extrema if TTL expired, keeps closestRandom, replaces random sample.
   */
  private getOceanShoreSample(
    player: Player,
    currentTick: number,
  ): OceanShoreSample | null {
    const cached = this._oceanShoreSampleCache.get(player.id());
    const needsRefresh =
      !cached ||
      currentTick - cached.lastUpdate >
        AIDiplomacyHandler.SHORE_SAMPLE_CACHE_TTL;

    if (!needsRefresh && cached) {
      return cached;
    }

    // Use cached ocean shore tiles from Player
    const oceanShores = player.oceanShoreTiles();
    if (oceanShores.length === 0) {
      this._oceanShoreSampleCache.delete(player.id());
      return null;
    }

    // Use cached extrema from Player
    const extrema = [...player.oceanShoreExtrema()];

    // Create set of extrema tiles to exclude from random sampling
    const extremaSet = new Set(extrema);

    // Get random sample (excluding extrema and closestRandom)
    const closestRandom = cached?.closestRandom ?? null;
    const availableForSampling = oceanShores.filter(
      (t) => !extremaSet.has(t) && t !== closestRandom,
    );

    const randomSample = this.sampleTiles(
      availableForSampling,
      AIDiplomacyHandler.RANDOM_SHORE_SAMPLE_SIZE,
    );

    const sample: OceanShoreSample = {
      extrema,
      randomSample,
      closestRandom,
      lastUpdate: currentTick,
    };

    this._oceanShoreSampleCache.set(player.id(), sample);
    return sample;
  }

  /**
   * Randomly samples n tiles from the array.
   */
  private sampleTiles(tiles: readonly TileRef[], n: number): TileRef[] {
    if (tiles.length <= n) {
      return [...tiles];
    }
    const result: TileRef[] = [];
    const indices = new Set<number>();
    while (result.length < n) {
      const idx = this.random.nextInt(0, tiles.length);
      if (!indices.has(idx)) {
        indices.add(idx);
        result.push(tiles[idx]);
      }
    }
    return result;
  }

  /**
   * Main tick function for diplomacy handling.
   */
  tickDiplomacy(ticks: number): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    // Periodically evaluate war scores
    if (
      this.shouldRunPeriodic(
        ticks,
        AIDiplomacyHandler.WAR_SCORE_EVALUATION_INTERVAL,
      )
    ) {
      this.evaluateWarScores(player, ticks);
      this.updateWarScoreHistory();
      this.maybeDeclarWars(player);
    }

    // Periodically evaluate peace scores and rebuild candidate list
    if (
      this.shouldRunPeriodic(
        ticks,
        AIDiplomacyHandler.PEACE_SCORE_EVALUATION_INTERVAL,
      )
    ) {
      this.evaluatePeaceScores(player, ticks);
    }

    // Try peace negotiation each tick (advances through candidate list)
    this.tryPeaceNegotiation(player, ticks);
  }

  /**
   * Evaluates war scores for all other human and AI players.
   */
  private evaluateWarScores(player: Player, ticks: number): void {
    this._warScores.clear();
    // Clear distance cache so new samples can affect results
    this._shoreDistanceCache.clear();

    for (const other of this.mg.players()) {
      // Skip self
      if (other.id() === player.id()) {
        continue;
      }

      // Only consider Human and AI players (not Bots)
      if (other.type() !== PlayerType.Human && other.type() !== PlayerType.AI) {
        continue;
      }

      // Skip dead players
      if (!other.isAlive()) {
        continue;
      }

      // Skip players we're already at war with
      if (player.isAtWarWith(other)) {
        continue;
      }

      // Skip allies and team members
      if (player.isFriendly(other)) {
        continue;
      }

      const score = this.calculateWarScore(player, other, ticks);
      this._warScores.set(other.id(), score);
    }
  }

  /**
   * Calculates the war score against a specific player.
   * Higher score = more likely to declare war.
   * Returns a linear combination of weighted factors.
   */
  private calculateWarScore(
    player: Player,
    other: Player,
    ticks: number,
  ): number {
    // No point declaring war on someone we can't reach
    if (!this.isReachable(player, other)) {
      return 0;
    }

    let score = 0;

    // Factor 1: Shared border length ratio
    // sharedBorderLength / ownTotalBorderLength
    const sharedBorderWeight = this.params.warScoreSharedBorderWeight ?? 0;
    if (sharedBorderWeight !== 0) {
      const ownTotalBorderLength = player.borderTiles().size;
      if (ownTotalBorderLength > 0) {
        const sharedBorderLength = player.sharedBorderLength(other);
        const borderRatio = sharedBorderLength / ownTotalBorderLength;
        score += sharedBorderWeight * borderRatio;
      }
    }

    // Factor 2: Military strength ratio
    // effectiveOwnStrength / totalEnemyStrength
    // effectiveOwnStrength = own + allies against target (scaled by target's share of their wars)
    // totalEnemyStrength = target + sum of current enemies (weighted by border status)
    const militaryStrengthWeight =
      this.params.warScoreMilitaryStrengthWeight ?? 0;
    if (militaryStrengthWeight !== 0) {
      const nonReachableWeight =
        this.params.warScoreNonReachableEnemyWeight ?? 0.2;
      let effectiveOwnStrength = player.militaryStrength();

      // Add military strength of others already at war with target, scaled by
      // how much of their attention is on the target
      for (const ally of this.mg.players()) {
        if (
          ally.id() !== player.id() &&
          ally.id() !== other.id() &&
          ally.isAlive() &&
          ally.type() !== PlayerType.Bot &&
          ally.isAtWarWith(other)
        ) {
          // Calculate total military strength of all players at war with this ally
          // weighted by whether they can reach the ally
          let totalEnemyStrengthOfAlly = 0;
          for (const allyEnemy of this.mg.players()) {
            if (
              allyEnemy.id() !== ally.id() &&
              allyEnemy.isAlive() &&
              allyEnemy.type() !== PlayerType.Bot &&
              ally.isAtWarWith(allyEnemy)
            ) {
              const enemyStrength = allyEnemy.militaryStrength();
              if (this.isReachable(allyEnemy, ally)) {
                totalEnemyStrengthOfAlly += enemyStrength;
              } else {
                totalEnemyStrengthOfAlly += enemyStrength * nonReachableWeight;
              }
            }
          }

          // Scale ally's contribution by target's share of their total enemies
          // Also scale by whether the ally can reach the target
          if (totalEnemyStrengthOfAlly > 0) {
            let targetStrengthForAlly = other.militaryStrength();
            if (!this.isReachable(ally, other)) {
              targetStrengthForAlly *= nonReachableWeight;
            }
            const targetShare =
              targetStrengthForAlly / totalEnemyStrengthOfAlly;
            effectiveOwnStrength += ally.militaryStrength() * targetShare;
          }
        }
      }

      let totalEnemyStrength = other.militaryStrength();

      // Add military strength of all players we're already at war with
      for (const enemy of this.mg.players()) {
        if (
          enemy.id() !== player.id() &&
          enemy.id() !== other.id() &&
          enemy.isAlive() &&
          enemy.type() !== PlayerType.Bot &&
          player.isAtWarWith(enemy)
        ) {
          const enemyStrength = enemy.militaryStrength();
          if (this.isReachable(enemy, player)) {
            // Reachable enemy: full weight
            totalEnemyStrength += enemyStrength;
          } else {
            // Non-reachable enemy: reduced weight (harder for them to attack us)
            totalEnemyStrength += enemyStrength * nonReachableWeight;
          }
        }
      }

      if (totalEnemyStrength > 0) {
        const strengthRatio = Math.min(
          effectiveOwnStrength / totalEnemyStrength,
          4,
        );
        score += militaryStrengthWeight * strengthRatio;
      }
    }

    // Factor 3: Ally penalty (negative contribution)
    const allyPenalty = this.params.warScoreAllyPenalty ?? 0;
    if (allyPenalty !== 0 && player.isAlliedWith(other)) {
      score -= allyPenalty;
    }

    // Factor 4: Distance penalty for non-bordering players
    // Penalizes distant ocean-only targets
    const distancePenaltyWeight =
      this.params.warScoreDistancePenaltyWeight ?? 0;
    if (distancePenaltyWeight !== 0 && !player.sharesBorderWith(other)) {
      const shoreDist = this.closestOceanShoreDistance(player, other, ticks);
      if (shoreDist !== null && shoreDist > 0) {
        // Normalize by geometric mean of map dimensions
        const mapWidth = this.mg.width();
        const mapHeight = this.mg.height();
        // Squared penalty
        const geoMean = Math.sqrt(mapWidth * mapHeight);
        const normalizedDist = shoreDist / geoMean;
        const penalty = normalizedDist * normalizedDist;
        score -= distancePenaltyWeight * penalty;
      }
    }

    // Factor 5: Dominance bonus – incentivise attacking the strongest player
    // Only fires when the target has the highest military strength in the game.
    const dominanceWeight = this.params.warScoreDominanceWeight ?? 0;
    if (dominanceWeight !== 0) {
      let totalGameStrength = 0;
      let highestStrength = 0;
      let secondHighestStrength = 0;

      for (const p of this.mg.players()) {
        if (!p.isAlive() || p.type() === PlayerType.Bot) continue;
        const s = p.militaryStrength();
        totalGameStrength += s;
        if (s > highestStrength) {
          secondHighestStrength = highestStrength;
          highestStrength = s;
        } else if (s > secondHighestStrength) {
          secondHighestStrength = s;
        }
      }

      const targetStrength = other.militaryStrength();
      if (
        totalGameStrength > 0 &&
        targetStrength >= highestStrength &&
        targetStrength > 0
      ) {
        const targetShare = targetStrength / totalGameStrength;
        const denominator = 0.8 - targetShare;
        // Only apply when target share is below 80% (denominator > 0)
        if (denominator > 0 && secondHighestStrength > 0) {
          const gapPercent =
            (targetStrength - secondHighestStrength) / secondHighestStrength;
          score += dominanceWeight * (gapPercent / denominator);
        }
      }
    }

    return score;
  }

  /**
   * Updates the war score history for moving average calculation.
   * Adds current scores to history and removes old entries.
   */
  private updateWarScoreHistory(): void {
    // Add current scores to history
    for (const [otherId, score] of this._warScores) {
      let history = this._warScoreHistory.get(otherId);
      if (!history) {
        history = [];
        this._warScoreHistory.set(otherId, history);
      }
      history.push(score);
      // Keep only the last N samples
      if (history.length > AIDiplomacyHandler.WAR_SCORE_HISTORY_LENGTH) {
        history.shift();
      }
    }

    // Clean up history for players no longer in war scores (e.g., died, allied, at war)
    for (const otherId of this._warScoreHistory.keys()) {
      if (!this._warScores.has(otherId)) {
        this._warScoreHistory.delete(otherId);
      }
    }
  }

  /**
   * Calculates the moving average war score for a player.
   */
  private getMovingAverageWarScore(otherId: PlayerID): number {
    const history = this._warScoreHistory.get(otherId);
    if (!history || history.length === 0) {
      return 0;
    }
    const sum = history.reduce((acc, score) => acc + score, 0);
    return sum / history.length;
  }

  /**
   * Declares war on players whose moving average war score exceeds the threshold.
   */
  private maybeDeclarWars(player: Player): void {
    const threshold = this.params.warDeclarationThreshold ?? 1.0;

    for (const [otherId] of this._warScores) {
      const avgScore = this.getMovingAverageWarScore(otherId);
      if (avgScore > threshold) {
        const other = this.mg.player(otherId);
        if (other && other.isAlive() && !player.isAtWarWith(other)) {
          // Declare war (mutual)
          player.setWarWith(other);
          other.setWarWith(player);
          // Clear history after declaring war
          this._warScoreHistory.delete(otherId);
        }
      }
    }
  }

  /**
   * Gets the current war score against a specific player.
   * Returns 0 if no score has been calculated.
   */
  getWarScore(otherId: PlayerID): number {
    return this._warScores.get(otherId) ?? 0;
  }

  /**
   * Gets all current war scores.
   */
  getAllWarScores(): Map<PlayerID, number> {
    return new Map(this._warScores);
  }

  // ---------------------------------------------------------------------------
  // Peace handling
  // ---------------------------------------------------------------------------

  /**
   * Returns the peace threshold for this AI.
   * Peace threshold = warDeclarationThreshold - peaceThresholdGap.
   * A war score below this value means the AI is willing to make peace.
   */
  private get peaceThreshold(): number {
    const warThreshold = this.params.warDeclarationThreshold ?? 1.0;
    const gap = this.params.peaceThresholdGap ?? 30;
    return warThreshold - gap;
  }

  /**
   * Evaluates peace scores for all players we are currently at war with.
   * Builds a sorted candidate list of enemies whose peace score is below the
   * peace threshold. Resets the negotiation state for this cycle.
   */
  private evaluatePeaceScores(player: Player, ticks: number): void {
    // Clear distance cache so fresh samples are used
    this._shoreDistanceCache.clear();

    const peaceScores: { id: PlayerID; score: number }[] = [];

    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (other.type() === PlayerType.Bot) continue;
      if (!other.isAlive()) continue;
      if (!player.isAtWarWith(other)) continue;

      // Peace score is calculated identically to war score, treating the
      // target as if we are NOT currently at war with them.
      // calculateWarScore already does this: it counts the target as the
      // primary enemy and adds OTHER current enemies separately (excluding
      // the target via the enemy.id() !== other.id() check).
      const score = this.calculateWarScore(player, other, ticks);

      if (score < this.peaceThreshold) {
        peaceScores.push({ id: other.id(), score });
      }
    }

    // Sort ascending: lowest score = most desirable peace partner
    peaceScores.sort((a, b) => a.score - b.score);

    this._pendingPeaceCandidates = peaceScores.map((e) => e.id);
    this._currentPeaceCandidateIndex = 0;
    this._peaceCompletedThisCycle = false;
  }

  /**
   * Attempts peace negotiation with the current candidate. Called each tick.
   * For AI targets: pre-checks acceptance, then creates the request (auto-accepted).
   * For human targets: creates a pending request (human will reply via UI).
   * If declined or cannot send, advances to the next candidate on the next tick.
   */
  private tryPeaceNegotiation(player: Player, ticks: number): void {
    // Already made peace this cycle, or no candidates left
    if (this._peaceCompletedThisCycle) return;
    if (this._currentPeaceCandidateIndex >= this._pendingPeaceCandidates.length)
      return;

    const candidateId =
      this._pendingPeaceCandidates[this._currentPeaceCandidateIndex];

    // Validate candidate is still a valid target
    if (!this.mg.hasPlayer(candidateId)) {
      this._currentPeaceCandidateIndex++;
      return;
    }

    const candidate = this.mg.player(candidateId);
    if (!candidate.isAlive() || !player.isAtWarWith(candidate)) {
      this._currentPeaceCandidateIndex++;
      return;
    }

    // Can't send if there's already a pending request or cooldown
    if (!player.canSendPeaceRequest(candidate)) {
      this._currentPeaceCandidateIndex++;
      return;
    }

    // For AI targets: pre-check if they would accept before creating request
    if (candidate.type() === PlayerType.AI) {
      const otherHandler = AIDiplomacyHandler.registry.get(candidateId);
      if (
        otherHandler &&
        !otherHandler.evaluateIncomingPeaceRequest(player, ticks)
      ) {
        // Declined – advance to next candidate on next tick
        this._currentPeaceCandidateIndex++;
        return;
      }
    }

    // Create the peace request (for humans it stays pending; for AI it will be auto-accepted by handleIncomingPeaceRequests)
    player.createPeaceRequest(candidate);
    this._peaceCompletedThisCycle = true;

    // Clear war score history so fresh evaluation starts if relations worsen again
    this._warScoreHistory.delete(candidateId);
  }

  /**
   * Handles incoming peace requests for this AI player.
   * Evaluates each request and accepts/rejects based on peace score threshold.
   * Called each tick by the AI execution loop.
   */
  handleIncomingPeaceRequests(ticks: number): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) return;

    for (const request of player.incomingPeaceRequests()) {
      const sender = request.requestor();
      if (this.evaluateIncomingPeaceRequest(sender, ticks)) {
        request.accept();
      } else {
        request.reject();
      }
    }
  }

  /**
   * Evaluates whether this AI should accept an incoming peace request
   * from the given player. Returns true if the peace score for the sender
   * is below this AI's peace threshold.
   */
  evaluateIncomingPeaceRequest(sender: Player, ticks: number): boolean {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) return false;
    if (!player.isAtWarWith(sender)) return false;

    // Calculate the war score for the sender as if not at war with them
    const score = this.calculateWarScore(player, sender, ticks);
    return score < this.peaceThreshold;
  }
}
