/**
 * MobileAllianceNotifications - Prominent notification bubbles for alliance requests
 * Displays under the top bar with Accept/Reject actions
 */

import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { EventBus } from "../../../core/EventBus";
import {
  AllianceRequestUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import type { GameView } from "../../../core/game/GameView";
import { PlayerView } from "../../../core/game/GameView";
import {
  SendAllianceExtensionIntentEvent,
  SendAllianceReplyIntentEvent,
} from "../../Transport";
import { HapticFeedback } from "../utils/HapticFeedback";

interface AllianceRequest {
  requestorID: number;
  recipientID: number;
  createdAt: number;
  requestorName: string;
}

interface AllianceExtensionWarning {
  allyID: number;
  allyName: string;
  allianceCreatedAt: number;
  tag: string; // Unique identifier
}

@customElement("mobile-alliance-notifications")
export class MobileAllianceNotifications extends LitElement {
  @property({ type: Object }) game: GameView | null = null;
  @property({ type: Object }) eventBus: EventBus | null = null;
  @property({ type: Number }) topOffset: number = 0; // Extra offset from attack bar

  @state() private requests: AllianceRequest[] = [];
  @state() private extensionWarnings: AllianceExtensionWarning[] = [];

  static styles = css`
    :host {
      display: block;
      position: fixed;
      /* Base top is set via inline style to account for dynamic topOffset */
      left: 50%;
      transform: translateX(-50%);
      width: min(85vw, 280px);
      z-index: 1500;
      pointer-events: none;
    }

    .notification {
      background:
        linear-gradient(
          180deg,
          rgba(120, 192, 155, 0.14) 0%,
          rgba(71, 123, 99, 0.08) 38%,
          rgba(24, 33, 38, 0.05) 100%
        ),
        linear-gradient(
          180deg,
          rgba(31, 46, 40, 0.96) 0%,
          rgba(18, 28, 24, 0.98) 52%,
          rgba(12, 20, 17, 0.98) 100%
        );
      border: 1px solid rgba(135, 199, 166, 0.32);
      border-radius: 8px;
      padding: 8px;
      margin-bottom: 8px;
      box-shadow:
        inset 0 1px 0 rgba(232, 241, 236, 0.08),
        0 3px 10px rgba(0, 0, 0, 0.38);
      pointer-events: all;
      animation: slideDown 0.3s ease-out;
    }

    .notification.warning {
      background:
        linear-gradient(
          180deg,
          rgba(212, 167, 96, 0.14) 0%,
          rgba(130, 94, 41, 0.08) 38%,
          rgba(30, 24, 18, 0.05) 100%
        ),
        linear-gradient(
          180deg,
          rgba(49, 38, 23, 0.96) 0%,
          rgba(31, 24, 15, 0.98) 52%,
          rgba(22, 17, 11, 0.98) 100%
        );
      border-color: rgba(221, 179, 108, 0.36);
    }

    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .notification-header {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.4rem;
    }

    .notification-icon {
      font-size: 1rem;
      flex-shrink: 0;
    }

    .notification-title {
      flex: 1;
      font-size: 11px;
      font-weight: 700;
      color: rgba(237, 244, 251, 0.95);
      text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
      letter-spacing: 0.2px;
    }

    .notification-close {
      background: linear-gradient(
        180deg,
        rgba(22, 30, 40, 0.86) 0%,
        rgba(12, 18, 26, 0.92) 100%
      );
      border: 1px solid rgba(128, 140, 154, 0.3);
      border-radius: 5px;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(238, 185, 122, 0.95);
      font-size: 14px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      flex-shrink: 0;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .notification-close:active {
      filter: brightness(1.08);
      transform: translateY(1px);
    }

    .notification-message {
      color: rgba(221, 230, 240, 0.9);
      font-size: 11px;
      margin-bottom: 6px;
      line-height: 1.3;
    }

    .notification-actions {
      display: flex;
      gap: 6px;
    }

    .action-btn {
      flex: 1;
      padding: 5px 7px;
      border: 1px solid rgba(126, 137, 150, 0.3);
      border-radius: 5px;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition:
        transform 0.12s ease,
        filter 0.12s ease,
        border-color 0.15s ease;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .action-btn:active {
      transform: translateY(1px) scale(0.97);
      filter: brightness(1.08);
    }

    .action-accept {
      background: linear-gradient(
        180deg,
        rgba(44, 114, 78, 0.88) 0%,
        rgba(24, 62, 42, 0.92) 100%
      );
      color: rgba(224, 246, 234, 0.96);
      border-color: rgba(112, 198, 156, 0.4);
    }

    .action-accept:active {
      filter: brightness(1.1);
    }

    .action-reject {
      background: linear-gradient(
        180deg,
        rgba(53, 63, 75, 0.86) 0%,
        rgba(27, 35, 45, 0.92) 100%
      );
      color: rgba(230, 236, 244, 0.94);
      border-color: rgba(144, 154, 168, 0.34);
    }

    .action-reject:active {
      filter: brightness(1.08);
    }

    .action-renew {
      background: linear-gradient(
        180deg,
        rgba(141, 99, 46, 0.88) 0%,
        rgba(85, 54, 22, 0.92) 100%
      );
      color: rgba(255, 241, 221, 0.96);
      border-color: rgba(217, 172, 101, 0.44);
    }

    .action-renew:active {
      filter: brightness(1.1);
    }
  `;

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);
    // Update top position when topOffset changes
    if (changedProperties.has("topOffset")) {
      const baseTop = 60; // Base offset from top bar
      this.style.top = `calc(env(safe-area-inset-top, 0px) + ${baseTop + this.topOffset}px)`;
    }
  }

  connectedCallback() {
    super.connectedCallback();
    // Set initial top position
    const baseTop = 60;
    this.style.top = `calc(env(safe-area-inset-top, 0px) + ${baseTop + this.topOffset}px)`;
  }

  tick() {
    if (!this.game) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      this.requests = [];
      this.extensionWarnings = [];
      return;
    }

    const updates = this.game.updatesSinceLastTick();
    if (updates && updates[GameUpdateType.AllianceRequest]) {
      updates[GameUpdateType.AllianceRequest].forEach(
        (update: AllianceRequestUpdate) => {
          // Only show if we're the recipient
          if (update.recipientID !== myPlayer.smallID()) return;

          const requestor = this.game!.playerBySmallID(update.requestorID);
          if (!requestor || !(requestor instanceof PlayerView)) return;

          // Check if already in list
          const exists = this.requests.some(
            (r) =>
              r.requestorID === update.requestorID &&
              r.recipientID === update.recipientID,
          );

          if (!exists) {
            this.requests = [
              ...this.requests,
              {
                requestorID: update.requestorID,
                recipientID: update.recipientID,
                createdAt: update.createdAt,
                requestorName: requestor.name(),
              },
            ];
          }
        },
      );
    }

    // Remove old requests (older than 5 minutes)
    const currentTick = this.game.ticks();
    this.requests = this.requests.filter(
      (r) => currentTick - r.createdAt < 300,
    );

    // ---- Alliance Extension Warnings ----
    const alliances = this.game.alliances();
    const duration = this.game.config().allianceDuration();
    const promptOffset = this.game.config().allianceExtensionPromptOffset();

    const newWarnings: AllianceExtensionWarning[] = [];

    for (const alliance of alliances) {
      const timeSinceCreation = currentTick - alliance.createdAt;
      const ticksLeft = duration - timeSinceCreation;

      // Show warning when close to expiry (within promptOffset ticks)
      if (ticksLeft >= promptOffset || ticksLeft <= 0) continue;

      // Only for alliances involving the local player
      if (
        alliance.requestorID !== myPlayer.smallID() &&
        alliance.recipientID !== myPlayer.smallID()
      ) {
        continue;
      }

      const otherID =
        alliance.requestorID === myPlayer.smallID()
          ? alliance.recipientID
          : alliance.requestorID;

      const other = this.game.playerBySmallID(otherID);
      if (
        !other ||
        !(other instanceof PlayerView) ||
        !myPlayer.isAlive() ||
        !other.isAlive()
      )
        continue;

      const tag = `about_to_expire_${alliance.requestorID}_${alliance.recipientID}_${alliance.createdAt}`;

      newWarnings.push({
        allyID: otherID,
        allyName: other.name(),
        allianceCreatedAt: alliance.createdAt,
        tag,
      });
    }

    this.extensionWarnings = newWarnings;
  }

  private handleAccept(request: AllianceRequest) {
    if (!this.game || !this.eventBus) return;

    const myPlayer = this.game.myPlayer();
    const requestor = this.game.playerBySmallID(request.requestorID);
    if (!myPlayer || !requestor || !(requestor instanceof PlayerView)) return;

    this.eventBus.emit(
      new SendAllianceReplyIntentEvent(requestor, myPlayer, true),
    );

    HapticFeedback.success();
    this.removeRequest(request);
  }

  private handleReject(request: AllianceRequest) {
    if (!this.game || !this.eventBus) return;

    const myPlayer = this.game.myPlayer();
    const requestor = this.game.playerBySmallID(request.requestorID);
    if (!myPlayer || !requestor || !(requestor instanceof PlayerView)) return;

    this.eventBus.emit(
      new SendAllianceReplyIntentEvent(requestor, myPlayer, false),
    );

    HapticFeedback.tap();
    this.removeRequest(request);
  }

  private handleDismiss(request: AllianceRequest) {
    HapticFeedback.tap();
    this.removeRequest(request);
  }

  private handleRenew(warning: AllianceExtensionWarning) {
    if (!this.game || !this.eventBus) return;

    const ally = this.game.playerBySmallID(warning.allyID);
    if (!ally || !(ally instanceof PlayerView)) return;

    this.eventBus.emit(new SendAllianceExtensionIntentEvent(ally));

    HapticFeedback.success();
    this.removeExtensionWarning(warning);
  }

  private handleDismissExtension(warning: AllianceExtensionWarning) {
    HapticFeedback.tap();
    this.removeExtensionWarning(warning);
  }

  private removeRequest(request: AllianceRequest) {
    this.requests = this.requests.filter(
      (r) =>
        !(
          r.requestorID === request.requestorID &&
          r.recipientID === request.recipientID &&
          r.createdAt === request.createdAt
        ),
    );
  }

  private removeExtensionWarning(warning: AllianceExtensionWarning) {
    this.extensionWarnings = this.extensionWarnings.filter(
      (w) => w.tag !== warning.tag,
    );
  }

  render() {
    if (this.requests.length === 0 && this.extensionWarnings.length === 0)
      return null;

    return html`
      ${this.extensionWarnings.map(
        (warning) => html`
          <div class="notification warning">
            <div class="notification-header">
              <div class="notification-icon">⏰</div>
              <div class="notification-title">Alliance Expiring Soon</div>
              <button
                class="notification-close"
                @click="${() => this.handleDismissExtension(warning)}"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
            <div class="notification-message">
              Alliance with ${warning.allyName} is about to expire!
            </div>
            <div class="notification-actions">
              <button
                class="action-btn action-renew"
                @click="${() => this.handleRenew(warning)}"
              >
                Renew
              </button>
              <button
                class="action-btn action-reject"
                @click="${() => this.handleDismissExtension(warning)}"
              >
                Dismiss
              </button>
            </div>
          </div>
        `,
      )}
      ${this.requests.map(
        (request) => html`
          <div class="notification">
            <div class="notification-header">
              <div class="notification-icon">🤝</div>
              <div class="notification-title">Alliance Request</div>
              <button
                class="notification-close"
                @click="${() => this.handleDismiss(request)}"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
            <div class="notification-message">
              ${request.requestorName} wants to form an alliance
            </div>
            <div class="notification-actions">
              <button
                class="action-btn action-accept"
                @click="${() => this.handleAccept(request)}"
              >
                Accept
              </button>
              <button
                class="action-btn action-reject"
                @click="${() => this.handleReject(request)}"
              >
                Reject
              </button>
            </div>
          </div>
        `,
      )}
    `;
  }
}
