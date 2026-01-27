import { ConstructionExecution } from "../execution/ConstructionExecution";
import { UpgradeStructureExecution } from "../execution/UpgradeStructureExecution";
import { computeUpgradeStepCost } from "../game/Costs";
import {
  Game,
  isStructureType,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  maxStackCount,
  playerMaxStructureTechLevel,
} from "../game/Upgradeables";
import { PseudoRandom } from "../PseudoRandom";
import { tradeIncomeModifiers } from "../tech/TechEffects";
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles structure construction for AI players.
 * Builds cities, factories, and ports based on density parameters.
 */
export class AIConstructionHandler {
  private target: UnitType | null = null;

  // Cached tile array to avoid allocation every tick
  private _cachedTiles: TileRef[] | null = null;
  private _cachedTilesPlayerTileCount: number = 0;

  // Structure types blocked from consideration until another structure is built/upgraded
  private _blockedStructures: Set<UnitType> = new Set();

  private static readonly PORT_SCORE_MULTIPLIER = 100;
  private static readonly HOSPITAL_BASE_SCORE = 1e-3;
  private static readonly ACADEMY_BASE_SCORE = 1e-3;
  private static readonly RESEARCH_LAB_BASE_SCORE = 8e-1;
  private static readonly AIRFIELD_SCORE_MULTIPLIER = 1e-1;
  private static readonly SAM_BASE_SCORE = 1e-5;
  private static readonly SAM_EVALUATION_INTERVAL = 10;
  private static readonly SAM_PLACEMENT_MIN_PLAYER_DIST = 10;

  // SAM evaluation state
  private _bestSAMScore: number = 0;
  private _bestSAMTile: TileRef | null = null;
  private _bestSAMIsUpgrade: boolean = false; // true if best option is stacking existing SAM
  private _bestSAMUpgradeUnit: Unit | null = null; // the SAM unit to stack (if _bestSAMIsUpgrade)

  // Tile evaluation state for non-SAM structures (ports, defense posts, others)
  private _portTileScore: number = 0;
  private _portTile: TileRef | null = null;
  private _defensePostTileScore: number = 0;
  private _defensePostTile: TileRef | null = null;
  private _otherTileScore: number = 0;
  private _otherTile: TileRef | null = null;

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

  tickConstruction(ticks: number, shouldRecalculate: boolean): void {
    const player = this.getPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    const numTiles = player.numTilesOwned();
    if (numTiles === 0) {
      return;
    }

    // Periodically evaluate SAM placement candidates
    if (ticks % AIConstructionHandler.SAM_EVALUATION_INTERVAL === 0) {
      this.tickSAMEvaluation(player);
    }

    // Every tick, evaluate a random tile for non-SAM structures
    this.tickTileEvaluation(player);

    // Periodically re-score and potentially retarget.
    // Only switches if there's a strictly better target than the current.
    if (shouldRecalculate) {
      this.recalculateTarget(player);
    }

    if (this.target === null) {
      this.target = this.pickTarget(null, player);
      return;
    }

    // SAM has special construction path using pre-evaluated best tile/upgrade
    if (this.target === UnitType.SAMLauncher) {
      // Check if we can afford the SAM before attempting
      if (!this.canAffordSAM(player)) {
        return; // Just wait until we can afford it, don't block
      }
      const result = this.trySAMConstruction(player);
      if (result === "success") {
        this.clearBlockedStructures();
        this.target = null;
        return;
      } else if (result === "blocked") {
        // Permanent failure - block SAM and pick a different target
        this._blockedStructures.add(UnitType.SAMLauncher);
        const original = this.target;
        const next = this.pickTarget(original, player);
        this.target = next;
        return;
      }
      // result === "retry" means temporary failure, just return and try again later
      return;
    }

    // Only attempt placement if we can afford the target structure
    if (!this.canAffordTarget(player, this.target)) {
      return;
    }

    // Get the saved tile for this structure type
    const savedTile = this.getSavedTileForStructure(this.target);
    if (savedTile === null) {
      // No tile evaluated yet, wait for tile evaluation
      return;
    }

    // Re-validate the tile at build time to catch any changes since evaluation
    if (!this.validateTileForConstruction(player, savedTile, this.target)) {
      // Tile no longer valid - clear it and wait for fresh evaluation
      this.clearTileScoresForTile(savedTile);
      this.target = null;
      return;
    }

    // Attempt to build at the saved tile
    const spawnTile = player.canBuild(this.target, savedTile);

    if (spawnTile !== false && this.canAffordTarget(player, this.target)) {
      this.mg.addExecution(
        new ConstructionExecution(player, this.target, spawnTile),
      );
      this.clearBlockedStructures();
    } else {
      // Failed to place - block this structure until another is built
      this._blockedStructures.add(this.target);
    }

    // Clear the score and tile for this structure type, and any others sharing the same tile
    this.clearTileScoresForTile(savedTile);
    this.target = null;
  }

  private recalculateTarget(player: Player): void {
    const candidates = this.candidateTargets();
    if (candidates.length === 0) {
      this.target = null;
      return;
    }

    // If current target is no longer a candidate, drop it so we can repick.
    if (this.target !== null && !candidates.includes(this.target)) {
      this.target = null;
    }

    // Log scores for Russia
    const isRussia = player.name() === "Russia";
    const scoreMap: Record<string, number> = {};

    let bestScore = -Infinity;
    let best: UnitType[] = [];
    for (const t of candidates) {
      const s = this.scoreTarget(player, t);
      if (isRussia) {
        scoreMap[t] = s;
      }
      if (s > bestScore) {
        bestScore = s;
        best = [t];
      } else if (s === bestScore) {
        best.push(t);
      }
    }

    if (isRussia) {
      const blockedStr =
        this._blockedStructures.size > 0
          ? ` [blocked: ${Array.from(this._blockedStructures).join(", ")}]`
          : "";
      console.log(
        `[AI Construction] Russia scores:`,
        Object.entries(scoreMap)
          .sort(([, a], [, b]) => b - a)
          .map(([t, s]) => `${t}: ${s.toFixed(4)}`)
          .join(", ") + blockedStr,
      );
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
    if (this.params.buildMissileSilos ?? false)
      candidates.push(UnitType.MissileSilo);
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
    }

    // For other structures, base score remains 0 (uses weight only)
    const structureScore = baseScore * weight;

    // Multiply by the appropriate tile score for non-SAM structures
    if (unitType === UnitType.SAMLauncher) {
      return structureScore; // SAM uses its own tile evaluation system
    } else if (unitType === UnitType.Port) {
      return structureScore * this._portTileScore;
    } else if (unitType === UnitType.DefensePost) {
      return structureScore * this._defensePostTileScore;
    } else {
      return structureScore * this._otherTileScore;
    }
  }

  /**
   * Computes the city base score as expected income gain / cost.
   */
  private scoreCity(player: Player): number {
    const config = this.mg.config();
    const cost = this.mg.unitInfo(UnitType.City).cost(player);
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
    if (costNum <= 0 || !Number.isFinite(incomeGain)) {
      return 0;
    }

    return (incomeGain / costNum) * 1e6;
  }

  /**
   * Computes the factory base score as expected income gain / cost.
   */
  private scoreFactory(player: Player): number {
    const config = this.mg.config();
    const cost = this.mg.unitInfo(UnitType.Factory).cost(player);
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
    if (costNum <= 0 || !Number.isFinite(incomeGain)) {
      return 0;
    }

    return (incomeGain / costNum) * 1e6;
  }

  /**
   * Computes the port base score based on trade demand.
   */
  private scorePort(player: Player): number {
    const portCount = player.unitsOwned(UnitType.Port);

    // If AI has 0 ports, use the profile parameter for first port score
    if (portCount === 0) {
      return this.params.aiFirstPortScore ?? 1.0;
    }

    // Get global trade demand queue length
    const queueLen = (this.mg as any).tradeDemandQueueLength?.() ?? 0;

    // Use player method for metrics calculation
    const metrics = player.tradeDemandMetrics(queueLen);

    // Get trade income multipliers
    const tradeMods = tradeIncomeModifiers(player);
    const tradeIncomeMul = tradeMods.incomeMul * tradeMods.tradeShipIncomeMul;

    // Calculate global ships under construction vs global ports multiplier
    // Global port count sums levels (stackCount) but ignores health
    const allPorts = this.mg.units(UnitType.Port).filter((p) => p.isActive());
    const globalPortCount = allPorts.reduce(
      (sum, port) => sum + (port.stackCount?.() ?? 1),
      0,
    );
    const globalShipsUnderConstruction = allPorts.reduce(
      (sum, port) => sum + (port as any).pendingTradeShipDueTicks().length,
      0,
    );
    const constructionRatioMul =
      globalPortCount > 0
        ? 1 - globalShipsUnderConstruction / globalPortCount
        : 1;

    // Base score = multiplier * (1 + queueRatio) * (1 - availableRatio) * tradeIncomeMods * constructionRatioMul
    return (
      AIConstructionHandler.PORT_SCORE_MULTIPLIER *
      (1 + metrics.queueRatio) *
      (1 - metrics.availableRatio) *
      tradeIncomeMul *
      Math.max(0, constructionRatioMul)
    );
  }

  /**
   * Computes the hospital base score based on troop ratio and pop growth bonus.
   */
  private scoreHospital(player: Player): number {
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

    return (
      AIConstructionHandler.HOSPITAL_BASE_SCORE *
      maxPop *
      targetTroopRatio *
      assumedPopPercent *
      hospitalBonus
    );
  }

  /**
   * Computes the academy base score based on troop ratio and combat bonus.
   */
  private scoreAcademy(player: Player): number {
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

    return (
      AIConstructionHandler.ACADEMY_BASE_SCORE *
      maxPop *
      targetTroopRatio *
      assumedPopPercent *
      academyBonus
    );
  }

  /**
   * Computes the research lab base score based on research spending and lab bonus.
   */
  private scoreResearchLab(player: Player): number {
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

    return (
      AIConstructionHandler.RESEARCH_LAB_BASE_SCORE *
      researchSpending *
      labBonus
    );
  }

  /**
   * Computes the airfield base score based on enemy structures.
   * Score = multiplier * (total non-self structures / (airfields owned + 1))
   */
  private scoreAirfield(player: Player): number {
    // Count total structures not owned by this player, including levels
    let totalNonSelfStructures = 0;
    for (const other of this.mg.players()) {
      if (other.id() === player.id()) continue;
      if (!other.isAlive()) continue;
      // Sum up all structure types including their levels (unitsOwned counts levels)
      for (const structureType of AIConstructionHandler.NON_DEFENSE_STRUCTURE_TYPES) {
        totalNonSelfStructures += other.unitsOwned(structureType);
      }
    }

    const airfieldCount = player.unitsOwned(UnitType.Airfield);

    return (
      AIConstructionHandler.AIRFIELD_SCORE_MULTIPLIER *
      (totalNonSelfStructures / (airfieldCount + 1))
    );
  }

  /**
   * Returns the previously evaluated SAM score.
   * The score is computed periodically by tickSAMEvaluation().
   */
  private scoreSAMLauncher(_player: Player): number {
    return this._bestSAMScore * AIConstructionHandler.SAM_BASE_SCORE;
  }

  /**
   * Resets the SAM evaluation state after a SAM is built or stacked.
   */
  private resetSAMEvaluationState(): void {
    this._bestSAMScore = 0;
    this._bestSAMTile = null;
    this._bestSAMIsUpgrade = false;
    this._bestSAMUpgradeUnit = null;
  }

  /**
   * Calculates the cost to build a new SAM or stack an existing one.
   */
  private getSAMCost(player: Player): bigint {
    const baseCost = this.mg.unitInfo(UnitType.SAMLauncher).cost(player);

    if (this._bestSAMIsUpgrade) {
      // Cost to increase stack count (80% of base cost)
      const multiplier = this.mg
        .config()
        .structureUpgradeCostMultiplier(UnitType.SAMLauncher);
      return computeUpgradeStepCost(baseCost, multiplier);
    } else {
      // Cost to build a new SAM (ConstructionExecution handles tech level automatically)
      return baseCost;
    }
  }

  /**
   * Checks if the player can afford the current best SAM option.
   */
  private canAffordSAM(player: Player): boolean {
    if (this._bestSAMScore <= 0) {
      return false; // No valid SAM option yet
    }
    return player.gold() >= this.getSAMCost(player);
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
    } else {
      return this._otherTile;
    }
  }

  /**
   * Clears the tile score for a given structure type and any other scores sharing the same tile.
   */
  private clearTileScoresForTile(tile: TileRef): void {
    if (this._portTile === tile) {
      this._portTileScore = 0;
      this._portTile = null;
    }
    if (this._defensePostTile === tile) {
      this._defensePostTileScore = 0;
      this._defensePostTile = null;
    }
    if (this._otherTile === tile) {
      this._otherTileScore = 0;
      this._otherTile = null;
    }
  }

  /**
   * Calculates the port tile score for a given tile.
   * Returns 0 if port cannot be built, otherwise a score with penalties/bonuses.
   */
  private calculatePortTileScore(player: Player, tile: TileRef): number {
    // Base check: can a port be built here?
    if (player.canBuild(UnitType.Port, tile) === false) {
      return 0;
    }

    let score = 1;

    // Penalty if within avoid player distance from another player
    const avoidPlayerDist = this.avoidPlayerDistanceFor(UnitType.Port);
    if (avoidPlayerDist > 0) {
      const isNearPlayer = this.tileIsNearOtherPlayer(
        player,
        tile,
        avoidPlayerDist,
      );
      if (isNearPlayer) {
        const penalty = this.params.portTileNearPlayerPenalty ?? 0.5;
        score *= 1 - penalty;
      }
    }

    // Penalty if within structure min distance from own structure
    const structureMinDist = this.structureMinDistanceFor(UnitType.Port);
    if (structureMinDist > 0) {
      const nearbyStructures = this.mg.nearbyUnits(
        tile,
        structureMinDist,
        AIConstructionHandler.DISTANCE_CHECK_STRUCTURE_TYPES,
      );
      // Filter to only structures owned by this player
      const ownNearbyStructures = nearbyStructures.filter(
        ({ unit }) => unit.owner().id() === player.id(),
      );
      if (ownNearbyStructures.length > 0) {
        const penalty = this.params.portTileNearStructurePenalty ?? 0.3;
        score *= 1 - penalty;
      }
    }

    // Bonus proportional to distance from capital
    const capital = player.capital();
    if (capital !== null) {
      const capitalTile = this.mg.ref(capital.x, capital.y);
      const dist = Math.sqrt(this.mg.euclideanDistSquared(tile, capitalTile));
      const bonusPerTile = this.params.portTileCapitalDistanceBonus ?? 0.01;
      const maxBonus = this.params.portTileCapitalDistanceBonusMax ?? 0.5;
      const bonus = Math.min(dist * bonusPerTile, maxBonus);
      score *= 1 + bonus;
    }

    // Bonus if tile is protected by SAM
    const sams = player.units(UnitType.SAMLauncher).filter((u) => u.isActive());
    if (sams.length > 0) {
      const techLevel = playerMaxStructureTechLevel(
        player,
        UnitType.SAMLauncher,
      );
      const samRange = this.getEffectiveSAMRange(techLevel);
      const samRangeSquared = samRange * samRange;

      // Count SAMs covering this tile
      let samCoverage = 0;
      for (const sam of sams) {
        if (this.mg.euclideanDistSquared(sam.tile(), tile) <= samRangeSquared) {
          samCoverage++;
        }
      }

      if (samCoverage > 0) {
        const bonusPerSAM = this.params.portTileSAMProtectionBonus ?? 0.2;
        // Diminishing returns for multiple SAMs
        const totalBonus = bonusPerSAM * (1 - Math.pow(0.5, samCoverage));
        score *= 1 + totalBonus;
      }
    }

    return score;
  }

  /**
   * Calculates the other tile score for a given tile (non-port, non-defense post, non-SAM structures).
   * Returns 0 if structure cannot be built, otherwise a score with penalties/bonuses.
   */
  private calculateOtherTileScore(player: Player, tile: TileRef): number {
    // Base check: can a city (proxy for other structures) be built here?
    if (player.canBuild(UnitType.City, tile) === false) {
      return 0;
    }

    let score = 1;

    // Penalty if within avoid player distance from another player
    const avoidPlayerDist = this.avoidPlayerDistanceFor(UnitType.City);
    if (avoidPlayerDist > 0) {
      const isNearPlayer = this.tileIsNearOtherPlayer(
        player,
        tile,
        avoidPlayerDist,
      );
      if (isNearPlayer) {
        const penalty = this.params.otherTileNearPlayerPenalty ?? 0.5;
        score *= 1 - penalty;
      }
    }

    // Penalty if within structure min distance from own structure
    const structureMinDist = this.structureMinDistanceFor(UnitType.City);
    if (structureMinDist > 0) {
      const nearbyStructures = this.mg.nearbyUnits(
        tile,
        structureMinDist,
        AIConstructionHandler.DISTANCE_CHECK_STRUCTURE_TYPES,
      );
      // Filter to only structures owned by this player
      const ownNearbyStructures = nearbyStructures.filter(
        ({ unit }) => unit.owner().id() === player.id(),
      );
      if (ownNearbyStructures.length > 0) {
        const penalty = this.params.otherTileNearStructurePenalty ?? 0.3;
        score *= 1 - penalty;
      }
    }

    // Bonus proportional to distance from capital
    const capital = player.capital();
    if (capital !== null) {
      const capitalTile = this.mg.ref(capital.x, capital.y);
      const dist = Math.sqrt(this.mg.euclideanDistSquared(tile, capitalTile));
      const bonusPerTile = this.params.otherTileCapitalDistanceBonus ?? 0.01;
      const maxBonus = this.params.otherTileCapitalDistanceBonusMax ?? 0.5;
      const bonus = Math.min(dist * bonusPerTile, maxBonus);
      score *= 1 + bonus;
    }

    // Bonus if tile is protected by SAM
    const sams = player.units(UnitType.SAMLauncher).filter((u) => u.isActive());
    if (sams.length > 0) {
      const techLevel = playerMaxStructureTechLevel(
        player,
        UnitType.SAMLauncher,
      );
      const samRange = this.getEffectiveSAMRange(techLevel);
      const samRangeSquared = samRange * samRange;

      // Count SAMs covering this tile
      let samCoverage = 0;
      for (const sam of sams) {
        if (this.mg.euclideanDistSquared(sam.tile(), tile) <= samRangeSquared) {
          samCoverage++;
        }
      }

      if (samCoverage > 0) {
        const bonusPerSAM = this.params.otherTileSAMProtectionBonus ?? 0.2;
        // Diminishing returns for multiple SAMs
        const totalBonus = bonusPerSAM * (1 - Math.pow(0.5, samCoverage));
        score *= 1 + totalBonus;
      }
    }

    // Penalty if water is within X tiles
    const waterCheckDist = this.params.otherTileWaterCheckDistance ?? 5;
    if (waterCheckDist > 0) {
      const hasNearbyWater = this.tileHasNearbyWater(tile, waterCheckDist);
      if (hasNearbyWater) {
        const penalty = this.params.otherTileNearWaterPenalty ?? 0.2;
        score *= 1 - penalty;
      }
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
   * Evaluates a random owned tile and updates the saved scores/tiles for ports, defense posts, and other structures.
   */
  private tickTileEvaluation(player: Player): void {
    const numTiles = player.numTilesOwned();
    if (numTiles === 0) return;

    // Ensure cached tiles are up to date
    if (
      this._cachedTiles === null ||
      this._cachedTilesPlayerTileCount !== numTiles
    ) {
      this._cachedTiles = Array.from(player.tiles());
      this._cachedTilesPlayerTileCount = numTiles;
    }

    if (this._cachedTiles.length === 0) return;

    // Pick a random owned tile
    const tile = this.random.randElement(this._cachedTiles);

    // Calculate port score with penalties and bonuses
    const portScore = this.calculatePortTileScore(player, tile);
    const defensePostScore =
      player.canBuild(UnitType.DefensePost, tile) !== false ? 1 : 0;
    // Calculate other structure score with penalties and bonuses
    const otherScore = this.calculateOtherTileScore(player, tile);

    // Update port tile if this score is strictly greater
    if (portScore > this._portTileScore) {
      this._portTileScore = portScore;
      this._portTile = tile;
    }

    // Update defense post tile if this score is strictly greater
    if (defensePostScore > this._defensePostTileScore) {
      this._defensePostTileScore = defensePostScore;
      this._defensePostTile = tile;
    }

    // Update other structures tile if this score is strictly greater
    if (otherScore > this._otherTileScore) {
      this._otherTileScore = otherScore;
      this._otherTile = tile;
    }
  }

  /**
   * Attempts to build or upgrade a SAM using the pre-evaluated best option.
   * Returns "success" if construction/upgrade was initiated,
   * "blocked" if there's a permanent failure (should block SAM),
   * "retry" if there's a temporary failure (should try again later).
   */
  private trySAMConstruction(player: Player): "success" | "blocked" | "retry" {
    const isRussia = player.name() === "Russia";

    // No evaluation data available - this is a permanent failure until re-evaluation finds something
    if (this._bestSAMScore <= 0) {
      if (isRussia) console.log(`[AI SAM] Russia trySAM: no score`);
      return "blocked";
    }

    if (this._bestSAMIsUpgrade && this._bestSAMUpgradeUnit) {
      // Stacking an existing SAM (increase stack count)
      const samToStack = this._bestSAMUpgradeUnit;

      // Verify the SAM still exists and is active
      if (!samToStack.isActive()) {
        if (isRussia)
          console.log(`[AI SAM] Russia trySAM stack: SAM not active`);
        this.resetSAMEvaluationState();
        return "retry"; // SAM was destroyed, need to re-evaluate
      }

      // Check if the SAM can still be stacked
      const currentStack = samToStack.stackCount?.() ?? 1;
      const maxStack = maxStackCount(UnitType.SAMLauncher);
      if (currentStack >= maxStack) {
        if (isRussia)
          console.log(`[AI SAM] Russia trySAM stack: already at max stack`);
        this.resetSAMEvaluationState();
        return "retry"; // Need to re-evaluate
      }

      if (isRussia)
        console.log(
          `[AI SAM] Russia trySAM stack: SUCCESS (stack ${currentStack}→${currentStack + 1})`,
        );
      this.mg.addExecution(new UpgradeStructureExecution(player, samToStack));
      this.resetSAMEvaluationState();
      return "success";
    } else if (this._bestSAMTile) {
      // Building a new SAM
      const tile = this._bestSAMTile;

      // Verify the tile is still owned by this player
      if (!this.mg.hasOwner(tile) || this.mg.owner(tile).id() !== player.id()) {
        if (isRussia) console.log(`[AI SAM] Russia trySAM new: tile not owned`);
        this.resetSAMEvaluationState();
        return "retry"; // Tile lost, need to re-evaluate
      }

      // Verify the tile can have a structure built on it
      if (!player.canBuild(UnitType.SAMLauncher, tile)) {
        if (isRussia) console.log(`[AI SAM] Russia trySAM new: canBuild=false`);
        this.resetSAMEvaluationState();
        return "retry"; // Something blocking, need to re-evaluate
      }

      if (isRussia) console.log(`[AI SAM] Russia trySAM new: SUCCESS`);

      // Build the SAM - ConstructionExecution automatically builds at player's max researched level
      this.mg.addExecution(
        new ConstructionExecution(player, UnitType.SAMLauncher, tile),
      );

      this.resetSAMEvaluationState();
      return "success";
    }

    if (isRussia) console.log(`[AI SAM] Russia trySAM: no tile or stack unit`);
    return "blocked"; // No valid option stored
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
    const unitType = structure.type();
    const baseCost = Number(this.mg.unitInfo(unitType).cost(player));
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
      const structures = player
        .units(structureType)
        .filter((u) => u.isActive());

      for (const structure of structures) {
        const structureTile = structure.tile();

        // Check if this structure would be covered by a SAM at the given tile
        if (this.mg.euclideanDistSquared(tile, structureTile) > rangeSquared) {
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
        const weight = 1 / (1 + existingCoverage);
        score += structureValue * weight;
      }
    }

    return score;
  }

  /**
   * Periodically evaluates SAM placement candidates.
   * Called every SAM_EVALUATION_INTERVAL ticks.
   */
  private tickSAMEvaluation(player: Player): void {
    // Ensure cached tiles are up to date
    const numTiles = player.numTilesOwned();
    if (numTiles === 0) return;

    if (
      this._cachedTiles === null ||
      this._cachedTilesPlayerTileCount !== numTiles
    ) {
      this._cachedTiles = Array.from(player.tiles());
      this._cachedTilesPlayerTileCount = numTiles;
    }

    if (this._cachedTiles.length === 0) return;

    // Get current SAMs and tech level info
    const sams = player.units(UnitType.SAMLauncher).filter((u) => u.isActive());
    // All SAMs have the same tech level (based on player's research)
    const techLevel = playerMaxStructureTechLevel(player, UnitType.SAMLauncher);
    const samRange = this.getEffectiveSAMRange(techLevel);
    const samRangeSquared = samRange * samRange;

    // Build list of evaluation options:
    // 1. Build a new SAM at a random tile
    // 2. Increase stack count on an existing SAM (if any exist and aren't maxed)
    type EvalOption = { type: "new" } | { type: "stack"; sam: Unit };

    const options: EvalOption[] = [];

    // Always can evaluate building a new SAM
    options.push({ type: "new" });

    // Can evaluate stacking if there's an existing SAM that isn't at max stack
    if (sams.length > 0) {
      const samToConsider = this.random.randElement(sams);
      const currentStack = samToConsider.stackCount?.() ?? 1;
      const maxStack = maxStackCount(UnitType.SAMLauncher);
      if (currentStack < maxStack) {
        options.push({ type: "stack", sam: samToConsider });
      }
    }

    // Randomly pick one option to evaluate this tick
    const choice = this.random.randElement(options);
    const isRussia = player.name() === "Russia";

    if (choice.type === "new") {
      // Evaluate placing a new SAM at a random tile
      const tile = this.findSAMEvaluationTile(player);
      if (tile === null) return;

      const score = this.evaluateSAMPlacementScore(
        player,
        tile,
        sams,
        samRangeSquared,
      );

      if (isRussia) {
        console.log(
          `[AI SAM] Russia new SAM eval: score=${score.toFixed(2)}, best=${this._bestSAMScore.toFixed(2)}`,
        );
      }

      if (score > this._bestSAMScore) {
        this._bestSAMScore = score;
        this._bestSAMTile = tile;
        this._bestSAMIsUpgrade = false;
        this._bestSAMUpgradeUnit = null;
      }
    } else {
      // Evaluate increasing stack count on an existing SAM
      const samToStack = choice.sam;

      // Score is the same as the SAM's current coverage (no exclusion needed)
      // since stacking just adds HP, doesn't change range
      const score = this.evaluateSAMPlacementScore(
        player,
        samToStack.tile(),
        sams,
        samRangeSquared,
      );

      // Divide by 0.8 since stacking is cheaper (80% of base cost)
      const adjustedScore = score / 0.8;

      if (isRussia) {
        console.log(
          `[AI SAM] Russia stack SAM eval: score=${score.toFixed(2)}, adjusted=${adjustedScore.toFixed(2)}, best=${this._bestSAMScore.toFixed(2)}`,
        );
      }

      if (adjustedScore > this._bestSAMScore) {
        this._bestSAMScore = adjustedScore;
        this._bestSAMTile = samToStack.tile();
        this._bestSAMIsUpgrade = true;
        this._bestSAMUpgradeUnit = samToStack;
      }
    }
  }

  /**
   * Finds a random owned tile suitable for SAM evaluation.
   * Must be at least SAM_PLACEMENT_MIN_PLAYER_DIST tiles away from other players.
   */
  private findSAMEvaluationTile(player: Player): TileRef | null {
    if (!this._cachedTiles || this._cachedTiles.length === 0) return null;

    // Try up to 10 random tiles to find one that passes the distance check
    for (let i = 0; i < 10; i++) {
      const tile = this.random.randElement(this._cachedTiles);

      // Check if tile is far enough from other players (use sampled for quick eval)
      if (
        !this.tileIsNearOtherPlayer(
          player,
          tile,
          AIConstructionHandler.SAM_PLACEMENT_MIN_PLAYER_DIST,
        )
      ) {
        return tile;
      }
    }

    return null;
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
    const cost = this.mg.unitInfo(unitType).cost(player);
    return player.gold() >= cost;
  }

  private structureMinDistanceFor(unitType: UnitType): number {
    if (unitType === UnitType.DefensePost) return 0;
    return Math.max(0, Math.floor(this.params.aiStructureMinDistance ?? 25)); // Reduced from 40
  }

  private avoidPlayerDistanceFor(unitType: UnitType): number {
    if (unitType === UnitType.DefensePost) return 0;
    return Math.max(0, Math.floor(this.params.aiAvoidPlayerDistance ?? 8)); // Reduced from 10
  }

  /**
   * Checks if there is another player's territory within the given radius.
   * Exhaustively checks all tiles within the radius.
   */
  private tileIsNearOtherPlayer(
    player: Player,
    center: TileRef,
    radius: number,
  ): boolean {
    if (radius <= 0) return false;

    const radiusSq = radius * radius;
    const cx = this.mg.x(center);
    const cy = this.mg.y(center);

    // Check all tiles within the radius
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radiusSq) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.mg.isValidCoord(x, y)) continue;
        const t = this.mg.ref(x, y);
        if (!this.mg.hasOwner(t)) continue;
        const owner = this.mg.owner(t);
        if (!owner.isPlayer?.() || !owner.isPlayer()) continue;
        if (owner.id() !== player.id()) return true;
      }
    }

    return false;
  }

  /**
   * Re-validates a tile at build time to ensure it still passes placement rules.
   * This catches any changes since the tile was originally evaluated.
   */
  private validateTileForConstruction(
    player: Player,
    tile: TileRef,
    unitType: UnitType,
  ): boolean {
    // Defense posts have no special validation rules
    if (unitType === UnitType.DefensePost) {
      return true;
    }

    // Check if still buildable
    if (player.canBuild(unitType, tile) === false) {
      return false;
    }

    // Check near-player distance
    const avoidPlayerDist = this.avoidPlayerDistanceFor(unitType);
    if (avoidPlayerDist > 0) {
      if (this.tileIsNearOtherPlayer(player, tile, avoidPlayerDist)) {
        return false;
      }
    }

    // Check structure min distance
    const structureMinDist = this.structureMinDistanceFor(unitType);
    if (structureMinDist > 0) {
      const nearbyStructures = this.mg.nearbyUnits(
        tile,
        structureMinDist,
        AIConstructionHandler.DISTANCE_CHECK_STRUCTURE_TYPES,
      );
      const ownNearbyStructures = nearbyStructures.filter(
        ({ unit }) => unit.owner().id() === player.id(),
      );
      if (ownNearbyStructures.length > 0) {
        return false;
      }
    }

    // For non-port structures, check water proximity
    if (unitType !== UnitType.Port) {
      const waterCheckDist = this.params.otherTileWaterCheckDistance ?? 5;
      if (waterCheckDist > 0) {
        if (this.tileHasNearbyWater(tile, waterCheckDist)) {
          return false;
        }
      }
    }

    return true;
  }
}
