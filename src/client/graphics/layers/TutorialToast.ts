import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { notificationQueue } from "../../NotificationQueue";
import { tutorialManager } from "../../TutorialManager";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

export type TutorialTipPayload = {
  id: string;
  title: string;
  description: string;
  category?: string;
  highlightTarget?: string;
};

const AUTO_DISMISS_DELAY_MS = 8000;
const EXIT_ANIMATION_MS = 200;

@customElement("tutorial-toast")
export class TutorialToast extends LitElement implements Layer {
  layerName = "TutorialToast";

  @property({ attribute: false })
  public game!: GameView;

  @property({ attribute: false })
  public eventBus!: EventBus;

  @state()
  private current: TutorialTipPayload | null = null;

  @state()
  private isVisible = false;

  private dismissTimer: number | null = null;
  private exitTimer: number | null = null;
  private settings = new UserSettings();

  createRenderRoot() {
    return this;
  }

  init() {
    // Listen for custom tutorial events
    window.addEventListener("show-tutorial-tip", this.handleTutorialEvent);

    notificationQueue.onShow((notification) => {
      if (notification.type === "tutorial") {
        this.showTutorialTip(notification.payload);
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("show-tutorial-tip", this.handleTutorialEvent);
    this.clearTimers();
  }

  shouldTransform(): boolean {
    return false;
  }

  tick() {
    // TutorialToast is event-driven, no per-tick logic needed
  }

  private handleTutorialEvent = (event: Event) => {
    const customEvent = event as CustomEvent<TutorialTipPayload>;
    if (customEvent.detail) {
      this.enqueue(customEvent.detail);
    }
  };

  private enqueue(payload: TutorialTipPayload) {
    // Check if tutorials are enabled
    if (!this.settings.tutorialEnabled()) {
      return;
    }

    // Add to unified queue
    notificationQueue.enqueue("tutorial", payload);
  }

  private showTutorialTip(payload: TutorialTipPayload) {
    this.current = payload;

    // Mark as seen for this session only
    tutorialManager.markSeen(payload.id);

    // Trigger highlight if specified
    if (payload.highlightTarget) {
      window.dispatchEvent(
        new CustomEvent("tutorial-highlight", {
          detail: { target: payload.highlightTarget, active: true },
        }),
      );
    }

    this.isVisible = true;
    this.clearDismissTimer();
    this.dismissTimer = window.setTimeout(
      () => this.handleAutoDismiss(),
      AUTO_DISMISS_DELAY_MS,
    );
  }

  private handleAutoDismiss() {
    this.dismiss();
  }

  private dismiss = () => {
    if (!this.current) return;

    // Clear highlight if it was active
    if (this.current.highlightTarget) {
      window.dispatchEvent(
        new CustomEvent("tutorial-highlight", {
          detail: { target: this.current.highlightTarget, active: false },
        }),
      );
    }

    this.isVisible = false;
    this.clearDismissTimer();
    this.clearExitTimer();
    this.exitTimer = window.setTimeout(() => {
      this.current = null;
      notificationQueue.complete();
    }, EXIT_ANIMATION_MS);
  };

  private disableAllTutorials = (event: Event) => {
    event.stopPropagation();
    this.settings.toggleTutorialEnabled();
    notificationQueue.clear();
    this.dismiss();
  };

  private clearTimers() {
    this.clearDismissTimer();
    this.clearExitTimer();
  }

  private clearDismissTimer() {
    if (this.dismissTimer !== null) {
      window.clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  private clearExitTimer() {
    if (this.exitTimer !== null) {
      window.clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
  }

  render() {
    const visible = this.isVisible && this.current !== null;

    return html`
      <style>
        .tutorial-toast {
          position: fixed;
          left: 36px;
          top: 50%;
          width: min(360px, 90vw);
          background-color: color-mix(
            in srgb,
            var(--ui-status-info, #3ba9ff) 14%,
            #0f172a
          );
          background-image: linear-gradient(
            180deg,
            color-mix(in srgb, var(--ui-status-info, #3ba9ff) 20%, #15203a),
            color-mix(in srgb, var(--ui-status-info, #3ba9ff) 10%, #0f172a)
          );
          border: 2px solid
            color-mix(in srgb, var(--ui-status-info, #3ba9ff) 65%, transparent);
          border-radius: 12px;
          padding: 16px 44px 14px 18px;
          color: var(--ui-text-light);
          font-family: "Oswald", sans-serif;
          box-shadow:
            0 10px 30px color-mix(in srgb, var(--ui-overlay) 75%, transparent),
            inset 0 0 10px
              color-mix(
                in srgb,
                var(--ui-status-info, #3ba9ff) 14%,
                transparent
              );
          transition:
            transform 240ms ease,
            opacity 240ms ease;
          opacity: 0;
          transform: translate(-120%, -50%);
          z-index: 10040;
          cursor: pointer;
          text-align: left;
        }
        .tutorial-toast.visible {
          transform: translate(0, -50%);
          opacity: 1;
        }
        .tutorial-toast__close {
          position: absolute;
          top: 10px;
          right: 10px;
          background: color-mix(
            in srgb,
            var(--ui-status-info) 18%,
            transparent
          );
          border: 1px solid
            color-mix(in srgb, var(--ui-status-info) 40%, transparent);
          border-radius: 6px;
          color: var(--ui-text-light);
          cursor: pointer;
          font-size: 16px;
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 150ms ease;
        }
        .tutorial-toast__close:hover {
          background: color-mix(
            in srgb,
            var(--ui-panel-border) 50%,
            transparent
          );
          border-color: var(--ui-text-light);
        }
        .tutorial-toast__header {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-bottom: 8px;
        }
        .tutorial-toast__label {
          font-size: 12px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: color-mix(
            in srgb,
            var(--ui-status-info) 85%,
            var(--ui-text-light)
          );
          font-weight: 700;
        }
        .tutorial-toast__title {
          font-size: 18px;
          line-height: 1.25;
          text-transform: uppercase;
          color: var(--ui-text-light);
          font-weight: 700;
        }
        .tutorial-toast__body {
          font-size: 14px;
          font-family: "Roboto Mono", monospace;
          color: color-mix(in srgb, var(--ui-text-light) 90%, transparent);
          line-height: 1.55;
          margin: 0;
        }
        .tutorial-toast__footer {
          display: flex;
          justify-content: flex-end;
          margin-top: 8px;
        }
        .tutorial-toast__disable-link {
          font-size: 10px;
          font-family: "Roboto Mono", monospace;
          color: color-mix(in srgb, var(--ui-text-light) 50%, transparent);
          text-decoration: none;
          cursor: pointer;
          transition: color 150ms ease;
          letter-spacing: 0.05em;
        }
        .tutorial-toast__disable-link:hover {
          color: var(--ui-status-warning);
          text-decoration: underline;
        }
        @keyframes glow {
          0% {
            opacity: 0.8;
            text-shadow: 0 0 4px
              color-mix(in srgb, var(--ui-status-info) 50%, transparent);
          }
          50% {
            opacity: 1;
            text-shadow: 0 0 12px
              color-mix(in srgb, var(--ui-status-info) 90%, transparent);
          }
          100% {
            opacity: 0.8;
            text-shadow: 0 0 4px
              color-mix(in srgb, var(--ui-status-info) 50%, transparent);
          }
        }
      </style>
      <div
        class="tutorial-toast ${visible ? "visible" : ""}"
        role="status"
        aria-live="polite"
        @click=${this.dismiss}
      >
        ${this.current
          ? html`
              <button
                class="tutorial-toast__close"
                @click=${this.dismiss}
                aria-label="Close"
                title="${translateText("common.close")}"
              >
                ×
              </button>
              <div class="tutorial-toast__header">
                <span class="tutorial-toast__label"
                  >${translateText("tutorial.label")}</span
                >
                <span class="tutorial-toast__title">${this.current.title}</span>
              </div>
              <p class="tutorial-toast__body">${this.current.description}</p>
              <div class="tutorial-toast__footer">
                <a
                  class="tutorial-toast__disable-link"
                  @click=${this.disableAllTutorials}
                  title="${translateText("tutorial.disable_all_tooltip")}"
                >
                  ${translateText("tutorial.disable_all")}
                </a>
              </div>
            `
          : null}
      </div>
    `;
  }
}
