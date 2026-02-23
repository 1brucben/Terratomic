/**
 * MobileResearchPanel - Native mobile research interface
 * Designed from scratch for mobile touch interaction
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import airIcon from "../../../../resources/icons/research/air.svg";
import landIcon from "../../../../resources/icons/research/land.svg";
import nuclearIcon from "../../../../resources/icons/research/nuclear.svg";
import seaIcon from "../../../../resources/icons/research/sea.svg";
import type { EventBus } from "../../../core/EventBus";
import type { GameView } from "../../../core/game/GameView";
import {
  getTechNodes,
  isTechAvailable,
  type Category,
  type TechNode,
} from "../../../core/tech/ResearchTree";
import { getTechMeta } from "../../../core/tech/TechEffects";
import {
  SendResearchTreeSelectBatchIntentEvent,
  SendResearchTreeSelectIntentEvent,
} from "../../Transport";
import { HapticFeedback } from "../utils/HapticFeedback";

const categoryIconSources: Record<Category, string> = {
  Land: landIcon,
  Sea: seaIcon,
  Air: airIcon,
  Nuclear: nuclearIcon,
};

@customElement("mobile-research-panel")
export class MobileResearchPanel extends LitElement {
  @property({ type: Object }) game: GameView | null = null;
  @property({ type: Object }) eventBus: EventBus | null = null;

  @state() private activeCategory: Category = "Land";

  private techs: TechNode[] = [...getTechNodes()];
  private categories: Category[] = ["Land", "Sea", "Air", "Nuclear"];
  private refreshTimer: number | null = null;

  static styles = css`
    :host {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background:
        linear-gradient(
          180deg,
          rgba(128, 138, 151, 0.1) 0%,
          rgba(68, 78, 91, 0.06) 30%,
          rgba(14, 19, 26, 0.02) 100%
        ),
        linear-gradient(to bottom, #1a2332, #0f1419);
      color: white;
      font-family:
        system-ui,
        -apple-system,
        sans-serif;
    }

    /* Category filter tabs */
    .category-tabs {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      padding: 10px;
      background: linear-gradient(
        180deg,
        rgba(13, 18, 26, 0.84) 0%,
        rgba(10, 14, 20, 0.9) 100%
      );
      border-bottom: 1px solid rgba(150, 161, 174, 0.22);
      box-shadow:
        inset 0 1px 0 rgba(236, 243, 251, 0.07),
        inset 0 -1px 0 rgba(0, 0, 0, 0.45);
      flex-shrink: 0;
    }

    .category-tab {
      padding: 8px 6px;
      border-radius: 10px;
      background: linear-gradient(
        180deg,
        rgba(20, 26, 35, 0.86) 0%,
        rgba(11, 16, 23, 0.9) 100%
      );
      border: 1px solid rgba(120, 131, 145, 0.32);
      color: rgba(190, 201, 214, 0.88);
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      cursor: pointer;
      transition: all 0.2s;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      min-width: 0;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        inset 0 -2px 4px rgba(0, 0, 0, 0.38);
    }

    .category-tab.cat-land {
      color: #2ecc71;
    }

    .category-tab.cat-sea {
      color: #3498db;
    }

    .category-tab.cat-air {
      color: #9b59b6;
    }

    .category-tab.cat-nuclear {
      color: #e74c3c;
    }

    .category-tab-icon,
    .category-icon {
      width: 18px;
      height: 18px;
      background-color: currentColor;
      -webkit-mask-image: var(--icon-url);
      mask-image: var(--icon-url);
      -webkit-mask-size: contain;
      mask-size: contain;
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
      -webkit-mask-position: center;
      mask-position: center;
      display: inline-block;
      flex-shrink: 0;
    }

    .category-tab-icon {
      width: 14px;
      height: 14px;
    }

    .category-tab.active {
      background: linear-gradient(
        180deg,
        rgba(28, 53, 87, 0.58) 0%,
        rgba(15, 29, 46, 0.92) 100%
      );
      border-color: rgba(96, 159, 246, 0.72);
      color: rgba(152, 206, 255, 0.96);
    }

    .category-tab:active {
      transform: scale(0.95);
    }

    .category-tab.prioritized {
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.08),
        0 0 12px rgba(115, 189, 255, 0.38);
      border-color: rgba(115, 189, 255, 0.68);
    }

    .category-tab.prioritized.active {
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.12),
        0 0 12px rgba(115, 189, 255, 0.48);
    }

    /* Tech grid */
    .tech-scroll {
      height: 100%;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }

    .tech-grid {
      padding: 12px;
    }

    .category-section {
      margin-bottom: 18px;
    }

    .category-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      padding: 7px 10px;
      background: linear-gradient(
        180deg,
        rgba(22, 29, 38, 0.84) 0%,
        rgba(13, 18, 24, 0.92) 100%
      );
      border-radius: 8px;
      border-left: 3px solid;
      border-top: 1px solid rgba(235, 242, 250, 0.05);
      border-right: 1px solid rgba(94, 105, 120, 0.25);
      border-bottom: 1px solid rgba(94, 105, 120, 0.25);
    }

    .category-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .category-priority-button {
      border: 1px solid currentColor;
      background: linear-gradient(
        180deg,
        rgba(18, 25, 33, 0.82) 0%,
        rgba(9, 14, 20, 0.88) 100%
      );
      color: currentColor;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    .category-priority-button.active {
      background: rgba(255, 255, 255, 0.12);
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.16);
    }

    .category-header.land {
      border-color: #2ecc71;
      color: #2ecc71;
    }

    .category-header.sea {
      border-color: #3498db;
      color: #3498db;
    }

    .category-header.air {
      border-color: #9b59b6;
      color: #9b59b6;
    }

    .category-header.nuclear {
      border-color: #e74c3c;
      color: #e74c3c;
    }

    .category-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .category-header.land .category-title {
      color: #2ecc71;
    }

    .category-header.sea .category-title {
      color: #3498db;
    }

    .category-header.air .category-title {
      color: #9b59b6;
    }

    .category-header.nuclear .category-title {
      color: #e74c3c;
    }

    /* Tech card */
    .tech-card {
      background: linear-gradient(
        135deg,
        rgba(48, 67, 88, 0.42),
        rgba(20, 28, 38, 0.74)
      );
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 8px;
      border: 1px solid rgba(126, 136, 148, 0.3);
      cursor: pointer;
      transition: all 0.2s;
      -webkit-tap-highlight-color: transparent;
      position: relative;
      overflow: hidden;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.05),
        inset 0 -2px 5px rgba(0, 0, 0, 0.38);
    }

    .tech-card:active {
      transform: scale(0.98);
    }

    .tech-card.researched {
      background: linear-gradient(
        135deg,
        rgba(46, 204, 113, 0.24),
        rgba(24, 90, 58, 0.46)
      );
      border-color: #2ecc71;
    }

    .tech-card.prioritized {
      border-color: #f0ad42;
      box-shadow: 0 0 0 2px rgba(240, 173, 66, 0.28);
    }

    .tech-card.unavailable {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .progress-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 4px;
      background: linear-gradient(to right, #3498db, #2ecc71);
      transition: width 0.3s;
    }

    .tech-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 6px;
    }

    .tech-name {
      font-size: 14px;
      font-weight: 700;
      color: rgba(239, 244, 250, 0.98);
      line-height: 1.3;
      flex: 1;
    }

    .tech-status {
      font-size: 10px;
      padding: 3px 7px;
      border-radius: 12px;
      font-weight: 600;
      margin-left: 8px;
      white-space: nowrap;
    }

    .tech-status.complete {
      background: rgba(46, 204, 113, 0.3);
      color: #2ecc71;
    }

    .tech-status.priority {
      background: rgba(243, 156, 18, 0.3);
      color: #f39c12;
    }

    .tech-status.progress {
      background: rgba(52, 152, 219, 0.3);
      color: #3498db;
    }

    .tech-description {
      font-size: 12px;
      color: rgba(193, 202, 214, 0.9);
      line-height: 1.4;
      margin-bottom: 6px;
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #7f8c8d;
    }

    .empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
      opacity: 0.5;
    }

    .empty-text {
      font-size: 14px;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    this.startRefreshTimer();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopRefreshTimer();
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      return;
    }

    this.refreshTimer = window.setInterval(() => {
      if (document.hidden) {
        return;
      }

      const sidebar = this.closest("mobile-research-sidebar");
      if (sidebar && !sidebar.hasAttribute("visible")) {
        return;
      }

      this.requestUpdate();
    }, 500);
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private handleCategoryClick(category: Category): void {
    this.activeCategory = category;
    HapticFeedback.tap();
  }

  private researchedIDsFromGame(): Set<string> {
    const res = new Set<string>();
    const me = this.game?.myPlayer?.();
    if (!me) return res;
    for (const t of this.techs) if (me.hasResearchedTech(t.id)) res.add(t.id);
    return res;
  }

  private handleTechClick(tech: TechNode): void {
    if (!this.game || !this.eventBus) return;
    const me = this.game.myPlayer();
    if (!me) return;

    const researched = this.researchedIDsFromGame();
    if (researched.has(tech.id)) return;

    const clickedTech = this.techs.find((t) => t.id === tech.id);
    if (!clickedTech) return;

    const priorities = me.researchPriorities?.() ?? new Set<string>();
    const willBePrioritized = !priorities.has(tech.id);

    if (willBePrioritized) {
      // Remove priorities from same-level techs in other categories
      for (const t of this.techs) {
        if (
          t.level === clickedTech.level &&
          t.category !== clickedTech.category &&
          priorities.has(t.id)
        ) {
          this.eventBus.emit(new SendResearchTreeSelectIntentEvent(t.id));
        }
      }
    }

    this.eventBus.emit(new SendResearchTreeSelectIntentEvent(tech.id));
    HapticFeedback.tap();
  }

  private handleCategoryPrioritize(
    category: Category,
    researched: Set<string>,
    priorities: Set<string>,
  ): void {
    if (!this.game || !this.eventBus) return;

    const categoryTechs = this.techs.filter((t) => t.category === category);
    const nonResearched = categoryTechs.filter((t) => !researched.has(t.id));
    if (nonResearched.length === 0) return;

    const alreadyPrioritized = nonResearched.every((t) => priorities.has(t.id));
    if (alreadyPrioritized) return;

    const techIdsToToggle: string[] = [];

    for (const tech of this.techs) {
      if (tech.category !== category && priorities.has(tech.id)) {
        techIdsToToggle.push(tech.id);
      }
    }

    for (const tech of nonResearched) {
      if (!priorities.has(tech.id)) {
        techIdsToToggle.push(tech.id);
      }
    }

    if (techIdsToToggle.length > 0) {
      this.eventBus.emit(
        new SendResearchTreeSelectBatchIntentEvent(techIdsToToggle),
      );
    }

    HapticFeedback.tap();
  }

  render() {
    const me = this.game?.myPlayer?.();
    if (!me) {
      return html`
        <div class="empty-state">
          <div class="empty-icon">🔬</div>
          <div class="empty-text">Loading research data...</div>
        </div>
      `;
    }

    const researched = this.researchedIDsFromGame();
    const priorities = me.researchPriorities?.() ?? new Set<string>();

    const percentByTechId = new Map<string, number>();
    for (const tech of this.techs) {
      const cost = Math.max(1, tech.cost || 1);
      const beakers = me.researchBeakers?.(tech.id) ?? 0;
      let pct = Math.floor((beakers / cost) * 100);
      if (!Number.isFinite(pct)) pct = 0;
      pct = Math.max(0, Math.min(100, pct));
      if (researched.has(tech.id)) pct = 100;
      percentByTechId.set(tech.id, pct);
    }

    return html`
      <!-- Category filter tabs -->
      <div class="category-tabs">
        ${this.categories.map(
          (cat) => html`
            <button
              class="category-tab cat-${cat.toLowerCase()} ${this
                .activeCategory === cat
                ? "active"
                : ""} ${this.isCategoryPrioritized(cat, researched, priorities)
                ? "prioritized"
                : ""}"
              @click="${() => this.handleCategoryClick(cat)}"
            >
              <span
                class="category-tab-icon"
                style="--icon-url: url('${categoryIconSources[cat]}')"
              ></span>
              ${cat}
            </button>
          `,
        )}
      </div>

      <!-- Tech grid -->
      <div class="tech-scroll">
        <div class="tech-grid">
          ${this.categories
            .filter((cat) => this.activeCategory === cat)
            .map((cat) =>
              this.renderCategory(cat, researched, priorities, percentByTechId),
            )}
        </div>
      </div>
    `;
  }

  private renderCategory(
    category: Category,
    researched: Set<string>,
    priorities: Set<string>,
    percentByTechId: Map<string, number>,
  ) {
    const categoryTechs = this.techs.filter((t) => t.category === category);

    return html`
      <div class="category-section">
        <div class="category-header ${category.toLowerCase()}">
          <div class="category-header-left">
            <div
              class="category-icon"
              style="--icon-url: url('${categoryIconSources[category]}')"
            ></div>
            <div class="category-title">${category}</div>
          </div>
          <button
            class="category-priority-button ${this.isCategoryPrioritized(
              category,
              researched,
              priorities,
            )
              ? "active"
              : ""}"
            @click=${() =>
              this.handleCategoryPrioritize(category, researched, priorities)}
            aria-label="Prioritize ${category} research"
          >
            ★ Prioritize
          </button>
        </div>
        ${categoryTechs.map((tech) =>
          this.renderTechCard(tech, researched, priorities, percentByTechId),
        )}
      </div>
    `;
  }

  private isCategoryPrioritized(
    category: Category,
    researched: Set<string>,
    priorities: Set<string>,
  ): boolean {
    const categoryTechs = this.techs.filter((t) => t.category === category);
    const nonResearched = categoryTechs.filter((t) => !researched.has(t.id));
    return (
      nonResearched.length > 0 &&
      nonResearched.every((t) => priorities.has(t.id))
    );
  }

  private renderTechCard(
    tech: TechNode,
    researched: Set<string>,
    priorities: Set<string>,
    percentByTechId: Map<string, number>,
  ) {
    const meta = getTechMeta(tech.id, { strict: false });
    const name = meta?.name ?? tech.id;
    const description = meta?.shortDescription ?? meta?.description ?? "";

    const isResearched = researched.has(tech.id);
    const isPrioritized = priorities.has(tech.id);
    const isAvailable = isTechAvailable(tech.id, researched);
    const progress = percentByTechId.get(tech.id) ?? 0;

    let statusBadge: TemplateResult | null = null;
    if (isResearched) {
      statusBadge = html`<div class="tech-status complete">✓ Complete</div>`;
    } else if (isPrioritized) {
      statusBadge = html`<div class="tech-status priority">★ Priority</div>`;
    } else if (progress > 0) {
      statusBadge = html`<div class="tech-status progress">${progress}%</div>`;
    }

    const classes = [
      "tech-card",
      isResearched ? "researched" : "",
      isPrioritized ? "prioritized" : "",
      !isAvailable ? "unavailable" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return html`
      <div
        class="${classes}"
        @click="${() =>
          isAvailable && !isResearched && this.handleTechClick(tech)}"
      >
        ${progress > 0 && !isResearched
          ? html`<div class="progress-bar" style="width: ${progress}%"></div>`
          : null}
        <div class="tech-header">
          <div class="tech-name">${name}</div>
          ${statusBadge}
        </div>
        ${description
          ? html`<div class="tech-description">${description}</div>`
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-research-panel": MobileResearchPanel;
  }
}
