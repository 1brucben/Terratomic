import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import "../../ResearchTreeModal";
import type { ResearchTreeModal } from "../../ResearchTreeModal";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

@customElement("research-toggle-button")
export class ResearchToggleButton extends LitElement implements Layer {
  layerName = "ResearchToggleButton";
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private _isVisible = false;

  @state()
  private _isModalOpen = false;

  @state()
  private _highlightActive = false;

  private modalRef: ResearchTreeModal | null = null;

  createRenderRoot() {
    return this; // inherit global styles / Tailwind scale adjustments
  }

  private readonly handleTutorialHighlight = (event: Event) => {
    const detail = (event as CustomEvent<{ target: string; active: boolean }>)
      .detail;
    if (!detail || detail.target !== "research-tree-button") {
      return;
    }
    this._highlightActive = Boolean(detail.active);
    this.requestUpdate();
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("tutorial-highlight", this.handleTutorialHighlight);
  }

  disconnectedCallback(): void {
    window.removeEventListener(
      "tutorial-highlight",
      this.handleTutorialHighlight,
    );
    super.disconnectedCallback();
  }

  init() {
    this.modalRef = this.lookupModal();
    this.updateModalState();
  }

  tick() {
    const player = this.game?.myPlayer?.();
    const shouldShow = Boolean(
      player && player.isAlive() && !this.game.inSpawnPhase(),
    );
    if (shouldShow !== this._isVisible) {
      this._isVisible = shouldShow;
      this.requestUpdate();
    }
    this.updateModalState();
  }

  shouldTransform(): boolean {
    return false;
  }

  private lookupModal(): ResearchTreeModal | null {
    return document.querySelector(
      "research-tree-modal",
    ) as ResearchTreeModal | null;
  }

  private updateModalState() {
    const modal = this.modalRef ?? this.lookupModal();
    if (!modal) {
      this._isModalOpen = false;
      return;
    }
    this.modalRef = modal;
    const modalShell = modal.shadowRoot?.querySelector("o-modal") as
      | (HTMLElement & { isModalOpen?: boolean })
      | null;
    const isOpen = Boolean(modalShell?.isModalOpen);
    if (isOpen !== this._isModalOpen) {
      this._isModalOpen = isOpen;
      this.requestUpdate();
    }
  }

  private toggleModal = () => {
    const modal = this.modalRef ?? this.lookupModal();
    if (!modal) return;
    modal.game = this.game;
    modal.eventBus = this.eventBus;
    if (this._isModalOpen) {
      modal.close();
    } else {
      modal.open();
    }
    this._isModalOpen = !this._isModalOpen;
  };

  render() {
    if (!this._isVisible) return html``;

    return html`
      <style>
        @keyframes tutorial-bg-flicker {
          0% {
            filter: brightness(1);
          }
          25% {
            filter: brightness(1.3);
          }
          50% {
            filter: brightness(1);
          }
          75% {
            filter: brightness(1.3);
          }
          100% {
            filter: brightness(1);
          }
        }

        .tutorial-highlight-flicker {
          animation: tutorial-bg-flicker 1.2s ease-in-out infinite;
        }

        .research-vertical-button {
          position: fixed;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: 10050;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 14px 10px;
          border: 2px solid var(--ui-panel-border);
          border-left: none;
          border-radius: 0 6px 6px 0;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-family: "Oswald", sans-serif;
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--ui-panel-shell-top) 96%, transparent),
            color-mix(in srgb, var(--ui-panel-shell-bottom) 96%, transparent)
          );
          color: var(--ui-text-light);
          cursor: pointer;
          box-shadow:
            inset 0 0 8px
              color-mix(in srgb, var(--ui-text-light) 18%, transparent),
            4px 0 12px color-mix(in srgb, var(--ui-overlay) 75%, transparent);
          transition:
            transform 120ms ease,
            box-shadow 120ms ease,
            background 120ms ease;
        }
        .research-vertical-button span:not(.policy-notification-badge) {
          display: block;
          font-size: 14px;
          line-height: 1.1;
        }
        .research-vertical-button:hover {
          transform: translateY(-50%) scale(1.05);
          box-shadow:
            inset 0 0 12px
              color-mix(in srgb, var(--ui-text-light) 22%, transparent),
            8px 0 16px color-mix(in srgb, var(--ui-overlay) 80%, transparent);
        }
        .research-vertical-button.open {
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--ui-secondary) 90%, transparent),
            color-mix(in srgb, var(--ui-primary) 90%, transparent)
          );
          border-color: var(--ui-secondary);
        }
        .policy-notification-badge {
          position: absolute;
          top: -4px;
          right: -4px;
          width: 18px;
          height: 18px;
          background: #ffc107;
          border: 2px solid #000;
          border-radius: 50%;
          font-size: 12px;
          font-weight: bold;
          color: #000;
          line-height: 14px;
          text-align: center;
          padding-left: 1px;
          animation: pulse-badge 1.5s ease-in-out infinite;
        }
        @keyframes pulse-badge {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.15);
          }
        }
      </style>
      <div
        class="ui-scale-surface"
        style="position: fixed; left: 0; top: 50%; z-index: 10050; --ui-scale-origin: center left;"
      >
        <button
          type="button"
          class="research-vertical-button ${this._isModalOpen ? "open" : ""}"
          aria-label=${translateText("research_tree.toggle_tooltip")}
          title=${translateText("research_tree.toggle_tooltip")}
          @click=${this.toggleModal}
          style="position: relative;"
        >
          ${["R", "E", "S", "E", "A", "R", "C", "H"].map(
            (letter) => html`<span>${letter}</span>`,
          )}
        </button>
      </div>
    `;
  }
}
