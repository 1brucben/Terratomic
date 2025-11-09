import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import flaskIcon from "../../proprietary/images/flask.png";
import { EventBus } from "../core/EventBus";
import { UpgradeType } from "../core/game/Game";
import { GameView, PlayerView } from "../core/game/GameView";
import {
  getTechNodes,
  isTechAvailable as serverIsTechAvailable,
  type Category,
  type TechNode,
} from "../core/tech/ResearchTree";
import { RESEARCH_TECH_IDS } from "../core/tech/TechEffects";
import "./components/baseComponents/Modal";
import {
  INVESTMENT_REQUEST_EVENT,
  INVESTMENT_SYNC_EVENT,
  INVESTMENT_SYNC_REQUEST_EVENT,
  type InvestmentRequestDetail,
  type InvestmentSyncDetail,
} from "./events/InvestmentEvents";
import { CloseViewEvent } from "./InputHandler";
import {
  SendPurchaseUpgradeIntentEvent,
  SendResearchTreeSelectIntentEvent,
} from "./Transport";
import { renderNumber } from "./Utils";

type ResearchTab = Category | "Overview";

// Category and TechNode are imported from core so client stays in sync

@customElement("research-tree-modal")
export class ResearchTreeModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @property({ type: Boolean }) visible: boolean = false;
  // Injected from parent so we can read upgrades and send intents
  @property({ attribute: false }) game!: GameView;
  @property({ attribute: false }) eventBus!: EventBus;

  // Local polling while modal is open to keep UI in sync with game state
  private refreshTimer: number | null = null;

  private techs: TechNode[] = [...getTechNodes()];
  private categories: Category[] = Array.from(
    new Set(this.techs.map((t) => t.category)),
  ) as Category[];
  private readonly tabOrder: ResearchTab[] = [
    "Land",
    "Sea",
    "Air",
    "Nuclear",
    "Economy",
    "Overview",
  ];

  @state()
  private activeTab: ResearchTab = "Land";

  @state()
  private roadInvestmentRate = 0;

  @state()
  private researchInvestmentRate = 0;

  @state()
  private lockRoad = false;

  @state()
  private lockResearch = false;

  @state()
  private roadInvestmentEnabled = false;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(
      INVESTMENT_SYNC_EVENT,
      this.handleInvestmentSync as EventListener,
    );
    if (this.visible) {
      this.requestInvestmentSync();
    }
    if (this.visible) this.open();
  }

  open() {
    this.modalEl?.open();
    this.requestInvestmentSync();
    // Perform a full layout pass on the next frame after opening
    requestAnimationFrame(() => this.updateLayout());
    // Start a light refresh loop to reflect game state (gold/upgrades) while open
    this.refreshTimer ??= window.setInterval(() => this.requestUpdate(), 500);
    this.eventBus.on(CloseViewEvent, this.close);
  }
  close = () => {
    this.modalEl?.close();
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.eventBus.off(CloseViewEvent, this.close);
  };
  show() {
    this.visible = true;
    this.open();
  }
  hide() {
    this.visible = false;
    this.close();
  }

  // Placeholder tree removed: client uses server-authoritative tree

  private isAvailable(id: string, researched: Set<string>): boolean {
    return serverIsTechAvailable(id, researched);
  }

  // No mapping to existing UpgradeType; research tree is separate

  private researchedIDsFromGame(): Set<string> {
    const res = new Set<string>();
    const me = this.game?.myPlayer?.();
    if (!me) return res;
    // Use new per-match researched techs
    for (const t of this.techs) if (me.hasResearchedTech(t.id)) res.add(t.id);
    return res;
  }

  private onTechClick(id: string) {
    if (!this.game || !this.eventBus) return;
    const tech = this.techs.find((t) => t.id === id)!;
    const me = this.game.myPlayer();
    if (!me) return;

    const researched = this.researchedIDsFromGame();
    // Allow prioritizing even if unavailable; still ignore already researched
    if (me.hasResearchedTech?.(id)) return; // already researched

    // Clicking sets this as the current research priority (server handles distribution)
    this.eventBus.emit(new SendResearchTreeSelectIntentEvent(id));
    this.requestUpdate();
  }

  private onActivateScorchedEarth(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.game || !this.eventBus) return;
    const me = this.game.myPlayer();
    if (!me || this.game.inSpawnPhase()) return;
    if (me.hasUpgrade?.(UpgradeType.ScorchedEarth)) return;
    this.eventBus.emit(
      new SendPurchaseUpgradeIntentEvent(UpgradeType.ScorchedEarth),
    );
  }

  private renderScorchedEarthAction(
    tech: TechNode,
    me: PlayerView | null,
    isResearched: boolean,
  ) {
    if (tech.id !== RESEARCH_TECH_IDS.SCORCHED_EARTH || !me || !isResearched) {
      return "";
    }
    const config = this.game?.config?.();
    if (!config) return "";
    const { cost } = config.upgradeInfo(UpgradeType.ScorchedEarth);
    const activationCost = cost(me);
    const gold = me.gold();
    const hasUpgrade = me.hasUpgrade(UpgradeType.ScorchedEarth);
    const disabled =
      hasUpgrade || this.game?.inSpawnPhase?.() || gold < activationCost;
    const tooltip = hasUpgrade
      ? "Scorched Earth already active."
      : gold < activationCost
        ? "Earn more gold to activate Scorched Earth."
        : "Activate to raze your road network and reset Economy techs.";
    return html`
      <button
        class="tech-action"
        @click=${(ev: Event) => this.onActivateScorchedEarth(ev)}
        ?disabled=${disabled}
        title=${tooltip}
      >
        ${hasUpgrade
          ? "Activated"
          : `Activate (${renderNumber(activationCost)} gold)`}
      </button>
    `;
  }

  private renderLegend() {
    return html`
      <div
        class="legend"
        style="display:flex;gap:12px;font-size:12px;color:#d1d5db;margin-bottom:8px;"
      >
        <span
          ><span
            class="swatch"
            style="width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:6px;background: rgba(239,68,68,0.7)"
          ></span
          >Required</span
        >
        <span
          ><span
            class="swatch"
            style="width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:6px;background: rgba(245,158,11,0.8)"
          ></span
          >Requires one of</span
        >
        <span
          ><span
            class="swatch"
            style="width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:6px;background:#4b5563"
          ></span
          >Researched</span
        >
        <span style="opacity:.7">Unmet requirements are grayed out</span>
      </div>
    `;
  }

  private getOrderedTabs(): ResearchTab[] {
    const available = new Set(this.categories);
    const ordered = this.tabOrder.filter((cat) => {
      if (cat === "Overview") return true;
      return available.has(cat);
    });
    if (!ordered.includes("Overview") && available.size > 0)
      ordered.push("Overview");
    return ordered.length ? ordered : [...available];
  }

  private getActiveCategory(): Category | null {
    if (this.activeTab === "Overview") return null;
    const tabs = this.getOrderedTabs();
    if (!tabs.length) return null;
    return tabs.includes(this.activeTab)
      ? (this.activeTab as Category)
      : (tabs[0] as Category);
  }

  private onTabClick(cat: ResearchTab) {
    if (cat === this.activeTab) return;
    this.activeTab = cat;
  }

  private handleInvestmentSync = (event: Event) => {
    const { detail } = event as CustomEvent<InvestmentSyncDetail>;
    if (!detail) return;
    this.roadInvestmentRate = detail.road;
    this.researchInvestmentRate = detail.research;
    this.lockRoad = detail.lockRoad;
    this.lockResearch = detail.lockResearch;
    this.roadInvestmentEnabled = detail.roadEnabled;
  };

  private requestInvestmentSync() {
    window.dispatchEvent(new CustomEvent(INVESTMENT_SYNC_REQUEST_EVENT));
  }

  private dispatchInvestmentRequest(detail: InvestmentRequestDetail) {
    window.dispatchEvent(
      new CustomEvent<InvestmentRequestDetail>(INVESTMENT_REQUEST_EVENT, {
        detail,
      }),
    );
  }

  private handleInvestmentInput(slider: "road" | "research", event: Event) {
    const input = event.target as HTMLInputElement;
    const value = Math.max(
      0,
      Math.min(1, (parseInt(input.value || "0", 10) || 0) / 100),
    );
    const currentValue =
      slider === "road" ? this.roadInvestmentRate : this.researchInvestmentRate;
    const locked = slider === "road" ? this.lockRoad : this.lockResearch;
    const enabled = slider === "road" ? this.canUseRoadSlider() : true;
    if (locked || !enabled) {
      input.value = Math.round(currentValue * 100).toString();
      return;
    }
    this.dispatchInvestmentRequest({ type: "set", slider, value });
  }

  private handleInvestmentToggle(slider: "road" | "research") {
    if (slider === "road" && !this.canUseRoadSlider()) return;
    this.dispatchInvestmentRequest({ type: "toggle-lock", slider });
  }

  private canUseRoadSlider(): boolean {
    if (this.roadInvestmentEnabled) return true;
    const me = this.game?.myPlayer?.();
    return me?.hasUpgrade?.(UpgradeType.Roads) ?? false;
  }

  private renderRoadSlider(me: PlayerView | null) {
    const hasRoads = this.canUseRoadSlider();
    const displayValue = hasRoads ? this.roadInvestmentRate : 0;
    const percent = Math.round(displayValue * 100);
    const quality = me?.roadNetworkQuality?.() ?? 100;
    const completion = me?.roadNetworkCompletion?.() ?? 100;
    const tooltip = hasRoads
      ? this.lockRoad
        ? "Slider is locked. Double-click to unlock."
        : "Double-click slider to lock."
      : "Research Post-War Reconstruction to enable road investment.";
    const breakEvenMarker = this.renderRoadBreakEvenMarker(me, hasRoads);
    return html`
      <div
        class="investment-slider ${hasRoads ? "" : "disabled"}"
        translate="no"
      >
        <label class="investment-label">
          <span>
            Road investment: ${percent}% ·
            <span style="white-space:nowrap;"
              >Quality ${quality.toFixed(1)}%</span
            >
            ·
            <span style="white-space:nowrap;"
              >Completion: ${Math.round(completion)}%</span
            >
          </span>
          ${this.lockRoad
            ? html`<span class="lock-badge">
                <svg class="lock-icon" viewBox="0 0 24 24">
                  <path
                    d="M8 10V7a4 4 0 118 0v3h1a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8a2 2 0 012-2h1zm2 0h4V7a2 2 0 10-4 0v3z"
                  />
                </svg>
                Locked
              </span>`
            : ""}
        </label>
        <div class="investment-track-wrapper" title=${tooltip}>
          <div class="investment-track-bg"></div>
          <div
            class="investment-track-fill"
            style="width:${Math.min(100, Math.max(0, percent))}%;"
          ></div>
          ${breakEvenMarker}
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            .value=${percent.toString()}
            class="investment-input ${this.lockRoad ? "locked" : ""}"
            ?disabled=${!hasRoads}
            @input=${(e: Event) => this.handleInvestmentInput("road", e)}
            @dblclick=${() => hasRoads && this.handleInvestmentToggle("road")}
          />
        </div>
        <div class="investment-hint">${tooltip}</div>
      </div>
    `;
  }

  private renderRoadBreakEvenMarker(me: PlayerView | null, enabled: boolean) {
    if (!enabled || !me) return "";
    const config = this.game?.config?.();
    if (!config) return "";
    const pxPerSecond = me.roadNetPixelsPerSecond?.() ?? 0;
    const base = config.roadConstructionBaseCost();
    const maintMult = config.roadMaintenanceMultiplier();
    const length = me.roadNetworkLength?.() ?? 0;
    const quality = me.roadNetworkQuality?.() ?? 100;
    const maintenancePerSecond =
      (length * base * maintMult * Math.max(0.1, quality / 100)) / 60;
    const grossPerSecond = pxPerSecond * base;
    let breakEven = 0;
    if (grossPerSecond > 0) breakEven = maintenancePerSecond / grossPerSecond;
    else breakEven = maintenancePerSecond > 0 ? 1 : 0;
    if (!Number.isFinite(breakEven)) breakEven = 0;
    breakEven = Math.max(0, Math.min(1, breakEven));
    if (breakEven <= 0 || breakEven >= 1) return "";
    const leftPct = (breakEven * 100).toFixed(2);
    return html`<div
      class="investment-marker"
      style="left:${leftPct}%;"
      title=${`Break-even: ${(breakEven * 100).toFixed(0)}%`}
    ></div>`;
  }

  private renderResearchSlider() {
    const percent = Math.round(this.researchInvestmentRate * 100);
    const tooltip = this.lockResearch
      ? "Slider is locked. Double-click to unlock."
      : "Double-click slider to lock.";
    return html`
      <div class="investment-slider" translate="no">
        <label class="investment-label">
          Research investment: ${percent}%
          ${this.lockResearch
            ? html`<span class="lock-badge">
                <svg class="lock-icon" viewBox="0 0 24 24">
                  <path
                    d="M8 10V7a4 4 0 118 0v3h1a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8a2 2 0 012-2h1zm2 0h4V7a2 2 0 10-4 0v3z"
                  />
                </svg>
                Locked
              </span>`
            : ""}
        </label>
        <div class="investment-track-wrapper" title=${tooltip}>
          <div class="investment-track-bg"></div>
          <div
            class="investment-track-fill"
            style="width:${Math.min(100, Math.max(0, percent))}%;"
          ></div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            .value=${percent.toString()}
            class="investment-input ${this.lockResearch ? "locked" : ""}"
            @input=${(e: Event) => this.handleInvestmentInput("research", e)}
            @dblclick=${() => this.handleInvestmentToggle("research")}
          />
        </div>
        <div class="investment-hint">${tooltip}</div>
      </div>
    `;
  }

  private computePositions(): { [id: string]: DOMRect } {
    const map: { [id: string]: DOMRect } = {};
    const cards = this.renderRoot.querySelectorAll(
      ".tech[data-id]",
    ) as NodeListOf<HTMLElement>;
    cards.forEach((el) => {
      const id = el.dataset.id!;
      map[id] = el.getBoundingClientRect();
    });
    return map;
  }

  // Orchestrate layout updates and edge redraw
  private updateLayout() {
    requestAnimationFrame(() => this.drawEdges());
  }

  private renderAllView(
    levels: number[],
    researched: Set<string>,
    categoryColors: Record<Category, string>,
    percentages: Map<string, number>,
  ) {
    if (!this.categories.length) {
      return html`<div class="empty-state">No research categories found.</div>`;
    }
    return html`
      <div class="all-view-grid">
        ${this.categories.map((cat) => {
          const accent = categoryColors[cat] ?? "rgba(59,130,246,0.06)";
          return html`<div
            class="all-column"
            style=${`--column-accent:${accent}`}
          >
            <div class="all-column-title">${cat}</div>
            ${levels.map((lvl) => {
              const techs = this.techs.filter(
                (t) => t.category === cat && t.level === lvl,
              );
              return html`<div class="compact-level">
                <div class="compact-level-label">L${lvl}</div>
                <div class="compact-level-techs">
                  ${techs.length
                    ? techs.map((tech) => {
                        const isResearched = researched.has(tech.id);
                        const pct = percentages.get(tech.id) ?? 0;
                        return html`<div
                          class=${`compact-tech ${isResearched ? "researched" : ""}`}
                        >
                          <span class="compact-name"
                            >${tech.name} (${pct}%)</span
                          >
                          ${isResearched
                            ? html`<span class="compact-check">✔</span>`
                            : ""}
                        </div>`;
                      })
                    : html`<div class="compact-tech empty">—</div>`}
                </div>
              </div>`;
            })}
          </div>`;
        })}
      </div>
    `;
  }

  private drawEdges() {
    const container = this.renderRoot.querySelector(
      ".line-layer",
    ) as HTMLElement | null;
    if (!container) return;
    const svg = container.querySelector("svg");
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    if (this.activeTab === "Overview") return;
    const activeCategory = this.getActiveCategory();
    if (!activeCategory) return;

    const visibleTechs = this.techs.filter(
      (t) => t.category === activeCategory,
    );
    if (!visibleTechs.length) return;

    const pos = this.computePositions();
    const treeEl = this.renderRoot.querySelector(
      ".tree-container",
    ) as HTMLElement | null;
    if (!treeEl) return;
    const rootRect = treeEl.getBoundingClientRect();
    const scrollLeft = treeEl.scrollLeft;
    const scrollTop = treeEl.scrollTop;

    const me = this.game?.myPlayer?.();
    const researched = this.researchedIDsFromGame();
    const priority = me?.researchPriorityTech?.() ?? null;

    const byId = new Map(visibleTechs.map((n) => [n.id, n] as const));
    const buildMissingPrereqPath = (targetId: string): Set<string> => {
      const path = new Set<string>();
      const seen = new Set<string>();
      const dfs = (tid: string) => {
        if (seen.has(tid)) return;
        seen.add(tid);
        const node = byId.get(tid);
        if (!node) return;
        const reqAll = (node.requiresAllOf ?? []).filter((p) => byId.has(p));
        const reqOne = (node.requiresOneOf ?? []).filter((p) => byId.has(p));
        for (const r of reqAll) {
          if (!researched.has(r)) {
            path.add(r);
            dfs(r);
          }
        }
        if (reqOne.length > 0 && !reqOne.some((p) => researched.has(p))) {
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
      if (targetId && byId.has(targetId)) dfs(targetId);
      return path;
    };

    const highlightNodes = new Set<string>();
    if (priority && byId.has(priority)) {
      highlightNodes.add(priority);
      const missing = buildMissingPrereqPath(priority);
      for (const id of missing) highlightNodes.add(id);
    }

    const addLine = (fromId: string, toId: string, cls: string) => {
      const a = pos[fromId];
      const b = pos[toId];
      if (!a || !b) return;
      const x1 = a.right - rootRect.left + scrollLeft;
      const y1 = a.top - rootRect.top + scrollTop + a.height / 2;
      const x2 = b.left - rootRect.left + scrollLeft;
      const y2 = b.top - rootRect.top + scrollTop + b.height / 2;
      const midX = (x1 + x2) / 2;
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      const d = `M ${x1},${y1} L ${midX},${y1} L ${midX},${y2} L ${x2},${y2}`;
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      const isHighlighted =
        highlightNodes.has(fromId) && highlightNodes.has(toId);
      path.setAttribute(
        "class",
        `edge ${cls} ${isHighlighted ? "highlight" : ""}`,
      );
      svg.appendChild(path);
    };

    for (const t of visibleTechs) {
      const reqAll = (t.requiresAllOf ?? []).filter((id) => byId.has(id));
      const reqOne = (t.requiresOneOf ?? []).filter((id) => byId.has(id));

      for (const p of reqAll) addLine(p, t.id, "req");
      for (const p of reqOne) addLine(p, t.id, "oneof");
    }
  }

  protected firstUpdated(_changed: PropertyValues): void {
    super.firstUpdated(_changed);
    setTimeout(() => this.updateLayout(), 0);
    window.addEventListener("resize", this.handleResize);
    // Watch scroll on the whole tree container (both axes)
    const tree = this.renderRoot.querySelector(".tree-container");
    tree?.addEventListener(
      "scroll",
      this.handleResize as any,
      {
        passive: true,
      } as any,
    );
    this.requestInvestmentSync();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.handleResize);
    // content no longer scrolls for this modal; listener removed
    const tree = this.renderRoot.querySelector(".tree-container");
    tree?.removeEventListener("scroll", this.handleResize as any);
    window.removeEventListener(
      INVESTMENT_SYNC_EVENT,
      this.handleInvestmentSync as EventListener,
    );
  }

  private handleResize = () => {
    this.updateLayout();
  };

  // No per-match listener needed; UI reflects game state directly

  protected updated(): void {
    // Schedule a layout update on the next animation frame
    requestAnimationFrame(() => this.updateLayout());
  }

  render() {
    const levels = Array.from(new Set(this.techs.map((t) => t.level))).sort(
      (a, b) => a - b,
    );
    const researched = this.researchedIDsFromGame();
    const categoryColors: Record<Category, string> = {
      Land: "rgba(59,130,246,0.08)",
      Sea: "rgba(14,165,233,0.08)",
      Air: "rgba(168,85,247,0.08)",
      Nuclear: "rgba(239,68,68,0.08)",
      Economy: "rgba(34,197,94,0.08)",
    };
    const me = this.game?.myPlayer?.();
    const priority = me?.researchPriorityTech?.() ?? null;
    const tabs = this.getOrderedTabs();
    const isAllView = this.activeTab === "Overview";
    const activeCategory = this.getActiveCategory();
    const activeTechs = activeCategory
      ? this.techs.filter((t) => t.category === activeCategory)
      : [];
    const activeMap = new Map(activeTechs.map((n) => [n.id, n] as const));
    const percentByTechId = (() => {
      const map = new Map<string, number>();
      for (const tech of this.techs) {
        const cost = Math.max(1, tech.cost || 1);
        const beakers = me?.researchBeakers?.(tech.id) ?? 0;
        let pct = Math.floor((beakers / cost) * 100);
        if (!Number.isFinite(pct)) pct = 0;
        pct = Math.max(0, Math.min(100, pct));
        if (researched.has(tech.id)) pct = 100;
        map.set(tech.id, pct);
      }
      return map;
    })();
    const highlightTrail = (() => {
      const set = new Set<string>();
      if (!priority || !activeCategory || !activeMap.has(priority)) return set;
      const seen = new Set<string>();
      const dfs = (tid: string) => {
        if (seen.has(tid)) return;
        seen.add(tid);
        const node = activeMap.get(tid);
        if (!node) return;
        const reqAll = (node.requiresAllOf ?? []).filter((p) =>
          activeMap.has(p),
        );
        const reqOne = (node.requiresOneOf ?? []).filter((p) =>
          activeMap.has(p),
        );
        for (const r of reqAll) {
          if (!researched.has(r)) {
            set.add(r);
            dfs(r);
          }
        }
        if (reqOne.length > 0 && !reqOne.some((p) => researched.has(p))) {
          const sorted = [...reqOne].sort(
            (a, b) =>
              (activeMap.get(a)?.level ?? 0) - (activeMap.get(b)?.level ?? 0),
          );
          const choice = sorted[0];
          if (choice && !researched.has(choice)) {
            set.add(choice);
            dfs(choice);
          }
        }
      };
      set.add(priority);
      dfs(priority);
      return set;
    })();

    return html`
      <o-modal
        title="Research Tree"
        max-width="90vw"
        max-height="85dvh"
        content-overflow="hidden"
      >
        <style>
          .tab-shell {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .tab-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            padding: 8px 4px 4px;
            border-bottom: 1px solid rgba(148, 163, 184, 0.12);
            align-items: flex-end;
          }
          .tab-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }
          .tab-button {
            background: #0b1428;
            color: #9fb4d9;
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 999px;
            padding: 6px 14px;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            cursor: pointer;
            transition: all 120ms ease;
          }
          .tab-button:hover {
            color: #f1f5ff;
            border-color: rgba(148, 163, 184, 0.4);
          }
          .tab-button.active {
            color: #f8fbff;
            border-color: rgba(99, 179, 237, 0.7);
            background:
              linear-gradient(
                135deg,
                rgba(59, 130, 246, 0.2),
                rgba(6, 182, 212, 0.08)
              ),
              var(--tab-accent, #132035);
            box-shadow: 0 0 20px rgba(15, 23, 42, 0.6);
          }
          .tab-panel {
            background: #050b16;
            border: 1px solid rgba(15, 23, 42, 0.9);
            border-radius: 14px;
            padding: 12px;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.05),
              0 10px 30px rgba(2, 6, 23, 0.65);
          }
          .investment-cluster {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            margin-left: auto;
            align-items: flex-start;
            margin-top: -40px;
          }
          .investment-slider {
            min-width: 260px;
            width: clamp(260px, 40vw, 390px);
            color: #dbe7ff;
            font-size: 12px;
          }
          .investment-slider.disabled {
            opacity: 0.5;
          }
          .investment-label {
            font-size: 12px;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .investment-track-wrapper {
            position: relative;
            height: 24px;
          }
          .investment-track-bg {
            position: absolute;
            left: 0;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            height: 6px;
            border-radius: 999px;
            background-color: rgba(24, 39, 66, 0.85);
          }
          .investment-track-fill {
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            height: 6px;
            border-radius: 999px;
            background: linear-gradient(90deg, #5ac8fa, #2563eb);
          }
          .investment-input {
            position: absolute;
            inset: 0;
            margin: 0;
            height: 100%;
            background: transparent;
            -webkit-appearance: none;
            appearance: none;
            outline: none;
          }
          .investment-input::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #0b1220;
            border: 2px solid #27476e;
            cursor: pointer;
            box-shadow: 0 0 0 1px rgba(39, 71, 110, 0.35) inset;
          }
          .investment-input::-moz-range-thumb {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #0b1220;
            border: 2px solid #27476e;
            cursor: pointer;
            box-shadow: 0 0 0 1px rgba(39, 71, 110, 0.35) inset;
          }
          .investment-input::-webkit-slider-runnable-track,
          .investment-input::-moz-range-track {
            background: transparent;
          }
          .investment-input.locked::-webkit-slider-thumb,
          .investment-input.locked::-moz-range-thumb {
            border-color: #f59e0b;
            box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.45) inset;
          }
          .investment-marker {
            position: absolute;
            top: 0;
            width: 2px;
            height: 8px;
            background: rgba(255, 255, 255, 0.85);
            transform: translateX(-1px);
            border-radius: 1px;
          }
          .investment-hint {
            font-size: 10px;
            opacity: 0.65;
            margin-top: 2px;
          }
          .investment-meta {
            font-size: 11px;
            opacity: 0.75;
            margin-top: 4px;
            text-align: right;
          }
          .lock-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 1px 6px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.2);
            font-size: 10px;
          }
          .lock-icon {
            width: 10px;
            height: 10px;
            fill: currentColor;
          }
          .tree-container {
            position: relative;
            overflow: auto;
            max-height: calc(85dvh - 150px);
            padding: 6px;
            scrollbar-width: thin;
            scrollbar-color: #27476e #0e1a33;
          }
          .tree-container.all-view {
            padding: 12px;
          }
          .tree-container::-webkit-scrollbar {
            height: 10px;
            width: 10px;
            background: transparent;
          }
          .tree-container::-webkit-scrollbar-track {
            background: #0e1a33;
            border-radius: 8px;
            box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.4);
          }
          .tree-container::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, #27476e, #1e3554);
            border-radius: 8px;
            border: 1px solid #27476e;
            box-shadow: inset 0 0 4px rgba(255, 255, 255, 0.06);
          }
          .tree-container::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(180deg, #32629b, #254a78);
            border-color: #32629b;
          }
          .tree-container::-webkit-scrollbar-corner {
            background: #0e1a33;
          }
          .level-strip {
            display: flex;
            gap: 36px;
            padding: 6px;
            min-height: 220px;
            position: relative;
            z-index: 2;
          }
          .level-column {
            flex: 0 0 auto;
            min-width: 220px;
            border-radius: 12px;
            border: 1px solid rgba(15, 23, 42, 0.95);
            background:
              linear-gradient(
                180deg,
                rgba(3, 7, 14, 0.98),
                rgba(5, 9, 18, 0.92)
              ),
              var(--level-accent, rgba(59, 130, 246, 0.06));
            padding: 12px;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.04),
              0 6px 24px rgba(2, 6, 23, 0.75);
          }
          .all-view-grid {
            display: flex;
            gap: 16px;
            min-width: max-content;
          }
          .all-column {
            flex: 0 0 220px;
            background:
              linear-gradient(
                180deg,
                rgba(4, 7, 14, 0.98),
                rgba(6, 12, 24, 0.92)
              ),
              var(--column-accent, rgba(59, 130, 246, 0.05));
            border: 1px solid rgba(15, 23, 42, 0.85);
            border-radius: 12px;
            padding: 10px;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.04),
              0 4px 16px rgba(2, 6, 23, 0.65);
          }
          .all-column-title {
            font-weight: 600;
            color: #f0f6ff;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          .compact-level {
            display: flex;
            gap: 8px;
            align-items: flex-start;
            margin-bottom: 6px;
          }
          .compact-level-label {
            font-size: 10px;
            color: #9fb4d9;
            padding-top: 2px;
            min-width: 22px;
          }
          .compact-level-techs {
            display: flex;
            flex-direction: column;
            gap: 4px;
            width: 100%;
          }
          .compact-tech {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
            padding: 4px 6px;
            border-radius: 6px;
            background: rgba(15, 23, 42, 0.65);
            border: 1px solid rgba(59, 130, 246, 0.15);
            color: #dbe7ff;
          }
          .compact-tech.researched {
            background: rgba(22, 82, 58, 0.35);
            border-color: rgba(34, 197, 94, 0.4);
          }
          .compact-tech.empty {
            justify-content: center;
            font-style: italic;
            opacity: 0.5;
          }
          .compact-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .compact-check {
            color: #86efac;
            font-weight: 600;
            margin-left: 8px;
          }
          .level-label {
            font-weight: 600;
            color: #e3edff;
            margin-bottom: 10px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }
          .tech-stack {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .empty-level {
            font-size: 12px;
            color: #7b8ba8;
            opacity: 0.8;
            text-align: center;
            border: 1px dashed rgba(125, 138, 164, 0.4);
            border-radius: 8px;
            padding: 16px 8px;
          }
          .empty-state {
            padding: 24px;
            text-align: center;
            color: #9eaec9;
          }
          .tech {
            background: linear-gradient(180deg, #122544, #0e1c33);
            border: 1px solid rgba(59, 130, 246, 0.35);
            border-radius: 10px;
            padding: 10px;
            color: #e4edff;
            position: relative;
            cursor: pointer;
            transition:
              transform 0.12s ease,
              box-shadow 0.12s ease,
              opacity 0.2s;
            min-height: 72px;
            width: 100%;
            text-align: left;
            box-shadow:
              0 6px 16px rgba(2, 6, 23, 0.65),
              inset 0 0 0 1px rgba(255, 255, 255, 0.02);
          }
          .tech:hover {
            box-shadow:
              0 8px 18px rgba(2, 6, 23, 0.8),
              0 0 0 2px rgba(59, 130, 246, 0.45) inset;
          }
          .tech.locked {
            opacity: 1;
            cursor: pointer;
          }
          .tech.researched {
            background: #162544;
            border-color: #27476e;
          }
          .tech.researched::after {
            content: "\\2713";
            position: absolute;
            top: 6px;
            right: 8px;
            font-weight: bold;
            color: #86efac;
            text-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
          }
          .tech-wrapper {
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
          }
          .tech-action {
            background: rgba(176, 80, 78, 0.18);
            border: 1px solid rgba(176, 80, 78, 0.45);
            border-radius: 6px;
            color: #ffd1d1;
            font-size: 11px;
            font-weight: 600;
            padding: 6px 8px;
            text-align: center;
            cursor: pointer;
            transition:
              background 120ms ease,
              border-color 120ms ease,
              color 120ms ease;
          }
          .tech-action:hover:not([disabled]) {
            background: rgba(176, 80, 78, 0.3);
            border-color: rgba(176, 80, 78, 0.6);
          }
          .tech-action[disabled] {
            opacity: 0.65;
            cursor: not-allowed;
          }
          .tech.priority {
            border-color: rgba(59, 130, 246, 0.9);
            box-shadow:
              0 0 0 2px rgba(59, 130, 246, 0.35) inset,
              0 0 10px 2px rgba(59, 130, 246, 0.25);
          }
          .tech .tooltip {
            position: absolute;
            top: 50%;
            left: calc(100% + 12px);
            transform: translateY(-50%);
            background: #111827;
            color: #e5e7eb;
            border: 1px solid #374151;
            border-radius: 8px;
            box-shadow:
              0 10px 20px rgba(0, 0, 0, 0.35),
              inset 0 0 0 1px rgba(255, 255, 255, 0.02);
            padding: 8px 10px;
            font-size: 12px;
            line-height: 1.25;
            max-width: 280px;
            width: max-content;
            z-index: 10;
            opacity: 0;
            visibility: hidden;
            transition: opacity 120ms ease;
            pointer-events: none;
            white-space: normal;
          }
          .tech .tooltip::after {
            content: "";
            position: absolute;
            left: -6px;
            top: 50%;
            transform: translateY(-50%);
            border-width: 6px;
            border-style: solid;
            border-color: transparent #111827 transparent transparent;
            filter: drop-shadow(-1px 0 0 rgba(55, 65, 81, 0.9));
          }
          .tech:hover .tooltip {
            opacity: 1;
            visibility: visible;
          }
          .progress-track {
            width: 100%;
            height: 6px;
            background: rgba(39, 71, 110, 0.25);
            border: 1px solid rgba(39, 71, 110, 0.35);
            border-radius: 6px;
            overflow: hidden;
            margin: 6px 0 4px;
          }
          .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #00f8ff 0%, #00a6f6 100%);
            box-shadow:
              0 0 10px rgba(37, 150, 186, 0.55),
              0 0 16px rgba(0, 166, 246, 0.35),
              inset 0 0 4px rgba(255, 255, 255, 0.1);
          }
          .progress-fill.priority {
            background: linear-gradient(90deg, #00f8ff 0%, #00a6f6 100%);
            box-shadow:
              0 0 14px rgba(0, 166, 246, 0.75),
              0 0 26px rgba(0, 248, 255, 0.6),
              0 0 32px rgba(0, 166, 246, 0.5),
              inset 0 0 6px rgba(255, 255, 255, 0.16),
              inset 0 0 0 1px rgba(255, 255, 255, 0.12);
          }
          .cost-inline {
            display: inline-flex;
            align-items: flex-end;
            gap: 6px;
            font-size: 12px;
            color: #dbe7ff;
            opacity: 0.95;
            margin: 2px 0 4px;
          }
          .cost-inline img {
            width: 14px;
            height: 14px;
            transform: translateY(-1px);
            opacity: 0.95;
          }
          .pill {
            font-size: 10px;
            border-radius: 999px;
            padding: 2px 6px;
            display: inline-block;
            margin-right: 6px;
          }
          .pill-req {
            background: rgba(176, 80, 78, 0.18);
            color: #ffd1d1;
            border: 1px solid rgba(176, 80, 78, 0.45);
          }
          .pill-oneof {
            background: rgba(245, 158, 11, 0.14);
            color: #ffe8a3;
            border: 1px solid rgba(245, 158, 11, 0.35);
          }
          .line-layer {
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 1;
          }
          .line-layer svg {
            width: 100%;
            height: 100%;
            overflow: visible;
          }
          .edge {
            stroke-width: 2;
          }
          .edge.req {
            stroke: rgba(176, 80, 78, 0.85);
          }
          .edge.oneof {
            stroke: rgba(245, 158, 11, 0.85);
            stroke-dasharray: 6 4;
          }
          .edge.highlight {
            stroke-width: 3;
            filter: drop-shadow(0 0 4px rgba(59, 130, 246, 0.45));
          }
        </style>
        ${this.renderLegend()}
        <div class="tab-shell">
          <div class="tab-bar">
            <div class="tab-buttons" role="tablist">
              ${tabs.map((cat) => {
                const isAllTab = cat === "Overview";
                const isActive = isAllTab ? isAllView : cat === activeCategory;
                return html`<button
                  type="button"
                  class="tab-button ${isActive ? "active" : ""}"
                  role="tab"
                  aria-selected=${String(isActive)}
                  style=${isActive
                    ? `--tab-accent:${isAllTab ? "rgba(148,163,184,0.25)" : (categoryColors[cat as Category] ?? "transparent")}`
                    : ""}
                  @click=${() => this.onTabClick(cat)}
                >
                  ${cat}
                </button>`;
              })}
            </div>
            <div class="investment-cluster">
              ${this.renderResearchSlider()}
              ${this.renderRoadSlider(me ?? null)}
            </div>
          </div>
          <div class="tab-panel" role="tabpanel">
            <div class="tree-container ${isAllView ? "all-view" : ""}">
              ${isAllView
                ? this.renderAllView(
                    levels,
                    researched,
                    categoryColors,
                    percentByTechId,
                  )
                : activeCategory
                  ? html`<div
                      class="level-strip"
                      style=${`--level-accent:${categoryColors[activeCategory] ?? "transparent"}`}
                    >
                      ${levels.map((lvl) => {
                        const techsForLevel = this.techs.filter(
                          (t) =>
                            t.level === lvl && t.category === activeCategory,
                        );
                        return html`<div class="level-column">
                          <div class="level-label">Tech Level ${lvl}</div>
                          <div class="tech-stack">
                            ${techsForLevel.length
                              ? techsForLevel.map((tech) => {
                                  const available = this.isAvailable(
                                    tech.id,
                                    researched,
                                  );
                                  const isResearched = researched.has(tech.id);
                                  const clickable = !isResearched;
                                  const inHighlight = highlightTrail.has(
                                    tech.id,
                                  );
                                  const classes = [
                                    "tech",
                                    available ? "" : "locked",
                                    isResearched ? "researched" : "",
                                    inHighlight ? "priority" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ");
                                  const action = this.renderScorchedEarthAction(
                                    tech,
                                    me ?? null,
                                    isResearched,
                                  );
                                  return html`<div class="tech-wrapper">
                                    <button
                                      class=${classes}
                                      data-id=${tech.id}
                                      @click=${() => this.onTechClick(tech.id)}
                                      title=${""}
                                      ?disabled=${!clickable}
                                    >
                                      <div class="tooltip">
                                        <div
                                          style="font-weight:600;margin-bottom:4px;"
                                        >
                                          ${tech.name}
                                        </div>
                                        ${tech.description
                                          ? html`<div
                                              style="opacity:.9;margin-bottom:6px;"
                                            >
                                              ${tech.description}
                                            </div>`
                                          : ""}
                                        ${(() => {
                                          const meLocal =
                                            this.game?.myPlayer?.();
                                          const b =
                                            meLocal?.researchBeakers?.(
                                              tech.id,
                                            ) ?? 0;
                                          const pct = Math.min(
                                            100,
                                            Math.floor(
                                              (b / (tech.cost || 1)) * 100,
                                            ),
                                          );
                                          return html`<div
                                            style="font-size:11px;opacity:.9;"
                                          >
                                            <div
                                              class="cost-inline"
                                              translate="no"
                                            >
                                              <span
                                                >Cost:
                                                ${tech.cost.toLocaleString()}</span
                                              >
                                              <img
                                                src=${flaskIcon}
                                                alt="research cost"
                                              />
                                            </div>
                                            ${isResearched
                                              ? html`<div>
                                                  Status: Completed
                                                </div>`
                                              : html`<div>
                                                  Progress:
                                                  ${b.toLocaleString()} /
                                                  ${tech.cost.toLocaleString()}
                                                  (${pct}%)
                                                </div>`}
                                          </div>`;
                                        })()}
                                      </div>
                                      <div
                                        style="font-weight:600; margin-bottom:6px;"
                                      >
                                        ${tech.name}
                                      </div>
                                      <div class="cost-inline" translate="no">
                                        <span
                                          >${tech.cost.toLocaleString()}</span
                                        >
                                        <img
                                          src=${flaskIcon}
                                          alt="research cost"
                                        />
                                      </div>
                                      ${!isResearched && me
                                        ? (() => {
                                            const b =
                                              me.researchBeakers?.(tech.id) ??
                                              0;
                                            const pct = Math.min(
                                              100,
                                              Math.floor(
                                                (b / (tech.cost || 1)) * 100,
                                              ),
                                            );
                                            return b > 0
                                              ? html`<div
                                                  class="progress-track"
                                                >
                                                  <div
                                                    class="progress-fill ${priority ===
                                                    tech.id
                                                      ? "priority"
                                                      : ""}"
                                                    style="width:${pct}%"
                                                  ></div>
                                                </div>`
                                              : "";
                                          })()
                                        : ""}
                                      <div>
                                        ${tech.requiresAllOf?.length
                                          ? html`<span class="pill pill-req"
                                              >Requires:
                                              ${tech.requiresAllOf.length}</span
                                            >`
                                          : ""}
                                        ${tech.requiresOneOf?.length
                                          ? html`<span class="pill pill-oneof"
                                              >One of:
                                              ${tech.requiresOneOf.length}</span
                                            >`
                                          : ""}
                                        ${priority === tech.id && !isResearched
                                          ? html`<span
                                              class="pill"
                                              style="background:rgba(59,130,246,0.18);color:#cfe3ff;border:1px solid rgba(59,130,246,0.45);"
                                              >Priority</span
                                            >`
                                          : ""}
                                      </div>
                                    </button>
                                    ${action}
                                  </div>`;
                                })
                              : html`<div class="empty-level">
                                  No techs at this level
                                </div>`}
                          </div>
                        </div>`;
                      })}
                    </div>`
                  : html`<div class="empty-state">
                      No research categories found.
                    </div>`}
              ${!isAllView
                ? html`<div class="line-layer"><svg></svg></div>`
                : ""}
            </div>
          </div>
        </div>
      </o-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "research-tree-modal": ResearchTreeModal;
  }
}
