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
import { AIBehaviorParams } from "./AIBehaviorParams";

/**
 * Handles structure construction for AI players.
 * Builds cities, factories, and ports based on density parameters.
 */
export class AIConstructionHandler {
  private target: UnitType | null = null;

  private static readonly AVOID_HUMAN_AI_SAMPLE_COUNT = 30;
  private static readonly AVOID_HUMAN_AI_RING_POINTS = 12;

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

    // Failed to place after N attempts: pick a different target (re-score)
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

  private scoreTarget(_player: Player, _unitType: UnitType): number {
    // Placeholder: all structures have equal score for now.
    return 0;
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
    return Math.max(0, Math.floor(this.params.aiStructureMinDistance ?? 40));
  }

  private avoidHumanAiDistanceFor(unitType: UnitType): number {
    if (unitType === UnitType.DefensePost) return 0;
    return Math.max(0, Math.floor(this.params.aiAvoidHumanAiDistance ?? 10));
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
    maxAttempts: number,
    rules: {
      structureMinDist: number;
      avoidHumanAiDist: number;
      avoidHumanAiSampleCount: number;
      avoidHumanAiRingPoints: number;
    },
  ): TileRef | null {
    const ownedTiles = Array.from(player.tiles());
    if (ownedTiles.length === 0) {
      return null;
    }

    for (let i = 0; i < maxAttempts; i++) {
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
