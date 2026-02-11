/**
 * Mobile top bar - minimal status bar showing stats and controls
 * 32px height, translucent background
 */

import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { renderNumber, renderTroops } from "../Utils";
import { HapticFeedback } from "./utils/HapticFeedback";

export interface TopBarStats {
  population: number;
  maxPopulation: number;
  gold: number;
  populationGrowth?: number;
  goldIncome?: number;
  gameDurationSeconds?: number; // Game time in seconds (only counts after spawn phase)
  inSpawnPhase?: boolean; // Whether game is still in spawn phase
}

@customElement("mobile-top-bar")
export class MobileTopBar extends LitElement {
  @property({ type: Object }) stats: TopBarStats = {
    population: 0,
    maxPopulation: 0,
    gold: 0,
  };

  @property({ type: Boolean }) showDetails: boolean = false;

  private detailsHideTimeout: number | null = null;

  static styles = css`
    :host {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1650;
    }

    .top-bar {
      min-height: 44px;
      padding-top: env(safe-area-inset-top, 0);
      padding-left: max(10px, env(safe-area-inset-left, 0));
      padding-right: max(10px, env(safe-area-inset-right, 0));
      background:
        linear-gradient(
          180deg,
          rgba(130, 140, 150, 0.18) 0%,
          rgba(74, 82, 92, 0.14) 40%,
          rgba(22, 27, 34, 0.05) 100%
        ),
        linear-gradient(
          180deg,
          rgba(42, 47, 56, 0.96) 0%,
          rgba(29, 33, 41, 0.96) 45%,
          rgba(18, 21, 28, 0.96) 100%
        );
      border-top: 1px solid rgba(196, 206, 218, 0.32);
      border-bottom: 1px solid rgba(8, 10, 14, 0.8);
      box-shadow:
        inset 0 1px 0 rgba(220, 227, 235, 0.2),
        inset 0 -1px 0 rgba(0, 0, 0, 0.5),
        0 2px 8px rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: white;
      font-family:
        system-ui,
        -apple-system,
        sans-serif;
      font-size: 14px;
      user-select: none;
      position: relative;
      overflow: hidden;
    }

    .top-bar::before,
    .top-bar::after {
      content: "";
      position: absolute;
      top: 8px;
      bottom: 8px;
      width: 12px;
      pointer-events: none;
      background: linear-gradient(
        180deg,
        rgba(190, 198, 210, 0.18) 0%,
        rgba(18, 22, 28, 0.35) 100%
      );
      border: 1px solid rgba(14, 18, 24, 0.8);
      box-shadow: inset 0 1px 0 rgba(210, 218, 226, 0.12);
    }

    .top-bar::before {
      left: 0;
      clip-path: polygon(0 14%, 100% 0, 100% 100%, 0 86%);
      border-right: none;
    }

    .top-bar::after {
      right: 0;
      clip-path: polygon(0 0, 100% 14%, 100% 86%, 0 100%);
      border-left: none;
    }

    .clock-recess,
    .stats,
    .buttons-right {
      min-height: 30px;
      border-radius: 999px;
      border: 1px solid rgba(128, 136, 146, 0.28);
      background: linear-gradient(
        180deg,
        rgba(10, 13, 18, 0.88) 0%,
        rgba(17, 21, 29, 0.92) 100%
      );
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        inset 0 -2px 5px rgba(0, 0, 0, 0.4),
        0 1px 1px rgba(0, 0, 0, 0.35);
    }

    .menu-button,
    .research-button,
    .settings-button {
      min-width: 30px;
      min-height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      color: rgba(255, 183, 105, 0.98);
      font-size: 17px;
      cursor: pointer;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      text-shadow: 0 0 8px rgba(255, 169, 72, 0.2);
    }

    .menu-button:active,
    .research-button:active,
    .settings-button:active {
      opacity: 0.6;
    }

    .game-clock {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      color: rgba(228, 234, 242, 0.9);
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.2px;
      min-width: 62px;
      padding: 0 12px;
    }

    .buttons-right {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 38px;
      padding: 0 6px;
    }

    .stats {
      display: flex;
      align-items: center;
      gap: 14px;
      flex: 1 1 auto;
      min-width: 0;
      max-width: 420px;
      justify-content: center;
      cursor: pointer;
      padding: 0 14px;
      transition: background 0.2s;
    }

    .stats:active {
      background: linear-gradient(
        180deg,
        rgba(16, 21, 28, 0.9) 0%,
        rgba(9, 12, 18, 0.92) 100%
      );
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 4px;
      font-variant-numeric: tabular-nums;
    }

    .stat.gold-stat {
      gap: 6px;
      position: relative;
    }

    .icon {
      font-size: 15px;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
    }

    .value {
      font-weight: 600;
      color: rgba(240, 244, 249, 0.96);
      text-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
    }

    /* Details tooltip */
    .details-tooltip {
      position: absolute;
      top: calc(44px + env(safe-area-inset-top, 0) + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.9);
      backdrop-filter: blur(8px);
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      font-size: 13px;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s;
      z-index: 101;
    }

    .clock-recess {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      overflow: hidden;
    }

    .details-tooltip.visible {
      opacity: 1;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      padding: 4px 0;
    }

    .detail-label {
      color: #9ca3af;
    }

    .detail-value {
      color: white;
      font-weight: 500;
    }

    .growth-positive {
      color: #10b981;
    }

    .growth-negative {
      color: #ef4444;
    }

    /* Accessibility */
    .settings-button:focus-visible,
    .research-button:focus-visible,
    .menu-button:focus-visible {
      outline: 2px solid white;
      outline-offset: 2px;
    }
  `;

  render() {
    const { gameDurationSeconds = 0, inSpawnPhase = true } = this.stats;

    // Format time like desktop: "1h2m3s", "2m3s", "3s"
    let timeDisplay = "";
    if (!inSpawnPhase && gameDurationSeconds > 0) {
      const hours = Math.floor(gameDurationSeconds / 3600);
      const minutes = Math.floor((gameDurationSeconds % 3600) / 60);
      const seconds = gameDurationSeconds % 60;

      if (hours > 0) timeDisplay = `${hours}h`;
      if (minutes > 0) timeDisplay += `${minutes}m`;
      timeDisplay += `${seconds}s`;
    }

    return html`
      <div class="top-bar">
        ${timeDisplay
          ? html`
              <div class="clock-recess" title="Game Time">
                <div class="game-clock">${timeDisplay}</div>
              </div>
            `
          : ""}

        <div class="stats" @click="${this.handleStatsClick}" title="Stats">
          <div class="stat" title="Population">
            <span class="icon">👥</span>
            <span class="value"
              >${renderTroops(this.stats.population)}/${renderTroops(
                this.stats.maxPopulation,
              )}</span
            >
          </div>
          <div class="stat gold-stat" title="Gold">
            <span class="icon">💰</span>
            <span class="value">${this.formatNumber(this.stats.gold)}</span>
          </div>
        </div>

        <div class="buttons-right">
          <button
            class="settings-button"
            aria-label="Settings"
            title="Settings"
            @click="${this.handleSettingsClick}"
          >
            ⚙️
          </button>
        </div>
      </div>

      ${this.renderDetailsTooltip()}
    `;
  }

  private renderDetailsTooltip() {
    if (!this.showDetails) return null;

    const {
      population,
      maxPopulation,
      gold,
      populationGrowth = 0,
      goldIncome = 0,
    } = this.stats;

    return html`
      <div class="details-tooltip visible">
        <div class="detail-row">
          <span class="detail-label">Population:</span>
          <span class="detail-value"
            >${renderTroops(population)} / ${renderTroops(maxPopulation)}</span
          >
        </div>
        <div class="detail-row">
          <span class="detail-label">Growth:</span>
          <span
            class="detail-value ${populationGrowth >= 0
              ? "growth-positive"
              : "growth-negative"}"
          >
            ${populationGrowth >= 0 ? "+" : ""}${this.formatNumber(
              populationGrowth,
            )}/s
          </span>
        </div>
        <div
          class="detail-row"
          style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 4px; padding-top: 8px;"
        >
          <span class="detail-label">Gold:</span>
          <span class="detail-value">${this.formatNumber(gold)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Income:</span>
          <span
            class="detail-value ${goldIncome >= 0
              ? "growth-positive"
              : "growth-negative"}"
          >
            ${goldIncome >= 0 ? "+" : ""}${this.formatNumber(goldIncome)}/s
          </span>
        </div>
      </div>
    `;
  }

  private formatNumber(value: number | bigint): string {
    return renderNumber(value);
  }

  private handleSettingsClick(): void {
    this.dispatchEvent(
      new CustomEvent("settings-click", {
        bubbles: true,
        composed: true,
      }),
    );

    HapticFeedback.tap();
  }

  private handleStatsClick(): void {
    this.showDetails = !this.showDetails;

    if (this.detailsHideTimeout !== null) {
      window.clearTimeout(this.detailsHideTimeout);
      this.detailsHideTimeout = null;
    }

    // Auto-hide after 3 seconds
    if (this.showDetails) {
      this.detailsHideTimeout = window.setTimeout(() => {
        this.showDetails = false;
        this.detailsHideTimeout = null;
      }, 3000);
    }

    HapticFeedback.tap();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    if (this.detailsHideTimeout !== null) {
      window.clearTimeout(this.detailsHideTimeout);
      this.detailsHideTimeout = null;
    }
  }

  /**
   * Update displayed stats
   */
  updateStats(stats: TopBarStats): void {
    this.stats = { ...stats };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-top-bar": MobileTopBar;
  }
}
