/**
 * MobilePlayerToast - Quick player info toast (long-press trigger)
 * Shows player name, relation, population, gold
 * Part of Phase 4: Diplomacy & Intel System
 */

import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { EventBus } from "../../../core/EventBus";
import type { GameView, PlayerView } from "../../../core/game/GameView";
import { getTechNodes, type Category } from "../../../core/tech/ResearchTree";
import {
  SendDeclareWarIntentEvent,
  SendPeaceRequestIntentEvent,
} from "../../Transport";
import { HapticFeedback } from "../utils/HapticFeedback";

@customElement("mobile-player-toast")
export class MobilePlayerToast extends LitElement {
  @property({ type: Boolean, reflect: true }) visible: boolean = false;
  @property({ type: Object }) game: GameView | null = null;
  @property({ type: Object }) player: PlayerView | null = null;
  @property({ type: Object }) eventBus: EventBus | null = null;
  @property({ type: Boolean }) canDonate: boolean = false;
  @property({ type: Boolean }) canSendEmoji: boolean = false;

  private autoHideTimeout: number | null = null;

  disconnectedCallback(): void {
    super.disconnectedCallback();

    if (this.autoHideTimeout !== null) {
      window.clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
    }
  }

  static styles = css`
    :host {
      display: block;
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 50px);
      left: 50%;
      transform: translateX(-50%) translateY(-100px);
      z-index: 2500;
      pointer-events: none;
      opacity: 0;
      transition:
        transform 0.25s ease-out,
        opacity 0.25s ease-out;
    }

    :host([visible]) {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
      pointer-events: all;
    }

    .toast {
      background:
        linear-gradient(
          180deg,
          rgba(130, 140, 153, 0.13) 0%,
          rgba(74, 84, 95, 0.09) 40%,
          rgba(21, 26, 34, 0.04) 100%
        ),
        linear-gradient(
          180deg,
          rgba(33, 39, 49, 0.97) 0%,
          rgba(20, 26, 35, 0.98) 56%,
          rgba(13, 18, 25, 0.98) 100%
        );
      border: 1px solid rgba(167, 178, 191, 0.24);
      border-radius: 10px;
      padding: 12px 14px;
      width: min(92vw, 300px);
      min-width: 0;
      box-shadow:
        inset 0 1px 0 rgba(231, 238, 246, 0.1),
        inset 0 -1px 0 rgba(0, 0, 0, 0.52),
        0 8px 22px rgba(0, 0, 0, 0.46);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }

    .toast:active {
      transform: scale(0.98);
    }

    .player-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(148, 160, 174, 0.22);
    }

    .player-name {
      color: rgba(239, 245, 252, 0.96);
      font-size: 14px;
      font-weight: 600;
      flex: 1;
      letter-spacing: 0.15px;
      text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .relation-badge {
      font-size: 14px;
      line-height: 1;
    }

    .player-stats {
      display: flex;
      gap: 8px;
      color: rgba(206, 216, 228, 0.88);
      font-size: 12px;
      margin-bottom: 4px;
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 6px;
      border-radius: 6px;
      background: linear-gradient(
        180deg,
        rgba(21, 29, 39, 0.74) 0%,
        rgba(13, 19, 27, 0.86) 100%
      );
      border: 1px solid rgba(116, 126, 140, 0.22);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    .relation-text {
      color: rgba(194, 205, 218, 0.75);
      font-size: 11px;
      margin-top: 0;
      text-transform: uppercase;
      letter-spacing: 0.35px;
    }

    .relation-text.allied {
      color: rgba(112, 222, 172, 0.94);
    }

    .relation-text.enemy {
      color: rgba(249, 133, 133, 0.95);
    }

    .research-summary {
      margin-top: 7px;
      padding: 7px;
      border-radius: 7px;
      border: 1px solid rgba(118, 130, 145, 0.24);
      background: linear-gradient(
        180deg,
        rgba(20, 28, 38, 0.78) 0%,
        rgba(12, 18, 25, 0.88) 100%
      );
    }

    .research-title {
      color: rgba(194, 205, 218, 0.86);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-bottom: 5px;
    }

    .research-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: rgba(225, 233, 243, 0.9);
      font-size: 11px;
      line-height: 1.35;
    }

    .research-row + .research-row {
      margin-top: 2px;
    }

    .research-row.overall {
      font-weight: 700;
      margin-bottom: 3px;
      padding-bottom: 3px;
      border-bottom: 1px solid rgba(148, 160, 174, 0.22);
    }

    .research-row-label {
      color: rgba(206, 216, 228, 0.82);
    }

    .research-row-value {
      color: rgba(238, 244, 251, 0.95);
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum";
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(148, 160, 174, 0.22);
    }

    .action-btn {
      flex: 1;
      padding: 6px 8px;
      border: 1px solid rgba(138, 148, 161, 0.3);
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      transition:
        transform 0.12s ease,
        filter 0.12s ease,
        border-color 0.15s ease;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }

    .action-btn.utility {
      background: linear-gradient(
        180deg,
        rgba(56, 67, 82, 0.9) 0%,
        rgba(29, 38, 50, 0.94) 100%
      );
      color: rgba(236, 242, 249, 0.95);
      border-color: rgba(133, 149, 171, 0.4);
    }

    .action-btn.chat {
      background: linear-gradient(
        180deg,
        rgba(63, 87, 130, 0.9) 0%,
        rgba(34, 52, 83, 0.94) 100%
      );
      border-color: rgba(122, 156, 216, 0.42);
    }

    .action-btn.emoji {
      background: linear-gradient(
        180deg,
        rgba(116, 88, 171, 0.9) 0%,
        rgba(63, 42, 102, 0.94) 100%
      );
      border-color: rgba(173, 140, 240, 0.42);
    }

    .action-btn.donate-troops {
      background: linear-gradient(
        180deg,
        rgba(181, 105, 47, 0.9) 0%,
        rgba(116, 63, 25, 0.94) 100%
      );
      border-color: rgba(234, 164, 99, 0.45);
    }

    .action-btn.donate-gold {
      background: linear-gradient(
        180deg,
        rgba(49, 126, 72, 0.9) 0%,
        rgba(24, 82, 44, 0.94) 100%
      );
      border-color: rgba(110, 197, 140, 0.45);
    }

    .btn-content {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      width: 100%;
    }

    .btn-icon {
      width: 12px;
      height: 12px;
      object-fit: contain;
      filter: brightness(1.12);
      flex: 0 0 auto;
    }

    .btn-label {
      white-space: nowrap;
    }

    .action-btn:active {
      transform: translateY(1px) scale(0.96);
      filter: brightness(1.08);
    }

    .action-btn.peace {
      background: linear-gradient(
        180deg,
        rgba(44, 99, 171, 0.86) 0%,
        rgba(22, 53, 92, 0.9) 100%
      );
      color: rgba(234, 243, 252, 0.96);
      border-color: rgba(100, 161, 238, 0.4);
    }

    .action-btn.war {
      background: linear-gradient(
        180deg,
        rgba(153, 54, 54, 0.88) 0%,
        rgba(95, 28, 28, 0.92) 100%
      );
      color: rgba(255, 239, 239, 0.96);
      border-color: rgba(226, 124, 124, 0.42);
    }

    .action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  render() {
    if (!this.visible || !this.player || !this.game) return null;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return null;

    const isAllied = myPlayer.isAlliedWith(this.player);
    const isEnemy = myPlayer.isAtWarWith(this.player);

    const relation = isAllied ? "allied" : isEnemy ? "enemy" : "neutral";
    const relationText = isAllied ? "Allied" : isEnemy ? "At War" : "Neutral";
    const relationIcon = isAllied ? "🤝" : isEnemy ? "⚔️" : "";
    const research = this.computeResearchCompletion(this.player);

    const population = this.player.numTilesOwned();
    const gold = Number(this.player.gold());

    return html`
      <div class="toast" @click="${this.handleClick}">
        <div class="player-header">
          <div class="player-name">${this.player.name()}</div>
          ${relationIcon
            ? html`<div class="relation-badge">${relationIcon}</div>`
            : null}
        </div>
        <div class="player-stats">
          <div class="stat">🏠 ${population}</div>
          <div class="stat">💰 ${gold}</div>
        </div>
        <div class="relation-text ${relation}">${relationText}</div>
        ${this.renderResearchSummary(research)} ${this.renderActions()}
      </div>
    `;
  }

  private computeResearchCompletion(player: PlayerView): {
    overall: number;
    byCategory: Record<Category, number>;
  } {
    const techs = getTechNodes();
    const categories: Category[] = ["Land", "Sea", "Air", "Nuclear"];

    const byCategory: Record<Category, number> = {
      Land: 0,
      Sea: 0,
      Air: 0,
      Nuclear: 0,
    };

    if (techs.length === 0) {
      return { overall: 0, byCategory };
    }

    let totalPct = 0;
    for (const category of categories) {
      const categoryTechs = techs.filter((tech) => tech.category === category);
      if (categoryTechs.length === 0) {
        byCategory[category] = 0;
        continue;
      }

      let categoryPctSum = 0;
      for (const tech of categoryTechs) {
        const cost = Math.max(1, tech.cost || 1);
        const beakers = player.researchBeakers(tech.id);
        let pct = Math.floor((beakers / cost) * 100);
        if (!Number.isFinite(pct)) pct = 0;
        pct = Math.max(0, Math.min(100, pct));
        if (player.hasResearchedTech(tech.id)) pct = 100;
        categoryPctSum += pct;
      }

      const categoryPct = Math.floor(categoryPctSum / categoryTechs.length);
      byCategory[category] = Math.max(0, Math.min(100, categoryPct));
      totalPct += categoryPctSum;
    }

    const overall = Math.floor(totalPct / techs.length);
    return {
      overall: Math.max(0, Math.min(100, overall)),
      byCategory,
    };
  }

  private renderResearchSummary(research: {
    overall: number;
    byCategory: Record<Category, number>;
  }) {
    return html`
      <div class="research-summary">
        <div class="research-title">Research Completion</div>
        <div class="research-row overall">
          <span class="research-row-label">Overall</span>
          <span class="research-row-value">${research.overall}%</span>
        </div>
        <div class="research-row">
          <span class="research-row-label">Land</span>
          <span class="research-row-value">${research.byCategory.Land}%</span>
        </div>
        <div class="research-row">
          <span class="research-row-label">Sea</span>
          <span class="research-row-value">${research.byCategory.Sea}%</span>
        </div>
        <div class="research-row">
          <span class="research-row-label">Air</span>
          <span class="research-row-value">${research.byCategory.Air}%</span>
        </div>
        <div class="research-row">
          <span class="research-row-label">Nuclear</span>
          <span class="research-row-value"
            >${research.byCategory.Nuclear}%</span
          >
        </div>
      </div>
    `;
  }

  private renderActions() {
    if (!this.player || !this.game || !this.eventBus) return null;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return null;

    const isAllied = myPlayer.isAlliedWith(this.player);
    const isAtWar = myPlayer.isAtWarWith(this.player);

    const isSelf = this.player === myPlayer;

    if (isSelf) {
      if (!this.canSendEmoji) {
        return null;
      }

      return html`
        <div class="actions" @click="${(e: Event) => e.stopPropagation()}">
          <button
            class="action-btn utility emoji"
            @click="${this.handleEmojiAction}"
          >
            <span class="btn-content">
              <img class="btn-icon" src="/images/EmojiIconWhite.svg" alt="" />
              <span class="btn-label">Public Emoji</span>
            </span>
          </button>
        </div>
      `;
    }

    return html`
      <div class="actions" @click="${(e: Event) => e.stopPropagation()}">
        <button
          class="action-btn utility chat"
          @click="${this.handleChatAction}"
        >
          <span class="btn-content">
            <img class="btn-icon" src="/images/ChatIconWhite.svg" alt="" />
            <span class="btn-label">Chat</span>
          </span>
        </button>

        ${this.canSendEmoji
          ? html`
              <button
                class="action-btn utility emoji"
                @click="${this.handleEmojiAction}"
              >
                <span class="btn-content">
                  <img
                    class="btn-icon"
                    src="/images/EmojiIconWhite.svg"
                    alt=""
                  />
                  <span class="btn-label">Emoji</span>
                </span>
              </button>
            `
          : null}
        ${this.canDonate
          ? html`
              <button
                class="action-btn utility donate-troops"
                @click="${this.handleDonateTroopsAction}"
              >
                <span class="btn-content">
                  <img
                    class="btn-icon"
                    src="/images/DonateTroopIconWhite.svg"
                    alt=""
                  />
                  <span class="btn-label">Donate Troops</span>
                </span>
              </button>
              <button
                class="action-btn utility donate-gold"
                @click="${this.handleDonateGoldAction}"
              >
                <span class="btn-content">
                  <img
                    class="btn-icon"
                    src="/images/DonateGoldIconWhite.svg"
                    alt=""
                  />
                  <span class="btn-label">Donate Gold</span>
                </span>
              </button>
            `
          : null}
        ${isAtWar
          ? html`
              <button class="action-btn peace" @click="${this.handlePeace}">
                <span class="btn-content">
                  <img
                    class="btn-icon"
                    src="/images/dove.b5af4f12b19e5773feee.png"
                    alt=""
                  />
                  <span class="btn-label">Peace</span>
                </span>
              </button>
            `
          : !isAllied
            ? html`
                <button class="action-btn peace" @click="${this.handlePeace}">
                  <span class="btn-content">
                    <img
                      class="btn-icon"
                      src="/images/dove.b5af4f12b19e5773feee.png"
                      alt=""
                    />
                    <span class="btn-label">Peace</span>
                  </span>
                </button>
              `
            : null}
        ${!isAtWar && !isAllied
          ? html`
              <button class="action-btn war" @click="${this.handleWar}">
                <span class="btn-content">
                  <img
                    class="btn-icon"
                    src="/images/SwordIconWhite.svg"
                    alt=""
                  />
                  <span class="btn-label">War</span>
                </span>
              </button>
            `
          : null}
      </div>
    `;
  }

  private handleChatAction = () => {
    if (!this.player) return;

    this.dispatchEvent(
      new CustomEvent("chat-clicked", {
        detail: { player: this.player },
        bubbles: true,
        composed: true,
      }),
    );

    HapticFeedback.tap();
    this.hide();
  };

  private handleEmojiAction = () => {
    if (!this.player) return;

    this.dispatchEvent(
      new CustomEvent("emoji-clicked", {
        detail: { player: this.player },
        bubbles: true,
        composed: true,
      }),
    );

    HapticFeedback.tap();
    this.hide();
  };

  private handleDonateTroopsAction = () => {
    if (!this.player) return;

    this.dispatchEvent(
      new CustomEvent("donate-troops-clicked", {
        detail: { player: this.player },
        bubbles: true,
        composed: true,
      }),
    );

    HapticFeedback.success();
    this.hide();
  };

  private handleDonateGoldAction = () => {
    if (!this.player) return;

    this.dispatchEvent(
      new CustomEvent("donate-gold-clicked", {
        detail: { player: this.player },
        bubbles: true,
        composed: true,
      }),
    );

    HapticFeedback.success();
    this.hide();
  };

  private handlePeace = () => {
    if (!this.player || !this.game || !this.eventBus) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    this.eventBus.emit(new SendPeaceRequestIntentEvent(myPlayer, this.player));

    HapticFeedback.success();
    this.hide();
  };

  private handleWar = () => {
    if (!this.player || !this.game || !this.eventBus) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    this.eventBus.emit(new SendDeclareWarIntentEvent(myPlayer, this.player));

    HapticFeedback.error();
    this.hide();
  };

  show(player: PlayerView, duration: number = 3000): void {
    this.player = player;
    this.visible = true;
    this.requestUpdate(); // Force re-render

    // Auto-hide after duration
    if (this.autoHideTimeout !== null) {
      clearTimeout(this.autoHideTimeout);
    }
    this.autoHideTimeout = window.setTimeout(() => {
      this.hide();
    }, duration);
  }

  hide(): void {
    this.visible = false;
    this.requestUpdate(); // Force re-render
    if (this.autoHideTimeout !== null) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
    }
  }

  private handleClick(): void {
    // Emit event to expand to full player details (opens Intel sidebar)
    this.dispatchEvent(
      new CustomEvent("toast-clicked", {
        detail: { player: this.player },
        bubbles: true,
        composed: true,
      }),
    );
    this.hide();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-player-toast": MobilePlayerToast;
  }
}
