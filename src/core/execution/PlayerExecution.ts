import { Config } from "../configuration/Config";
import {
  Execution,
  Game,
  Player,
  PlayerType,
  UnitType,
  UpgradeType,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { getTechNodes, isTechAvailable } from "../tech/ResearchTree";
import { simpleHash } from "../Util";

export class PlayerExecution implements Execution {
  private config: Config;
  private mg: Game;
  private active = true;
  private random: PseudoRandom | null = null;
  // Accumulate research "intensity" allocation since last innovation calculation
  private _researchAccum: Map<string, number> = new Map();

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.config = mg.config();
    this.random = new PseudoRandom(ticks + simpleHash(this.player.id()));
  }

  tick(ticks: number) {
    this.player.decayRelations();
    this.player.units().forEach((u) => {
      const tileOwner = this.mg!.owner(u.tile());
      if (u.info().territoryBound) {
        if (tileOwner.isPlayer()) {
          if (tileOwner !== this.player) {
            this.mg!.player(tileOwner.id()).captureUnit(u);
          }
        } else {
          u.delete();
        }
      }
    });

    if (!this.player.isAlive()) {
      // Player has no tiles, delete any remaining units and gold
      const gold = this.player.gold();
      this.player.removeGold(gold);
      this.player.units().forEach((u) => {
        if (
          u.type() !== UnitType.AtomBomb &&
          u.type() !== UnitType.HydrogenBomb &&
          u.type() !== UnitType.MIRVWarhead &&
          u.type() !== UnitType.MIRV
        ) {
          u.delete();
        }
      });
      this.active = false;
      return;
    }

    const popInc =
      this.config.populationIncreaseRate(this.player) +
      this.player.hospitalReturns();
    this.player.resetHospitalReturns();
    this.player.addWorkers(popInc * (1 - this.player.targetTroopRatio()));
    this.player.addTroops(popInc * this.player.targetTroopRatio());
    // Compute gross gold from config (pre-investment), then apply both investments
    const grossGoldDouble = this.config.grossGoldAdditionRate(this.player);
    const grossGold = BigInt(
      Math.floor(Number.isFinite(grossGoldDouble) ? grossGoldDouble : 0),
    );

    const prodInvest = this.player.investmentRate?.() ?? 0; // 0..0.5 (clamped in PlayerImpl)
    const roadInvest = this.player.hasUpgrade(UpgradeType.Roads)
      ? (this.player.roadInvestmentRate?.() ?? 0)
      : 0;
    const researchInvest = this.player.researchInvestmentRate?.() ?? 0; // 0..1 (no gating)
    let totalInvest = prodInvest + roadInvest + researchInvest; // can exceed 1

    // Allow up to 110% total when treasury is positive, else cap at 100%
    const hasTreasury = this.player.gold() > 0n;
    const maxTotal = hasTreasury ? 1.1 : 1.0;
    if (totalInvest > maxTotal) totalInvest = maxTotal;

    // Net gold added this tick (can be negative when totalInvest > 1)
    let netGoldDouble = grossGoldDouble * (1 - totalInvest);
    if (!Number.isFinite(netGoldDouble)) netGoldDouble = 0;
    let netGold = BigInt(Math.floor(netGoldDouble));
    // Prevent gold from going below zero (server-side safety)
    if (netGold < 0n) {
      const goldNow = this.player.gold();
      if (goldNow + netGold < 0n) {
        netGold = -goldNow; // drain treasury to zero at most
      }
    }
    this.player.addGold(netGold);
    this.player.updateProductivity();
    // Record stats
    // Track net income after investment in stats
    this.mg.stats().goldWork(this.player, netGold);

    const adjustRate = this.config.troopAdjustmentRate(this.player);
    this.player.addTroops(adjustRate);
    this.player.removeWorkers(adjustRate);

    const alliances = Array.from(this.player.alliances());
    for (const alliance of alliances) {
      if (
        this.mg.ticks() - alliance.createdAt() >
        this.mg.config().allianceDuration()
      ) {
        alliance.expire();
      }
    }

    const embargoes = this.player.getEmbargoes();
    for (const embargo of embargoes) {
      if (
        embargo.isTemporary &&
        this.mg.ticks() - embargo.createdAt >
          this.mg.config().temporaryEmbargoDuration()
      ) {
        this.player.stopEmbargo(embargo.target);
      }
    }

    // Regenerate health of damaged buildings
    this.player.units().forEach((u) => {
      if (u.hasHealth() && u.health() < u.effectiveMaxHealth()) {
        u.modifyHealth(0.5);
      }
    });
    // --- Research system per-tick processing ---
    this.tickResearch();
  }

  private tickResearch() {
    // Ensure RNG and config are ready
    if (!this.random) return;

    // Determine research investment (gold) this tick and transform via f(x) = A * investment^B
    const grossGold = this.config.grossGoldAdditionRate(this.player);
    const investRate = (this.player as any).researchInvestmentRate?.() ?? 0;
    if (investRate <= 0 || grossGold <= 0) return;

    const investment = Math.max(0, grossGold * investRate);
    const A = this.config.researchAlpha();
    const B = this.config.researchBeta();
    let xTotal = A * Math.pow(investment, B);
    if (!Number.isFinite(xTotal) || xTotal <= 0) return;

    // Apply Research Lab multiplier: +40% for first, +20% for second, halving thereafter
    // Upgrades count as multiples via effectiveUnits (level-weighted)
    const labsEff = Math.max(
      0,
      (this.player as any).effectiveUnits?.(UnitType.ResearchLab) ?? 0,
    );
    if (labsEff > 0) {
      const boostSum = (0.4 * (1 - Math.pow(0.5, labsEff))) / (1 - 0.5); // geometric series
      const multiplier = 1 + boostSum; // caps at 1.8 as labs -> infinity
      xTotal *= multiplier;
    }

    // Build researched set and available techs
    const nodes = getTechNodes();
    const researched = new Set<string>();
    for (const n of nodes) {
      if ((this.player as any).hasResearchedTech?.(n.id)) researched.add(n.id);
    }
    const available = nodes.filter(
      (n) => !researched.has(n.id) && isTechAvailable(n.id, researched),
    );
    if (available.length === 0) return;

    // Allocation: 50% to priority, 50% split among remaining; if no valid priority, split evenly
    const priorityId: string | null =
      (this.player as any).researchPriority?.() ?? null;
    const priorityInSet =
      priorityId !== null && available.some((n) => n.id === priorityId);

    const k = this.config.researchK();
    const bMin = this.config.researchBeakerMin();
    const bMax = this.config.researchBeakerMax();

    // Helper to get node by id and same-category filtering
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const sameCat = (a: string, b: string) =>
      (byId.get(a)?.category ?? "") === (byId.get(b)?.category ?? "");

    // Build prerequisite path set for a target within same category, including only missing techs
    const buildMissingPrereqPath = (targetId: string): Set<string> => {
      const path = new Set<string>();
      const seen = new Set<string>();
      const dfs = (tid: string) => {
        if (seen.has(tid)) return;
        seen.add(tid);
        const node = byId.get(tid);
        if (!node) return;
        // If already available given current researched, stop here
        // We collect missing prereqs only
        const reqAll = (node.requiresAllOf ?? []).filter((p) =>
          sameCat(p, tid),
        );
        const reqOne = (node.requiresOneOf ?? []).filter((p) =>
          sameCat(p, tid),
        );

        // Handle requiresAllOf: include those not yet researched
        for (const r of reqAll) {
          if (!researched.has(r)) {
            path.add(r);
            dfs(r);
          }
        }
        // Handle requiresOneOf: if none are researched, choose one deterministically
        if (reqOne.length > 0 && !reqOne.some((p) => researched.has(p))) {
          // Choose the lower-level option first; fallback to first listed
          const sorted = [...reqOne].sort(
            (a, b) => (byId.get(a)?.level ?? 0) - (byId.get(b)?.level ?? 0),
          );
          const choice = sorted[0];
          if (choice && !researched.has(choice)) {
            path.add(choice);
            dfs(choice);
          }
        }
      };
      dfs(targetId);
      return path;
    };

    const alloc: Record<string, number> = {};
    if (priorityId && !priorityInSet) {
      // Priority target not available: allocate half to the frontier of its missing prereqs
      const pathSet = buildMissingPrereqPath(priorityId);
      const frontier = available.filter((n) => pathSet.has(n.id));
      if (frontier.length > 0) {
        const half = 0.5 * xTotal;
        const shareFrontier = half / frontier.length;
        for (const n of frontier)
          alloc[n.id] = (alloc[n.id] ?? 0) + shareFrontier;
        const others = available.filter((n) => !pathSet.has(n.id));
        const remaining = xTotal - half;
        const shareOthers = others.length > 0 ? remaining / others.length : 0;
        for (const n of others) alloc[n.id] = (alloc[n.id] ?? 0) + shareOthers;
      } else {
        // Fallback: even split if no frontier identified
        const share = xTotal / available.length;
        for (const n of available) alloc[n.id] = share;
      }
    } else if (priorityInSet && available.length > 1) {
      const half = 0.5 * xTotal;
      alloc[priorityId!] = (alloc[priorityId!] ?? 0) + half;
      const others = available.filter((n) => n.id !== priorityId);
      const share = others.length > 0 ? half / others.length : 0;
      for (const n of others) alloc[n.id] = (alloc[n.id] ?? 0) + share;
    } else {
      const share = xTotal / available.length;
      for (const n of available) alloc[n.id] = share;
    }

    // Accumulate allocated intensity for each available tech
    for (const n of available) {
      const x = alloc[n.id] ?? 0;
      if (x <= 0) continue;
      const prev = this._researchAccum.get(n.id) ?? 0;
      this._researchAccum.set(n.id, prev + x);
    }

    // Only calculate innovation probability on the configured cadence
    const interval = this.config.researchIntervalTicks();
    if (interval > 0 && this.mg.ticks() % interval === 0) {
      const isHuman = this.player.type() === PlayerType.Human;
      for (const [techId, X] of this._researchAccum.entries()) {
        if (!Number.isFinite(X) || X <= 0) continue;
        const p = 1 - Math.exp(-k * X);
        const roll = this.random.next();
        if (roll < p) {
          // Success: award uniform beakers between [bMin, bMax] inclusive
          const beakers = this.random.nextInt(bMin, bMax + 1);
          const cost = byId.get(techId)?.cost ?? 0;
          const result = (this.player as any).addResearchBeakers?.(
            techId,
            beakers,
            cost,
          );
          if (result?.completed) {
            // completed via addResearchBeakers -> addResearchedTech side-effects
          }
        }
      }
      // Reset accumulators after processing the cadence boundary
      this._researchAccum.clear();
    }
  }

  owner(): Player {
    if (this.player === null) {
      throw new Error("Not initialized");
    }
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }
}
