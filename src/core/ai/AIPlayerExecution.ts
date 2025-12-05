import { Execution, Game, Nation, Player, UpgradeType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { AIBehaviorParams } from "./AIBehaviorParams";
import { AIBotAttackHandler } from "./AIBotAttackHandler";
import { AIPolicyHandler } from "./AIPolicyHandler";
import { AISpawnHandler } from "./AISpawnHandler";
import { AITerraNulliusHandler } from "./AITerraNulliusHandler";

/**
 * AI Player Execution - A configurable AI player with behavior parameters.
 */
export class AIPlayerExecution implements Execution {
  private active = true;
  private mg: Game;
  private player: Player | null = null;
  private random: PseudoRandom;
  private spawnHandler: AISpawnHandler | null = null;
  private terraNulliusHandler: AITerraNulliusHandler | null = null;
  private botAttackHandler: AIBotAttackHandler | null = null;
  private policyHandler: AIPolicyHandler | null = null;
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
  }

  init(mg: Game): void {
    this.mg = mg;
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
    );
    this.botAttackHandler = new AIBotAttackHandler(
      mg,
      this.nation.playerInfo.id,
      this.random,
      this.params,
    );
    this.policyHandler = new AIPolicyHandler(
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
    if (this.player === null) {
      this.player =
        this.mg.players().find((p) => p.id() === this.nation.playerInfo.id) ??
        null;
    }

    if (this.player === null || !this.player.isAlive()) {
      this.active = false;
      return;
    }

    // Handle slider updates every 100 ticks
    if (ticks % 100 === 0) {
      this.updateSliders(ticks);
    }

    // Handle policy directive choices
    this.policyHandler?.handlePolicyDirectives();

    // Handle Terra Nullius expansion every tick
    this.terraNulliusHandler?.handleTerraNulliusAttack();

    // Handle bot attacks every tick
    this.botAttackHandler?.handleBotAttack();
  }

  private updateSliders(ticks: number): void {
    if (this.player === null) return;

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
