import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import airIcon from "../../../../resources/icons/research/air.svg";
import landIcon from "../../../../resources/icons/research/land.svg";
import nuclearIcon from "../../../../resources/icons/research/nuclear.svg";
import seaIcon from "../../../../resources/icons/research/sea.svg";
import type { EventBus } from "../../../core/EventBus";
import type { GameView } from "../../../core/game/GameView";
import {
  getTechNodes,
  type Category,
  type TechNode,
} from "../../../core/tech/ResearchTree";
import { SendResearchTreeSelectIntentEvent } from "../../Transport";
import {
  computeAnchoredTop,
  getMobileAttackBarBottom,
  startRepositionInterval,
  stopRepositionInterval,
} from "../utils/OverlayPositioning";
import "./MobileResearchPriorityToast";
import type { MobileResearchPriorityToast } from "./MobileResearchPriorityToast";

const BASE_TOP_PX = 48;
const STACK_GAP_PX = 8;

@customElement("mobile-research-priority-modal")
export class MobileResearchPriorityModal extends LitElement {
  @property({ type: Boolean, reflect: true }) visible = false;
  @property({ attribute: false }) game!: GameView;
  @property({ attribute: false }) eventBus!: EventBus;

  private techs: TechNode[] = [...getTechNodes()];
  private categories: Category[] = ["Land", "Sea", "Air", "Nuclear"];
  private repositionTimer: number | null = null;
  private ownedToast: MobileResearchPriorityToast | null = null;

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 4000;
      display: none;
      pointer-events: none;
    }

    :host([visible]) {
      display: block;
      pointer-events: none;
    }

    .backdrop {
      position: absolute;
      inset: 0;
      display: none;
    }

    :host([visible]) .backdrop {
      display: none;
    }

    .panel {
      position: absolute;
      top: calc(
        env(safe-area-inset-top, 0px) + var(--research-panel-top, 48px)
      );
      left: max(14px, calc(env(safe-area-inset-left, 0px) + 10px));
      transform: translateY(-6px);
      width: min(90vw, 336px);
      border-radius: 9px;
      border: 1px solid rgba(160, 171, 184, 0.24);
      background:
        linear-gradient(
          180deg,
          rgba(130, 141, 153, 0.13) 0%,
          rgba(75, 85, 96, 0.09) 38%,
          rgba(21, 26, 34, 0.04) 100%
        ),
        linear-gradient(
          180deg,
          rgba(35, 41, 50, 0.97) 0%,
          rgba(22, 27, 35, 0.98) 56%,
          rgba(14, 19, 25, 0.98) 100%
        );
      box-shadow: 0 10px 20px rgba(0, 0, 0, 0.5);
      overflow: visible;
      opacity: 0;
      pointer-events: auto;
      transition:
        opacity 0.22s ease,
        transform 0.22s ease;
      padding: 8px;
    }

    :host([visible]) .panel {
      opacity: 1;
      transform: translateY(0);
    }

    .close {
      position: absolute;
      top: 3px;
      right: 6px;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      border: 1px solid rgba(129, 141, 156, 0.3);
      color: rgba(244, 188, 122, 0.95);
      background: linear-gradient(
        180deg,
        rgba(18, 24, 33, 0.9) 0%,
        rgba(11, 15, 22, 0.94) 100%
      );
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }

    .close:active {
      transform: translateY(1px);
      filter: brightness(1.08);
    }

    .list {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
    }

    .heading {
      color: rgba(223, 232, 243, 0.9);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.2px;
      text-transform: uppercase;
      margin: 2px 30px 6px 2px;
      line-height: 1.1;
    }

    .category-btn {
      width: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 58px;
      padding: 6px 4px;
      gap: 4px;
      border-radius: 7px;
      border: 1px solid rgba(122, 134, 148, 0.28);
      background: linear-gradient(
        180deg,
        rgba(21, 27, 36, 0.84) 0%,
        rgba(12, 18, 25, 0.92) 100%
      );
      color: rgba(230, 237, 245, 0.94);
      text-align: center;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    .category-btn:active {
      transform: translateY(1px) scale(0.99);
      filter: brightness(1.06);
    }

    .category-btn.selected {
      border-color: rgba(236, 194, 118, 0.45);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 0 0 1px rgba(236, 194, 118, 0.25);
    }

    .category-btn.land {
      color: rgba(149, 230, 195, 0.96);
    }

    .category-btn.sea {
      color: rgba(145, 198, 255, 0.96);
    }

    .category-btn.air {
      color: rgba(208, 186, 255, 0.96);
    }

    .category-btn.nuclear {
      color: rgba(255, 173, 173, 0.97);
    }

    .icon {
      width: 22px;
      height: 22px;
      mask-size: contain;
      -webkit-mask-size: contain;
      mask-position: center;
      -webkit-mask-position: center;
      mask-repeat: no-repeat;
      -webkit-mask-repeat: no-repeat;
      background-color: currentColor;
      opacity: 0.95;
    }

    .name {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.16px;
      text-transform: uppercase;
      line-height: 1;
    }
  `;

  open(): void {
    this.updateTopOffset();
    this.startRepositionLoop();
    this.visible = true;
  }

  close = (): void => {
    this.visible = false;
    this.stopRepositionLoop();
  };

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopRepositionLoop();

    if (this.ownedToast) {
      this.ownedToast.remove();
      this.ownedToast = null;
    }
  }

  private researchedIDsFromGame(): Set<string> {
    const researched = new Set<string>();
    const me = this.game?.myPlayer?.();
    if (!me) return researched;
    for (const tech of this.techs) {
      if (me.hasResearchedTech(tech.id)) {
        researched.add(tech.id);
      }
    }
    return researched;
  }

  private prioritizeCategory(category: Category): void {
    if (!this.game || !this.eventBus) return;

    const me = this.game.myPlayer();
    if (!me) return;

    const researched = this.researchedIDsFromGame();
    const priorities = me.researchPriorities?.() ?? new Set<string>();

    for (const tech of this.techs) {
      if (tech.category !== category && priorities.has(tech.id)) {
        this.eventBus.emit(new SendResearchTreeSelectIntentEvent(tech.id));
      }
    }

    const categoryTechs = this.techs.filter(
      (tech) => tech.category === category,
    );
    for (const tech of categoryTechs) {
      if (!researched.has(tech.id) && !priorities.has(tech.id)) {
        this.eventBus.emit(new SendResearchTreeSelectIntentEvent(tech.id));
      }
    }

    const toast = this.getOrCreateToast();
    toast.show(category);

    window.setTimeout(() => {
      this.close();
    }, 100);
  }

  render() {
    if (!this.visible) return null;

    const me = this.game?.myPlayer?.();
    const priorities = me?.researchPriorities?.() ?? new Set<string>();
    const researched = this.researchedIDsFromGame();

    const icons: Record<Category, string> = {
      Land: landIcon,
      Sea: seaIcon,
      Air: airIcon,
      Nuclear: nuclearIcon,
    };

    return html`
      <div class="panel" role="dialog" aria-modal="false">
        <button class="close" @click=${this.close} aria-label="Close">✕</button>
        <div class="heading">Pick your research category</div>
        <div class="list">
          ${this.categories.map((category) => {
            const categoryTechs = this.techs.filter(
              (tech) => tech.category === category,
            );
            const pending = categoryTechs.filter(
              (tech) => !researched.has(tech.id),
            );
            const active =
              pending.length > 0 &&
              pending.every((tech) => priorities.has(tech.id));

            const categoryClass = category.toLowerCase();

            return html`
              <button
                class="category-btn ${categoryClass} ${active
                  ? "selected"
                  : ""}"
                @click=${() => this.prioritizeCategory(category)}
                aria-label="Prioritize ${category}"
              >
                <div
                  class="icon"
                  style="-webkit-mask-image: url('${icons[
                    category
                  ]}'); mask-image: url('${icons[category]}')"
                ></div>
                <div class="name">${category}</div>
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  private getOrCreateToast(): MobileResearchPriorityToast {
    let toast = document.querySelector(
      "mobile-research-priority-toast",
    ) as MobileResearchPriorityToast | null;

    if (!toast) {
      toast = document.createElement(
        "mobile-research-priority-toast",
      ) as MobileResearchPriorityToast;
      document.body.appendChild(toast);
      this.ownedToast = toast;
    }

    return toast;
  }

  private updateTopOffset(): void {
    const attackBottom = getMobileAttackBarBottom();
    const topPx = computeAnchoredTop(BASE_TOP_PX, attackBottom, STACK_GAP_PX);

    this.style.setProperty("--research-panel-top", `${topPx}px`);
  }

  private startRepositionLoop(): void {
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
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-research-priority-modal": MobileResearchPriorityModal;
  }
}
