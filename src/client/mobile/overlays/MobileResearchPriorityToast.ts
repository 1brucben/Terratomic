import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";

const TOAST_AUTO_HIDE_MS = 4600;
const BASE_TOP_PX = 56;

@customElement("mobile-research-priority-toast")
export class MobileResearchPriorityToast extends LitElement {
  @property({ type: Boolean, reflect: true }) visible = false;
  @property({ type: String }) title = "";
  @property({ type: String }) message = "";

  private hideTimer: number | null = null;

  static styles = css`
    :host {
      position: fixed;
      top: calc(
        env(safe-area-inset-top, 0px) + var(--research-toast-top, 56px)
      );
      left: var(
        --research-toast-left,
        max(14px, calc(env(safe-area-inset-left, 0px) + 10px))
      );
      right: auto;
      transform: translate(var(--research-toast-shift-x, 0), -8px);
      width: min(92vw, 320px);
      z-index: 4300;
      pointer-events: none;
      opacity: 0;
      transition:
        transform 0.22s ease,
        opacity 0.22s ease;
    }

    :host([visible]) {
      opacity: 1;
      transform: translate(var(--research-toast-shift-x, 0), 0);
      pointer-events: auto;
    }

    @media (orientation: landscape) {
      :host {
        --research-toast-left: 50%;
        --research-toast-shift-x: -50%;
      }
    }

    @media (orientation: portrait) and (min-width: 431px) {
      :host {
        --research-toast-left: 50%;
        --research-toast-shift-x: -50%;
      }
    }

    .toast {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      position: relative;
      padding: 10px;
      padding-right: 34px;
      border-radius: 10px;
      border: 1px solid rgba(142, 154, 169, 0.3);
      background:
        linear-gradient(
          180deg,
          rgba(128, 138, 151, 0.12) 0%,
          rgba(75, 85, 96, 0.08) 38%,
          rgba(22, 27, 34, 0.04) 100%
        ),
        linear-gradient(
          180deg,
          rgba(34, 40, 49, 0.97) 0%,
          rgba(21, 27, 35, 0.98) 56%,
          rgba(14, 19, 25, 0.98) 100%
        );
      box-shadow:
        inset 0 1px 0 rgba(232, 239, 247, 0.1),
        0 8px 20px rgba(0, 0, 0, 0.42);
      cursor: pointer;
      pointer-events: auto;
    }

    .close {
      position: absolute;
      top: 7px;
      right: 7px;
      width: 22px;
      height: 22px;
      border-radius: 5px;
      border: 1px solid rgba(129, 141, 156, 0.3);
      color: rgba(244, 188, 122, 0.95);
      background: linear-gradient(
        180deg,
        rgba(18, 24, 33, 0.9) 0%,
        rgba(11, 15, 22, 0.94) 100%
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

    .icon {
      width: 22px;
      height: 22px;
      min-width: 22px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      color: rgba(234, 245, 235, 0.96);
      background: linear-gradient(
        180deg,
        rgba(45, 116, 79, 0.88) 0%,
        rgba(23, 62, 42, 0.92) 100%
      );
      border: 1px solid rgba(108, 188, 147, 0.44);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }

    .content {
      min-width: 0;
    }

    .title {
      color: rgba(239, 245, 252, 0.96);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.18px;
      margin-bottom: 2px;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .message {
      color: rgba(203, 214, 226, 0.9);
      font-size: 11px;
      line-height: 1.3;
    }
  `;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.clearTimer();
  }

  show(category: string): void {
    this.title = translateText("research_priority.confirm_title");
    this.message = translateText("research_priority.confirm_text", {
      category,
    });

    this.updateTopOffset();
    this.visible = true;
    this.clearTimer();
    this.hideTimer = window.setTimeout(() => {
      this.dismiss();
    }, TOAST_AUTO_HIDE_MS);
  }

  private dismiss = (): void => {
    this.visible = false;
    this.clearTimer();
  };

  private handleCloseClick = (event: Event): void => {
    event.stopPropagation();
    this.dismiss();
  };

  render() {
    return html`
      <div
        class="toast"
        role="status"
        aria-live="polite"
        @click=${this.dismiss}
      >
        <button
          class="close"
          @click=${this.handleCloseClick}
          aria-label="Close"
        >
          ×
        </button>
        <div class="icon">✓</div>
        <div class="content">
          <div class="title">${this.title}</div>
          <div class="message">${this.message}</div>
        </div>
      </div>
    `;
  }

  private clearTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private updateTopOffset(): void {
    this.style.setProperty("--research-toast-top", `${BASE_TOP_PX}px`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-research-priority-toast": MobileResearchPriorityToast;
  }
}
