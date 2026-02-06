import { Execution, Game, Nation, Player, UpgradeType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { AIAttackHandler } from "./AIAttackHandler";
import { AIBehaviorParams } from "./AIBehaviorParams";
import { AIBotAttackHandler } from "./AIBotAttackHandler";
import { AIConstructionHandler } from "./AIConstructionHandler";
import { AIDiplomacyHandler } from "./AIDiplomacyHandler";
import { AISpawnHandler } from "./AISpawnHandler";
import { AITerraNulliusHandler } from "./AITerraNulliusHandler";

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
  private initialInvestmentSet = false;
  private roadInvestmentSet = false;

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
    );
    this.diplomacyHandler = new AIDiplomacyHandler(
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
