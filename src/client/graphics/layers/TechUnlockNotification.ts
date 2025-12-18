import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { PlayerID } from "../../../core/game/Game";
import {
  GameUpdateType,
  type PlayerUpdate,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { getTechNodes } from "../../../core/tech/ResearchTree";
import { getTechMeta } from "../../../core/tech/TechEffects";
import { Layer } from "./Layer";

type TechNotificationPayload = {
  id: string;
  name: string;
  description: string;
};

const AUTO_DISMISS_DELAY_MS = 5000;
const EXIT_ANIMATION_MS = 200;

@customElement("tech-unlock-notification")
export class TechUnlockNotification extends LitElement implements Layer {
  layerName = "TechUnlockNotification";
  @property({ attribute: false })
  public game!: GameView;

  @property({ attribute: false })
  public eventBus!: EventBus;

  @state()
  private current: TechNotificationPayload | null = null;

  @state()
  private isVisible = false;

  private queue: TechNotificationPayload[] = [];
  private seenTechs = new Set<string>();
  private activePlayerId: PlayerID | null = null;
  private dismissTimer: number | null = null;
  private exitTimer: number | null = null;
  private allTechIds = new Set(getTechNodes().map((t) => t.id));

  createRenderRoot() {
    return this;
  }

  init() {
    this.seedFromPlayer();
  }

  shouldTransform(): boolean {
    return false;
  }

  tick() {
    const player = this.game.myPlayer();
    if (!player || !player.isAlive()) {
      if (this.activePlayerId !== null) {
        this.resetState();
      }
      return;
    }

    if (player.id() !== this.activePlayerId) {
      this.activePlayerId = player.id();
      this.seedFromPlayer();
    }

    const updates = this.game.updatesSinceLastTick();
    const playerUpdates =
      (updates?.[GameUpdateType.Player] as PlayerUpdate[]) ?? [];
    if (!playerUpdates.length) return;

    for (const update of playerUpdates) {
      if (update.id !== player.id()) continue;
      if (!update.researchTreeTechs) continue;
      this.handleResearchUpdate(update.researchTreeTechs);
    }
  }

  private handleResearchUpdate(updatedTechs: string[]) {
    const filtered = updatedTechs.filter((id) => this.allTechIds.has(id));
    for (const techId of filtered) {
      if (this.seenTechs.has(techId)) continue;
      const meta = getTechMeta(techId, { strict: false });
      if (!meta) continue;
      this.seenTechs.add(techId);
      const body = meta.shortDescription ?? meta.description ?? "";
      this.enqueue({
        id: techId,
        name: meta.name ?? techId,
        description: body,
      });
    }
    for (const techId of filtered) this.seenTechs.add(techId);
  }

  private seedFromPlayer() {
    this.queue = [];
    this.clearTimers();
    this.current = null;
    this.isVisible = false;
    this.seenTechs.clear();
    const player = this.game.myPlayer();
    if (!player) return;
    for (const techId of this.allTechIds) {
      if (player.hasResearchedTech(techId)) {
        this.seenTechs.add(techId);
      }
    }
  }

  private resetState() {
    this.activePlayerId = null;
    this.seenTechs.clear();
    this.queue = [];
    this.clearTimers();
    this.current = null;
    this.isVisible = false;
  }

  private enqueue(payload: TechNotificationPayload) {
    this.queue.push(payload);
    if (!this.current) {
      this.showNext();
    }
  }

  private showNext() {
    const next = this.queue.shift() ?? null;
    this.current = next;
    if (!next) {
      this.isVisible = false;
      return;
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
    this.isVisible = false;
    this.clearDismissTimer();
    this.clearExitTimer();
    this.exitTimer = window.setTimeout(() => {
      this.current = null;
      this.showNext();
    }, EXIT_ANIMATION_MS);
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
        .tech-toast {
          position: fixed;
          left: 36px;
          top: 50%;
          transform: translateY(-50%);
          width: min(320px, 90vw);
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--ui-panel-shell-top) 95%, transparent),
            color-mix(in srgb, var(--ui-panel-shell-bottom) 95%, transparent)
          );
          border: 2px solid
            color-mix(in srgb, var(--ui-panel-border) 90%, transparent);
          border-radius: 8px;
          padding: 12px 16px;
          color: var(--ui-text-light);
          font-family: "Oswald", sans-serif;
          box-shadow:
            inset 0 0 12px
              color-mix(in srgb, var(--ui-text-light) 18%, transparent),
            8px 12px 24px color-mix(in srgb, var(--ui-overlay) 85%, transparent);
          transition:
            transform 200ms ease,
            opacity 200ms ease;
          opacity: 0;
          transform: translate(-120%, -50%);
          z-index: 10040;
          cursor: pointer;
        }
        .tech-toast.visible {
          transform: translate(0, -50%);
          opacity: 1;
        }
        .tech-toast__header {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 8px;
        }
        .tech-toast__label {
          font-size: 12px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--ui-status-warning);
          animation: pulse 1.25s ease-in-out infinite;
        }
        .tech-toast__title {
          font-size: 20px;
          line-height: 1.1;
          text-transform: uppercase;
        }
        .tech-toast__body {
          font-size: 13px;
          font-family: "Roboto Mono", monospace;
          color: color-mix(in srgb, var(--ui-text-light) 85%, transparent);
          line-height: 1.4;
          white-space: pre-line;
        }
        @keyframes pulse {
          0% {
            opacity: 0.7;
            text-shadow: 0 0 4px
              color-mix(in srgb, var(--ui-status-warning) 40%, transparent);
          }
          50% {
            opacity: 1;
            text-shadow: 0 0 12px
              color-mix(in srgb, var(--ui-status-warning) 80%, transparent);
          }
          100% {
            opacity: 0.7;
            text-shadow: 0 0 4px
              color-mix(in srgb, var(--ui-status-warning) 40%, transparent);
          }
        }
      </style>
      <div
        class="tech-toast ${visible ? "visible" : ""}"
        role="status"
        aria-live="polite"
        @click=${this.dismiss}
      >
        ${this.current
          ? html`
              <div class="tech-toast__header">
                <span class="tech-toast__label">Tech unlocked</span>
                <span class="tech-toast__title">${this.current.name}</span>
              </div>
              <p class="tech-toast__body">${this.current.description}</p>
            `
          : null}
      </div>
    `;
  }
}
