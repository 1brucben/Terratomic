import { ConstructionExecution } from "../execution/ConstructionExecution";
import { NukeExecution } from "../execution/NukeExecution";
import { UpgradeStructureExecution } from "../execution/UpgradeStructureExecution";
import {
  Execution,
  Game,
  Nation,
  Player,
  Unit,
  UnitType,
  UpgradeType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { NukeType } from "../StatsSchemas";
import { simpleHash } from "../Util";
import { AIAttackHandler } from "./AIAttackHandler";
import { AIBehaviorParams } from "./AIBehaviorParams";
import { AIBotAttackHandler } from "./AIBotAttackHandler";
import { AIConstructionHandler } from "./AIConstructionHandler";
import { AIDiplomacyHandler } from "./AIDiplomacyHandler";
import { AINukeEvaluator } from "./AINukeEvaluator";
import { AINukeHandler } from "./AINukeHandler";
import { AISpawnHandler } from "./AISpawnHandler";
import { AITerraNulliusHandler } from "./AITerraNulliusHandler";

/**
 * Phases for the nuke launch state machine.
 *
 * idle          – no nuke sequence active; normal construction runs.
 * waitForFunds  – nuke score beat construction; waiting until we can afford
 *                 all bombs + any silos we need to build.
 * buildSilo     – building / upgrading silo; waiting for it to complete.
 * launchSAMs    – launching one atom bomb per tick at each SAM level in range.
 * waitForMain   – 30-tick gap between last SAM bomb and main bomb.
 * launchMain    – fire the main bomb.
 */
type NukeSequencePhase =
  | "idle"
  | "waitForFunds"
  | "buildSilo"
  | "launchSAMs"
  | "waitForMain"
  | "launchMain";

/**
 * Mutable state for an in-progress nuke sequence.
 */
interface NukeSequenceState {
  phase: NukeSequencePhase;
  /** The bomb type to use for the main strike. */
  bombType: NukeType;
  /** Target tile for the main bomb. */
  targetTile: TileRef;
  /** SAM units in range of the target, with one atom bomb per stack level. */
  samTargets: { sam: Unit; levelsRemaining: number }[];
  /** Tick when we entered waitForMain phase. */
  waitStartTick: number;
}

/**
 * AI Player Execution - A configurable AI player with behavior parameters.
 */
export class AIPlayerExecution implements Execution {
  private active = true;
  private mg: Game;
  private player: Player | undefined;
  private random: PseudoRandom;
  private phaseSeed: number;
  private spawnHandler: AISpawnHandler | null = null;
  private terraNulliusHandler: AITerraNulliusHandler | null = null;
  private botAttackHandler: AIBotAttackHandler | null = null;
  private attackHandler: AIAttackHandler | null = null;
  private constructionHandler: AIConstructionHandler | null = null;
  private diplomacyHandler: AIDiplomacyHandler | null = null;
  private nukeEvaluator: AINukeEvaluator | null = null;
  private nukeHandler: AINukeHandler | null = null;
  private initialInvestmentSet = false;
  private roadInvestmentSet = false;

  // Nuke launch state machine
  private nukeState: NukeSequenceState | null = null;
  private static readonly MAIN_BOMB_DELAY_TICKS = 30;
  /** How often (in ticks) to check for redundant nukes during an active sequence. */
  private static readonly NUKE_REDUNDANCY_CHECK_INTERVAL = 10;

  /** Internal multiplier applied to nuke scores when comparing against construction scores. */
  private static readonly NUKE_SCORE_INTERNAL_MULTIPLIER = 300;

  constructor(
    private gameID: GameID,
    private nation: Nation,
    private params: AIBehaviorParams = {},
  ) {
    this.random = new PseudoRandom(
      simpleHash(nation.playerInfo.id) + simpleHash(gameID),
    );
    // Stagger periodic actions across AIs.
    // For any period P, use (phaseSeed % P) as the per-AI offset.
    this.phaseSeed = this.random.nextInt(0, 0x7fffffff);
  }

  private periodicOffset(period: number): number {
    const p = Math.max(1, Math.floor(period));
    return this.phaseSeed % p;
  }

  private shouldRunPeriodic(ticks: number, period: number): boolean {
    const p = Math.max(1, Math.floor(period));
    return ticks % p === this.periodicOffset(p);
  }

  init(mg: Game): void {
    this.mg = mg;
    // Calculate threshold offset once and share between attack handlers
    // Random offset in range [-0.025, 0.025] for threshold variation
    const thresholdOffset = (this.random.next() - 0.5) * 0.05;

    this.spawnHandler = new AISpawnHandler(
      mg,
      this.nation,
      this.random,
      this.params,
    );
    this.terraNulliusHandler = new AITerraNulliusHandler(
      mg,
      this.nation.playerInfo.id,
      this.random,
      this.params,
      thresholdOffset,
    );
    this.botAttackHandler = new AIBotAttackHandler(
      mg,
      this.nation.playerInfo.id,
      this.random,
      this.params,
      thresholdOffset,
    );
    this.attackHandler = new AIAttackHandler(
      mg,
      this.nation.playerInfo.id,
      this.random,
      this.params,
      thresholdOffset,
    );
    this.constructionHandler = new AIConstructionHandler(
      mg,
      this.nation.playerInfo.id,
      this.random,
      this.params,
      AINukeEvaluator.getInstance(this.gameID, mg),
    );
    this.diplomacyHandler = new AIDiplomacyHandler(
      mg,
      this.nation.playerInfo.id,
      this.random,
      this.params,
    );
    this.nukeEvaluator = AINukeEvaluator.getInstance(this.gameID, mg);
    this.nukeHandler = new AINukeHandler(
      mg,
      this.nation.playerInfo.id,
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

    // Find player if not found yet
    this.player ??= this.mg
      .players()
      .find((p) => p.id() === this.nation.playerInfo.id);

    if (!this.player || !this.player.isAlive()) {
      this.active = false;
      return;
    }

    const sliderPeriod = 100;
    const constructionRescorePeriod = 100;

    // --- Nuke orchestration ---
    this.tickNukeSequence(ticks);

    // Construction runs every tick (targeted planning + placement attempts)
    this.constructionHandler?.tickConstruction(
      ticks,
      this.shouldRunPeriodic(ticks, constructionRescorePeriod),
    );

    // Handle slider updates every 100 ticks
    if (this.shouldRunPeriodic(ticks, sliderPeriod)) {
      this.updateSliders(ticks);
    }

    // Handle Terra Nullius expansion every tick
    const tnAttacked =
      this.terraNulliusHandler?.handleTerraNulliusAttack() ?? false;

    // Handle bot attacks every tick (skip if TN already attacked)
    let botAttacked = false;
    if (!tnAttacked) {
      botAttacked = this.botAttackHandler?.handleBotAttack() ?? false;
    }

    // Handle attacks against AI/Human players we're at war with (skip if already attacked)
    if (!tnAttacked && !botAttacked) {
      this.attackHandler?.handleAttack();
    }

    // Handle diplomacy (war declarations, etc.)
    this.diplomacyHandler?.tickDiplomacy(ticks);

    // Update shared nuke target evaluation
    this.nukeEvaluator?.tick(this.random, ticks);

    // Update per-player nuke target evaluation
    this.nukeHandler?.tick(ticks);
  }

  // ---------------------------------------------------------------------------
  // Nuke launch state machine
  // ---------------------------------------------------------------------------

  /**
   * Drives the nuke sequence each tick. Transitions:
   *
   * idle → waitForFunds  (when nuke score > all construction scores)
   * waitForFunds → buildSilo (when player can afford everything)
   * buildSilo → launchSAMs  (when silo capacity is sufficient)
   * launchSAMs → waitForMain (when all SAM-targeting atom bombs launched)
   * waitForMain → launchMain (after 30 ticks)
   * launchMain → idle        (after main bomb launched)
   */
  private tickNukeSequence(ticks: number): void {
    if (!this.player || !this.nukeHandler || !this.constructionHandler) return;

    // If no active sequence, check whether to start one
    if (this.nukeState === null || this.nukeState.phase === "idle") {
      this.maybeStartNukeSequence();
      return;
    }

    const state = this.nukeState;

    // Periodically check whether another nuke is already heading into the
    // blast radius of our target.  If so, abort to avoid wasting resources.
    if (
      this.shouldRunPeriodic(
        ticks,
        AIPlayerExecution.NUKE_REDUNDANCY_CHECK_INTERVAL,
      ) &&
      this.isNukeAlreadyInbound(state)
    ) {
      this.resetNukeSequence();
      return;
    }

    switch (state.phase) {
      case "waitForFunds":
        this.tickWaitForFunds();
        break;
      case "buildSilo":
        this.tickBuildSilo();
        break;
      case "launchSAMs":
        this.tickLaunchSAMs();
        break;
      case "waitForMain":
        this.tickWaitForMain(ticks);
        break;
      case "launchMain":
        this.tickLaunchMain();
        break;
    }
  }

  /**
   * Check whether to begin a nuke sequence: the best nuke score must exceed
   * every construction score.
   */
  private maybeStartNukeSequence(): void {
    if (!this.player || !this.nukeHandler || !this.constructionHandler) return;

    // Determine best nuke target
    const atomTarget = this.nukeHandler.bestAtomTarget();
    let bestScore = atomTarget?.score ?? 0;
    let bestTile = atomTarget?.tile ?? null;
    let bombType: UnitType = UnitType.AtomBomb;

    // Consider hydrogen bomb only if researched
    if (this.player.hasUpgrade(UpgradeType.ThermonuclearStaging)) {
      const hydrogenTarget = this.nukeHandler.bestHydrogenTarget();
      if (hydrogenTarget && hydrogenTarget.score > bestScore) {
        bestScore = hydrogenTarget.score;
        bestTile = hydrogenTarget.tile;
        bombType = UnitType.HydrogenBomb;
      }
    }

    if (bestScore <= 0 || bestTile === null) return;

    // Apply multipliers
    const profileMultiplier = this.params.nukeScoreMultiplier ?? 1;
    bestScore *=
      profileMultiplier * AIPlayerExecution.NUKE_SCORE_INTERNAL_MULTIPLIER;

    // Compare against best construction score
    const constructionScore = this.constructionHandler.bestConstructionScore();
    if (bestScore <= constructionScore) return;

    // Start the nuke sequence — pause construction
    const sams = this.nukeHandler.getSAMsInRange(bestTile);
    this.nukeState = {
      phase: "waitForFunds",
      bombType,
      targetTile: bestTile,
      samTargets: sams.map((s) => ({
        sam: s,
        levelsRemaining: s.stackCount(),
      })),
      waitStartTick: 0,
    };
    this.constructionHandler.setPaused(true);
  }

  /**
   * Wait until the player can afford all bombs + any silos needed.
   */
  private tickWaitForFunds(): void {
    if (!this.player || !this.nukeState || !this.nukeHandler) return;
    const state = this.nukeState;

    const totalCost = this.calculateNukeSequenceCost(state);
    if (this.player.gold() < BigInt(Math.ceil(totalCost))) return;

    // Player can afford it — check silo capacity
    const bombsNeeded = this.nukeHandler.bombsNeeded(state.targetTile);
    const siloCapacity = this.nukeHandler.getPlayerSiloCapacity();

    if (siloCapacity >= bombsNeeded) {
      // Silo capacity already sufficient — skip straight to launching
      state.phase = "launchSAMs";
    } else {
      // Need to build/upgrade silo
      state.phase = "buildSilo";
    }
  }

  /**
   * Build or upgrade a missile silo to the required capacity.
   */
  private tickBuildSilo(): void {
    if (
      !this.player ||
      !this.nukeState ||
      !this.nukeHandler ||
      !this.constructionHandler
    )
      return;
    const state = this.nukeState;

    const bombsNeeded = this.nukeHandler.bombsNeeded(state.targetTile);
    const siloCapacity = this.nukeHandler.getPlayerSiloCapacity();

    if (siloCapacity >= bombsNeeded) {
      // Silo is ready — move to launching
      state.phase = "launchSAMs";
      return;
    }

    // Find the player's largest existing silo
    let largestSilo: Unit | null = null;
    let largestStack = 0;
    for (const silo of this.mg.units(UnitType.MissileSilo)) {
      if (!silo.isActive()) continue;
      if (silo.owner().id() !== this.player.id()) continue;
      if (silo.stackCount() > largestStack) {
        largestStack = silo.stackCount();
        largestSilo = silo;
      }
    }

    if (largestSilo !== null) {
      // Upgrade the existing largest silo
      this.mg.addExecution(
        new UpgradeStructureExecution(this.player, largestSilo),
      );
    } else {
      // No silo exists — build a new one at the construction handler's other tile
      const tile = this.constructionHandler.consumeOtherTile();
      if (tile === null) {
        // No tile available yet — wait for tile evaluation to find one
        return;
      }
      const spawnTile = this.player.canBuild(UnitType.MissileSilo, tile);
      if (spawnTile === false) {
        // Can't build here — abort the sequence
        this.resetNukeSequence();
        return;
      }
      // Build a silo at the level needed
      this.mg.addExecution(
        new ConstructionExecution(
          this.player,
          UnitType.MissileSilo,
          spawnTile,
          bombsNeeded,
        ),
      );
    }
    // Stay in buildSilo phase; next tick will re-check capacity
  }

  /**
   * Launch one atom bomb per tick targeting SAMs in range of the nuke target.
   * Each SAM gets one atom bomb per stack level.
   */
  private tickLaunchSAMs(): void {
    if (!this.player || !this.nukeState || !this.nukeHandler) return;
    const state = this.nukeState;

    // Final score check before the first launch of the sequence
    if (
      state.samTargets.every((s) => s.levelsRemaining === s.sam.stackCount())
    ) {
      const freshScore = this.nukeHandler.scoreForTile(
        state.targetTile,
        state.bombType,
      );
      if (freshScore <= 0) {
        this.resetNukeSequence();
        return;
      }
    }

    // Find next SAM that still needs atom bombs
    const nextSam = state.samTargets.find((s) => s.levelsRemaining > 0);
    if (!nextSam) {
      // All SAM-targeting bombs launched (or there were none)
      // If there were no SAMs at all, go directly to launchMain
      const hadSAMs = state.samTargets.length > 0;
      if (!hadSAMs) {
        state.phase = "launchMain";
      } else {
        state.phase = "waitForMain";
        state.waitStartTick = this.mg.ticks();
      }
      return;
    }

    // Check if we can afford an atom bomb
    const atomCost = this.mg.unitInfo(UnitType.AtomBomb).cost(this.player);
    if (this.player.gold() < atomCost) return; // Wait for funds

    // Check if we have a silo not on cooldown
    if (!this.player.canBuild(UnitType.AtomBomb, nextSam.sam.tile())) {
      return; // Wait for silo cooldown
    }

    // Launch atom bomb at this SAM's tile
    this.mg.addExecution(
      new NukeExecution(UnitType.AtomBomb, this.player, nextSam.sam.tile()),
    );
    nextSam.levelsRemaining--;
  }

  /**
   * Wait 30 ticks after the last SAM bomb before launching the main bomb.
   */
  private tickWaitForMain(ticks: number): void {
    if (!this.nukeState) return;
    const elapsed = ticks - this.nukeState.waitStartTick;
    if (elapsed >= AIPlayerExecution.MAIN_BOMB_DELAY_TICKS) {
      this.nukeState.phase = "launchMain";
    }
  }

  /**
   * Launch the main bomb at the target tile.
   */
  private tickLaunchMain(): void {
    if (!this.player || !this.nukeState || !this.nukeHandler) return;
    const state = this.nukeState;

    // Final score recheck before committing the main bomb
    const freshScore = this.nukeHandler.scoreForTile(
      state.targetTile,
      state.bombType,
    );
    if (freshScore <= 0) {
      this.resetNukeSequence();
      return;
    }

    // Check cost
    const bombCost = this.mg.unitInfo(state.bombType).cost(this.player);
    if (this.player.gold() < bombCost) return; // Wait for funds

    // Check silo availability
    if (!this.player.canBuild(state.bombType, state.targetTile)) {
      return; // Wait for silo cooldown
    }

    // Fire the main bomb
    this.mg.addExecution(
      new NukeExecution(state.bombType, this.player, state.targetTile),
    );

    // Sequence complete — reset
    this.resetNukeSequence();
  }

  /**
   * Calculate the total cost of the nuke sequence: main bomb + atom bombs
   * for SAMs + any silo construction/upgrade costs.
   */
  private calculateNukeSequenceCost(state: NukeSequenceState): number {
    if (!this.player || !this.nukeHandler) return Infinity;

    // Main bomb cost
    const mainCost = Number(this.mg.unitInfo(state.bombType).cost(this.player));

    // Atom bomb cost per SAM level
    const atomCost = Number(
      this.mg.unitInfo(UnitType.AtomBomb).cost(this.player),
    );
    const totalSAMLevels = state.samTargets.reduce(
      (sum, s) => sum + s.levelsRemaining,
      0,
    );
    const samBombsCost = totalSAMLevels * atomCost;

    // Silo cost if capacity is insufficient
    const bombsNeeded = 1 + totalSAMLevels;
    const siloCapacity = this.nukeHandler.getPlayerSiloCapacity();
    let siloCost = 0;
    if (siloCapacity < bombsNeeded) {
      const siloUnitCost = Number(
        this.mg.unitInfo(UnitType.MissileSilo).cost(this.player),
      );
      siloCost = (bombsNeeded - siloCapacity) * siloUnitCost;
    }

    return mainCost + samBombsCost + siloCost;
  }

  /**
   * Reset the nuke sequence state and resume construction.
   */
  private resetNukeSequence(): void {
    this.nukeState = null;
    this.nukeHandler?.resetScores();
    this.constructionHandler?.setPaused(false);
  }

  /**
   * Check whether another nuke (from any player, including ourselves) is
   * already in flight toward the blast radius of our planned target.
   * Returns true if we should abort because the target will already be hit.
   */
  private isNukeAlreadyInbound(state: NukeSequenceState): boolean {
    const magnitude = this.mg.config().nukeMagnitudes(state.bombType);
    const rangeSquared = magnitude.inner * magnitude.inner;

    const inFlightNukes = this.mg.units(
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRVWarhead,
    );

    for (const nuke of inFlightNukes) {
      if (!nuke.isActive()) continue;
      // Skip nukes we launched as part of this sequence's SAM suppression
      if (nuke.owner().id() === this.player?.id()) continue;
      const target = nuke.targetTile();
      if (target === undefined) continue;
      const dist2 = this.mg.euclideanDistSquared(state.targetTile, target);
      if (dist2 <= rangeSquared) return true;
    }

    return false;
  }

  private updateSliders(ticks: number): void {
    if (!this.player) return;

    // Set initial investment rates once
    if (!this.initialInvestmentSet) {
      const productivityRate = this.params.productivityInvestmentRate ?? 0.1;
      const researchRate = this.params.researchInvestmentRate ?? 0.1;
      const troopRatio = this.params.targetTroopRatio ?? 0.6;
      this.player.setInvestmentRate(productivityRate);
      this.player.setResearchInvestmentRate(researchRate);
      this.player.setRoadInvestmentRate(0);
      this.player.setTargetTroopRatio(troopRatio);
      this.initialInvestmentSet = true;
    }

    // Set road investment once roads are researched
    if (!this.roadInvestmentSet && this.player.hasUpgrade(UpgradeType.Roads)) {
      this.updateRoadInvestment(this.player);
      this.roadInvestmentSet = true;
    } else if (
      this.roadInvestmentSet &&
      this.params.roadInvestmentCapToMaintenance
    ) {
      // Continuously update road investment when capping to maintenance
      this.updateRoadInvestment(this.player);
    }
  }

  private updateRoadInvestment(player: Player): void {
    const baseRate = this.params.roadInvestmentRate ?? 0.1;
    const capToMaintenance =
      this.params.roadInvestmentCapToMaintenance ?? false;

    if (!capToMaintenance) {
      player.setRoadInvestmentRate(baseRate);
      return;
    }

    // New parameters
    const buildBoost = this.params.roadBuildBoost ?? 0.1; // X
    const qualityAdjust = this.params.roadQualityAdjust ?? 0.01; // Y
    const targetQuality = this.params.targetRoadQuality ?? 100;

    // Get maintenance rate from authoritative source
    const maintenanceRate = this.mg.getRoadMaintenanceRateForPlayer(player);
    const roadLength = player.roadNetworkLength();
    const quality = player.roadNetworkQuality();
    const completion = player.roadNetworkCompletion();

    let finalRate: number;
    if (roadLength === 0) {
      // No roads built yet: invest buildBoost to start building
      finalRate = buildBoost;
    } else if (completion < 100) {
      // Road network incomplete: invest maintenance + buildBoost to build more roads
      finalRate = maintenanceRate + buildBoost;
    } else {
      // Road network complete: adjust based on quality vs target
      if (quality < targetQuality) {
        finalRate = maintenanceRate + qualityAdjust;
      } else {
        finalRate = maintenanceRate - qualityAdjust;
      }
    }

    // Clamp to [0, 1]
    finalRate = Math.max(0, Math.min(1, finalRate));

    player.setRoadInvestmentRate(finalRate);
  }
}
