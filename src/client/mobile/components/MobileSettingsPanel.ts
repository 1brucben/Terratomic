/**
 * MobileSettingsPanel - Native mobile settings panel
 * Focused on core in-game toggles and replay actions
 */

import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import type { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import {
  RefreshGraphicsEvent,
  ReplaySpeedChangeEvent,
} from "../../InputHandler";
import { SaveReplayRequestEvent } from "../../Transport";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "../../utilities/ReplaySpeedMultiplier";
import { translateText } from "../../Utils";
import { HapticFeedback } from "../utils/HapticFeedback";

@customElement("mobile-settings-panel")
export class MobileSettingsPanel extends LitElement {
  @property({ type: Object }) game: GameView | null = null;
  @property({ type: Object }) eventBus: EventBus | null = null;

  @state()
  private replaySpeedMultiplier: number = defaultReplaySpeedMultiplier;

  @state()
  private showExitConfirm: boolean = false;

  private userSettings = new UserSettings();

  static styles = css`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      color: #e5e7eb;
      font-family:
        system-ui,
        -apple-system,
        sans-serif;
      background:
        linear-gradient(
          180deg,
          rgba(128, 138, 151, 0.1) 0%,
          rgba(68, 78, 91, 0.06) 30%,
          rgba(14, 19, 26, 0.02) 100%
        ),
        radial-gradient(120% 120% at 0% 0%, #1f2a44 0%, #111827 60%),
        linear-gradient(180deg, #0f172a 0%, #0b1220 100%);
    }

    .panel {
      min-height: 100%;
      display: flex;
      flex-direction: column;
    }

    .section {
      padding: 10px;
      border-bottom: 1px solid rgba(149, 160, 174, 0.2);
      background: linear-gradient(
        180deg,
        rgba(15, 20, 28, 0.82) 0%,
        rgba(11, 15, 22, 0.9) 100%
      );
      box-shadow:
        inset 0 1px 0 rgba(236, 242, 249, 0.05),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35);
    }

    .section-title {
      font-size: 11px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: rgba(206, 216, 228, 0.84);
      margin-bottom: 8px;
    }

    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 10px;
      background: linear-gradient(
        180deg,
        rgba(23, 30, 39, 0.82) 0%,
        rgba(13, 18, 24, 0.92) 100%
      );
      border: 1px solid rgba(123, 133, 145, 0.24);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
      margin-bottom: 8px;
    }

    .setting-info {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .setting-icon {
      font-size: 16px;
    }

    .setting-label {
      font-size: 13px;
      font-weight: 600;
      color: rgba(237, 243, 250, 0.98);
    }

    .toggle {
      width: 48px;
      height: 26px;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.2);
      border: 1px solid rgba(148, 163, 184, 0.35);
      position: relative;
      cursor: pointer;
      transition:
        background 0.2s ease,
        border-color 0.2s ease;
      -webkit-tap-highlight-color: transparent;
    }

    .toggle.on {
      background: rgba(56, 189, 248, 0.25);
      border-color: rgba(56, 189, 248, 0.6);
    }

    .toggle-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #e2e8f0;
      transition:
        transform 0.2s ease,
        background 0.2s ease;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    }

    .toggle.on .toggle-thumb {
      transform: translateX(22px);
      background: #38bdf8;
    }

    .actions {
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: linear-gradient(
        180deg,
        rgba(12, 17, 24, 0.72) 0%,
        rgba(10, 14, 20, 0.78) 100%
      );
    }

    .action-button {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(109, 156, 230, 0.52);
      background: linear-gradient(
        135deg,
        rgba(32, 82, 179, 0.66),
        rgba(59, 130, 246, 0.78)
      );
      color: #f8fafc;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition:
        transform 0.15s ease,
        box-shadow 0.2s ease;
    }

    .action-button:active {
      transform: scale(0.98);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.4) inset;
    }

    .action-button.danger {
      border-color: rgba(248, 113, 113, 0.6);
      background: linear-gradient(
        135deg,
        rgba(220, 38, 38, 0.7),
        rgba(248, 113, 113, 0.85)
      );
    }

    .muted-note {
      font-size: 11px;
      color: rgba(203, 213, 224, 0.66);
      padding: 0 10px 10px;
    }

    .confirm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.48);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 5000;
      padding: 16px;
    }

    .confirm-dialog {
      width: min(90vw, 320px);
      border-radius: 12px;
      border: 1px solid rgba(152, 163, 177, 0.32);
      background: linear-gradient(
        180deg,
        rgba(23, 30, 39, 0.95) 0%,
        rgba(12, 17, 24, 0.98) 100%
      );
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
      padding: 14px;
    }

    .confirm-title {
      font-size: 14px;
      font-weight: 700;
      color: rgba(237, 243, 250, 0.98);
      margin-bottom: 8px;
    }

    .confirm-text {
      font-size: 12px;
      color: rgba(208, 217, 229, 0.88);
      line-height: 1.4;
      margin-bottom: 12px;
    }

    .confirm-actions {
      display: flex;
      gap: 8px;
    }

    .confirm-btn {
      flex: 1;
      padding: 9px 10px;
      border-radius: 8px;
      border: 1px solid rgba(139, 151, 167, 0.3);
      background: linear-gradient(
        180deg,
        rgba(20, 26, 35, 0.9) 0%,
        rgba(12, 17, 24, 0.95) 100%
      );
      color: rgba(228, 236, 246, 0.95);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }

    .confirm-btn.danger {
      border-color: rgba(248, 113, 113, 0.55);
      background: linear-gradient(
        180deg,
        rgba(185, 38, 38, 0.78) 0%,
        rgba(124, 25, 25, 0.88) 100%
      );
      color: rgba(255, 238, 238, 0.96);
    }

    .speed-controls {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .speed-button {
      padding: 9px 10px;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: linear-gradient(
        180deg,
        rgba(20, 26, 35, 0.86) 0%,
        rgba(11, 16, 23, 0.9) 100%
      );
      color: #e5e7eb;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition:
        background 0.2s ease,
        border-color 0.2s ease,
        transform 0.15s ease;
    }

    .speed-button:active {
      transform: scale(0.95);
    }

    .speed-button.active {
      background: linear-gradient(
        180deg,
        rgba(28, 53, 87, 0.58) 0%,
        rgba(15, 29, 46, 0.9) 100%
      );
      border-color: rgba(96, 159, 246, 0.72);
      color: rgba(152, 206, 255, 0.95);
    }

    :host::-webkit-scrollbar {
      width: 8px;
    }

    :host::-webkit-scrollbar-track {
      background: rgba(20, 27, 36, 0.7);
    }

    :host::-webkit-scrollbar-thumb {
      background: rgba(132, 143, 157, 0.45);
      border-radius: 4px;
    }

    :host::-webkit-scrollbar-thumb:hover {
      background: rgba(150, 161, 174, 0.56);
    }
  `;

  private handleToggleDarkMode(): void {
    this.userSettings.toggleDarkMode();
    if (this.eventBus) {
      this.eventBus.emit(new RefreshGraphicsEvent());
    }
    this.requestUpdate();
    HapticFeedback.tap();
  }

  private handleToggleLobbyNotifications(): void {
    this.userSettings.toggleLobbyNotifications();
    this.requestUpdate();
    HapticFeedback.tap();
  }

  private handleToggleRandomName(): void {
    this.userSettings.toggleRandomName();
    this.requestUpdate();
    HapticFeedback.tap();
  }

  private handleSaveReplay(): void {
    if (!this.eventBus) return;
    this.eventBus.emit(new SaveReplayRequestEvent());
    HapticFeedback.success();
  }

  private handleReplaySpeedChange(speed: ReplaySpeedMultiplier): void {
    this.replaySpeedMultiplier = speed;
    if (this.eventBus) {
      this.eventBus.emit(new ReplaySpeedChangeEvent(speed));
    }
    HapticFeedback.tap();
  }

  private handleExitGame(): void {
    const isAlive = this.game?.myPlayer()?.isAlive();
    if (isAlive) {
      this.showExitConfirm = true;
      HapticFeedback.tap();
      return;
    }

    this.exitGame();
  }

  private handleCancelExit = (): void => {
    this.showExitConfirm = false;
    HapticFeedback.tap();
  };

  private handleConfirmExit = (): void => {
    this.showExitConfirm = false;
    HapticFeedback.success();
    this.exitGame();
  };

  private exitGame(): void {
    window.location.href = "/";
  }

  private renderToggle(
    label: string,
    icon: string,
    enabled: boolean,
    onToggle: () => void,
  ) {
    return html`
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-icon">${icon}</div>
          <div class="setting-label">${label}</div>
        </div>
        <button
          class="toggle ${enabled ? "on" : ""}"
          aria-pressed="${enabled}"
          @click="${onToggle}"
        >
          <span class="toggle-thumb"></span>
        </button>
      </div>
    `;
  }

  private renderReplaySpeedControls(isSinglePlayer: boolean) {
    const speedOptions: Array<{
      label: string;
      value: ReplaySpeedMultiplier;
    }> = [
      { label: "×0.5", value: ReplaySpeedMultiplier.slow },
      { label: "×1", value: ReplaySpeedMultiplier.normal },
      { label: "×2", value: ReplaySpeedMultiplier.fast },
      { label: "max", value: ReplaySpeedMultiplier.fastest },
    ];

    return html`
      <div class="section">
        <div class="section-title">
          ${isSinglePlayer ? "Game Speed" : "Replay Speed"}
        </div>
        <div class="speed-controls">
          ${speedOptions.map(
            ({ label, value }) => html`
              <button
                class="speed-button ${this.replaySpeedMultiplier === value
                  ? "active"
                  : ""}"
                @click="${() => this.handleReplaySpeedChange(value)}"
              >
                ${label}
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  render() {
    const isReplay = this.game?.config().isReplay() ?? false;
    const isSinglePlayer =
      this.game?.config().gameConfig().gameType === GameType.Singleplayer;
    const showSpeedControls = isSinglePlayer;

    return html`
      <div class="panel">
        ${showSpeedControls
          ? this.renderReplaySpeedControls(isSinglePlayer)
          : ""}

        <div class="section">
          <div class="section-title">Preferences</div>
          ${this.renderToggle(
            "Dark Mode",
            "🌙",
            this.userSettings.darkMode(),
            () => this.handleToggleDarkMode(),
          )}
          ${this.renderToggle(
            "Lobby Notifications",
            "🔔",
            this.userSettings.lobbyNotificationsEnabled(),
            () => this.handleToggleLobbyNotifications(),
          )}
          ${this.renderToggle(
            "Random Name Mode",
            "🥷",
            this.userSettings.anonymousNames(),
            () => this.handleToggleRandomName(),
          )}
        </div>

        <div class="actions">
          ${!isReplay
            ? html`
                <button class="action-button" @click="${this.handleSaveReplay}">
                  💾 Save Replay
                </button>
              `
            : ""}
          <button class="action-button danger" @click="${this.handleExitGame}">
            🚪 Exit Game
          </button>
        </div>
        ${isReplay
          ? html`<div class="muted-note">Replay mode: saving is disabled.</div>`
          : ""}
        ${this.showExitConfirm
          ? html`
              <div class="confirm-overlay" @click=${this.handleCancelExit}>
                <div
                  class="confirm-dialog"
                  @click=${(e: Event) => e.stopPropagation()}
                >
                  <div class="confirm-title">Exit Game?</div>
                  <div class="confirm-text">
                    ${translateText("help_modal.exit_confirmation")}
                  </div>
                  <div class="confirm-actions">
                    <button class="confirm-btn" @click=${this.handleCancelExit}>
                      Cancel
                    </button>
                    <button
                      class="confirm-btn danger"
                      @click=${this.handleConfirmExit}
                    >
                      Exit
                    </button>
                  </div>
                </div>
              </div>
            `
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-settings-panel": MobileSettingsPanel;
  }
}
