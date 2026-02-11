/**
 * MobileSettingsSidebar - Native settings panel for mobile
 * Slides in from the right edge with core toggles
 */

import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { EventBus } from "../../../core/EventBus";
import type { GameView } from "../../../core/game/GameView";
import "../components/MobileSettingsPanel";
import { HapticFeedback } from "../utils/HapticFeedback";

@customElement("mobile-settings-sidebar")
export class MobileSettingsSidebar extends LitElement {
  @property({ type: Boolean, reflect: true }) visible: boolean = false;
  @property({ type: Object }) game: GameView | null = null;
  @property({ type: Object }) eventBus: EventBus | null = null;

  static styles = css`
    :host {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 3000;
      pointer-events: none;
    }

    :host([visible]) {
      display: block;
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
      transition: opacity 0.25s ease;
    }

    :host([visible]) .backdrop {
      opacity: 1;
    }

    .sidebar {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 70%;
      max-width: 400px;
      background:
        linear-gradient(
          180deg,
          rgba(132, 142, 154, 0.14) 0%,
          rgba(76, 85, 97, 0.09) 36%,
          rgba(20, 24, 31, 0.04) 100%
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
      transform: translateX(100%);
      transition: transform 0.25s ease-out;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    :host([visible]) .sidebar {
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
      flex-shrink: 0;
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

    .content {
      flex: 1;
      overflow: hidden;
      position: relative;
      min-height: 0;
      display: flex;
    }

    mobile-settings-panel {
      flex: 1;
      min-height: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
  `;

  render() {
    if (!this.visible) return null;

    return html`
      <div class="backdrop" @click="${this.handleBackdropClick}"></div>
      <div class="sidebar">
        <div class="header">
          <div class="title">⚙️ Settings</div>
          <button class="close-btn" @click="${this.close}">✕</button>
        </div>
        <div class="content">
          <mobile-settings-panel
            .game="${this.game}"
            .eventBus="${this.eventBus}"
          ></mobile-settings-panel>
        </div>
      </div>
    `;
  }

  private handleBackdropClick(): void {
    this.close();
  }

  open(): void {
    this.visible = true;
    HapticFeedback.tap();
  }

  close(): void {
    this.visible = false;
    this.dispatchEvent(
      new CustomEvent("sidebar-closed", {
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
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-settings-sidebar": MobileSettingsSidebar;
  }
}
