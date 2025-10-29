import { LitElement, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
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
import { CloseViewEvent } from "./InputHandler";
import {
  SendPurchaseUpgradeIntentEvent,
  SendResearchTreeSelectIntentEvent,
} from "./Transport";
import { renderNumber } from "./Utils";

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
  // Fixed column widths per category (px). Adjust as needed.
  private readonly categoryColumnWidths: Record<Category, number> = {
    Land: 360,
    Sea: 360,
    Air: 360,
    Nuclear: 360,
    Economy: 360,
  };

  connectedCallback(): void {
    super.connectedCallback();
    if (this.visible) this.open();
  }

  open() {
    this.modalEl?.open();
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

  // Apply fixed widths to each level grid so columns line up between rows
  private applyCategoryWidths() {
    const tree = this.renderRoot.querySelector(
      ".tree-container",
    ) as HTMLElement | null;
    if (!tree) return;
    const template = this.categories
      .map((cat) => `${this.categoryColumnWidths[cat]}px`)
      .join(" ");
    tree
      .querySelectorAll(".level-grid")
      .forEach(
        (grid) => ((grid as HTMLElement).style.gridTemplateColumns = template),
      );
  }

  // Position the colored category bands to match the computed column geometry
  private updateCategoryBandPositions() {
    const tree = this.renderRoot.querySelector(
      ".tree-container",
    ) as HTMLElement | null;
    if (!tree) return;
    const bands = this.renderRoot.querySelectorAll(
      ".category-bands .category-band",
    ) as NodeListOf<HTMLElement>;
    const firstGrid = tree.querySelector(".level-grid") as HTMLElement | null;
    if (!firstGrid || bands.length !== this.categories.length) return;
    const rootRect = tree.getBoundingClientRect();
    const scrollLeft = tree.scrollLeft;
    const contentHeight = tree.scrollHeight;
    const slots = firstGrid.querySelectorAll(
      ":scope > .category-slot",
    ) as NodeListOf<HTMLElement>;
    slots.forEach((slot, i) => {
      const r = slot.getBoundingClientRect();
      const left = r.left - rootRect.left + scrollLeft;
      const width = r.width;
      const band = bands[i];
      band.style.position = "absolute";
      band.style.left = `${left}px`;
      band.style.width = `${width}px`;
      band.style.top = "0";
      band.style.bottom = "auto";
      band.style.height = `${contentHeight}px`;
    });
    // Reveal the bands immediately after positioning
    const bandsContainer = this.renderRoot.querySelector(
      ".category-bands",
    ) as HTMLElement | null;
    if (bandsContainer) {
      bandsContainer.style.height = `${contentHeight}px`;
      bandsContainer.style.bottom = "auto";
      bandsContainer.style.visibility = "visible";
    }
  }

  // Orchestrate layout updates and edge redraw
  private updateLayout() {
    // Apply fixed widths and then position bands/edges
    requestAnimationFrame(() => {
      this.applyCategoryWidths();
      requestAnimationFrame(() => {
        this.updateCategoryBandPositions();
        this.drawEdges();
      });
    });
  }

  private drawEdges() {
    const container = this.renderRoot.querySelector(
      ".line-layer",
    ) as HTMLElement | null;
    if (!container) return;
    const svg = container.querySelector("svg")!;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const pos = this.computePositions();
    const treeEl = this.renderRoot.querySelector(
      ".tree-container",
    ) as HTMLElement;
    const rootRect = treeEl.getBoundingClientRect();
    const scrollLeft = treeEl.scrollLeft;
    const scrollTop = treeEl.scrollTop;

    // Compute highlight path based on priority and current researched
    const me = this.game?.myPlayer?.();
    const researched = this.researchedIDsFromGame();
    const priority = me?.researchPriorityTech?.() ?? null;

    const byId = new Map(this.techs.map((n) => [n.id, n] as const));
    const sameCat = (a: string, b: string) =>
      (byId.get(a)?.category ?? "") === (byId.get(b)?.category ?? "");
    const buildMissingPrereqPath = (targetId: string): Set<string> => {
      const path = new Set<string>();
      const seen = new Set<string>();
      const dfs = (tid: string) => {
        if (seen.has(tid)) return;
        seen.add(tid);
        const node = byId.get(tid);
        if (!node) return;
        const reqAll = (node.requiresAllOf ?? []).filter((p) =>
          sameCat(p, tid),
        );
        const reqOne = (node.requiresOneOf ?? []).filter((p) =>
          sameCat(p, tid),
        );
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
      if (targetId) dfs(targetId);
      return path;
    };

    const highlightNodes = new Set<string>();
    if (priority) {
      highlightNodes.add(priority);
      const missing = buildMissingPrereqPath(priority);
      for (const id of missing) highlightNodes.add(id);
    }

    const addLine = (fromId: string, toId: string, cls: string) => {
      const a = pos[fromId];
      const b = pos[toId];
      if (!a || !b) return;
      const x1 = a.left - rootRect.left + scrollLeft + a.width / 2;
      const y1 = a.top - rootRect.top + scrollTop + a.height;
      const x2 = b.left - rootRect.left + scrollLeft + b.width / 2;
      const y2 = b.top - rootRect.top + scrollTop;
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      const mx = (x1 + x2) / 2;
      const d = `M ${x1},${y1} C ${mx},${y1 + 20} ${mx},${y2 - 20} ${x2},${y2}`;
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

    for (const t of this.techs) {
      const sameCat = (p: string) =>
        this.techs.find((x) => x.id === p)?.category === t.category;
      t.requiresAllOf ??= [];
      t.requiresOneOf ??= [];

      const reqAll = t.requiresAllOf.filter(sameCat);
      const reqOne = t.requiresOneOf.filter(sameCat);

      for (const p of reqAll) addLine(p, t.id, "req");
      for (const p of reqOne) addLine(p, t.id, "oneof");
    }
  }

  protected firstUpdated(): void {
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
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.handleResize);
    // content no longer scrolls for this modal; listener removed
    const tree = this.renderRoot.querySelector(".tree-container");
    tree?.removeEventListener("scroll", this.handleResize as any);
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

    return html`
      <!-- Prevent outer content from scrolling; use inner tree scroll only -->
      <o-modal
        title="Research Tree"
        max-width="90vw"
        max-height="85dvh"
        content-overflow="hidden"
      >
        <style>
          .tree-container {
            display: grid;
            /* Size each category column to its content and allow overall horizontal scroll */
            grid-template-columns: repeat(5, minmax(160px, max-content));
            grid-auto-rows: auto;
            gap: 16px;
            position: relative;
            overflow-x: auto;
            overflow-y: auto; /* inner scroll */
            width: 100%;
            /* constrain height to modal content so vertical scroll stays inside */
            max-height: calc(85dvh - 100px);
            padding-bottom: 4px; /* space for scrollbar overlay */
            /* Firefox scrollbar */
            scrollbar-width: thin;
            scrollbar-color: #27476e #0e1a33; /* thumb track */
          }
          /* WebKit-based browsers scrollbar */
          .tree-container::-webkit-scrollbar {
            height: 10px; /* horizontal scrollbar thickness */
            width: 10px; /* vertical scrollbar thickness */
            background: transparent; /* let track define color */
          }
          .tree-container::-webkit-scrollbar-track {
            background: #0e1a33; /* deep navy track */
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
          .category-bands {
            position: absolute;
            inset: 0;
            display: block; /* absolute children are positioned by JS */
            z-index: 0;
            pointer-events: none;
            visibility: hidden; /* avoid flicker before positioned */
          }
          .category-band {
            border-left: 1px solid rgba(255, 255, 255, 0.05);
            border-right: 1px solid rgba(0, 0, 0, 0.25);
          }
          .level-band {
            grid-column: 1 / -1;
            border-radius: 8px;
            padding: 6px; /* slightly tighter vertical spacing */
          }
          .level-header {
            font-weight: bold;
            color: #e3edff; /* submarine heading */
            margin-bottom: 6px; /* reduce header-bottom gap */
            padding-left: 6px; /* add a bit of left room */
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .level-grid {
            display: grid;
            /* Make each category column width fit its widest cell content */
            grid-template-columns: repeat(5, minmax(160px, max-content));
            gap: 10px; /* slightly less gap between categories */
          }
          .category-slot {
            display: flex;
            flex-direction: column;
            gap: 6px; /* slightly reduce space between title and row */
            width: auto; /* allow to grow */
            padding: 6px 12px; /* slightly reduce vertical padding */
            box-sizing: border-box;
          }
          .tech-row {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap; /* keep items horizontal, wrap if too many for fixed column */
            align-items: flex-start;
            justify-content: center; /* center techs within the category */
            gap: 6px; /* slightly tighter spacing between cards */
            /* No per-row scroll; the entire tree scrolls */
            overflow: visible;
            width: 100%;
          }
          .category-title {
            font-size: 12px;
            text-transform: uppercase;
            opacity: 0.8;
            color: #c9dbff; /* submarine label */
            margin-bottom: 4px;
          }
          .tech {
            background: #0b1220; /* submarine panel */
            border: 1px solid #0e1a33; /* deep navy border */
            border-radius: 8px;
            padding: 8px;
            color: #dbe7ff; /* soft desaturated light-blue */
            position: relative;
            cursor: pointer;
            transition:
              transform 0.12s ease,
              box-shadow 0.12s ease,
              opacity 0.2s;
            min-height: 64px;
            /* Let multiple techs sit side-by-side */
            flex: 0 0 auto;
            width: 160px;
            text-align: left;
          }
          .tech:hover {
            box-shadow: 0 0 0 2px rgba(39, 71, 110, 0.8) inset; /* bluish rim */
          }
          .tech.locked {
            opacity: 1; /* allow full visibility so users can prioritize paths */
            cursor: pointer;
          }
          .tech.researched {
            background: #162544; /* slightly lighter */
            border-color: #27476e;
          }
          .tech.researched::after {
            content: "\\2713";
            position: absolute;
            top: 6px;
            right: 8px;
            font-weight: bold;
            color: #86efac; /* keep success green */
            text-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
          }
          .tech-wrapper {
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 160px;
            flex: 0 0 auto;
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
          /* Highlight prioritized tech with a subtle halo */
          .tech.priority {
            border-color: rgba(59, 130, 246, 0.9);
            box-shadow:
              0 0 0 2px rgba(59, 130, 246, 0.35) inset,
              0 0 10px 2px rgba(59, 130, 246, 0.25);
          }
          /* Themed tooltip for tech descriptions (right-side) */
          .tech .tooltip {
            position: absolute;
            top: 50%;
            left: calc(100% + 8px);
            transform: translateY(-50%);
            background: #111827; /* modal dark */
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
            border-color: transparent #111827 transparent transparent; /* caret pointing right */
            filter: drop-shadow(-1px 0 0 rgba(55, 65, 81, 0.9));
          }
          .tech:hover .tooltip {
            opacity: 1;
            visibility: visible;
          }
          /* Research progress bar */
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
            /* Match flask colors exactly */
            background: linear-gradient(90deg, #00f8ff 0%, #00a6f6 100%);
            box-shadow:
              0 0 10px rgba(37, 150, 186, 0.55),
              0 0 16px rgba(0, 166, 246, 0.35),
              inset 0 0 4px rgba(255, 255, 255, 0.1);
          }
          .progress-fill.priority {
            /* Same flask gradient, but stronger neon to pop more than base */
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
            /* Align bottoms of number and icon */
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
            /* Slight nudge up to visually align with text bottom across platforms */
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
            background: rgba(176, 80, 78, 0.18); /* warning red match */
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
        <div class="tree-container">
          <div class="category-bands">
            ${this.categories.map(
              (cat) =>
                html`<div
                  class="category-band"
                  style="background:${categoryColors[cat]}"
                ></div>`,
            )}
          </div>
          ${levels.map(
            (lvl) => html`
              <div class="level-band">
                <div class="level-header">Tech Level ${lvl}</div>
                <div class="level-grid">
                  ${this.categories.map((cat) => {
                    const techs = this.techs.filter(
                      (t) => t.level === lvl && t.category === cat,
                    );
                    return html`
                      <div class="category-slot">
                        <div class="category-title">${cat}</div>
                        <div class="tech-row">
                          ${techs.map((tech) => {
                            const available = this.isAvailable(
                              tech.id,
                              researched,
                            );
                            const isResearched = researched.has(tech.id);
                            const clickable = !isResearched; // allow prioritizing locked techs
                            // Compute highlight membership for this node
                            const byId = new Map(
                              this.techs.map((n) => [n.id, n] as const),
                            );
                            const sameCat = (a: string, b: string) =>
                              (byId.get(a)?.category ?? "") ===
                              (byId.get(b)?.category ?? "");
                            const buildMissingPrereqPath = (
                              targetId: string,
                            ): Set<string> => {
                              const path = new Set<string>();
                              const seen = new Set<string>();
                              const dfs = (tid: string) => {
                                if (seen.has(tid)) return;
                                seen.add(tid);
                                const node = byId.get(tid);
                                if (!node) return;
                                const reqAll = (
                                  node.requiresAllOf ?? []
                                ).filter((p) => sameCat(p, tid));
                                const reqOne = (
                                  node.requiresOneOf ?? []
                                ).filter((p) => sameCat(p, tid));
                                for (const r of reqAll) {
                                  if (!researched.has(r)) {
                                    path.add(r);
                                    dfs(r);
                                  }
                                }
                                if (
                                  reqOne.length > 0 &&
                                  !reqOne.some((p) => researched.has(p))
                                ) {
                                  const sorted = [...reqOne].sort(
                                    (a, b) =>
                                      (byId.get(a)?.level ?? 0) -
                                      (byId.get(b)?.level ?? 0),
                                  );
                                  const choice = sorted[0];
                                  if (choice && !researched.has(choice)) {
                                    path.add(choice);
                                    dfs(choice);
                                  }
                                }
                              };
                              if (priority) dfs(priority);
                              return path;
                            };
                            const highlightSet = (() => {
                              const s = new Set<string>();
                              if (priority) {
                                s.add(priority);
                                const missing =
                                  buildMissingPrereqPath(priority);
                                for (const id of missing) s.add(id);
                              }
                              return s;
                            })();
                            const inHighlight = highlightSet.has(tech.id);

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
                            return html`
                              <div class="tech-wrapper">
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
                                      const meLocal = this.game?.myPlayer?.();
                                      const b =
                                        meLocal?.researchBeakers?.(tech.id) ??
                                        0;
                                      const pct = Math.min(
                                        100,
                                        Math.floor(
                                          (b / (tech.cost || 1)) * 100,
                                        ),
                                      );
                                      return html`<div
                                        style="font-size:11px;opacity:.9;"
                                      >
                                        <div class="cost-inline" translate="no">
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
                                          ? html`<div>Status: Completed</div>`
                                          : html`<div>
                                              Progress: ${b.toLocaleString()} /
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
                                    <span>${tech.cost.toLocaleString()}</span>
                                    <img src=${flaskIcon} alt="research cost" />
                                  </div>
                                  ${!isResearched && me
                                    ? (() => {
                                        const b =
                                          me.researchBeakers?.(tech.id) ?? 0;
                                        const pct = Math.min(
                                          100,
                                          Math.floor(
                                            (b / (tech.cost || 1)) * 100,
                                          ),
                                        );
                                        return b > 0
                                          ? html`<div class="progress-track">
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
                              </div>
                            `;
                          })}
                        </div>
                      </div>
                    `;
                  })}
                </div>
              </div>
            `,
          )}
          <div class="line-layer"><svg></svg></div>
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
