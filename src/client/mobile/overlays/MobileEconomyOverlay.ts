/**
 * MobileEconomyOverlay - Investment sliders for production, road, and research
 * Swipes up from bottom to adjust economic settings
 */

import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { EventBus } from "../../../core/EventBus";
import { UpgradeType } from "../../../core/game/Game";
import type { GameView } from "../../../core/game/GameView";
import {
  INVESTMENT_REQUEST_EVENT,
  INVESTMENT_SYNC_EVENT,
  INVESTMENT_SYNC_REQUEST_EVENT,
  type InvestmentRequestDetail,
  type InvestmentSlider,
  type InvestmentSyncDetail,
} from "../../events/InvestmentEvents";
import { SendSetTargetTroopRatioEvent } from "../../Transport";
import { renderTroops } from "../../Utils";
import { HapticFeedback } from "../utils/HapticFeedback";

export interface EconomyStats {
  production: number; // 0-100
  road: number; // 0-100
  research: number; // 0-100
  productionLocked: boolean;
  roadLocked: boolean;
  researchLocked: boolean;
}

@customElement("mobile-economy-overlay")
export class MobileEconomyOverlay extends LitElement {
  @property({ type: Boolean, reflect: true }) visible: boolean = false;
  @property({ type: Object }) game: GameView | null = null;
  @property({ type: Object }) eventBus: EventBus | null = null;
  @property({ type: Number }) production: number = 0;
  @property({ type: Number }) road: number = 0;
  @property({ type: Number }) research: number = 0;
  @property({ type: Boolean }) productionLocked: boolean = false;
  @property({ type: Boolean }) roadLocked: boolean = false;
  @property({ type: Boolean }) researchLocked: boolean = false;
  @property({ type: Number }) troopRatio: number = 0.6;
  @property({ type: Number }) attackRatio: number = 0.3;
  @property({ type: Boolean }) roadEnabled: boolean = false;

  private defaultsInitialized = false;

  static styles = css`
    :host {
      display: block;
      position: fixed;
      top: var(--m-panel-top-offset, 0px);
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1800;
      pointer-events: none;
    }

    :host([visible]) {
      pointer-events: all;
    }

    .backdrop {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.42);
      opacity: 0;
      transition: opacity 0.25s ease-out;
    }

    :host([visible]) .backdrop {
      opacity: 1;
    }

    .panel {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: min(64vw, 420px);
      max-width: 420px;
      background:
        linear-gradient(
          180deg,
          rgba(136, 146, 159, 0.15) 0%,
          rgba(76, 85, 97, 0.1) 35%,
          rgba(18, 22, 29, 0.04) 100%
        ),
        linear-gradient(
          180deg,
          rgba(35, 40, 49, 0.97) 0%,
          rgba(23, 28, 36, 0.98) 48%,
          rgba(14, 18, 24, 0.98) 100%
        );
      border-left: 1px solid rgba(174, 185, 198, 0.22);
      box-shadow:
        inset 1px 0 0 rgba(220, 229, 238, 0.12),
        -8px 0 24px rgba(0, 0, 0, 0.52);
      padding-top: max(
        6px,
        var(--m-panel-safe-top-padding, env(safe-area-inset-top, 0px))
      );
      padding-bottom: env(safe-area-inset-bottom, 0);
      transform: translateX(100%);
      transition: transform 0.25s ease-out;
      height: 100%;
      overflow-y: auto;
    }

    :host([visible]) .panel {
      transform: translateX(0);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(161, 171, 184, 0.2);
      background: linear-gradient(
        180deg,
        rgba(16, 20, 28, 0.86) 0%,
        rgba(12, 16, 23, 0.92) 100%
      );
      box-shadow:
        inset 0 1px 0 rgba(232, 239, 247, 0.08),
        inset 0 -1px 0 rgba(0, 0, 0, 0.45);
    }

    .title {
      color: rgba(235, 241, 248, 0.95);
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0.2px;
      text-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
    }

    .close-btn {
      background: linear-gradient(
        180deg,
        rgba(18, 24, 33, 0.9) 0%,
        rgba(11, 15, 22, 0.94) 100%
      );
      border: 1px solid rgba(136, 146, 159, 0.28);
      border-radius: 6px;
      color: rgba(244, 176, 99, 0.95);
      font-size: 16px;
      cursor: pointer;
      min-width: 28px;
      min-height: 24px;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 1px 1px rgba(0, 0, 0, 0.35);
    }

    .close-btn:active {
      opacity: 0.9;
      transform: translateY(1px);
    }

    .subtitle {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.6);
    }

    .section-title {
      color: rgba(208, 218, 230, 0.86);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      margin: 8px 0 4px;
    }

    .content {
      padding: 0 10px 10px;
      background: linear-gradient(
        180deg,
        rgba(11, 15, 21, 0.68) 0%,
        rgba(9, 13, 18, 0.72) 100%
      );
    }

    .slider-group {
      margin-bottom: 8px;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid rgba(123, 133, 145, 0.24);
      background: linear-gradient(
        180deg,
        rgba(23, 30, 39, 0.82) 0%,
        rgba(13, 18, 24, 0.92) 100%
      );
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .slider-group.disabled {
      opacity: 0.55;
    }

    .slider-group.disabled .slider {
      cursor: not-allowed;
    }

    .lock-note {
      margin-top: 8px;
      font-size: 10px;
      color: rgba(199, 208, 220, 0.82);
    }

    .slider-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .slider-label {
      color: rgba(236, 242, 249, 0.96);
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .slider-icon {
      font-size: 14px;
    }

    .slider-value {
      color: rgba(250, 199, 93, 0.96);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      min-width: 32px;
      text-align: right;
      text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
    }

    .value-lock-group {
      display: flex;
      align-items: center;
    }

    .lock-button {
      background: linear-gradient(
        180deg,
        rgba(17, 22, 30, 0.82) 0%,
        rgba(11, 15, 22, 0.92) 100%
      );
      border: 1px solid rgba(130, 140, 152, 0.35);
      color: rgba(212, 221, 232, 0.78);
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 10px;
      cursor: pointer;
      margin-left: 6px;
      -webkit-tap-highlight-color: transparent;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .lock-button.locked {
      background: linear-gradient(
        180deg,
        rgba(28, 53, 87, 0.58) 0%,
        rgba(15, 29, 46, 0.9) 100%
      );
      border-color: rgba(96, 159, 246, 0.72);
      color: rgba(152, 206, 255, 0.95);
    }

    .lock-button:active {
      filter: brightness(1.1);
    }

    .slider-container {
      position: relative;
      height: 30px;
      display: flex;
      align-items: center;
    }

    .slider {
      width: 100%;
      height: 6px;
      -webkit-appearance: none;
      appearance: none;
      background: linear-gradient(
        180deg,
        rgba(16, 22, 29, 0.92) 0%,
        rgba(10, 14, 20, 0.92) 100%
      );
      border: 1px solid rgba(120, 130, 141, 0.28);
      border-radius: 4px;
      outline: none;
      cursor: pointer;
    }

    .slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: linear-gradient(135deg, #7aa6de, #3b82f6);
      cursor: pointer;
      border: 1px solid rgba(234, 241, 249, 0.4);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      transition: transform 0.15s ease;
    }

    .slider::-webkit-slider-thumb:active {
      transform: scale(1.2);
    }

    .slider::-moz-range-thumb {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: linear-gradient(135deg, #7aa6de, #3b82f6);
      cursor: pointer;
      border: 1px solid rgba(234, 241, 249, 0.4);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    }

    .constraint-warning {
      background: rgba(239, 68, 68, 0.14);
      border: 1px solid rgba(239, 68, 68, 0.4);
      border-radius: 8px;
      padding: 8px;
      margin-top: 8px;
      color: #fdb3b3;
      font-size: 11px;
      line-height: 1.5;
    }

    .constraint-sum {
      font-weight: 600;
      color: #ef4444;
    }
  `;

  render() {
    const total = this.production + this.road + this.research;
    const exceeds = total > 100;
    const troopPercent = Math.round(this.troopRatio * 100);
    const workerPercent = 100 - troopPercent;
    const attackPercent = Math.round(this.attackRatio * 100);
    const productionMax = this.productionMaxPercent();
    const roadEnabled = this.isRoadsUnlocked();
    const me = this.game?.myPlayer?.();
    const attackTroops = Math.floor((me?.troops?.() ?? 0) * this.attackRatio);
    const productivityPct = Math.round((me?.productivity?.() ?? 1) * 100);
    const productivityGrowthPerMinute =
      (me?.productivityGrowthPerMinute?.() ?? 0) * 100;

    return html`
      <div class="backdrop" @click="${this.close}"></div>
      <div class="panel">
        <div class="header">
          <div class="title">💰 Economy</div>
          <button class="close-btn" @click="${this.close}">✕</button>
        </div>

        <div class="content">
          <div class="section-title">Controls</div>

          <div class="slider-group">
            <div class="slider-header">
              <div class="slider-label">
                <span class="slider-icon">🪖</span>
                <span>Troop / Worker Ratio</span>
              </div>
              <div class="slider-value">${troopPercent}%</div>
            </div>
            <div class="slider-container">
              <input
                type="range"
                class="slider"
                min="0"
                max="100"
                step="1"
                .value="${troopPercent.toString()}"
                @input="${this.handleTroopRatioChange}"
              />
            </div>
            <div class="subtitle">
              ${troopPercent}% troops • ${workerPercent}% workers
            </div>
          </div>

          <div class="slider-group">
            <div class="slider-header">
              <div class="slider-label">
                <span class="slider-icon">⚔️</span>
                <span>Attack Ratio</span>
              </div>
              <div class="slider-value">${attackPercent}%</div>
            </div>
            <div class="slider-container">
              <input
                type="range"
                class="slider"
                min="1"
                max="100"
                step="1"
                .value="${attackPercent.toString()}"
                @input="${this.handleAttackRatioChange}"
              />
            </div>
            <div class="subtitle">
              Sends ${renderTroops(attackTroops)} troops per attack
            </div>
          </div>

          <div class="section-title">Economy</div>

          <!-- Production Slider -->
          <div class="slider-group">
            <div class="slider-header">
              <div class="slider-label">
                <span class="slider-icon">🏭</span>
                <span>Production Investment</span>
              </div>
              <div class="value-lock-group">
                <div class="slider-value">${this.production}%</div>
                <button
                  class="lock-button ${this.productionLocked ? "locked" : ""}"
                  @click="${() => this.toggleLock("prod")}"
                >
                  ${this.productionLocked ? "🔒" : "🔓"}
                </button>
              </div>
            </div>
            <div class="slider-container">
              <input
                type="range"
                class="slider"
                min="0"
                max="${productionMax}"
                step="1"
                .value="${this.production.toString()}"
                @input="${(e: Event) => this.handleSliderChange("prod", e)}"
              />
            </div>
            <div class="subtitle">
              Prod: ${productivityPct}%
              (${productivityGrowthPerMinute >= 0
                ? "+"
                : ""}${productivityGrowthPerMinute.toFixed(1)}%/min)
            </div>
          </div>

          <!-- Research Slider -->
          <div class="slider-group">
            <div class="slider-header">
              <div class="slider-label">
                <span class="slider-icon">🔬</span>
                <span>Research Investment</span>
              </div>
              <div class="value-lock-group">
                <div class="slider-value">${this.research}%</div>
                <button
                  class="lock-button ${this.researchLocked ? "locked" : ""}"
                  @click="${() => this.toggleLock("research")}"
                >
                  ${this.researchLocked ? "🔒" : "🔓"}
                </button>
              </div>
            </div>
            <div class="slider-container">
              <input
                type="range"
                class="slider"
                min="0"
                max="50"
                step="1"
                .value="${this.research.toString()}"
                @input="${(e: Event) => this.handleSliderChange("research", e)}"
              />
            </div>
          </div>

          <!-- Road Slider -->
          <div class="slider-group ${roadEnabled ? "" : "disabled"}">
            <div class="slider-header">
              <div class="slider-label">
                <span class="slider-icon">🛣️</span>
                <span>Road Investment</span>
              </div>
              <div class="value-lock-group">
                <div class="slider-value">${roadEnabled ? this.road : 0}%</div>
                <button
                  class="lock-button ${this.roadLocked || !roadEnabled
                    ? "locked"
                    : ""}"
                  ?disabled=${!roadEnabled}
                  @click="${() => this.toggleLock("road")}"
                >
                  ${this.roadLocked || !roadEnabled ? "🔒" : "🔓"}
                </button>
              </div>
            </div>
            <div class="slider-container">
              <input
                type="range"
                class="slider"
                min="0"
                max="50"
                step="1"
                .value="${(roadEnabled ? this.road : 0).toString()}"
                ?disabled=${!roadEnabled}
                @input="${(e: Event) => this.handleSliderChange("road", e)}"
              />
            </div>
            ${!roadEnabled
              ? html`<div class="lock-note">
                  Locked: Research Roads to unlock
                </div>`
              : null}
          </div>

          <!-- Constraint Warning -->
          ${exceeds
            ? html`
                <div class="constraint-warning">
                  ⚠️ Total investment (<span class="constraint-sum"
                    >${total}%</span
                  >) exceeds 100%. Unlocked sliders will be reduced
                  automatically.
                </div>
              `
            : null}
        </div>
      </div>
    `;
  }

  private handleSliderChange(slider: InvestmentSlider, event: Event): void {
    const target = event.target as HTMLInputElement;
    if (slider === "road" && !this.isRoadsUnlocked()) {
      target.value = "0";
      return;
    }
    const value = parseInt(target.value, 10);
    const max = slider === "prod" ? this.productionMaxPercent() : 50;
    const clamped = Math.max(0, Math.min(max, value));

    // Update local state
    switch (slider) {
      case "prod":
        this.production = clamped;
        break;
      case "road":
        this.road = clamped;
        break;
      case "research":
        this.research = clamped;
        break;
    }

    this.persistInvestmentDefaults();

    // Emit DOM CustomEvent (desktop compatibility)
    window.dispatchEvent(
      new CustomEvent(INVESTMENT_REQUEST_EVENT, {
        detail: {
          type: "set",
          slider,
          value: clamped / 100,
        } as InvestmentRequestDetail,
      }),
    );
  }

  private toggleLock(slider: InvestmentSlider): void {
    if (slider === "road" && !this.isRoadsUnlocked()) {
      return;
    }
    // Update local state
    switch (slider) {
      case "prod":
        this.productionLocked = !this.productionLocked;
        break;
      case "road":
        this.roadLocked = !this.roadLocked;
        break;
      case "research":
        this.researchLocked = !this.researchLocked;
        break;
    }

    // Emit DOM CustomEvent (desktop compatibility)
    window.dispatchEvent(
      new CustomEvent(INVESTMENT_REQUEST_EVENT, {
        detail: {
          type: "toggle-lock",
          slider,
        } as InvestmentRequestDetail,
      }),
    );

    HapticFeedback.tap();
  }

  open(): void {
    this.ensureDefaults();
    window.dispatchEvent(new CustomEvent(INVESTMENT_SYNC_REQUEST_EVENT));
    this.visible = true;
  }

  close(): void {
    this.visible = false;

    this.dispatchEvent(
      new CustomEvent("overlay-closed", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  toggle(): void {
    if (this.visible) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Update slider values from game state
   */
  updateStats(stats: EconomyStats): void {
    this.production = stats.production;
    this.road = stats.road;
    this.research = stats.research;
    this.productionLocked = stats.productionLocked;
    this.roadLocked = stats.roadLocked;
    this.researchLocked = stats.researchLocked;
  }

  resetInvestmentDefaults(): void {
    const defaultResearch =
      this.game?.config()?.defaultResearchInvestment?.() ?? 0.1;
    const defaultRoad = this.game?.config()?.defaultRoadInvestment?.() ?? 0.1;
    this.production = 0;
    this.road = this.isRoadsUnlocked() ? Math.round(defaultRoad * 100) : 0;
    this.research = Math.round(defaultResearch * 100);
    this.persistInvestmentDefaults();
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(
      INVESTMENT_SYNC_EVENT,
      this.handleInvestmentSync as EventListener,
    );
    this.ensureDefaults();
  }

  disconnectedCallback(): void {
    window.removeEventListener(
      INVESTMENT_SYNC_EVENT,
      this.handleInvestmentSync as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleInvestmentSync = (event: Event): void => {
    const detail = (event as CustomEvent<InvestmentSyncDetail>).detail;
    if (!detail) return;
    this.production = Math.round(detail.prod * 100);
    this.roadEnabled = detail.roadEnabled;
    this.road = Math.round((detail.roadEnabled ? detail.road : 0) * 100);
    this.research = Math.round(detail.research * 100);
    this.productionLocked = detail.lockProd;
    this.roadLocked = detail.lockRoad;
    this.researchLocked = detail.lockResearch;
    this.persistInvestmentDefaults();
  };

  private handleTroopRatioChange = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    const ratio = Math.max(0, Math.min(1, parseInt(target.value, 10) / 100));
    this.troopRatio = ratio;
    if (this.eventBus) {
      this.eventBus.emit(new SendSetTargetTroopRatioEvent(ratio));
    }
  };

  private handleAttackRatioChange = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    const rawRatio = Math.max(
      0.01,
      Math.min(1, Number.parseInt(target.value, 10) / 100),
    );
    const ratio = Math.round(rawRatio * 100) / 100;
    this.attackRatio = ratio;
    this.dispatchEvent(
      new CustomEvent("attack-ratio-changed", {
        detail: { ratio },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private ensureDefaults(): void {
    if (this.defaultsInitialized) return;

    if (!this.game) {
      return;
    }

    this.defaultsInitialized = true;

    const storedProd = this.parseStoredRate("settings.investmentRate");
    const storedRoad = this.parseStoredRate("settings.roadInvestmentRate");
    const storedResearch = this.parseStoredRate(
      "settings.researchInvestmentRate",
    );
    const storedAttack = this.parseStoredRate("settings.attackRatio", 0.3);
    const storedTroop = this.parseStoredRate("settings.troopRatio", 0.6);

    const defaultResearch =
      this.game?.config()?.defaultResearchInvestment?.() ?? 0.1;
    const defaultRoad = this.game?.config()?.defaultRoadInvestment?.() ?? 0.1;
    const productionRate = storedProd ?? 0;
    const roadRate = storedRoad ?? defaultRoad;
    const researchRate = storedResearch ?? defaultResearch;

    this.production = Math.round(productionRate * 100);
    if (!this.isRoadsUnlocked()) {
      this.road = 0;
    } else {
      this.road = Math.round(roadRate * 100);
    }
    this.research = Math.round(researchRate * 100);
    this.attackRatio = storedAttack ?? 0.3;
    this.troopRatio = storedTroop ?? 0.6;

    this.persistInvestmentDefaults();
  }

  applyPreferredCombatRatios(): void {
    const preferredAttack = this.parseStoredRate("settings.attackRatio", 0.3);
    const preferredTroop = this.parseStoredRate("settings.troopRatio", 0.6);

    this.attackRatio = preferredAttack ?? 0.3;
    this.troopRatio = preferredTroop ?? 0.6;

    if (this.eventBus) {
      this.eventBus.emit(new SendSetTargetTroopRatioEvent(this.troopRatio));
    }

    this.dispatchEvent(
      new CustomEvent("attack-ratio-changed", {
        detail: { ratio: this.attackRatio },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private persistInvestmentDefaults(): void {
    localStorage.setItem(
      "settings.investmentRate",
      (this.production / 100).toString(),
    );
    localStorage.setItem(
      "settings.roadInvestmentRate",
      ((this.isRoadsUnlocked() ? this.road : 0) / 100).toString(),
    );
    localStorage.setItem(
      "settings.researchInvestmentRate",
      (this.research / 100).toString(),
    );
  }

  private parseStoredRate(key: string, fallback?: number): number | null {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) {
      return fallback ?? null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback ?? null;
    return Math.max(0, Math.min(1, parsed));
  }

  private productionMaxPercent(): number {
    const maxRate = this.game?.config()?.maxInvestmentRate?.() ?? 0.5;
    return Math.round(Math.max(0, Math.min(1, maxRate)) * 100);
  }

  private isRoadsUnlocked(): boolean {
    if (this.roadEnabled) return true;
    return Boolean(this.game?.myPlayer?.()?.hasUpgrade?.(UpgradeType.Roads));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-economy-overlay": MobileEconomyOverlay;
  }
}
