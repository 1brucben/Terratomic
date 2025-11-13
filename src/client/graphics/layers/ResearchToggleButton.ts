import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import "../../ResearchTreeModal";
import type { ResearchTreeModal } from "../../ResearchTreeModal";
import { Layer } from "./Layer";

@customElement("research-toggle-button")
export class ResearchToggleButton extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private _isVisible = false;

  @state()
  private _isModalOpen = false;

  private modalRef: ResearchTreeModal | null = null;

  createRenderRoot() {
    return this; // inherit global styles / Tailwind scale adjustments
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
        .research-vertical-button {
          position: fixed;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: 10050;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-1); /* 4px */
          padding: 0.875rem 0.625rem; /* 14px 10px -> rem for root scaling */
          border: 0.125rem solid var(--ui-panel-border); /* 2px */
          border-left: none;
          border-radius: 0 0.375rem 0.375rem 0; /* 6px */
          text-transform: uppercase;
          letter-spacing: 0.0625rem; /* 1px */
          font-family: "Oswald", sans-serif;
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--ui-panel-shell-top) 96%, transparent),
            color-mix(in srgb, var(--ui-panel-shell-bottom) 96%, transparent)
          );
          color: var(--ui-text-light);
          cursor: pointer;
          box-shadow:
            inset 0 0 0.5rem
              color-mix(in srgb, var(--ui-text-light) 18%, transparent),
            /* 8px */ 0.25rem 0 0.75rem
              color-mix(in srgb, var(--ui-overlay) 75%, transparent); /* 4px 12px */
          transition:
            transform 120ms ease,
            box-shadow 120ms ease,
            background 120ms ease;
        }
        .research-vertical-button span {
          display: block;
          font-size: var(--font-md); /* 16px */
          line-height: 1.1;
        }
        .research-vertical-button:hover {
          transform: translateY(-50%) scale(1.05);
          box-shadow:
            inset 0 0 0.75rem
              color-mix(in srgb, var(--ui-text-light) 22%, transparent),
            /* 12px */ 0.5rem 0 1rem
              color-mix(in srgb, var(--ui-overlay) 80%, transparent); /* 8px 16px */
        }
        .research-vertical-button.open {
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--ui-secondary) 90%, transparent),
            color-mix(in srgb, var(--ui-primary) 90%, transparent)
          );
          border-color: var(--ui-secondary);
        }
      </style>
      <div
        class="ui-scale-surface"
        style="position: fixed; left: 0; top: 50%; z-index: 10050; --ui-scale-origin: center left;"
      >
        <button
          type="button"
          class="research-vertical-button ${this._isModalOpen ? "open" : ""}"
          aria-label="Toggle Research Tree"
          @click=${this.toggleModal}
        >
          ${["R", "E", "S", "E", "A", "R", "C", "H"].map(
            (letter) => html`<span>${letter}</span>`,
          )}
        </button>
      </div>
    `;
  }
}
