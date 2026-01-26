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
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  isStackableStructure,
  playerMaxStructureLevel,
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

  // Cooldown after completely failing placement
  private _placementCooldownUntil: number = 0;
  private static readonly PLACEMENT_COOLDOWN_TICKS = 50;
  private static readonly MAX_PLACEMENT_ATTEMPTS = 50;

  private static readonly AVOID_HUMAN_AI_SAMPLE_COUNT = 12; // Reduced from 30
  private static readonly AVOID_HUMAN_AI_RING_POINTS = 8; // Reduced from 12

  private static readonly PORT_SCORE_MULTIPLIER = 0.5;

  private static readonly NON_DEFENSE_STRUCTURE_TYPES: UnitType[] =
    Object.values(UnitType).filter(
      (t) => isStructureType(t) && t !== UnitType.DefensePost,
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

    // Periodically re-score and potentially retarget.
    // Only switches if there's a strictly better target than the current.
    if (shouldRecalculate) {
      this.recalculateTarget(player);
    }

    if (this.target === null) {
      this.target = this.pickTarget(null, player);
      return;
    }

    // Only attempt placement if we can afford the target structure
    if (!this.canAffordTarget(player, this.target)) {
      return;
    }

    // Skip placement attempts during cooldown period
    if (ticks < this._placementCooldownUntil) {
      return;
    }

    const structureMinDist = this.structureMinDistanceFor(this.target);
    const avoidHumanAiDist = this.avoidHumanAiDistanceFor(this.target);
    const avoidHumanAiSampleCount =
      AIConstructionHandler.AVOID_HUMAN_AI_SAMPLE_COUNT;
    const avoidHumanAiRingPoints =
      AIConstructionHandler.AVOID_HUMAN_AI_RING_POINTS;

    const placement = this.findPlacement(player, this.target, 200, {
      structureMinDist,
      avoidHumanAiDist,
      avoidHumanAiSampleCount,
      avoidHumanAiRingPoints,
    });
    if (placement !== null) {
      // Recalculate right before building to ensure target is still optimal
      this.recalculateTarget(player);
      if (this.target === null || !this.canAffordTarget(player, this.target)) {
        return;
      }
      this.mg.addExecution(
        new ConstructionExecution(player, this.target, placement),
      );
      this.target = null;
      return;
    }

    // If we can't find a valid placement tile, prefer upgrading an existing
    // stackable structure of this type (if any) instead of switching targets.
    if (this.tryUpgradeExistingStructure(player, this.target)) {
      this.target = null;
      return;
    }

    // Fallback: try again with relaxed rules (no structure min dist, smaller player avoidance)
    const relaxedPlacement = this.findPlacement(player, this.target, 200, {
      structureMinDist: 0,
      avoidHumanAiDist: 5,
      avoidHumanAiSampleCount,
      avoidHumanAiRingPoints,
    });
    if (relaxedPlacement !== null) {
      this.mg.addExecution(
        new ConstructionExecution(player, this.target, relaxedPlacement),
      );
      this.target = null;
      return;
    }

    // Failed to place even with relaxed rules - give up for a while
    console.log(
      `[AIConstruction] ${player.displayName()} failed to place ${this.target} even with relaxed rules, cooling down`,
    );
    this._placementCooldownUntil =
      ticks + AIConstructionHandler.PLACEMENT_COOLDOWN_TICKS;

    // Pick a different target (re-score)
    const original = this.target;
    const next = this.pickTarget(original, player);
    this.target = next;
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
    if (this.params.buildMissileSilos ?? false)
      candidates.push(UnitType.MissileSilo);
    if (this.params.buildSAMLaunchers ?? false)
      candidates.push(UnitType.SAMLauncher);
    if (this.params.buildDefensePosts ?? false)
      candidates.push(UnitType.DefensePost);
    if (this.params.buildDoomsdayDevices ?? false)
      candidates.push(UnitType.DoomsdayDevice);
    return candidates;
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
    }

    // For other structures, base score remains 0 (uses weight only)
    return baseScore * weight;
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
    const k = player.effectiveUnits(UnitType.Factory);
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
    const k = player.effectiveUnits(UnitType.Factory);
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
    const portCount = player.effectiveUnits(UnitType.Port);

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

    // Base score = multiplier * (1 + queueRatio) * (1 - availableRatio) * tradeIncomeMods
    return (
      AIConstructionHandler.PORT_SCORE_MULTIPLIER *
      (1 + metrics.queueRatio) *
      (1 - metrics.availableRatio) *
      tradeIncomeMul
    );
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

  private avoidHumanAiDistanceFor(unitType: UnitType): number {
    if (unitType === UnitType.DefensePost) return 0;
    return Math.max(0, Math.floor(this.params.aiAvoidHumanAiDistance ?? 8)); // Reduced from 10
  }

  private tileIsNearHumanOrAi(
    player: Player,
    center: TileRef,
    radius: number,
    sampleCount: number,
    ringPoints: number,
  ): boolean {
    if (radius <= 0) return false;

    const minSq = radius * radius;
    const cx = this.mg.x(center);
    const cy = this.mg.y(center);

    const isHumanOrAiOwner = (tile: TileRef): boolean => {
      if (!this.mg.hasOwner(tile)) return false;
      const owner = this.mg.owner(tile);
      if (!owner.isPlayer?.() || !owner.isPlayer()) return false;
      if (owner.id() === player.id()) return false;
      return (
        owner.type() === PlayerType.Human || owner.type() === PlayerType.AI
      );
    };

    // A few deterministic ring points at exactly radius.
    if (ringPoints > 0) {
      const seen = new Set<string>();
      for (let i = 0; i < ringPoints; i++) {
        const theta = (2 * Math.PI * i) / ringPoints;
        const dx = Math.round(radius * Math.cos(theta));
        const dy = Math.round(radius * Math.sin(theta));
        if (dx === 0 && dy === 0) continue;
        const key = `${dx},${dy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const x = cx + dx;
        const y = cy + dy;
        if (!this.mg.isValidCoord(x, y)) continue;
        const t = this.mg.ref(x, y);
        if (isHumanOrAiOwner(t)) return true;
      }
    }

    // Random samples within the radius disk.
    for (let i = 0; i < sampleCount; i++) {
      let dx = 0;
      let dy = 0;
      // Rejection sample inside circle; cap retries to avoid worst-case loops.
      for (let tries = 0; tries < 6; tries++) {
        dx = this.random.nextInt(-radius, radius + 1);
        dy = this.random.nextInt(-radius, radius + 1);
        if (dx * dx + dy * dy <= minSq) break;
      }

      if (dx * dx + dy * dy > minSq) {
        continue;
      }

      const x = cx + dx;
      const y = cy + dy;
      if (!this.mg.isValidCoord(x, y)) continue;
      const t = this.mg.ref(x, y);
      if (isHumanOrAiOwner(t)) return true;
    }

    return false;
  }

  private passesAiPlacementRules(
    player: Player,
    spawnTile: TileRef,
    unitType: UnitType,
    rules: {
      structureMinDist: number;
      avoidHumanAiDist: number;
      avoidHumanAiSampleCount: number;
      avoidHumanAiRingPoints: number;
    },
  ): boolean {
    if (unitType === UnitType.DefensePost) {
      return true;
    }

    const {
      structureMinDist,
      avoidHumanAiDist,
      avoidHumanAiSampleCount,
      avoidHumanAiRingPoints,
    } = rules;

    if (structureMinDist > 0) {
      const near = this.mg.nearbyUnits(
        spawnTile,
        structureMinDist,
        AIConstructionHandler.NON_DEFENSE_STRUCTURE_TYPES,
      );
      // Any nearby non-defense structure blocks placement.
      if (near.length > 0) {
        return false;
      }
    }

    if (avoidHumanAiDist > 0) {
      // Local sampling around the candidate tile: reject if we detect nearby
      // Human/AI territory within the avoidance radius.
      if (
        this.tileIsNearHumanOrAi(
          player,
          spawnTile,
          avoidHumanAiDist,
          avoidHumanAiSampleCount,
          avoidHumanAiRingPoints,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  private unitLevelLike(u: Unit): number {
    const stack = u.stackCount?.() ?? 1;
    const lvl = u.level?.() ?? 1;
    return Math.max(stack, lvl);
  }

  private tryUpgradeExistingStructure(
    player: Player,
    unitType: UnitType,
  ): boolean {
    if (unitType === UnitType.DefensePost) {
      return false;
    }
    if (!isStackableStructure(unitType)) {
      return false;
    }

    const owned = player.units(unitType).filter((u) => u.isActive());
    if (owned.length === 0) {
      return false;
    }

    // Determine if we can afford at least one upgrade step.
    const baseCost = this.mg.unitInfo(unitType).cost(player);
    const multiplier = this.mg
      .config()
      .structureUpgradeCostMultiplier(unitType);
    const upgradeCost = computeUpgradeStepCost(baseCost, multiplier);
    if (player.gold() < upgradeCost) {
      return false;
    }

    const maxLevel = playerMaxStructureLevel(player, unitType);
    const upgradeable = owned.filter((u) => this.unitLevelLike(u) < maxLevel);
    if (upgradeable.length === 0) {
      return false;
    }

    const strategy = this.params.aiStackUpgradeStrategy ?? "lowest";

    const selected =
      strategy === "weighted"
        ? this.weightedRandomUnit(upgradeable)
        : this.lowestLevelUnit(upgradeable);

    if (!selected) {
      return false;
    }

    this.mg.addExecution(new UpgradeStructureExecution(player, selected));
    return true;
  }

  private lowestLevelUnit(units: Unit[]): Unit | null {
    let minLevel = Infinity;
    let best: Unit[] = [];
    for (const u of units) {
      const lvl = this.unitLevelLike(u);
      if (lvl < minLevel) {
        minLevel = lvl;
        best = [u];
      } else if (lvl === minLevel) {
        best.push(u);
      }
    }
    if (best.length === 0) return null;
    return this.random.randElement(best);
  }

  private weightedRandomUnit(units: Unit[]): Unit | null {
    let total = 0;
    const weights: number[] = [];
    for (const u of units) {
      const w = Math.max(1, this.unitLevelLike(u));
      weights.push(w);
      total += w;
    }
    if (total <= 0) return null;
    // nextInt upper bound is exclusive
    let r = this.random.nextInt(0, total);
    for (let i = 0; i < units.length; i++) {
      r -= weights[i];
      if (r < 0) {
        return units[i];
      }
    }
    return units[units.length - 1] ?? null;
  }

  private findPlacement(
    player: Player,
    unitType: UnitType,
    _maxAttempts: number,
    rules: {
      structureMinDist: number;
      avoidHumanAiDist: number;
      avoidHumanAiSampleCount: number;
      avoidHumanAiRingPoints: number;
    },
  ): TileRef | null {
    // Use cached tile array if player's tile count hasn't changed
    const currentTileCount = player.numTilesOwned();
    if (
      this._cachedTiles === null ||
      this._cachedTilesPlayerTileCount !== currentTileCount
    ) {
      this._cachedTiles = Array.from(player.tiles());
      this._cachedTilesPlayerTileCount = currentTileCount;
    }

    const ownedTiles = this._cachedTiles;
    if (ownedTiles.length === 0) {
      return null;
    }

    for (let i = 0; i < AIConstructionHandler.MAX_PLACEMENT_ATTEMPTS; i++) {
      const tile = this.random.randElement(ownedTiles);
      const spawnTile = player.canBuild(unitType, tile);
      if (spawnTile === false) {
        continue;
      }
      if (!this.passesAiPlacementRules(player, spawnTile, unitType, rules)) {
        continue;
      }
      return spawnTile;
    }

    return null;
  }
}
