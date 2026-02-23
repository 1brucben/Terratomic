import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { notificationQueue } from "../../NotificationQueue";
import {
  getMobileAttackBarBottom,
  startRepositionInterval,
  stopRepositionInterval,
} from "../utils/OverlayPositioning";

type TechNotificationPayload = {
  id: string;
  name: string;
  description: string;
};

const AUTO_DISMISS_DELAY_MS = 4600;
const EXIT_ANIMATION_MS = 180;
const BASE_TOP_PX = 52;
const STACK_GAP_PX = 8;

@customElement("mobile-tech-unlock-toast")
export class MobileTechUnlockToast extends LitElement {
  @state() private current: TechNotificationPayload | null = null;
  @state() private visible = false;

  private dismissTimer: number | null = null;
  private exitTimer: number | null = null;
  private repositionTimer: number | null = null;
  private subscribed = false;

  static styles = css`
    :host {
      position: fixed;
      left: 50%;
      top: var(--mobile-toast-top, calc(env(safe-area-inset-top, 0px) + 52px));
      transform: translateX(-50%);
      width: min(92vw, 320px);
      z-index: 4050;
      pointer-events: none;
      display: block;
    }

    .toast {
      position: relative;
      opacity: 0;
      transform: translateY(-8px);
      transition:
        transform 0.2s ease,
        opacity 0.2s ease;
      pointer-events: auto;
      border-radius: 10px;
      border: 1px solid rgba(158, 170, 184, 0.36);
      background:
        linear-gradient(
          180deg,
          rgba(218, 226, 236, 0.18) 0%,
          rgba(154, 166, 180, 0.12) 38%,
          rgba(116, 129, 145, 0.08) 100%
        ),
        linear-gradient(
          180deg,
          rgba(72, 84, 100, 0.96) 0%,
          rgba(56, 67, 82, 0.97) 52%,
          rgba(43, 52, 66, 0.98) 100%
        );
      box-shadow:
        inset 0 1px 0 rgba(243, 248, 255, 0.24),
        0 8px 18px rgba(0, 0, 0, 0.3);
      color: rgba(241, 247, 255, 0.97);
      padding: 10px 34px 9px 10px;
    }

    .toast.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .close {
      position: absolute;
      top: 7px;
      right: 7px;
      width: 22px;
      height: 22px;
      border-radius: 5px;
      border: 1px solid rgba(156, 168, 184, 0.34);
      color: rgba(254, 217, 164, 0.95);
      background: linear-gradient(
        180deg,
        rgba(78, 89, 103, 0.95) 0%,
        rgba(62, 72, 86, 0.97) 100%
      );
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
    }

    .close:active {
      transform: translateY(1px);
      filter: brightness(1.08);
    }

    .label {
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: rgba(255, 221, 146, 0.95);
      font-weight: 700;
      margin-bottom: 3px;
      line-height: 1;
    }

    .title {
      font-size: 14px;
      line-height: 1.2;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 4px;
      color: rgba(245, 250, 255, 0.98);
      max-height: 2.5em;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .body {
      font-size: 12px;
      line-height: 1.35;
      color: rgba(221, 230, 241, 0.92);
      margin: 0;
      max-height: 5.2em;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();

    if (!this.subscribed) {
      notificationQueue.onShow((notification) => {
        if (notification.type !== "tech") return;
        if (!this.isMobileUIActive()) return;
        this.showTechToast(notification.payload as TechNotificationPayload);
      });
      this.subscribed = true;
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.clearTimers();
  }

  private showTechToast(payload: TechNotificationPayload): void {
    this.current = payload;
    this.updateTopOffset();
    this.startRepositionLoop();

    this.visible = true;
    this.clearDismissTimer();
    this.dismissTimer = window.setTimeout(() => {
      this.dismiss();
    }, AUTO_DISMISS_DELAY_MS);
  }

  private dismiss = (): void => {
    if (!this.current) return;

    this.visible = false;
    this.clearDismissTimer();
    this.clearExitTimer();
    this.stopRepositionLoop();
    this.exitTimer = window.setTimeout(() => {
      this.current = null;
      notificationQueue.complete();
    }, EXIT_ANIMATION_MS);
  };

  private updateTopOffset(): void {
    const anchorTop = BASE_TOP_PX;
    const attackBottom = this.getAttackBarBottom();
    const allianceBottom = this.getAllianceBottom();
    const researchBottom = this.getResearchPriorityToastBottom();
    const maxBottom = Math.max(attackBottom, allianceBottom, researchBottom);

    const targetTop =
      maxBottom > 0 ? Math.max(anchorTop, maxBottom + STACK_GAP_PX) : anchorTop;

    this.style.setProperty("--mobile-toast-top", `${targetTop}px`);
  }

  private startRepositionLoop(): void {
    this.stopRepositionLoop();
    this.repositionTimer = startRepositionInterval(
      this.repositionTimer,
      () => {
        this.updateTopOffset();
      },
      180,
    );
  }

  private stopRepositionLoop(): void {
    this.repositionTimer = stopRepositionInterval(this.repositionTimer);
  }

  private getAttackBarBottom(): number {
    return getMobileAttackBarBottom();
  }

  private getAllianceBottom(): number {
    const alliance = document.querySelector(
      "mobile-alliance-notifications",
    ) as HTMLElement | null;
    if (!alliance) return 0;

    const hasNotifications =
      alliance.shadowRoot?.querySelectorAll(".notification").length ?? 0;
    if (hasNotifications === 0) return 0;

    return alliance.getBoundingClientRect().bottom;
  }

  private getResearchPriorityToastBottom(): number {
    const toast = document.querySelector(
      "mobile-research-priority-toast",
    ) as HTMLElement | null;
    if (!toast || !toast.hasAttribute("visible")) return 0;

    return toast.getBoundingClientRect().bottom;
  }

  private isMobileUIActive(): boolean {
    return document.body.classList.contains("mobile-ui-enabled");
  }

  private clearTimers(): void {
    this.clearDismissTimer();
    this.clearExitTimer();
    this.stopRepositionLoop();
  }

  private clearDismissTimer(): void {
    if (this.dismissTimer !== null) {
      window.clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  private clearExitTimer(): void {
    if (this.exitTimer !== null) {
      window.clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
  }

  render() {
    if (!this.current) return null;

    return html`
      <div
        class="toast ${this.visible ? "visible" : ""}"
        @click=${this.dismiss}
      >
        <button class="close" @click=${this.dismiss} aria-label="Close">
          ×
        </button>
        <div class="label">Tech unlocked</div>
        <div class="title">${this.current.name}</div>
        <p class="body">${this.current.description}</p>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-tech-unlock-toast": MobileTechUnlockToast;
  }
}
