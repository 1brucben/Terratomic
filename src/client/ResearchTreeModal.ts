import { html, LitElement, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import airIcon from "../../resources/icons/research/air.svg";
import landIcon from "../../resources/icons/research/land.svg";
import nuclearIcon from "../../resources/icons/research/nuclear.svg";
import seaIcon from "../../resources/icons/research/sea.svg";
import { EventBus } from "../core/EventBus";
import { GameView } from "../core/game/GameView";
import {
  getTechNodes,
  isTechAvailable as serverIsTechAvailable,
  type Category,
  type TechNode,
} from "../core/tech/ResearchTree";
import { getTechMeta } from "../core/tech/TechEffects";
import "./components/baseComponents/Modal";
import {
  INVESTMENT_REQUEST_EVENT,
  INVESTMENT_SYNC_EVENT,
  INVESTMENT_SYNC_REQUEST_EVENT,
  type InvestmentRequestDetail,
  type InvestmentSyncDetail,
} from "./events/InvestmentEvents";
import { CloseViewEvent } from "./InputHandler";
import { getDetailedTechTooltip } from "./TechTooltips";
import { SendResearchTreeSelectIntentEvent } from "./Transport";

/** Helper to get display name/description from TechEffects */
function getTechDisplay(tech: TechNode): {
  name: string;
  shortDescription?: string;
  description?: string;
} {
  const meta = getTechMeta(tech.id, { strict: false });
  return {
    name: meta?.name ?? tech.id,
    shortDescription: meta?.shortDescription ?? meta?.description,
    description: meta?.description,
  };
}

@customElement("research-tree-modal")
export class ResearchTreeModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @property({ type: Boolean }) visible: boolean = false;
  @property({ attribute: false }) game!: GameView;
  @property({ attribute: false }) eventBus!: EventBus;

  private refreshTimer: number | null = null;
  private techs: TechNode[] = [...getTechNodes()];
  // Fixed category ordering: Land, Sea, Air, Nuclear
  private categories: Category[] = ["Land", "Sea", "Air", "Nuclear"];

  @state()
  private researchInvestmentRate = 0;

  @state()
  private lockResearch = false;

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

  private isAvailable(id: string, researched: Set<string>): boolean {
    return serverIsTechAvailable(id, researched);
  }

  private researchedIDsFromGame(): Set<string> {
    const res = new Set<string>();
    const me = this.game?.myPlayer?.();
    if (!me) return res;
    for (const t of this.techs) if (me.hasResearchedTech(t.id)) res.add(t.id);
    return res;
  }

  private onTechClick(id: string) {
    if (!this.game || !this.eventBus) return;
    const me = this.game.myPlayer();
    if (!me) return;

    const researched = this.researchedIDsFromGame();
    if (me.hasResearchedTech?.(id)) return;

    // Find the clicked tech to get its level and category
    const clickedTech = this.techs.find((t) => t.id === id);
    if (!clickedTech) return;

    const priorities = me.researchPriorities?.() ?? new Set<string>();

    // If this tech is being prioritized (not toggled off)
    const willBePrioritized = !priorities.has(id);

    if (willBePrioritized) {
      // Remove priorities from same-level techs in other categories
      for (const tech of this.techs) {
        if (
          tech.level === clickedTech.level &&
          tech.category !== clickedTech.category &&
          priorities.has(tech.id)
        ) {
          this.eventBus.emit(new SendResearchTreeSelectIntentEvent(tech.id));
        }
      }
    }

    this.eventBus.emit(new SendResearchTreeSelectIntentEvent(id));
    this.requestUpdate();
  }

  private prioritizeCategory(category: Category) {
    if (!this.game || !this.eventBus) return;
    const me = this.game.myPlayer();
    if (!me) return;

    // First, clear all priorities from other categories
    const allTechs = this.techs;
    const researched = this.researchedIDsFromGame();
    const priorities = me.researchPriorities?.() ?? new Set<string>();

    // Remove priorities from techs in other categories
    for (const tech of allTechs) {
      if (tech.category !== category && priorities.has(tech.id)) {
        this.eventBus.emit(new SendResearchTreeSelectIntentEvent(tech.id));
      }
    }

    // Now prioritize all techs in this category that aren't already prioritized
    const categoryTechs = this.techs.filter((t) => t.category === category);

    for (const tech of categoryTechs) {
      if (!researched.has(tech.id) && !priorities.has(tech.id)) {
        this.eventBus.emit(new SendResearchTreeSelectIntentEvent(tech.id));
      }
    }

    // Force UI update after a short delay to show changes
    setTimeout(() => this.requestUpdate(), 50);
  }

  private handleInvestmentSync = (event: Event) => {
    const { detail } = event as CustomEvent<InvestmentSyncDetail>;
    if (!detail) return;
    this.researchInvestmentRate = detail.research;
    this.lockResearch = detail.lockResearch;
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

  private renderResearchSlider() {
    const percent = Math.round(this.researchInvestmentRate * 100);

    return html`
      <div class="investment-control">
        <span class="inv-label"
          >Investment: <span class="inv-percent">${percent}%</span></span
        >
        <div class="slider-wrapper">
          <input
            type="range"
            min="0"
            max="50"
            step="1"
            .value=${percent.toString()}
            class="research-slider"
            @input=${(e: Event) => this.handleInvestmentInput(e)}
          />
        </div>
      </div>
    `;
  }

  private handleInvestmentInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = Math.max(
      0,
      Math.min(1, (parseInt(input.value || "0", 10) || 0) / 100),
    );
    const locked = this.lockResearch;
    if (locked) {
      input.value = Math.round(this.researchInvestmentRate * 100).toString();
      return;
    }
    this.dispatchInvestmentRequest({ type: "set", slider: "research", value });
  }

  protected firstUpdated(_changed: PropertyValues): void {
    super.firstUpdated(_changed);
    this.requestInvestmentSync();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(
      INVESTMENT_SYNC_EVENT,
      this.handleInvestmentSync as EventListener,
    );
  }

  render() {
    const researched = this.researchedIDsFromGame();
    const categoryColors: Record<Category, string> = {
      Land: "#2ecc71",
      Sea: "#3498db",
      Air: "#9b59b6",
      Nuclear: "#e74c3c",
    };
    const me = this.game?.myPlayer?.();
    const priorities = me?.researchPriorities?.() ?? new Set<string>();

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

    // Group techs by category for the grid layout
    const techsByCategory = new Map<Category, TechNode[]>();
    for (const cat of this.categories) {
      techsByCategory.set(
        cat,
        this.techs.filter((t) => t.category === cat),
      );
    }

    return html`
      <o-modal
        title="Research"
        max-width="95vw"
        max-height="85dvh"
        content-overflow="auto"
        class="ui-scale-surface"
        style="--ui-scale-origin: center;"
      >
        <style>
          :host {
            --ui-text-light: #ecf0f1;
            --ui-text-accent: #bdc3c7;
            --ui-text-muted: #95a5a6;
            --ui-panel-shell-top: #34495e;
            --ui-panel-shell-bottom: #2c3e50;
            --ui-border: #465f75;
            --ui-info: #3498db;
          }

          .research-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            background-color: var(--ui-modal-content);
            width: 50vw;
            max-width: 95vw;
            gap: 0;
          }

          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background-color: var(--ui-modal-header);
            padding: 15px;
            border-bottom: 1px solid var(--ui-panel-border);
            flex-shrink: 0;
          }

          .header-title {
            font-size: 1.2em;
            font-weight: bold;
            color: #fff;
            letter-spacing: 1px;
          }

          .investment-control {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .inv-label {
            font-size: 0.9em;
            color: #bdc3c7;
            margin-right: 5px;
            text-transform: uppercase;
          }

          .slider-wrapper {
            display: flex;
            align-items: center;
            margin-left: 12px;
            width: 200px;
          }

          .research-slider {
            width: 100%;
            height: 6px;
            -webkit-appearance: none;
            appearance: none;
            background: #465f75;
            border-radius: 5px;
            outline: none;
            cursor: pointer;
          }

          .research-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #3498db;
            cursor: pointer;
            border: 2px solid #2c3e50;
            box-shadow: 0 0 6px rgba(52, 152, 219, 0.5);
          }

          .research-slider::-moz-range-thumb {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #3498db;
            cursor: pointer;
            border: 2px solid #2c3e50;
            box-shadow: 0 0 6px rgba(52, 152, 219, 0.5);
          }

          .research-slider::-webkit-slider-runnable-track {
            background: linear-gradient(to right, #3498db, #3498db) no-repeat;
            background-size: calc((var(--value, 0) / 50) * 100%) 100%;
            background-color: #465f75;
          }

          .categories-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 2px;
            background-color: var(--ui-panel-border);
            padding: 2px;
            flex: 1;
            overflow: auto;
          }

          @media (max-width: 900px) {
            .categories-grid {
              grid-template-columns: 1fr;
            }
          }

          .category {
            padding: 12px;
            background-color: var(--ui-panel-shell-top);
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .category-header {
            font-size: 1.05em;
            font-weight: bold;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .category-icon {
            width: 24px;
            height: 24px;
            background-color: currentColor;
            -webkit-mask-size: contain;
            mask-size: contain;
            -webkit-mask-repeat: no-repeat;
            mask-repeat: no-repeat;
            -webkit-mask-position: center;
            mask-position: center;
          }

          .tech-row {
            display: flex;
            align-items: center;
            background: var(--ui-table-row-bg);
            padding: 6px;
            border-radius: 4px;
            border: 1px solid var(--ui-panel-border);
            gap: 8px;
            cursor: pointer;
            transition: all 0.2s;
          }

          .tech-row:hover {
            background: var(--ui-table-row-hover);
          }

          .tech-row.researched {
            opacity: 0.7;
          }

          .tech-row.locked {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .tech-info {
            width: 160px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .tech-name {
            font-size: 0.95em;
            font-weight: 600;
            color: var(--ui-text-default);
          }

          .tech-desc {
            font-size: 0.75em;
            color: var(--ui-text-muted);
          }

          .progress-container {
            flex-grow: 1;
            height: 8px;
            background-color: var(--ui-slider-track);
            border-radius: 5px;
            overflow: hidden;
            border: 1px solid var(--ui-panel-border);
            margin: 0 4px;
          }

          .progress-bar {
            height: 100%;
            transition: width 0.3s;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.2) inset;
          }

          .progress-text {
            position: absolute;
            right: 5px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 9px;
            color: #fff;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
            font-family: monospace;
          }

          .priority-btn {
            background: none;
            border: 1px solid var(--ui-border-muted);
            color: var(--ui-text-muted);
            cursor: pointer;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: 600;
            white-space: nowrap;
            transition: all 0.2s;
            flex-shrink: 0;
          }

          .priority-btn:hover:not(:disabled) {
            background: var(--ui-secondary);
            color: var(--ui-text-default);
            border-color: var(--ui-text-light);
          }

          .priority-btn.active {
            background: #f39c12;
            color: #fff;
            border-color: #e67e22;
            box-shadow: 0 0 8px rgba(243, 156, 18, 0.4);
          }

          .priority-btn:disabled {
            cursor: not-allowed;
            opacity: 0.8;
          }

          .priority-btn.locked-prioritized {
            background: #f39c12;
            color: #fff;
            border-color: #e67e22;
            opacity: 0.7;
          }

          .category-prioritize-btn {
            background: none;
            border: 1px solid var(--ui-border-muted);
            color: var(--ui-text-muted);
            cursor: pointer;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: 600;
            margin-left: auto;
            transition: all 0.2s;
            white-space: nowrap;
          }

          .category-prioritize-btn:hover {
            background: var(--ui-secondary);
            color: var(--ui-text-default);
            border-color: var(--ui-text-light);
          }

          .category-prioritize-btn.active {
            background: #f39c12;
            color: #fff;
            border-color: #e67e22;
            box-shadow: 0 0 8px rgba(243, 156, 18, 0.4);
          }

          .bar-sea {
            background-color: #3498db;
          }
          .bar-land {
            background-color: #27ae60;
          }
          .bar-air {
            background-color: #8e44ad;
          }
          .bar-nuclear {
            background-color: #c0392b;
          }

          .cat-sea {
            color: #3498db;
            text-shadow: 0 0 10px rgba(52, 152, 219, 0.2);
          }
          .cat-land {
            color: #2ecc71;
            text-shadow: 0 0 10px rgba(46, 204, 113, 0.2);
          }
          .cat-air {
            color: #9b59b6;
            text-shadow: 0 0 10px rgba(155, 89, 182, 0.2);
          }
          .cat-nuclear {
            color: #e74c3c;
            text-shadow: 0 0 10px rgba(231, 76, 60, 0.2);
          }
        </style>

        <div class="research-container">
          <div class="header">
            <div class="header-title">Research</div>
            ${this.renderResearchSlider()}
          </div>

          <div class="categories-grid">
            ${this.categories.map((cat) => {
              const techs = techsByCategory.get(cat) ?? [];
              const catClass = `cat-${cat.toLowerCase()}`;

              const icons: Record<string, string> = {
                Land: landIcon,
                Sea: seaIcon,
                Air: airIcon,
                Nuclear: nuclearIcon,
              };
              const iconSrc = icons[cat];

              // Check if all non-researched techs in category are prioritized
              const nonResearchedTechs = techs.filter(
                (t) => !researched.has(t.id),
              );
              const allPrioritized =
                nonResearchedTechs.length > 0 &&
                nonResearchedTechs.every((t) => priorities.has(t.id));

              return html`
                <div class="category">
                  <div class="category-header ${catClass}">
                    ${iconSrc
                      ? html`<div
                          class="category-icon"
                          style="-webkit-mask-image: url('${iconSrc}'); mask-image: url('${iconSrc}')"
                        ></div>`
                      : ""}
                    ${cat.toUpperCase()}
                    <button
                      class="category-prioritize-btn ${allPrioritized
                        ? "active"
                        : ""}"
                      @click=${() => this.prioritizeCategory(cat)}
                      title="Prioritize all ${cat} techs"
                    >
                      ${allPrioritized ? "⭐ Prioritized" : "☆ Prioritize"}
                    </button>
                  </div>
                  ${techs.map((tech) => {
                    const available = this.isAvailable(tech.id, researched);
                    const isResearched = researched.has(tech.id);
                    const pct = percentByTechId.get(tech.id) ?? 0;
                    const isPriority = priorities.has(tech.id);
                    const display = getTechDisplay(tech);
                    const tooltip = getDetailedTechTooltip(tech.id);

                    const rowClass = [
                      "tech-row",
                      isResearched ? "researched" : "",
                      !available && !isResearched ? "locked" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");

                    const barClass = `bar-${cat.toLowerCase()}`;

                    // Locked techs show as prioritized (yellow) if they're set as priority
                    const btnClass = [
                      "priority-btn",
                      isPriority && available
                        ? "active"
                        : isPriority && !available
                          ? "locked-prioritized"
                          : "",
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return html`
                      <div
                        class="${rowClass}"
                        @click=${() => this.onTechClick(tech.id)}
                        title=${tooltip}
                      >
                        <div class="tech-info">
                          <div class="tech-name">${display.name}</div>
                          <div class="tech-desc">
                            ${display.shortDescription ?? ""}
                          </div>
                        </div>
                        <div
                          class="progress-container"
                          style="position: relative;"
                        >
                          <div
                            class="progress-bar ${barClass}"
                            style="width: ${pct}%"
                          ></div>
                          ${pct > 0 && pct < 100
                            ? html`<span class="progress-text">${pct}%</span>`
                            : ""}
                        </div>
                        <button
                          class="${btnClass}"
                          ?disabled=${isResearched}
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            if (!isResearched) {
                              this.onTechClick(tech.id);
                            }
                          }}
                        >
                          ${isResearched
                            ? "✓ Done"
                            : !available && isPriority
                              ? "🔒 Locked"
                              : !available
                                ? "🔒 Locked"
                                : isPriority
                                  ? "⭐ Prioritized"
                                  : "☆ Prioritize"}
                        </button>
                      </div>
                    `;
                  })}
                </div>
              `;
            })}
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
