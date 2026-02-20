import { ConstructionExecution } from "../execution/ConstructionExecution";
import { UpgradeStructureExecution } from "../execution/UpgradeStructureExecution";
import { computeUpgradeStepCost } from "../game/Costs";
import {
  Game,
  isStructureType,
  Player,
  PlayerID,
  PlayerType,
  Unit,
  UnitType,
  UpgradeType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  isStackableStructure,
  maxStackCount,
  playerMaxStructureTechLevel,
} from "../game/Upgradeables";
import { PseudoRandom } from "../PseudoRandom";
import { tradeIncomeModifiers } from "../tech/TechEffects";
import { AIBehaviorParams } from "./AIBehaviorParams";
import { AINukeEvaluator } from "./AINukeEvaluator";

/**
 * Handles structure construction for AI players.
 * Builds cities, factories, and ports based on density parameters.
 */
export class AIConstructionHandler {
  private target: UnitType | null = null;

  // Cached tile array to avoid allocation every tick
  private _cachedTiles: TileRef[] | null = null;
  private _cachedTilesLastRebuildTick: number = -Infinity;

  // Whether construction is paused (e.g. during a nuke sequence)
  private _paused: boolean = false;

  // Structure types blocked from consideration until another structure is built/upgraded
  private _blockedStructures: Set<UnitType> = new Set();

  private static readonly PORT_SCORE_MULTIPLIER = 5e4;
  private static readonly HOSPITAL_BASE_SCORE = 5;
  private static readonly ACADEMY_BASE_SCORE = 7;
  private static readonly RESEARCH_LAB_BASE_SCORE = 4e3;
  private static readonly AIRFIELD_SCORE_MULTIPLIER = 5e3;
  private static readonly SAM_BASE_SCORE = 2e-1;
  private static readonly DEFENSE_POST_BASE_SCORE = 7e4;
  private static readonly MIN_TILE_EVALUATIONS_BEFORE_BUILD = 30;
  private static readonly TILE_EVALUATION_INTERVAL = 1;
  private static readonly TILE_CACHE_REBUILD_INTERVAL = 200; // Rebuild tile cache every ~10s (200 ticks at 20 tps)
  private static readonly UPGRADE_SCORE_DIVISOR = 0.8;
  private static readonly PORT_STATS_CACHE_INTERVAL = 50;

  // Cached global port statistics (refreshed every PORT_STATS_CACHE_INTERVAL ticks)
  private _cachedGlobalPortCount = 0;
  private _cachedGlobalShipsUnderConstruction = 0;
  private _cachedPortStatsTick = -Infinity;

  // Lazy-computed map dimension (√(width×height), never changes)
  private _cachedMapDim = 0;

  // Lazy-computed zone weights (derived from params, never change)
  private _cachedZoneWeights: number[] | null = null;

  // Cached airfield enemy structure count (refreshed periodically)
  private _cachedAirfieldEnemyStructures = 0;
  private _cachedAirfieldTick = -Infinity;
  private static readonly AIRFIELD_STATS_CACHE_INTERVAL = 50;

  // Cached structure base costs per type (refreshed once per scoring cycle)
  private _cachedStructureCosts: Map<UnitType, number> = new Map();
  private _cachedCostsTick = -Infinity;

  // scoreTarget cache for external callers (bestConstructionScore, constructionScoreBreakdown)
  private _scoreTargetCache: Map<UnitType, number> = new Map();
  private _scoreTargetCacheDirty = true;

  // Tile evaluation state (ports, defense posts, SAMs, others)
  private _portTileScore: number = 0;
  private _portTile: TileRef | null = null;
  private _portEvalCount: number = 0;
  private _defensePostTileScore: number = 0;
  private _defensePostTile: TileRef | null = null;
  private _defensePostEvalCount: number = 0;
  private _samTileScore: number = 0;
  private _samTile: TileRef | null = null;
  private _samEvalCount: number = 0;
  private _otherTileScore: number = 0;
  private _otherTile: TileRef | null = null;
  private _otherEvalCount: number = 0;

  // Upgrade evaluation state for each stackable structure type
  // Maps UnitType -> { score: number, unit: Unit | null }
  private _upgradeScores: Map<UnitType, { score: number; unit: Unit | null }> =
    new Map();

  // Set by scoreTarget: whether upgrade composite (baseScore*tileScore) beats new-build composite.
  private _upgradePreferred: Map<UnitType, boolean> = new Map();

  // Tracks the last tick each structure (by ID) was evaluated for upgrade.
  // Structures not in this map have never been evaluated and are prioritised.
  private _upgradeLastEvalTick: Map<number, number> = new Map();

  // Tracks the tick of the last successful build or upgrade for each structure type.
  // Used to require all upgrade candidates of that type to be re-evaluated before the next action.
  private _lastBuildOrUpgradeTick: Map<UnitType, number> = new Map();

  private static readonly ALL_STRUCTURE_TYPES: UnitType[] = Object.values(
    UnitType,
  ).filter((t) => isStructureType(t));

  private static readonly NON_DEFENSE_STRUCTURE_TYPES: UnitType[] =
    Object.values(UnitType).filter(
      (t) => isStructureType(t) && t !== UnitType.DefensePost,
    );

  // Structure types to consider for distance checks (excludes defense posts and SAMs)
  private static readonly DISTANCE_CHECK_STRUCTURE_TYPES: UnitType[] =
    Object.values(UnitType).filter(
      (t) =>
        isStructureType(t) &&
        t !== UnitType.DefensePost &&
        t !== UnitType.SAMLauncher,
    );

  // Types excluded from distance checks — used to skip Construction units building these
  private static readonly DISTANCE_CHECK_EXCLUDED_CONSTRUCTION_TYPES: Set<UnitType> =
    new Set([UnitType.DefensePost, UnitType.SAMLauncher]);

  // Tiered zone boundaries for structure proximity penalty (squared for fast comparison)
  // Diameters: atom inner 2×12=24, atom outer 2×30=60, hydro inner 2×80=160, hydro outer 2×100=200
  private static readonly ZONE_BOUNDARIES = [24, 60, 160, 200] as const;
  private static readonly ZONE_BOUNDARIES_SQ = (
    AIConstructionHandler.ZONE_BOUNDARIES as readonly number[]
  ).map((d) => d * d);
  private static readonly ZONE_SEARCH_RADIUS =
    AIConstructionHandler.ZONE_BOUNDARIES[3]; // outermost zone

  // Phase seed for spreading periodic actions across AIs
  private readonly phaseSeed: number;

  /** Optional callback that returns the current naval unit score (max of warship, submarine). */
  private _navalScoreProvider: (() => number) | null = null;

  /** Internal multiplier applied to nuke scores in shouldDeferToNukes. */
  private static readonly NUKE_SCORE_CONSTRUCTION_INTERNAL_MULTIPLIER = 1;

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private random: PseudoRandom,
    private params: AIBehaviorParams,
    private nukeEvaluator: AINukeEvaluator | null = null,
  ) {
    // Stagger periodic actions across AIs using random offset
    this.phaseSeed = random.nextInt(0, 0x7fffffff);
  }

  /**
   * Set a callback that provides the current naval unit score
   * (max of warship and submarine scores from AIUnitHandler).
   * Used by scorePort to boost port priority when the AI has no ports
   * but wants to build naval units.
   */
  setNavalScoreProvider(provider: () => number): void {
    this._navalScoreProvider = provider;
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

  /** Lazy getter for √(width×height), computed once. */
  private getMapDim(): number {
    if (this._cachedMapDim === 0) {
      this._cachedMapDim = Math.sqrt(this.mg.width() * this.mg.height());
    }
    return this._cachedMapDim;
  }

  /** Lazy getter for tiered zone weights, computed once from params. */
  private getZoneWeights(): number[] {
    if (this._cachedZoneWeights === null) {
      const basePenalty = this.params.tileNearStructurePenalty ?? 0.3;
      const mul2 = this.params.nearStructureZone2Multiplier ?? 0.5;
      const mul3 = this.params.nearStructureZone3Multiplier ?? 0.5;
      const mul4 = this.params.nearStructureZone4Multiplier ?? 0.5;
      this._cachedZoneWeights = [
        basePenalty,
        basePenalty * mul2,
        basePenalty * mul2 * mul3,
        basePenalty * mul2 * mul3 * mul4,
      ];
    }
    return this._cachedZoneWeights;
  }

  /**
   * Returns the cached base cost (as number) for a unit type, refreshing
   * once per tick to avoid repeated BigInt→Number conversions.
   */
  private getCachedStructureCost(player: Player, unitType: UnitType): number {
    const tick = this.mg.ticks();
    if (tick !== this._cachedCostsTick) {
      this._cachedStructureCosts.clear();
      this._cachedCostsTick = tick;
    }
    let cost = this._cachedStructureCosts.get(unitType);
    if (cost === undefined) {
      cost = Number(this.mg.unitInfo(unitType).cost(player));
      this._cachedStructureCosts.set(unitType, cost);
    }
    return cost;
  }

  /**
   * Build the SAM + under-construction-SAM list and range data for a player.
   * Call once per tile evaluation cycle and pass the result to tile score functions.
   * Always returns range data (needed to evaluate coverage of a potential new SAM)
   * even when the player owns no SAMs yet.
   */
  private buildSAMData(player: Player): { units: Unit[]; rangeSq: number } {
    const sams = player.units(UnitType.SAMLauncher).filter((u) => u.isActive());
    for (const u of player.units(UnitType.Construction)) {
      if (u.isActive() && u.constructionType() === UnitType.SAMLauncher) {
        sams.push(u);
      }
    }
    const techLevel = playerMaxStructureTechLevel(player, UnitType.SAMLauncher);
    const samRange = this.getEffectiveSAMRange(techLevel);
    return { units: sams, rangeSq: samRange * samRange };
  }

  tickConstruction(
    ticks: number,
    shouldRecalculate: boolean,
    allowSpending: boolean = true,
  ): void {
    // Invalidate scoreTarget cache every tick since base scores depend on
    // live game state (income, unit counts, trade demand, etc.)
    this._scoreTargetCacheDirty = true;

    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    const numTiles = player.numTilesOwned();
    if (numTiles === 0) {
      return;
    }

    // Periodically evaluate a random tile for structures (spread across AIs)
    if (
      this.shouldRunPeriodic(
        ticks,
        AIConstructionHandler.TILE_EVALUATION_INTERVAL,
      )
    ) {
      this.tickTileEvaluation(player, ticks);
    }

    // Periodically re-score and potentially retarget.
    // Only switches if there's a strictly better target than the current.
    if (shouldRecalculate) {
      this.recalculateTarget(player);
    }

    if (this.target === null) {
      this.target = this.pickTarget(null, player);
      return;
    }

    // If spending is not allowed (e.g. nuke sequence active, or unit score is higher), skip
    if (!allowSpending) {
      return;
    }

    // If nuke score threshold is set, skip construction when nuke value is higher
    if (this.shouldDeferToNukes(player)) {
      return;
    }

    // Only attempt placement if we can afford the target structure
    if (!this.canAffordTarget(player, this.target)) {
      return;
    }

    // Require minimum tile evaluations before attempting construction
    const evalCount = this.getEvalCountForStructure(this.target);
    if (evalCount < AIConstructionHandler.MIN_TILE_EVALUATIONS_BEFORE_BUILD) {
      return;
    }

    // Check if upgrade is preferred over building new
    const { isUpgrade } = this.getEffectiveScoreAndMode(this.target);

    if (isUpgrade && isStackableStructure(this.target)) {
      // Upgrade path: stack an existing structure
      const result = this.tryStructureUpgrade(player, this.target);
      if (result === "success") {
        this._lastBuildOrUpgradeTick.set(this.target, ticks);
        this.clearBlockedStructures();
        this.target = null;
        return;
      } else if (result === "blocked") {
        // Permanent failure - clear upgrade state and try again
        this.clearUpgradeScoreForStructure(this.target);
        this.target = null;
        return;
      }
      // result === "retry" means temporary failure, just return and try again later
      return;
    }

    // Build new path: construct at the saved tile
    // Get the saved tile for this structure type
    const savedTile = this.getSavedTileForStructure(this.target);
    if (savedTile === null) {
      // No tile evaluated yet, wait for tile evaluation
      return;
    }

    // Re-validate the tile at build time to catch any changes since evaluation
    if (!this.validateTileForConstruction(player, savedTile, this.target)) {
      // Tile no longer valid - clear it and wait for fresh evaluation
      this.clearTileScoresForTile(
        savedTile,
        `validation failed for ${this.target}`,
      );
      this.target = null;
      return;
    }

    // Score was updated by validation — re-check if this target is still the best
    const previousTarget = this.target;
    this.recalculateTarget(player);
    if (this.target !== previousTarget) {
      // A different target now scores higher, switch to it instead of building
      return;
    }

    // Attempt to build at the saved tile
    const spawnTile = player.canBuild(this.target, savedTile);

    if (spawnTile !== false && this.canAffordTarget(player, this.target)) {
      this.mg.addExecution(
        new ConstructionExecution(player, this.target, spawnTile),
      );
      this._lastBuildOrUpgradeTick.set(this.target, ticks);
      this.clearBlockedStructures();
    } else {
      // Failed to place - block this structure until another is built
      this._blockedStructures.add(this.target);
    }

    // Clear the score and tile for this structure type, and any others sharing the same tile
    this.clearTileScoresForTile(
      savedTile,
      `build attempted for ${this.target} (success=${spawnTile !== false})`,
    );
    this.target = null;
  }

  /**
   * Attempts to upgrade (stack) an existing structure.
   * Returns "success" if upgrade was initiated,
   * "blocked" if there's a permanent failure (should clear upgrade state),
   * "retry" if there's a temporary failure (should try again later).
   */
  private tryStructureUpgrade(
    player: Player,
    unitType: UnitType,
  ): "success" | "blocked" | "retry" {
    const upgradeUnit = this.getUpgradeUnitForStructure(unitType);

    if (upgradeUnit === null) {
      return "blocked";
    }

    // Validate the unit is still valid for upgrade
    if (!upgradeUnit.isActive()) {
      return "blocked";
    }

    if (upgradeUnit.owner().id() !== player.id()) {
      return "blocked";
    }

    const currentStack = upgradeUnit.stackCount?.() ?? 1;
    const maxStack = maxStackCount(unitType);
    if (currentStack >= maxStack) {
      return "blocked";
    }

    // Check if we can afford the upgrade
    const baseCost = this.mg.unitInfo(unitType).cost(player);
    const multiplier = this.mg
      .config()
      .structureUpgradeCostMultiplier(unitType);
    const upgradeCost = computeUpgradeStepCost(baseCost, multiplier);
    if (player.gold() < upgradeCost) {
      return "retry"; // Can't afford yet, try again later
    }

    // Execute the upgrade
    this.mg.addExecution(new UpgradeStructureExecution(player, upgradeUnit));
    this.clearUpgradeScoreForStructure(unitType);
    return "success";
  }

  /**
   * Clears the upgrade score and unit for a given structure type.
   */
  private clearUpgradeScoreForStructure(unitType: UnitType): void {
    // Defense posts cannot be stacked
    if (unitType === UnitType.DefensePost) {
      return;
    }
    this._upgradeScores.delete(unitType);
    this._upgradePreferred.delete(unitType);
    this._scoreTargetCacheDirty = true;
  }

  /**
   * Gets the evaluation count for a structure type.
   * Returns MIN_TILE_EVALUATIONS_BEFORE_BUILD if:
   * - Tile eval count >= MIN_TILE_EVALUATIONS_BEFORE_BUILD, AND
   * - All stackable structures of this type have been evaluated (or none exist)
   * Otherwise returns a value less than MIN_TILE_EVALUATIONS_BEFORE_BUILD.
   */
  private getEvalCountForStructure(unitType: UnitType): number {
    // Get tile evaluation count
    let tileEvalCount: number;
    if (unitType === UnitType.Port) {
      tileEvalCount = this._portEvalCount;
    } else if (unitType === UnitType.DefensePost) {
      tileEvalCount = this._defensePostEvalCount;
    } else if (unitType === UnitType.SAMLauncher) {
      tileEvalCount = this._samEvalCount;
    } else {
      tileEvalCount = this._otherEvalCount;
    }

    // If tile eval count is below threshold, return it directly
    if (
      tileEvalCount < AIConstructionHandler.MIN_TILE_EVALUATIONS_BEFORE_BUILD
    ) {
      return tileEvalCount;
    }

    // Check if all stackable structures of this type have been evaluated
    if (isStackableStructure(unitType)) {
      const allEvaluated = this.allStructuresEvaluatedForType(unitType);
      if (!allEvaluated) {
        // Return a value below threshold to block construction until all evaluated
        return AIConstructionHandler.MIN_TILE_EVALUATIONS_BEFORE_BUILD - 1;
      }
    }

    // Both conditions met
    return tileEvalCount;
  }

  /**
   * Checks if all upgradeable structures of a given type have been evaluated
   * since the last build or upgrade of that type.
   * Returns true if there are no upgradeable structures or all have been evaluated.
   */
  private allStructuresEvaluatedForType(unitType: UnitType): boolean {
    const player = this.getPlayer();
    if (!player) return true;

    // Get all upgradeable structures of this type
    const upgradeableUnits = player.units(unitType).filter((u) => {
      if (!u.isActive()) return false;
      const currentStack = u.stackCount?.() ?? 1;
      const maxStack = maxStackCount(unitType);
      return currentStack < maxStack;
    });

    // If no upgradeable structures, consider all evaluated
    if (upgradeableUnits.length === 0) return true;

    // All candidates must have been evaluated after the last build/upgrade of this type
    const lastBuildTick =
      this._lastBuildOrUpgradeTick.get(unitType) ?? -Infinity;
    for (const unit of upgradeableUnits) {
      const lastEval = this._upgradeLastEvalTick.get(unit.id());
      if (lastEval === undefined || lastEval <= lastBuildTick) {
        return false;
      }
    }
    return true;
  }

  /**
   * Recalculates the saved tile scores for each category by re-scoring
   * the currently saved best tile against the current game state.
   * If a tile's score dropped to 0, it's cleared.
   */
  private refreshTileScores(player: Player): void {
    if (this._portTile !== null) {
      const newScore = this.calculatePortTileScore(player, this._portTile);
      if (newScore <= 0) {
        this._portTileScore = 0;
        this._portTile = null;
      } else {
        this._portTileScore = newScore;
      }
    }

    if (this._defensePostTile !== null) {
      const newScore = this.calculateDefensePostTileScore(
        player,
        this._defensePostTile,
      );
      if (newScore <= 0) {
        this._defensePostTileScore = 0;
        this._defensePostTile = null;
      } else {
        this._defensePostTileScore = newScore;
      }
    }

    if (this._samTile !== null) {
      const newScore = this.calculateSAMTileScore(player, this._samTile);
      if (newScore <= 0) {
        this._samTileScore = 0;
        this._samTile = null;
      } else {
        this._samTileScore = newScore;
      }
    }

    if (this._otherTile !== null) {
      const newScore = this.calculateOtherTileScore(player, this._otherTile);
      if (newScore <= 0) {
        this._otherTileScore = 0;
        this._otherTile = null;
      } else {
        this._otherTileScore = newScore;
      }
    }

    // Tile scores may have changed, invalidate scoreTarget cache
    this._scoreTargetCacheDirty = true;
  }

  private recalculateTarget(player: Player): void {
    // Refresh saved tile scores by recalculating against current game state
    this.refreshTileScores(player);

    const candidates = this.candidateTargets();
    if (candidates.length === 0) {
      this.target = null;
      return;
    }

    // If current target is no longer a candidate, drop it so we can repick.
    if (this.target !== null && !candidates.includes(this.target)) {
      this.target = null;
    }

    let bestScore = -Infinity;
    let best: UnitType[] = [];

    for (const t of candidates) {
      const s = this.scoreTarget(player, t);
      if (s > bestScore) {
        bestScore = s;
        best = [t];
      } else if (s === bestScore) {
        best.push(t);
      }
    }

    if (best.length === 0) {
      this.target = null;
      return;
    }

    if (this.target === null) {
      this.target = this.random.randElement(best);
      return;
    }

    const currentScore = this.scoreTarget(player, this.target);
    // Switch only if a new target has a strictly higher score, or if the current
    // target is somehow not in the best set.
    if (bestScore > currentScore || !best.includes(this.target)) {
      this.target = this.random.randElement(best);
    }
  }

  private candidateTargets(): UnitType[] {
    const candidates: UnitType[] = [];
    if (this.params.buildCities ?? true) candidates.push(UnitType.City);
    if (this.params.buildFactories ?? true) candidates.push(UnitType.Factory);
    if (this.params.buildPorts ?? true) candidates.push(UnitType.Port);
    if (this.params.buildHospitals ?? false) candidates.push(UnitType.Hospital);
    if (this.params.buildAcademies ?? false) candidates.push(UnitType.Academy);
    if (this.params.buildAirfields ?? false) candidates.push(UnitType.Airfield);
    if (this.params.buildResearchLabs ?? false)
      candidates.push(UnitType.ResearchLab);
    if (this.params.buildSAMLaunchers ?? false)
      candidates.push(UnitType.SAMLauncher);
    if (this.params.buildDefensePosts ?? false)
      candidates.push(UnitType.DefensePost);
    if (this.params.buildDoomsdayDevices ?? false)
      candidates.push(UnitType.DoomsdayDevice);
    // Exclude blocked structures until another structure is successfully built
    return candidates.filter((t) => !this._blockedStructures.has(t));
  }

  private scoreTarget(player: Player, unitType: UnitType): number {
    const weight = this.getStructureWeight(unitType);
    let baseScore = 0;

    if (unitType === UnitType.City) {
      baseScore = this.scoreCity(player);
    } else if (unitType === UnitType.Factory) {
      baseScore = this.scoreFactory(player);
    } else if (unitType === UnitType.Port) {
      baseScore = this.scorePort(player);
    } else if (unitType === UnitType.Hospital) {
      baseScore = this.scoreHospital(player);
    } else if (unitType === UnitType.Academy) {
      baseScore = this.scoreAcademy(player);
    } else if (unitType === UnitType.ResearchLab) {
      baseScore = this.scoreResearchLab(player);
    } else if (unitType === UnitType.Airfield) {
      baseScore = this.scoreAirfield(player);
    } else if (unitType === UnitType.SAMLauncher) {
      baseScore = this.scoreSAMLauncher(player);
    } else if (unitType === UnitType.DefensePost) {
      baseScore = this.scoreDefensePost(player);
    }

    // For other structures, base score remains 0 (uses weight only)
    const newBuildScore = baseScore * weight;

    // Get the upgrade score for this structure type (if stackable)
    const upgradeData = this._upgradeScores.get(unitType);
    const upgradeScore = upgradeData?.score ?? 0;

    // Recompute base score using upgrade cost for T (all stackable structures)
    let upgradeBaseScore = baseScore;
    if (upgradeScore > 0 && unitType !== UnitType.DefensePost) {
      const baseCost = this.mg.unitInfo(unitType).cost(player);
      const upgMultiplier = this.mg
        .config()
        .structureUpgradeCostMultiplier(unitType);
      const upgCost = computeUpgradeStepCost(baseCost, upgMultiplier);
      if (unitType === UnitType.City) {
        upgradeBaseScore = this.scoreCity(player, upgCost);
      } else if (unitType === UnitType.Factory) {
        upgradeBaseScore = this.scoreFactory(player, upgCost);
      } else if (unitType === UnitType.Port) {
        upgradeBaseScore = this.scorePort(player, upgCost);
      } else if (unitType === UnitType.Hospital) {
        upgradeBaseScore = this.scoreHospital(player, upgCost);
      } else if (unitType === UnitType.Academy) {
        upgradeBaseScore = this.scoreAcademy(player, upgCost);
      } else if (unitType === UnitType.ResearchLab) {
        upgradeBaseScore = this.scoreResearchLab(player, upgCost);
      } else if (unitType === UnitType.Airfield) {
        upgradeBaseScore = this.scoreAirfield(player, upgCost);
      } else if (unitType === UnitType.SAMLauncher) {
        upgradeBaseScore = this.scoreSAMLauncher(player, upgCost);
      }
    }
    const upgradeStructureScore = upgradeBaseScore * weight;

    // Multiply by the max of (newBuild * tileScore) vs (upgrade * upgradeScore)
    // Compute new-build and upgrade composites, record which wins.
    let newComposite: number;
    let upgComposite: number;

    if (unitType === UnitType.Port) {
      const effectivePortTileScore =
        this._portEvalCount <
          AIConstructionHandler.MIN_TILE_EVALUATIONS_BEFORE_BUILD &&
        this._portTileScore === 0
          ? 1
          : this._portTileScore;
      newComposite = newBuildScore * effectivePortTileScore;
      upgComposite = upgradeStructureScore * upgradeScore;

      // When the AI has no ports, the naval unit score acts as a floor
      // on the final composite so it isn't diluted by weight × tileScore.
      if (player.unitsOwned(UnitType.Port) === 0) {
        const navalScore = this._navalScoreProvider?.() ?? 0;
        newComposite = Math.max(newComposite, navalScore);
      }
    } else if (unitType === UnitType.DefensePost) {
      newComposite = newBuildScore * this._defensePostTileScore;
      upgComposite = 0; // Defense posts cannot be stacked
    } else if (unitType === UnitType.SAMLauncher) {
      newComposite = newBuildScore * this._samTileScore;
      upgComposite = upgradeStructureScore * upgradeScore;
    } else {
      newComposite = newBuildScore * this._otherTileScore;
      upgComposite = upgradeStructureScore * upgradeScore;
    }

    // Record which mode the composite comparison favors.
    // Use >= so that ties (equal tile scores) are broken by the cheaper
    // upgrade cost (higher base score due to smaller T).
    this._upgradePreferred.set(
      unitType,
      upgradeScore > 0 && upgComposite >= newComposite,
    );

    return Math.max(newComposite, upgComposite);
  }

  /**
   * Gets the base score for a structure type (without weight or tile multiplier).
   * Used for debugging/logging purposes.
   */
  private getBaseScoreForType(player: Player, unitType: UnitType): number {
    if (unitType === UnitType.City) {
      return this.scoreCity(player);
    } else if (unitType === UnitType.Factory) {
      return this.scoreFactory(player);
    } else if (unitType === UnitType.Port) {
      return this.scorePort(player);
    } else if (unitType === UnitType.Hospital) {
      return this.scoreHospital(player);
    } else if (unitType === UnitType.Academy) {
      return this.scoreAcademy(player);
    } else if (unitType === UnitType.ResearchLab) {
      return this.scoreResearchLab(player);
    } else if (unitType === UnitType.Airfield) {
      return this.scoreAirfield(player);
    } else if (unitType === UnitType.SAMLauncher) {
      return this.scoreSAMLauncher(player);
    } else if (unitType === UnitType.DefensePost) {
      return this.scoreDefensePost(player);
    }
    return 0;
  }

  /**
   * Gets the effective tile/upgrade score for a structure type, and whether upgrade is preferred.
   * Returns { score, isUpgrade } where isUpgrade is true if the upgrade score is higher.
   */
  private getEffectiveScoreAndMode(unitType: UnitType): {
    score: number;
    isUpgrade: boolean;
  } {
    // Defense posts cannot be stacked
    if (unitType === UnitType.DefensePost) {
      return { score: this._defensePostTileScore, isUpgrade: false };
    }

    const upgradeData = this._upgradeScores.get(unitType);
    const upgradeScore = upgradeData?.score ?? 0;

    let tileScore: number;
    if (unitType === UnitType.Port) {
      tileScore = this._portTileScore;
    } else if (unitType === UnitType.SAMLauncher) {
      tileScore = this._samTileScore;
    } else {
      tileScore = this._otherTileScore;
    }

    // Read the decision that scoreTarget already computed using the full
    // composite (baseScore × weight × tileScore) for both modes.
    const isUpgrade = this._upgradePreferred.get(unitType) ?? false;
    return { score: Math.max(tileScore, upgradeScore), isUpgrade };
  }

  /**
   * Gets the upgrade unit for a structure type, if upgrade is the preferred mode.
   */
  private getUpgradeUnitForStructure(unitType: UnitType): Unit | null {
    // Defense posts cannot be stacked
    if (unitType === UnitType.DefensePost) {
      return null;
    }
    const upgradeData = this._upgradeScores.get(unitType);
    return upgradeData?.unit ?? null;
  }

  /**
   * Computes the city base score as present value of perpetual income gain:
   * incomeGain/min / discountRate / (1 + discountRate)^T
   * where T = minutes to earn the city cost at current income.
   * @param costOverride - If provided, use this cost instead of base cost (e.g. upgrade cost).
   */
  private scoreCity(player: Player, costOverride?: bigint): number {
    const config = this.mg.config();
    const cost = costOverride ?? this.mg.unitInfo(UnitType.City).cost(player);
    if (cost <= 0n) {
      return 0;
    }

    // Get assumed pop percentage (default 70%)
    const assumedPopPercent = this.params.aiAssumedPopPercent ?? 0.7;
    const targetTroopRatio = player.targetTroopRatio();

    // Compute current max pop and projected max pop with +1 city
    const currentMaxPop = config.maxPopulation(player);
    const cityPopBonus = config.cityPopulationIncrease();
    // Adding one city increases effective units by 1 (at level 1)
    const projectedMaxPop = currentMaxPop + cityPopBonus;

    // Compute workers under assumed pop scenario
    // totalPop = maxPop * assumedPopPercent
    // troops = totalPop * targetTroopRatio
    // workers = totalPop - troops = totalPop * (1 - targetTroopRatio)
    const currentTotalPop = currentMaxPop * assumedPopPercent;
    const currentWorkers = currentTotalPop * (1 - targetTroopRatio);

    const projectedTotalPop = projectedMaxPop * assumedPopPercent;
    const projectedWorkers = projectedTotalPop * (1 - targetTroopRatio);

    // Compute factory factor (unchanged by city construction)
    const k = player.unitsOwned(UnitType.Factory);
    const factoryFactor = Math.pow(1 + k, 0.35);

    // Compute productivity and multiplier (unchanged)
    const productivity = player.productivity();
    const multiplier = config.gameConfig().goldMultiplier ?? 1;

    const currentGrossGold =
      0.11 *
      Math.pow(currentWorkers, 0.65) *
      productivity *
      factoryFactor *
      multiplier;
    const projectedGrossGold =
      0.11 *
      Math.pow(projectedWorkers, 0.65) *
      productivity *
      factoryFactor *
      multiplier;

    const incomeGain = projectedGrossGold - currentGrossGold;

    const costNum = Number(cost);
    if (costNum <= 0 || !Number.isFinite(incomeGain) || incomeGain <= 0) {
      return 0;
    }

    const TICKS_PER_MINUTE = 600;
    const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
    if (grossGoldPerMinute <= 0) {
      return 0;
    }

    // T = minutes to earn the cost of the city (or city stack upgrade)
    const T = costNum / grossGoldPerMinute;
    const discountRate = this.params.discountFactor ?? 0.1;
    const incomeGainPerMinute = incomeGain * TICKS_PER_MINUTE;

    // PV of perpetuity delayed by T minutes:
    // incomeGainPerMinute / discountRate / (1 + discountRate)^T
    return incomeGainPerMinute / discountRate / Math.pow(1 + discountRate, T);
  }

  /**
   * Computes the factory base score as present value of perpetual income gain:
   * incomeGain/min / discountRate / (1 + discountRate)^T
   * where T = minutes to earn the factory cost at current income.
   * @param costOverride - If provided, use this cost instead of base cost (e.g. upgrade cost).
   */
  private scoreFactory(player: Player, costOverride?: bigint): number {
    const config = this.mg.config();
    const cost =
      costOverride ?? this.mg.unitInfo(UnitType.Factory).cost(player);
    if (cost <= 0n) {
      return 0;
    }

    const assumedPopPercent = this.params.aiAssumedPopPercent ?? 0.7;
    const targetTroopRatio = player.targetTroopRatio();

    const currentMaxPop = config.maxPopulation(player);
    const currentTotalPop = currentMaxPop * assumedPopPercent;
    const workers = currentTotalPop * (1 - targetTroopRatio);

    // Factory factor changes with +1 factory
    const k = player.unitsOwned(UnitType.Factory);
    const currentFactoryFactor = Math.pow(1 + k, 0.35);
    const projectedFactoryFactor = Math.pow(1 + k + 1, 0.35);

    const productivity = player.productivity();
    const multiplier = config.gameConfig().goldMultiplier ?? 1;

    const base = 0.11 * Math.pow(workers, 0.65) * productivity * multiplier;
    const currentGrossGold = base * currentFactoryFactor;
    const projectedGrossGold = base * projectedFactoryFactor;

    const incomeGain = projectedGrossGold - currentGrossGold;

    const costNum = Number(cost);
    if (costNum <= 0 || !Number.isFinite(incomeGain) || incomeGain <= 0) {
      return 0;
    }

    const TICKS_PER_MINUTE = 600;
    const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
    if (grossGoldPerMinute <= 0) {
      return 0;
    }

    // T = minutes to earn the cost of the factory (or factory stack upgrade)
    const T = costNum / grossGoldPerMinute;
    const discountRate = this.params.discountFactor ?? 0.1;
    const incomeGainPerMinute = incomeGain * TICKS_PER_MINUTE;

    // PV of perpetuity delayed by T minutes:
    // incomeGainPerMinute / discountRate / (1 + discountRate)^T
    return incomeGainPerMinute / discountRate / Math.pow(1 + discountRate, T);
  }

  /**
   * Computes the port base score based on trade demand.
   */
  private scorePort(player: Player, costOverride?: bigint): number {
    const portCount = player.unitsOwned(UnitType.Port);

    // When the AI has 0 ports, score the first port as a discounted
    // present value of a share of total income:
    //   score = d / r / (1 + r)^(T + 1)
    // where d = incomeShare * grossGoldPerMinute, r = discount factor,
    // T = minutes to afford the port at current income.
    // The naval-score boost is applied later in scoreTarget (on the
    // final composite) so it isn't diluted by weight × tileScore.
    if (portCount === 0) {
      const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
      const r = this.params.discountFactor ?? 0.1;
      let base = 0;
      if (grossGoldPerMinute > 0) {
        const portCost = Number(
          costOverride ?? this.mg.unitInfo(UnitType.Port).cost(player),
        );
        const T = portCost / grossGoldPerMinute;
        const incomeShare = this.params.firstPortIncomeShare ?? 0.5;
        const d = incomeShare * grossGoldPerMinute;
        base = d / r / Math.pow(1 + r, T + 1);
      }
      return base;
    }

    // Get global trade demand queue length
    const queueLen = (this.mg as any).tradeDemandQueueLength?.() ?? 0;

    // Use player method for metrics calculation
    const metrics = player.tradeDemandMetrics(queueLen);

    // Get trade income multipliers
    const tradeMods = tradeIncomeModifiers(player);
    const tradeIncomeMul = tradeMods.incomeMul * tradeMods.tradeShipIncomeMul;

    // Calculate global ships under construction vs global ports multiplier
    // Uses cached values refreshed every PORT_STATS_CACHE_INTERVAL ticks
    const currentTick = this.mg.ticks();
    if (
      currentTick - this._cachedPortStatsTick >=
      AIConstructionHandler.PORT_STATS_CACHE_INTERVAL
    ) {
      this._cachedPortStatsTick = currentTick;
      const allPorts = this.mg.units(UnitType.Port).filter((p) => p.isActive());
      this._cachedGlobalPortCount = allPorts.reduce(
        (sum, port) => sum + (port.stackCount?.() ?? 1),
        0,
      );
      this._cachedGlobalShipsUnderConstruction = allPorts.reduce(
        (sum, port) => sum + (port as any).pendingTradeShipDueTicks().length,
        0,
      );
    }
    const globalPortCount = this._cachedGlobalPortCount;
    const globalShipsUnderConstruction =
      this._cachedGlobalShipsUnderConstruction;
    const constructionRatioMul =
      globalPortCount > 0
        ? 1 - globalShipsUnderConstruction / globalPortCount
        : 1;

    // Time-discount: (1+r)^T where T = minutes to fund the port
    const portCost = Number(
      costOverride ?? this.mg.unitInfo(UnitType.Port).cost(player),
    );
    const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
    const r = this.params.discountFactor ?? 0.1;
    let timeDiscount = 1;
    if (grossGoldPerMinute > 0 && portCost > 0) {
      const T = portCost / grossGoldPerMinute;
      timeDiscount = Math.pow(1 + r, T);
    }

    // Base score = multiplier * (1 + queueRatio) * (1 - availableRatio) * tradeIncomeMods * constructionRatioMul * productivity / (1+r)^T
    return (
      (AIConstructionHandler.PORT_SCORE_MULTIPLIER *
        (1 + metrics.queueRatio) *
        (1 - metrics.availableRatio) *
        tradeIncomeMul *
        Math.max(0, constructionRatioMul) *
        player.productivity()) /
      timeDiscount
    );
  }

  /**
   * Computes the hospital base score based on troop ratio and pop growth bonus.
   */
  private scoreHospital(player: Player, costOverride?: bigint): number {
    const config = this.mg.config();
    const assumedPopPercent = this.params.aiAssumedPopPercent ?? 0.7;
    const targetTroopRatio = player.targetTroopRatio();
    const maxPop = config.maxPopulation(player);

    // Calculate the bonus from constructing one additional hospital
    // Death multiplier formula: 0.6 + 0.4 * Math.pow(0.75, hospitals)
    const currentHospitals = player.unitsOwned(UnitType.Hospital);
    const currentDeathMul = 0.6 + 0.4 * Math.pow(0.75, currentHospitals);
    const projectedDeathMul = 0.6 + 0.4 * Math.pow(0.75, currentHospitals + 1);
    const hospitalBonus = currentDeathMul - projectedDeathMul;

    // Time-discount: (1+r)^T where T = minutes to fund the hospital
    const hospitalCost = Number(
      costOverride ?? this.mg.unitInfo(UnitType.Hospital).cost(player),
    );
    const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
    const discountRate = this.params.discountFactor ?? 0.1;
    let timeDiscount = 1;
    if (grossGoldPerMinute > 0 && hospitalCost > 0) {
      const T = hospitalCost / grossGoldPerMinute;
      timeDiscount = Math.pow(1 + discountRate, T);
    }

    return (
      (AIConstructionHandler.HOSPITAL_BASE_SCORE *
        maxPop *
        targetTroopRatio *
        assumedPopPercent *
        hospitalBonus) /
      timeDiscount
    );
  }

  /**
   * Computes the academy base score based on troop ratio and combat bonus.
   */
  private scoreAcademy(player: Player, costOverride?: bigint): number {
    const config = this.mg.config();
    const assumedPopPercent = this.params.aiAssumedPopPercent ?? 0.7;
    const targetTroopRatio = player.targetTroopRatio();
    const maxPop = config.maxPopulation(player);

    // Calculate the bonus from constructing one additional academy
    // Academy modifier formula: 1.2 - 0.2 * 0.5^(academies)
    // Higher modifier = more enemy casualties in combat
    const currentAcademies = player.unitsOwned(UnitType.Academy);
    const currentModifier = 1.2 - 0.2 * Math.pow(0.5, currentAcademies);
    const projectedModifier = 1.2 - 0.2 * Math.pow(0.5, currentAcademies + 1);
    const academyBonus = projectedModifier - currentModifier;

    // Time-discount: (1+r)^T where T = minutes to fund the academy
    const academyCost = Number(
      costOverride ?? this.mg.unitInfo(UnitType.Academy).cost(player),
    );
    const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
    const discountRate = this.params.discountFactor ?? 0.1;
    let timeDiscount = 1;
    if (grossGoldPerMinute > 0 && academyCost > 0) {
      const T = academyCost / grossGoldPerMinute;
      timeDiscount = Math.pow(1 + discountRate, T);
    }

    return (
      (AIConstructionHandler.ACADEMY_BASE_SCORE *
        maxPop *
        targetTroopRatio *
        assumedPopPercent *
        academyBonus) /
      timeDiscount
    );
  }

  /**
   * Computes the research lab base score based on research spending and lab bonus.
   */
  private scoreResearchLab(player: Player, costOverride?: bigint): number {
    const config = this.mg.config();

    // Calculate total effective research spending
    const grossGold = config.grossGoldAdditionRate(player);
    const investRate = player.researchInvestmentRate?.() ?? 0;
    const researchSpending = grossGold * investRate;

    if (researchSpending <= 0) {
      return 0;
    }

    // Calculate the bonus from constructing one additional research lab
    // Lab multiplier formula: 1 + (0.4 * (1 - 0.5^labs)) / 0.5
    // This is a geometric series that caps at 1.8 as labs -> infinity
    const currentLabs = player.unitsOwned(UnitType.ResearchLab);
    const currentBoostSum =
      currentLabs > 0 ? (0.4 * (1 - Math.pow(0.5, currentLabs))) / 0.5 : 0;
    const projectedBoostSum =
      (0.4 * (1 - Math.pow(0.5, currentLabs + 1))) / 0.5;
    const labBonus = projectedBoostSum - currentBoostSum;

    // Time-discount: (1+r)^T where T = minutes to fund the research lab
    const labCost = Number(
      costOverride ?? this.mg.unitInfo(UnitType.ResearchLab).cost(player),
    );
    const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
    const discountRate = this.params.discountFactor ?? 0.1;
    let timeDiscount = 1;
    if (grossGoldPerMinute > 0 && labCost > 0) {
      const T = labCost / grossGoldPerMinute;
      timeDiscount = Math.pow(1 + discountRate, T);
    }

    return (
      (AIConstructionHandler.RESEARCH_LAB_BASE_SCORE *
        researchSpending *
        labBonus) /
      timeDiscount
    );
  }

  /**
   * Computes the airfield base score based on enemy structures.
   * Score = multiplier * (total non-self structures / (airfields owned + 1))
   */
  private scoreAirfield(player: Player, costOverride?: bigint): number {
    // Use cached enemy structure count (refreshed every AIRFIELD_STATS_CACHE_INTERVAL ticks)
    const currentTick = this.mg.ticks();
    if (
      currentTick - this._cachedAirfieldTick >=
      AIConstructionHandler.AIRFIELD_STATS_CACHE_INTERVAL
    ) {
      this._cachedAirfieldTick = currentTick;
      let total = 0;
      for (const other of this.mg.players()) {
        if (other.id() === player.id()) continue;
        if (!other.isAlive()) continue;
        for (const structureType of AIConstructionHandler.NON_DEFENSE_STRUCTURE_TYPES) {
          total += other.unitsOwned(structureType);
        }
      }
      this._cachedAirfieldEnemyStructures = total;
    }
    const totalNonSelfStructures = this._cachedAirfieldEnemyStructures;

    const airfieldCount = player.unitsOwned(UnitType.Airfield);

    // Time-discount: (1+r)^T where T = minutes to fund the airfield
    const airfieldCost = Number(
      costOverride ?? this.mg.unitInfo(UnitType.Airfield).cost(player),
    );
    const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
    const discountRate = this.params.discountFactor ?? 0.1;
    let timeDiscount = 1;
    if (grossGoldPerMinute > 0 && airfieldCost > 0) {
      const T = airfieldCost / grossGoldPerMinute;
      timeDiscount = Math.pow(1 + discountRate, T);
    }

    return (
      (AIConstructionHandler.AIRFIELD_SCORE_MULTIPLIER *
        (totalNonSelfStructures / (airfieldCount + 1))) /
      timeDiscount
    );
  }

  /**
   * Computes the SAM launcher base score.
   * Uses SAM_BASE_SCORE as a fixed multiplier, similar to other structures.
   */
  private scoreSAMLauncher(player: Player, costOverride?: bigint): number {
    // Time-discount: (1+r)^T where T = minutes to fund the SAM launcher
    const samCost = Number(
      costOverride ?? this.mg.unitInfo(UnitType.SAMLauncher).cost(player),
    );
    const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
    const discountRate = this.params.discountFactor ?? 0.1;
    let timeDiscount = 1;
    if (grossGoldPerMinute > 0 && samCost > 0) {
      const T = samCost / grossGoldPerMinute;
      timeDiscount = Math.pow(1 + discountRate, T);
    }

    return AIConstructionHandler.SAM_BASE_SCORE / timeDiscount;
  }

  /**
   * Computes the defense post base score as baseScoreParam / ((1+r)^T * ownMilitaryStrength).
   * T = minutes to earn the defense post cost at current gross gold income.
   * r = discount rate (from AI profile discountFactor, default 0.1).
   */
  private scoreDefensePost(player: Player): number {
    const cost = this.mg.unitInfo(UnitType.DefensePost).cost(player);
    const costNum = Number(cost);
    if (costNum <= 0) return 0;

    const grossGoldPerMinute = player.estimatedGoldIncomePerMinute();
    if (grossGoldPerMinute <= 0) return 0;

    // T = minutes to earn the defense post cost
    const T = costNum / grossGoldPerMinute;
    const discountRate = this.params.discountFactor ?? 0.1;

    return (
      AIConstructionHandler.DEFENSE_POST_BASE_SCORE /
      Math.pow(1 + discountRate, T)
    );
  }

  /**
   * Clears all blocked structures after a successful build/upgrade.
   */
  private clearBlockedStructures(): void {
    this._blockedStructures.clear();
  }

  /**
   * Gets the saved tile for a given structure type.
   */
  private getSavedTileForStructure(unitType: UnitType): TileRef | null {
    if (unitType === UnitType.Port) {
      return this._portTile;
    } else if (unitType === UnitType.DefensePost) {
      return this._defensePostTile;
    } else if (unitType === UnitType.SAMLauncher) {
      return this._samTile;
    } else {
      return this._otherTile;
    }
  }

  /**
   * Clears the tile score for a given structure type and any other scores sharing the same tile.
   * Also resets the tile evaluation counter to require fresh evaluations.
   */
  private clearTileScoresForTile(tile: TileRef, reason: string): void {
    if (this._portTile === tile) {
      this._portTileScore = 0;
      this._portTile = null;
      this._portEvalCount = 0;
    }
    if (this._defensePostTile === tile) {
      this._defensePostTileScore = 0;
      this._defensePostTile = null;
      this._defensePostEvalCount = 0;
    }
    if (this._samTile === tile) {
      this._samTileScore = 0;
      this._samTile = null;
      this._samEvalCount = 0;
    }
    if (this._otherTile === tile) {
      this._otherTileScore = 0;
      this._otherTile = null;
      this._otherEvalCount = 0;
    }
    this._scoreTargetCacheDirty = true;
  }

  /**
   * Logistic (sigmoid) function: σ(z) = 1 / (1 + e^(-z))
   * Maps any real number z ∈ (-∞, +∞) to (0, 1).
   */
  private static sigmoid(z: number): number {
    return 1 / (1 + Math.exp(-z));
  }

  /**
   * Calculates the port tile score for a given tile using a logistic function.
   *
   * ## Mathematical Model
   *
   * The tile score is computed as:
   *
   *   score = σ(z) = 1 / (1 + e^(-z))
   *
   * where z is a linear combination of features:
   *
   *   z = w₀ + w₁·x₁ + w₂·x₂ + w₃·x₃
   *
   * Features (xᵢ) and their weights (wᵢ):
   *   - w₀ = bias term (default 0, so σ(0) = 0.5 as baseline)
   *   - x₁ = (max(0, (maxDist - closestPlayerDist) / maxDist))² ∈ [0, 1], quadratic
   *         w₁ = -tileNearPlayerPenalty (negative = penalty for being close to enemies)
   *   - x₂ = tiered structure value penalty: Σ(structureValue * zoneWeight) / 1M
   *         Zones: ≤25, 25-61, 61-161, 161-201 tiles; each zone's weight is
   *         basePenalty * Π(zone multipliers) cascading from inner to outer.
   *   - x₃ = dist / maxMapDim, normalized by larger map dimension
   *         w₃ = -tileCapitalDistancePenalty (negative = penalty for being far from capital)
   *
   * Returns 0 if port cannot be built (hard constraint), otherwise score ∈ (0, 1).
   */
  private calculatePortTileScore(
    player: Player,
    tile: TileRef,
    skipSpacingCheck: boolean = false,
    precomputedClosestPlayerDist?: number | null | undefined,
    precomputedNearbyStructures?: Array<{ unit: Unit; distSquared: number }>,
    precomputedSAMs?: { units: Unit[]; rangeSq: number },
  ): number {
    // Early terrain check: ports must be on ocean shore
    if (!this.mg.isOceanShore(tile)) {
      return 0;
    }

    // Check ownership and structure spacing (skip for upgrade evaluation)
    if (
      !skipSpacingCheck &&
      player.canBuildAtTile(UnitType.Port, tile) === false
    ) {
      return 0;
    }

    // For upgrades, still check basic ownership
    if (skipSpacingCheck && this.mg.owner(tile) !== player) {
      return 0;
    }

    // Initialize linear combination: z = w₀ (bias)
    let z = 0;

    // Feature 1: Enemy proximity penalty (quadratic)
    // x₁ = (max(0, (maxDist - dist) / maxDist))², bounded below at 0
    // x₁ = 1 when dist = 0 (very close), x₁ = 0 when dist >= maxDist
    // Quadratic makes penalty more severe when enemies are very close
    const avoidPlayerDist = this.avoidPlayerDistanceFor(UnitType.Port);
    if (avoidPlayerDist > 0) {
      // Use precomputed value if provided (undefined = not precomputed; null = no enemy found)
      const closestPlayerDist =
        precomputedClosestPlayerDist !== undefined
          ? precomputedClosestPlayerDist
          : this.closestOtherPlayerDistance(player, tile, avoidPlayerDist);
      if (closestPlayerDist !== null) {
        const linearX1 = Math.max(
          0,
          (avoidPlayerDist - closestPlayerDist) / avoidPlayerDist,
        );
        const x1 = linearX1 * linearX1; // Quadratic
        const w1 = -(this.params.tileNearPlayerPenalty ?? 2.0);
        z += w1 * x1;
      }
    }

    // Feature 2: Own structure proximity penalty (tiered zones)
    {
      const nearbyStructures =
        precomputedNearbyStructures ??
        this.mg.nearbyUnits(
          tile,
          AIConstructionHandler.ZONE_SEARCH_RADIUS,
          AIConstructionHandler.DISTANCE_CHECK_STRUCTURE_TYPES,
        );
      const zoneWeights = this.getZoneWeights();
      const zoneSq = AIConstructionHandler.ZONE_BOUNDARIES_SQ;
      const pid = player.id();
      let weightedValue = 0;
      for (const { unit, distSquared } of nearbyStructures) {
        if (unit.owner().id() !== pid) continue;
        // Skip Construction units building excluded types (SAM, DefensePost)
        if (
          unit.type() === UnitType.Construction &&
          AIConstructionHandler.DISTANCE_CHECK_EXCLUDED_CONSTRUCTION_TYPES.has(
            unit.constructionType()!,
          )
        )
          continue;
        // Determine zone index (0-3) based on distance²
        let zi = 0;
        if (distSquared > zoneSq[0]) {
          if (distSquared > zoneSq[2]) zi = 3;
          else if (distSquared > zoneSq[1]) zi = 2;
          else zi = 1;
        }
        weightedValue += this.getStructureValue(player, unit) * zoneWeights[zi];
      }
      if (weightedValue > 0) {
        z -= weightedValue / 1_000_000;
      }
    }

    // Feature 3: Capital distance penalty
    // x₃ = dist / mapDim, normalized by geometric mean of map dimensions
    const capital = player.capital();
    if (capital !== null) {
      const capitalTile = this.mg.ref(capital.x, capital.y);
      const dist = Math.sqrt(this.mg.euclideanDistSquared(tile, capitalTile));
      const mapDim = this.getMapDim();
      const x3 = dist / mapDim;
      const w3 = -(this.params.tileCapitalDistancePenalty ?? 1.0);
      z += w3 * x3;
    }

    // Feature 4: Nearby own structure bonus (flat if any structure within road range)
    {
      const roadRangeSq = 120 * 120;
      const bonus = this.params.tileNearbyStructureStackBonus ?? 0.01;
      const pid = player.id();
      let hasNearby = false;
      const structures =
        precomputedNearbyStructures ??
        this.mg.nearbyUnits(
          tile,
          AIConstructionHandler.ZONE_SEARCH_RADIUS,
          AIConstructionHandler.DISTANCE_CHECK_STRUCTURE_TYPES,
        );
      for (const { unit, distSquared } of structures) {
        if (distSquared > roadRangeSq) continue;
        if (unit.owner().id() !== pid) continue;
        // Skip Construction units building excluded types (SAM, DefensePost)
        if (
          unit.type() === UnitType.Construction &&
          AIConstructionHandler.DISTANCE_CHECK_EXCLUDED_CONSTRUCTION_TYPES.has(
            unit.constructionType()!,
          )
        )
          continue;
        hasNearby = true;
        break;
      }
      if (hasNearby) z += bonus;
    }

    // Feature 5: SAM coverage bonus (flat +0.01 if within range of an existing or under-construction SAM)
    {
      const samData =
        precomputedSAMs !== undefined
          ? precomputedSAMs
          : this.buildSAMData(player);
      for (const sam of samData.units) {
        if (this.mg.euclideanDistSquared(tile, sam.tile()) <= samData.rangeSq) {
          z += 0.01;
          break;
        }
      }
    }

    return AIConstructionHandler.sigmoid(z);
  }

  /**
   * Calculates the other tile score for land structures using a logistic function.
   *
   * ## Mathematical Model
   *
   * The tile score is computed as:
   *
   *   score = σ(z) = 1 / (1 + e^(-z))
   *
   * where z is a linear combination of features:
   *
   *   z = w₀ + w₁·x₁ + w₂·x₂ + w₃·x₃ + w₄·x₄
   *
   * Features (xᵢ) and their weights (wᵢ):
   *   - w₀ = bias term (default 0, so σ(0) = 0.5 as baseline)
   *   - x₁ = (max(0, (maxDist - closestPlayerDist) / maxDist))² ∈ [0, 1], quadratic
   *         w₁ = -tileNearPlayerPenalty (negative = penalty for being close to enemies)
   *   - x₂ = tiered structure value penalty: Σ(structureValue * zoneWeight) / 1M
   *         Zones: ≤25, 25-61, 61-161, 161-201 tiles; each zone's weight is
   *         basePenalty * Π(zone multipliers) cascading from inner to outer.
   *   - x₃ = dist / maxMapDim, normalized by larger map dimension
   *         w₃ = -tileCapitalDistancePenalty (negative = penalty for being far from capital)
   *   - x₄ = nearby water indicator: 1 if water within distance, 0 otherwise
   *         w₄ = -otherTileNearWaterPenalty (negative = penalty for being near coast)
   *
   * Returns 0 if structure cannot be built (hard constraint), otherwise score ∈ (0, 1).
   */
  private calculateOtherTileScore(
    player: Player,
    tile: TileRef,
    skipSpacingCheck: boolean = false,
    precomputedClosestPlayerDist?: number | null | undefined,
    precomputedNearbyStructures?: Array<{ unit: Unit; distSquared: number }>,
    precomputedSAMs?: { units: Unit[]; rangeSq: number },
  ): number {
    // Early terrain check: land structures cannot be on ocean
    if (this.mg.isOcean(tile)) {
      return 0;
    }

    // Check ownership and structure spacing (skip for upgrade evaluation)
    if (
      !skipSpacingCheck &&
      player.canBuildAtTile(UnitType.City, tile) === false
    ) {
      return 0;
    }

    // For upgrades, still check basic ownership
    if (skipSpacingCheck && this.mg.owner(tile) !== player) {
      return 0;
    }

    // Initialize linear combination: z = w₀ (bias)
    let z = 0;

    // Feature 1: Enemy proximity penalty (quadratic)
    // x₁ = (max(0, (maxDist - dist) / maxDist))², bounded below at 0
    // x₁ = 1 when dist = 0 (very close), x₁ = 0 when dist >= maxDist
    // Quadratic makes penalty more severe when enemies are very close
    const avoidPlayerDist = this.avoidPlayerDistanceFor(UnitType.City);
    if (avoidPlayerDist > 0) {
      // Use precomputed value if provided (undefined = not precomputed; null = no enemy found)
      const closestPlayerDist =
        precomputedClosestPlayerDist !== undefined
          ? precomputedClosestPlayerDist
          : this.closestOtherPlayerDistance(player, tile, avoidPlayerDist);
      if (closestPlayerDist !== null) {
        const linearX1 = Math.max(
          0,
          (avoidPlayerDist - closestPlayerDist) / avoidPlayerDist,
        );
        const x1 = linearX1 * linearX1; // Quadratic
        const w1 = -(this.params.tileNearPlayerPenalty ?? 2.0);
        z += w1 * x1;
      }
    }

    // Feature 2: Own structure proximity penalty (tiered zones)
    {
      const nearbyStructures =
        precomputedNearbyStructures ??
        this.mg.nearbyUnits(
          tile,
          AIConstructionHandler.ZONE_SEARCH_RADIUS,
          AIConstructionHandler.DISTANCE_CHECK_STRUCTURE_TYPES,
        );
      const zoneWeights = this.getZoneWeights();
      const zoneSq = AIConstructionHandler.ZONE_BOUNDARIES_SQ;
      const pid = player.id();
      let weightedValue = 0;
      for (const { unit, distSquared } of nearbyStructures) {
        if (unit.owner().id() !== pid) continue;
        // Skip Construction units building excluded types (SAM, DefensePost)
        if (
          unit.type() === UnitType.Construction &&
          AIConstructionHandler.DISTANCE_CHECK_EXCLUDED_CONSTRUCTION_TYPES.has(
            unit.constructionType()!,
          )
        )
          continue;
        let zi = 0;
        if (distSquared > zoneSq[0]) {
          if (distSquared > zoneSq[2]) zi = 3;
          else if (distSquared > zoneSq[1]) zi = 2;
          else zi = 1;
        }
        weightedValue += this.getStructureValue(player, unit) * zoneWeights[zi];
      }
      if (weightedValue > 0) {
        z -= weightedValue / 1_000_000;
      }
    }

    // Feature 3: Capital distance penalty
    // x₃ = dist / mapDim, normalized by geometric mean of map dimensions
    const capital = player.capital();
    if (capital !== null) {
      const capitalTile = this.mg.ref(capital.x, capital.y);
      const dist = Math.sqrt(this.mg.euclideanDistSquared(tile, capitalTile));
      const mapDim = this.getMapDim();
      const x3 = dist / mapDim;
      const w3 = -(this.params.tileCapitalDistancePenalty ?? 1.0);
      z += w3 * x3;
    }

    // Feature 4: Nearby water penalty (binary feature)
    // x₄ = 1 if water is within distance, 0 otherwise
    const waterCheckDist = this.params.otherTileWaterCheckDistance ?? 5;
    if (waterCheckDist > 0) {
      const hasNearbyWater = this.tileHasNearbyWater(tile, waterCheckDist);
      if (hasNearbyWater) {
        const x4 = 1;
        const w4 = -(this.params.otherTileNearWaterPenalty ?? 0.8);
        z += w4 * x4;
      }
    }

    // Feature 5: Nearby own structure bonus (flat if any structure within road range)
    {
      const roadRangeSq = 120 * 120;
      const bonus = this.params.tileNearbyStructureStackBonus ?? 0.01;
      const pid = player.id();
      let hasNearby = false;
      const structures =
        precomputedNearbyStructures ??
        this.mg.nearbyUnits(
          tile,
          AIConstructionHandler.ZONE_SEARCH_RADIUS,
          AIConstructionHandler.DISTANCE_CHECK_STRUCTURE_TYPES,
        );
      for (const { unit, distSquared } of structures) {
        if (distSquared > roadRangeSq) continue;
        if (unit.owner().id() !== pid) continue;
        // Skip Construction units building excluded types (SAM, DefensePost)
        if (
          unit.type() === UnitType.Construction &&
          AIConstructionHandler.DISTANCE_CHECK_EXCLUDED_CONSTRUCTION_TYPES.has(
            unit.constructionType()!,
          )
        )
          continue;
        hasNearby = true;
        break;
      }
      if (hasNearby) z += bonus;
    }

    // Feature 6: SAM coverage bonus (flat +0.01 if within range of an existing or under-construction SAM)
    {
      const samData =
        precomputedSAMs !== undefined
          ? precomputedSAMs
          : this.buildSAMData(player);
      for (const sam of samData.units) {
        if (this.mg.euclideanDistSquared(tile, sam.tile()) <= samData.rangeSq) {
          z += 0.01;
          break;
        }
      }
    }

    return AIConstructionHandler.sigmoid(z);
  }

  /**
   * Calculates the defense post tile score based on nearby enemy threat.
   *
   * Score = Σ over each nearby enemy player:
   *   min(militaryStrength(enemy) / ownMilitaryStrength, 4) * distanceFactor
   *
   * where:
   *   x = closestEnemyBorderDist / defensePostRadius, clamped to [0, 1]
   *   distanceFactor = -x² + 2x  (peaks at 1.0 when x=1, so enemy border at radius edge)
   *
   * Returns 0 if tile is ocean or not owned by the player.
   */
  private calculateDefensePostTileScore(player: Player, tile: TileRef): number {
    if (this.mg.isOcean(tile)) return 0;
    if (!this.mg.hasOwner(tile) || this.mg.owner(tile).id() !== player.id())
      return 0;

    const defensePostRadius = this.mg.config().defensePostRange();
    if (defensePostRadius <= 0) return 0;

    const radiusSquared = defensePostRadius * defensePostRadius;

    // Area scan: find closest distance² to each enemy player within radius.
    // This is O(radius²) instead of O(numEnemies × borderTiles).
    const playerSmallID = player.smallID();
    const cx = this.mg.x(tile);
    const cy = this.mg.y(tile);
    const closestDistSqByOwner = new Map<number, number>();

    // Piggyback water check onto the same area scan to avoid a second pass
    const waterCheckDist = this.params.otherTileWaterCheckDistance ?? 5;
    const waterCheckDistSq = waterCheckDist * waterCheckDist;
    let hasNearbyWater = false;

    for (let dy = -defensePostRadius; dy <= defensePostRadius; dy++) {
      for (let dx = -defensePostRadius; dx <= defensePostRadius; dx++) {
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSquared) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.mg.isValidCoord(nx, ny)) continue;
        const t = this.mg.ref(nx, ny);
        // Check for nearby water within the water check distance
        if (
          !hasNearbyWater &&
          waterCheckDist > 0 &&
          distSq <= waterCheckDistSq &&
          this.mg.isOcean(t)
        ) {
          hasNearbyWater = true;
        }
        if (!this.mg.hasOwner(t)) continue;
        const oid = this.mg.ownerID(t);
        if (oid === playerSmallID || oid === 0) continue;
        const prev = closestDistSqByOwner.get(oid);
        if (prev === undefined || distSq < prev) {
          closestDistSqByOwner.set(oid, distSq);
        }
      }
    }

    if (closestDistSqByOwner.size === 0) return 0;

    const ownStrength = Math.max(1, player.militaryStrength());
    let score = 0;

    for (const [ownerSmallID, closestDistSq] of closestDistSqByOwner) {
      const other = this.mg.playerBySmallID(ownerSmallID);
      if (!other.isPlayer()) continue;
      if (!other.isAlive()) continue;
      if (other.type() === PlayerType.Bot) continue;

      // x = closestDist / radius, clamped to [0, 1]
      const x = Math.min(1, Math.sqrt(closestDistSq) / defensePostRadius);
      // distanceFactor = -x² + 2x (parabola peaking at 1.0 when x = 1)
      const distanceFactor = -x * x + 2 * x;

      const strengthRatio = Math.min(4, other.militaryStrength() / ownStrength);
      score += strengthRatio * distanceFactor;
    }

    if (score <= 0) return 0;

    // Penalize overlap with existing and under-construction defense posts (same radius circles)
    const existingDPs = player
      .units(UnitType.DefensePost)
      .filter((u) => u.isActive());
    // Include defense posts under construction
    for (const u of player.units(UnitType.Construction)) {
      if (u.isActive() && u.constructionType() === UnitType.DefensePost) {
        existingDPs.push(u);
      }
    }
    if (existingDPs.length > 0) {
      const r = defensePostRadius;
      const circleArea = Math.PI * r * r;
      let totalOverlapArea = 0;

      for (const dp of existingDPs) {
        const distSq = this.mg.euclideanDistSquared(tile, dp.tile());
        const d = Math.sqrt(distSq);

        if (d >= 2 * r) {
          // No overlap
          continue;
        } else if (d <= 0) {
          // Full overlap
          totalOverlapArea += circleArea;
        } else {
          // Partial overlap of two equal-radius circles:
          // area = 2r²·arccos(d/(2r)) - (d/2)·√(4r²-d²)
          const halfD = d / 2;
          const overlapArea =
            2 * r * r * Math.acos(halfD / r) -
            halfD * Math.sqrt(4 * r * r - d * d);
          totalOverlapArea += overlapArea;
        }
      }

      const overlapFraction = Math.min(1, totalOverlapArea / circleArea);
      score *= 1 - overlapFraction;
    }

    // Apply water avoidance penalty (same convention as otherTileNearWaterPenalty)
    if (hasNearbyWater) {
      score *= 1 - (this.params.defensePostNearWaterPenalty ?? 0);
    }

    return score;
  }

  /**
   * Checks if there is water (ocean) within the given distance of a tile.
   */
  private tileHasNearbyWater(tile: TileRef, maxDist: number): boolean {
    const cx = this.mg.x(tile);
    const cy = this.mg.y(tile);
    const maxDistSq = maxDist * maxDist;

    // Sample tiles in the area to check for water
    for (let dy = -maxDist; dy <= maxDist; dy++) {
      for (let dx = -maxDist; dx <= maxDist; dx++) {
        if (dx * dx + dy * dy > maxDistSq) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.mg.isValidCoord(x, y)) continue;
        const t = this.mg.ref(x, y);
        if (this.mg.isOcean(t)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Calculates the SAM tile score for a given tile.
   *
   * Score = Σ over each owned structure:
   *   structureValue * weight
   *
   * where weight = 1 / (1 + e^(decay * existingCoverage))
   * and existingCoverage = number of existing SAMs already covering the structure.
   *
   * Returns 0 if the tile is ocean, not owned, or too close to enemies.
   * The raw score is structure-value-weighted and NOT normalized to (0,1).
   */
  private calculateSAMTileScore(
    player: Player,
    tile: TileRef,
    precomputedClosestPlayerDist?: number | null | undefined,
    skipSpacingCheck: boolean = false,
    precomputedSAMs?: { units: Unit[]; rangeSq: number },
  ): number {
    if (this.mg.isOcean(tile)) return 0;
    if (!this.mg.hasOwner(tile) || this.mg.owner(tile).id() !== player.id())
      return 0;

    // Check if a SAM can be built here (skip for upgrade evaluation)
    if (
      !skipSpacingCheck &&
      player.canBuildAtTile(UnitType.SAMLauncher, tile) === false
    )
      return 0;

    // Enemy proximity penalty via sigmoid (only the distance term)
    let z = 0;
    const avoidPlayerDist = this.avoidPlayerDistanceFor(UnitType.SAMLauncher);
    if (avoidPlayerDist > 0) {
      // Use precomputed value if provided (undefined = not precomputed; null = no enemy found)
      const closestPlayerDist =
        precomputedClosestPlayerDist !== undefined
          ? precomputedClosestPlayerDist
          : this.closestOtherPlayerDistance(player, tile, avoidPlayerDist);
      if (closestPlayerDist !== null) {
        const linearX = Math.max(
          0,
          (avoidPlayerDist - closestPlayerDist) / avoidPlayerDist,
        );
        const x = linearX * linearX; // Quadratic
        const w = -(this.params.tileNearPlayerPenalty ?? 2.0);
        z += w * x;
      }
    }
    const proximityMultiplier = AIConstructionHandler.sigmoid(z);

    // Use precomputed SAM data or build it
    const samData =
      precomputedSAMs !== undefined
        ? precomputedSAMs
        : this.buildSAMData(player);
    const sams = samData.units;
    const rangeSquared = samData.rangeSq;

    const rawScore = this.evaluateSAMPlacementScore(
      player,
      tile,
      sams,
      rangeSquared,
    );

    return rawScore * proximityMultiplier;
  }

  /**
   * Evaluates a random owned tile or existing structure and updates the saved scores.
   * Randomly decides between evaluating a new tile and evaluating an existing structure for upgrade.
   */
  private tickTileEvaluation(player: Player, ticks: number): void {
    const numTiles = player.numTilesOwned();
    if (numTiles === 0) return;

    // Rebuild cached tile array periodically (~every 10s) so newly conquered tiles
    // are included. Between rebuilds, stale entries are skipped via ownership check.
    if (
      this._cachedTiles === null ||
      this._cachedTiles.length === 0 ||
      ticks - this._cachedTilesLastRebuildTick >=
        AIConstructionHandler.TILE_CACHE_REBUILD_INTERVAL
    ) {
      this._cachedTiles = Array.from(player.tiles());
      this._cachedTilesLastRebuildTick = ticks;
    }

    if (this._cachedTiles.length === 0) return;

    // Evaluate both a new tile and an existing structure for upgrade every tick
    this.evaluateNewTile(player);
    this.evaluateUpgradeCandidate(player, ticks);
  }

  /**
   * Evaluates a random owned tile for building new structures.
   */
  private evaluateNewTile(player: Player): void {
    if (this._cachedTiles === null || this._cachedTiles.length === 0) return;

    // Pick a random owned tile, skipping stale entries (tiles no longer owned)
    let tile: TileRef | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const candidate = this.random.randElement(this._cachedTiles);
      if (this.mg.owner(candidate) === player) {
        tile = candidate;
        break;
      }
    }
    if (tile === null) return;

    // Early terrain classification to avoid redundant expensive checks
    const isOceanTile = this.mg.isOcean(tile);

    // Precompute shared expensive values once for all score functions:
    // closestOtherPlayerDistance is used by port, other, and SAM (all with same radius)
    // nearbyUnits is used by port and other (same tile, same params)
    // SAM list + range is used by port, other, and SAM tile scoring
    const avoidPlayerDist = this.avoidPlayerDistanceFor(UnitType.Port); // Same for Port, City, SAMLauncher
    const closestPlayerDist =
      avoidPlayerDist > 0
        ? this.closestOtherPlayerDistance(player, tile, avoidPlayerDist)
        : null;

    const nearbyStructures = this.mg.nearbyUnits(
      tile,
      AIConstructionHandler.ZONE_SEARCH_RADIUS,
      AIConstructionHandler.DISTANCE_CHECK_STRUCTURE_TYPES,
    );

    const samData = this.buildSAMData(player);

    // Calculate port score with penalties and bonuses (only for ocean shore tiles)
    const portScore = this.calculatePortTileScore(
      player,
      tile,
      false,
      closestPlayerDist,
      nearbyStructures,
      samData,
    );

    // Land structures (defense post, SAM, and other) can only be built on non-ocean tiles
    const otherScore = isOceanTile
      ? 0
      : this.calculateOtherTileScore(
          player,
          tile,
          false,
          closestPlayerDist,
          nearbyStructures,
          samData,
        );
    const defensePostScore = isOceanTile
      ? 0
      : this.calculateDefensePostTileScore(player, tile);
    const samScore = isOceanTile
      ? 0
      : this.calculateSAMTileScore(
          player,
          tile,
          closestPlayerDist,
          false,
          samData,
        );

    // Increment evaluation counts for each type
    this._portEvalCount++;
    this._defensePostEvalCount++;
    this._samEvalCount++;
    this._otherEvalCount++;

    // Update port tile if this score is strictly greater
    if (portScore > this._portTileScore) {
      this._portTileScore = portScore;
      this._portTile = tile;
      this._scoreTargetCacheDirty = true;
    }

    // Update defense post tile if this score is strictly greater
    if (defensePostScore > this._defensePostTileScore) {
      this._defensePostTileScore = defensePostScore;
      this._defensePostTile = tile;
      this._scoreTargetCacheDirty = true;
    }

    // Update SAM tile if this score is strictly greater
    if (samScore > this._samTileScore) {
      this._samTileScore = samScore;
      this._samTile = tile;
      this._scoreTargetCacheDirty = true;
    }

    // Update other structures tile if this score is strictly greater
    if (otherScore > this._otherTileScore) {
      this._otherTileScore = otherScore;
      this._otherTile = tile;
      this._scoreTargetCacheDirty = true;
    }
  }

  /**
   * Evaluates the least-recently-checked existing structure for potential upgrade/stacking.
   * Structures that have never been evaluated are checked first.
   * Uses the same scoring as new tiles but divides by UPGRADE_SCORE_DIVISOR.
   * Returns true if a structure was evaluated, false if no upgradeable structures exist.
   */
  private evaluateUpgradeCandidate(player: Player, ticks: number): boolean {
    // Get all stackable structures owned by this player
    const stackableTypes = [
      UnitType.City,
      UnitType.Port,
      UnitType.Airfield,
      UnitType.Hospital,
      UnitType.Academy,
      UnitType.ResearchLab,
      UnitType.Factory,
      UnitType.SAMLauncher,
    ];

    // Collect all upgradeable structures
    const upgradeableStructures: Unit[] = [];
    for (const unitType of stackableTypes) {
      const units = player.units(unitType).filter((u) => {
        if (!u.isActive()) return false;
        const currentStack = u.stackCount?.() ?? 1;
        const maxStack = maxStackCount(unitType);
        return currentStack < maxStack;
      });
      upgradeableStructures.push(...units);
    }

    if (upgradeableStructures.length === 0) return false;

    // Pick the structure that was evaluated the longest ago (never-evaluated first)
    let structure = upgradeableStructures[0];
    let oldestTick = this._upgradeLastEvalTick.get(structure.id()) ?? -Infinity;
    for (let i = 1; i < upgradeableStructures.length; i++) {
      const candidate = upgradeableStructures[i];
      const lastTick =
        this._upgradeLastEvalTick.get(candidate.id()) ?? -Infinity;
      if (lastTick < oldestTick) {
        oldestTick = lastTick;
        structure = candidate;
      }
    }

    // Record this evaluation tick
    this._upgradeLastEvalTick.set(structure.id(), ticks);
    const tile = structure.tile();
    const unitType = structure.type();

    // Calculate the score based on structure type (skip spacing check for upgrades)
    let score: number;
    if (unitType === UnitType.Port) {
      score = this.calculatePortTileScore(player, tile, true);
    } else if (unitType === UnitType.SAMLauncher) {
      score = this.calculateSAMTileScore(player, tile, undefined, true);
    } else {
      score = this.calculateOtherTileScore(player, tile, true);
    }

    // Get current upgrade data for this specific structure type
    const currentData = this._upgradeScores.get(unitType);
    const currentScore = currentData?.score ?? 0;

    // Update the upgrade score/unit for this structure type if this score is strictly greater
    if (score > currentScore) {
      this._upgradeScores.set(unitType, {
        score,
        unit: structure,
      });
      this._scoreTargetCacheDirty = true;
    }

    return true;
  }

  /**
   * Computes the effective SAM range for a given tech level.
   */
  private getEffectiveSAMRange(techLevel: number): number {
    const baseRange = this.mg.config().defaultSamRange();
    const rangeBonus = this.mg.config().samRangeUpgradePercent();
    if (techLevel <= 1) return baseRange;
    return baseRange * Math.pow(1 + rangeBonus, techLevel - 1);
  }

  /**
   * Computes the value of a structure based on its type and level.
   * Uses base construction cost + upgrade costs for each level.
   */
  private getStructureValue(player: Player, structure: Unit): number {
    let unitType = structure.type();
    // For construction units, value by the type being built
    if (unitType === UnitType.Construction) {
      const ct = structure.constructionType();
      if (ct === null) return 0;
      unitType = ct;
    }
    const baseCost = this.getCachedStructureCost(player, unitType);
    const level = structure.stackCount?.() ?? 1;

    if (level <= 1) {
      return baseCost;
    }

    // Add upgrade costs for each level beyond 1
    // Upgrade cost is typically 80% of base cost per level
    const upgradeMultiplier = 0.8;
    let totalValue = baseCost;
    for (let i = 2; i <= level; i++) {
      totalValue += baseCost * upgradeMultiplier;
    }
    return totalValue;
  }

  /**
   * Evaluates the score of placing a SAM at a given tile.
   * Returns weighted sum of structure values where weight = 1/(1 + existing SAM coverage).
   */
  private evaluateSAMPlacementScore(
    player: Player,
    tile: TileRef,
    sams: Unit[],
    rangeSquared: number,
  ): number {
    let score = 0;

    for (const structureType of AIConstructionHandler.ALL_STRUCTURE_TYPES) {
      // Exclude SAMs and SAM constructions — their value shouldn't inflate
      // the protected-value score (circular incentive).
      if (structureType === UnitType.SAMLauncher) continue;

      const structures = player.units(structureType).filter((u) => {
        if (!u.isActive()) return false;
        // Exclude Construction units that are building a SAM
        if (
          u.type() === UnitType.Construction &&
          u.constructionType() === UnitType.SAMLauncher
        ) {
          return false;
        }
        return true;
      });

      for (const structure of structures) {
        const structureTile = structure.tile();
        const distSq = this.mg.euclideanDistSquared(tile, structureTile);

        // Check if this structure would be covered by a SAM at the given tile
        if (distSq > rangeSquared) {
          continue; // Structure not in range
        }

        // Count existing SAM coverage
        let existingCoverage = 0;
        for (const sam of sams) {
          if (
            this.mg.euclideanDistSquared(sam.tile(), structureTile) <=
            rangeSquared
          ) {
            existingCoverage++;
          }
        }

        const structureValue = this.getStructureValue(player, structure);
        const decay = this.params.samCoverageDecay ?? 0.05;
        const weight = 1 / (1 + Math.exp(decay * existingCoverage));
        const contribution = structureValue * weight;
        score += contribution;
      }
    }

    return score;
  }

  private getStructureWeight(unitType: UnitType): number {
    switch (unitType) {
      case UnitType.City:
        return this.params.weightCity ?? 1;
      case UnitType.Factory:
        return this.params.weightFactory ?? 1;
      case UnitType.Port:
        return this.params.weightPort ?? 1;
      case UnitType.Hospital:
        return this.params.weightHospital ?? 1;
      case UnitType.Academy:
        return this.params.weightAcademy ?? 1;
      case UnitType.Airfield:
        return this.params.weightAirfield ?? 1;
      case UnitType.ResearchLab:
        return this.params.weightResearchLab ?? 1;
      case UnitType.MissileSilo:
        return this.params.weightMissileSilo ?? 1;
      case UnitType.SAMLauncher:
        return this.params.weightSAMLauncher ?? 1;
      case UnitType.DefensePost:
        return this.params.weightDefensePost ?? 1;
      case UnitType.DoomsdayDevice:
        return this.params.weightDoomsdayDevice ?? 1;
      default:
        return 1;
    }
  }

  private pickTarget(
    exclude: UnitType | null,
    player: Player,
  ): UnitType | null {
    const candidates = this.candidateTargets().filter((t) =>
      exclude === null ? true : t !== exclude,
    );

    if (candidates.length === 0) {
      return null;
    }

    let bestScore = -Infinity;
    let best: UnitType[] = [];
    for (const t of candidates) {
      const s = this.scoreTarget(player, t);
      if (s > bestScore) {
        bestScore = s;
        best = [t];
      } else if (s === bestScore) {
        best.push(t);
      }
    }

    return this.random.randElement(best);
  }

  private canAffordTarget(player: Player, unitType: UnitType): boolean {
    // Check if we're upgrading or building new
    const { isUpgrade } = this.getEffectiveScoreAndMode(unitType);

    if (isUpgrade && isStackableStructure(unitType)) {
      // Upgrade cost is based on structure upgrade multiplier
      const baseCost = this.mg.unitInfo(unitType).cost(player);
      const multiplier = this.mg
        .config()
        .structureUpgradeCostMultiplier(unitType);
      const upgradeCost = computeUpgradeStepCost(baseCost, multiplier);
      return player.gold() >= upgradeCost;
    } else {
      // New construction cost
      const cost = this.mg.unitInfo(unitType).cost(player);
      return player.gold() >= cost;
    }
  }

  /**
   * Returns true if construction should be deferred because nuke value
   * exceeds the construction target score (scaled by threshold param).
   * Only considers hydrogen bomb score if the player has ThermonuclearStaging.
   */
  private shouldDeferToNukes(player: Player): boolean {
    const threshold = this.params.nukeScoreConstructionThreshold ?? 0;
    if (threshold <= 0 || !this.nukeEvaluator || this.target === null)
      return false;

    // Get the best nuke scores
    const atomTarget = this.nukeEvaluator.bestAtomTarget();
    let bestNukeScore = atomTarget?.score ?? 0;

    // Only consider hydrogen bomb if player has researched ThermonuclearStaging
    if (player.hasUpgrade(UpgradeType.ThermonuclearStaging)) {
      const hydrogenTarget = this.nukeEvaluator.bestHydrogenTarget();
      if (hydrogenTarget && hydrogenTarget.score > bestNukeScore) {
        bestNukeScore = hydrogenTarget.score;
      }
    }

    if (bestNukeScore <= 0) return false;

    // Apply internal multiplier
    bestNukeScore *=
      AIConstructionHandler.NUKE_SCORE_CONSTRUCTION_INTERNAL_MULTIPLIER;

    const constructionScore = this.scoreTarget(player, this.target);

    return constructionScore < threshold * bestNukeScore;
  }

  /**
   * Returns the best construction score across all candidate structure types.
   */
  bestConstructionScore(): number {
    const player = this.getPlayer();
    if (!player) return 0;
    // Use cached scores if available; they're invalidated by tile/upgrade score changes
    if (!this._scoreTargetCacheDirty && this._scoreTargetCache.size > 0) {
      let best = 0;
      for (const s of this._scoreTargetCache.values()) {
        if (s > best) best = s;
      }
      return best;
    }
    // Rebuild cache
    this._scoreTargetCache.clear();
    const candidates = this.candidateTargets();
    let best = 0;
    for (const t of candidates) {
      const s = this.scoreTarget(player, t);
      this._scoreTargetCache.set(t, s);
      if (s > best) best = s;
    }
    this._scoreTargetCacheDirty = false;
    return best;
  }

  /**
   * Returns a map of candidate structure type → score for debugging/logging.
   */
  constructionScoreBreakdown(): Map<UnitType, number> {
    const player = this.getPlayer();
    if (!player) return new Map();
    // Use cached scores if available
    if (!this._scoreTargetCacheDirty && this._scoreTargetCache.size > 0) {
      return new Map(this._scoreTargetCache);
    }
    // Rebuild cache
    this._scoreTargetCache.clear();
    const candidates = this.candidateTargets();
    for (const t of candidates) {
      this._scoreTargetCache.set(t, this.scoreTarget(player, t));
    }
    this._scoreTargetCacheDirty = false;
    return new Map(this._scoreTargetCache);
  }

  /**
   * Returns whether the upgrade path is preferred over new-build for a given type.
   */
  isUpgradePreferred(unitType: UnitType): boolean {
    return this._upgradePreferred.get(unitType) ?? false;
  }

  /**
   * Returns detailed component breakdowns for city and factory base scores.
   * Used for debugging/logging.
   */
  cityFactoryScoreBreakdown(player: Player): {
    city: {
      cost: number;
      currentMaxPop: number;
      projectedMaxPop: number;
      currentWorkers: number;
      projectedWorkers: number;
      factoryCount: number;
      factoryFactor: number;
      productivity: number;
      goldMultiplier: number;
      currentGrossGold: number;
      projectedGrossGold: number;
      incomeGain: number;
      T: number;
      discountRate: number;
      finalScore: number;
    };
    factory: {
      cost: number;
      workers: number;
      factoryCount: number;
      currentFactoryFactor: number;
      projectedFactoryFactor: number;
      productivity: number;
      goldMultiplier: number;
      currentGrossGold: number;
      projectedGrossGold: number;
      incomeGain: number;
      T: number;
      discountRate: number;
      finalScore: number;
    };
  } {
    const config = this.mg.config();
    const assumedPopPercent = this.params.aiAssumedPopPercent ?? 0.7;
    const targetTroopRatio = player.targetTroopRatio();
    const discountRate = this.params.discountFactor ?? 0.1;
    const TICKS_PER_MINUTE = 600;

    // --- City ---
    const cityCost = this.mg.unitInfo(UnitType.City).cost(player);
    const cityCostNum = Number(cityCost);
    const currentMaxPop = config.maxPopulation(player);
    const cityPopBonus = config.cityPopulationIncrease();
    const projectedMaxPop = currentMaxPop + cityPopBonus;
    const currentWorkers =
      currentMaxPop * assumedPopPercent * (1 - targetTroopRatio);
    const projectedWorkers =
      projectedMaxPop * assumedPopPercent * (1 - targetTroopRatio);
    const factoryCount = player.unitsOwned(UnitType.Factory);
    const factoryFactor = Math.pow(1 + factoryCount, 0.35);
    const cityProductivity = player.productivity();
    const cityMultiplier = config.gameConfig().goldMultiplier ?? 1;
    const cityCurrentGross =
      0.11 *
      Math.pow(currentWorkers, 0.65) *
      cityProductivity *
      factoryFactor *
      cityMultiplier;
    const cityProjectedGross =
      0.11 *
      Math.pow(projectedWorkers, 0.65) *
      cityProductivity *
      factoryFactor *
      cityMultiplier;
    const cityIncomeGain = cityProjectedGross - cityCurrentGross;
    const cityGrossPerMin = cityCurrentGross * TICKS_PER_MINUTE;
    const cityT = cityGrossPerMin > 0 ? cityCostNum / cityGrossPerMin : 0;
    const cityIncomeGainPerMin = cityIncomeGain * TICKS_PER_MINUTE;
    const cityFinalScore =
      cityGrossPerMin > 0 && cityIncomeGain > 0
        ? cityIncomeGainPerMin /
          discountRate /
          Math.pow(1 + discountRate, cityT)
        : 0;

    // --- Factory ---
    const factoryCost = this.mg.unitInfo(UnitType.Factory).cost(player);
    const factoryCostNum = Number(factoryCost);
    const fWorkers = currentMaxPop * assumedPopPercent * (1 - targetTroopRatio);
    const currentFactoryFactor = Math.pow(1 + factoryCount, 0.35);
    const projectedFactoryFactor = Math.pow(1 + factoryCount + 1, 0.35);
    const factoryProductivity = player.productivity();
    const factoryMultiplier = config.gameConfig().goldMultiplier ?? 1;
    const factoryBase =
      0.11 * Math.pow(fWorkers, 0.65) * factoryProductivity * factoryMultiplier;
    const factoryCurrentGross = factoryBase * currentFactoryFactor;
    const factoryProjectedGross = factoryBase * projectedFactoryFactor;
    const factoryIncomeGain = factoryProjectedGross - factoryCurrentGross;
    const factoryGrossPerMin = factoryCurrentGross * TICKS_PER_MINUTE;
    const factoryT =
      factoryGrossPerMin > 0 ? factoryCostNum / factoryGrossPerMin : 0;
    const factoryIncomeGainPerMin = factoryIncomeGain * TICKS_PER_MINUTE;
    const factoryFinalScore =
      factoryGrossPerMin > 0 && factoryIncomeGain > 0
        ? factoryIncomeGainPerMin /
          discountRate /
          Math.pow(1 + discountRate, factoryT)
        : 0;

    return {
      city: {
        cost: cityCostNum,
        currentMaxPop,
        projectedMaxPop,
        currentWorkers,
        projectedWorkers,
        factoryCount,
        factoryFactor,
        productivity: cityProductivity,
        goldMultiplier: cityMultiplier,
        currentGrossGold: cityCurrentGross,
        projectedGrossGold: cityProjectedGross,
        incomeGain: cityIncomeGain,
        T: cityT,
        discountRate,
        finalScore: cityFinalScore,
      },
      factory: {
        cost: factoryCostNum,
        workers: fWorkers,
        factoryCount,
        currentFactoryFactor,
        projectedFactoryFactor,
        productivity: factoryProductivity,
        goldMultiplier: factoryMultiplier,
        currentGrossGold: factoryCurrentGross,
        projectedGrossGold: factoryProjectedGross,
        incomeGain: factoryIncomeGain,
        T: factoryT,
        discountRate,
        finalScore: factoryFinalScore,
      },
    };
  }

  /**
   * Consume the current "other" tile for silo placement during a nuke sequence.
   * Returns the tile and clears it (same as after a normal build).
   */
  consumeOtherTile(): TileRef | null {
    const tile = this._otherTile;
    if (tile !== null) {
      this.clearTileScoresForTile(tile, "consumed for nuke silo");
    }
    return tile;
  }

  private avoidPlayerDistanceFor(unitType: UnitType): number {
    if (unitType === UnitType.DefensePost) return 0;
    return Math.max(0, Math.floor(this.params.aiAvoidPlayerDistance ?? 8)); // Reduced from 10
  }

  /**
   * Finds the distance to the closest other player's territory within the given radius.
   * Returns null if no other player territory is found within radius.
   * Exhaustively checks all tiles within the radius.
   */
  private closestOtherPlayerDistance(
    player: Player,
    center: TileRef,
    radius: number,
  ): number | null {
    if (radius <= 0) return null;

    const radiusSq = radius * radius;
    const cx = this.mg.x(center);
    const cy = this.mg.y(center);
    let closestDistSq: number | null = null;

    // Check all tiles within the radius
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.mg.isValidCoord(x, y)) continue;
        const t = this.mg.ref(x, y);
        if (!this.mg.hasOwner(t)) continue;
        const owner = this.mg.owner(t);
        if (!owner.isPlayer?.() || !owner.isPlayer()) continue;
        if (owner.id() !== player.id()) {
          if (closestDistSq === null || distSq < closestDistSq) {
            closestDistSq = distSq;
          }
        }
      }
    }

    return closestDistSq !== null ? Math.sqrt(closestDistSq) : null;
  }

  /**
   * Re-validates a tile at build time by recalculating its score.
   * Updates the saved score to the fresh value. If score dropped to 0,
   * rejects the tile. Even if the score decreased, the tile may still be the
   * best option so we keep it rather than doing a full reset.
   */
  private validateTileForConstruction(
    player: Player,
    tile: TileRef,
    unitType: UnitType,
  ): boolean {
    // Recalculate the score for the current best tile
    if (unitType === UnitType.Port) {
      const newScore = this.calculatePortTileScore(player, tile);
      // Update saved score to current value (tile may still be the best even if score dropped)
      this._portTileScore = newScore;
      return newScore > 0;
    } else if (unitType === UnitType.DefensePost) {
      const newScore = this.calculateDefensePostTileScore(player, tile);
      this._defensePostTileScore = newScore;
      return newScore > 0;
    } else if (unitType === UnitType.SAMLauncher) {
      const newScore = this.calculateSAMTileScore(player, tile);
      this._samTileScore = newScore;
      return newScore > 0;
    } else {
      const newScore = this.calculateOtherTileScore(player, tile);
      this._otherTileScore = newScore;
      return newScore > 0;
    }
  }
}
