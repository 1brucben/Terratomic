import { Execution, Game, Nation, Player, UpgradeType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { AIBehaviorParams } from "./AIBehaviorParams";
import { AIBotAttackHandler } from "./AIBotAttackHandler";
import { AIConstructionHandler } from "./AIConstructionHandler";
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
  private constructionHandler: AIConstructionHandler | null = null;
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
    this.constructionHandler = new AIConstructionHandler(
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
    if (!tnAttacked) {
      this.botAttackHandler?.handleBotAttack();
    }
  }

  private updateSliders(ticks: number): void {
    if (!this.player) return;

    // Set initial investment rates once
    if (!this.initialInvestmentSet) {
      const productivityRate = this.params.productivityInvestmentRate ?? 0.1;
      const researchRate = this.params.researchInvestmentRate ?? 0.1;
      this.player.setInvestmentRate(productivityRate);
      this.player.setResearchInvestmentRate(researchRate);
      this.player.setRoadInvestmentRate(0);
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

    // Calculate maintenance rate needed
    const config = this.mg.config();
    const baseCost = config.roadConstructionBaseCost();
    const maintMult = config.roadMaintenanceMultiplier();
    const roadLength = player.roadNetworkLength();
    const productivity = Math.max(0.0001, player.productivity());
    const quality = player.roadNetworkQuality();
    const maxQuality = config.roadQualityMax?.() ?? 150;
    const minQuality = config.roadQualityMin?.() ?? 0;
    const clampedQuality = Math.max(minQuality, Math.min(maxQuality, quality));
    const qualityFactor = clampedQuality / 100;

    // Maintenance per tick
    const maintenancePerTick =
      baseCost * maintMult * productivity * roadLength * qualityFactor;

    // Gross gold per tick
    const grossGoldPerTick = config.grossGoldAdditionRate(player);

    // Calculate maintenance rate as fraction of gross gold
    let maintenanceRate = 0;
    if (grossGoldPerTick > 0) {
      maintenanceRate = maintenancePerTick / grossGoldPerTick;
    }
    maintenanceRate = Math.max(0, Math.min(1, maintenanceRate));

    // If near max quality (within 1%), set exactly to maintenance; otherwise min of base and maintenance
    const atMaxQuality = quality >= maxQuality - 1;
    const finalRate = atMaxQuality
      ? maintenanceRate
      : Math.min(baseRate, maintenanceRate);

    player.setRoadInvestmentRate(finalRate);
  }
}
