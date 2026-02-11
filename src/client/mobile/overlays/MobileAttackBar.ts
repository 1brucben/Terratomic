/**
 * MobileAttackBar - Shows active attacks/boats/paratroopers as small bubbles
 * Positioned directly beneath the topbar, max 2 rows
 */

import { css, html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { PlayerType, UnitType } from "../../../core/game/Game";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import {
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  CancelParatrooperIntentEvent,
} from "../../Transport";
import { renderNumber, renderTroops } from "../../Utils";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
} from "../../graphics/layers/Leaderboard";
import { HapticFeedback } from "../utils/HapticFeedback";

interface AttackBubble {
  type: "incoming" | "outgoing" | "land" | "boat" | "paratrooper" | "trade";
  id: string | number;
  troops: number;
  tradeAmount?: number;
  playerName?: string;
  retreating?: boolean;
  // For camera focus
  attackerID?: number;
  targetID?: number;
  attackID?: string;
  unitView?: UnitView;
}

@customElement("mobile-attack-bar")
export class MobileAttackBar extends LitElement {
  @property({ type: Object }) eventBus!: EventBus;
  @property({ type: Object }) game!: GameView;

  @state() private bubbles: AttackBubble[] = [];
  @state() private tradeIncomeAmount: number | null = null;
  @state() private tradeIncomeAnimating: boolean = false;

  private tradeIncomeHideTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private tradeIncomeAnimationTimeoutId: ReturnType<typeof setTimeout> | null =
    null;

  // Expose current height for other components to position below
  get currentHeight(): number {
    if (this.bubbles.length === 0) return 0;
    const container = this.shadowRoot?.querySelector(".container");
    return container ? container.getBoundingClientRect().height : 0;
  }

  static styles = css`
    :host {
      display: block;
      position: fixed;
      top: calc(44px + env(safe-area-inset-top, 0px));
      left: 0;
      right: 0;
      z-index: 1760;
      pointer-events: none;
    }

    .container {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding: 6px 10px;
      max-height: 78px; /* ~2 rows of 32px bubbles + gaps + padding */
      overflow: hidden;
      pointer-events: none;
      position: relative;
      z-index: 1;
      background: linear-gradient(
        180deg,
        rgba(12, 16, 22, 0.28) 0%,
        rgba(9, 13, 18, 0) 100%
      );
    }

    .container:empty {
      display: none;
    }

    .bubble {
      display: inline-flex;
      align-items: stretch;
      height: 32px;
      padding: 0;
      border: 1px solid rgba(128, 139, 153, 0.24);
      background: linear-gradient(
        180deg,
        rgba(25, 31, 40, 0.9) 0%,
        rgba(13, 18, 25, 0.94) 100%
      );
      border-radius: 16px;
      font-size: 12px;
      font-family:
        system-ui,
        -apple-system,
        sans-serif;
      color: white;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 2px 8px rgba(0, 0, 0, 0.36);
      transition:
        transform 0.1s ease,
        filter 0.12s ease,
        opacity 0.15s ease;
      user-select: none;
      overflow: hidden;
      pointer-events: auto;
    }

    .bubble:active {
      transform: translateY(1px) scale(0.96);
      filter: brightness(1.08);
    }

    .bubble.cancelable {
      cursor: pointer;
      -webkit-appearance: none;
      appearance: none;
    }

    .bubble.cancelable:active {
      background: linear-gradient(
        180deg,
        rgba(124, 48, 48, 0.78) 0%,
        rgba(74, 25, 25, 0.86) 100%
      );
    }

    .bubble-main,
    .bubble-content {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      padding: 0 8px;
      border: none;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    .bubble-main:active {
      background: rgba(255, 255, 255, 0.05);
    }

    .bubble-content {
      pointer-events: none;
    }

    /* Color coding */
    .bubble.incoming {
      border-left: 3px solid rgba(231, 117, 117, 0.95);
    }

    .bubble.outgoing,
    .bubble.boat,
    .bubble.paratrooper {
      border-left: 3px solid rgba(109, 175, 247, 0.95);
    }

    .bubble.land {
      border-left: 3px solid rgba(144, 154, 167, 0.9);
    }

    .bubble.trade {
      border-left: 3px solid rgba(74, 222, 128, 0.95);
      background: linear-gradient(
        180deg,
        rgba(16, 42, 24, 0.92) 0%,
        rgba(10, 28, 17, 0.94) 100%
      );
    }

    .bubble.trade.animating {
      animation: tradeBubblePulse 0.6s ease-out;
    }

    @keyframes tradeBubblePulse {
      0% {
        transform: scale(1);
      }
      30% {
        transform: scale(1.06);
      }
      60% {
        transform: scale(1.02);
      }
      100% {
        transform: scale(1);
      }
    }

    .bubble.retreating {
      opacity: 0.7;
    }

    .icon {
      font-size: 13px;
      flex-shrink: 0;
    }

    .troops {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: rgba(236, 243, 251, 0.95);
    }

    .name {
      max-width: 74px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: rgba(202, 212, 225, 0.86);
    }

    .retreating-label {
      font-size: 10px;
      opacity: 0.78;
      font-style: italic;
    }

    .cancel-hint {
      margin-left: 4px;
      color: rgba(245, 183, 117, 0.96);
      font-size: 13px;
      font-weight: 700;
      opacity: 0.98;
      flex-shrink: 0;
    }
  `;

  /**
   * Update attack data from game state - called from MobileUI tick loop
   */
  tick(): void {
    if (!this.game) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this.bubbles.length > 0) {
        this.bubbles = [];
      }
      this.clearTradeIncomeIndicator();
      return;
    }

    const newBubbles: AttackBubble[] = [];

    // Incoming attacks (red) - exclude bot attacks
    const incomingAttacks = myPlayer.incomingAttacks().filter((a) => {
      const attacker = this.game.playerBySmallID(a.attackerID) as PlayerView;
      return attacker && attacker.type() !== PlayerType.Bot;
    });

    for (const attack of incomingAttacks) {
      const attacker = this.game.playerBySmallID(
        attack.attackerID,
      ) as PlayerView;
      const bubble: AttackBubble = {
        type: "incoming",
        id: attack.id,
        troops: attack.troops,
        playerName: attacker?.name() ?? "Unknown",
        retreating: attack.retreating,
        attackerID: attack.attackerID,
        attackID: attack.id,
      };
      newBubbles.push(bubble);
    }

    // Outgoing attacks (blue) - against players
    const outgoingAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID !== 0);

    for (const attack of outgoingAttacks) {
      const target = this.game.playerBySmallID(attack.targetID) as PlayerView;
      const bubble: AttackBubble = {
        type: "outgoing",
        id: attack.id,
        troops: attack.troops,
        playerName: target?.name() ?? "Unknown",
        retreating: attack.retreating,
        targetID: attack.targetID,
        attackID: attack.id,
      };
      newBubbles.push(bubble);
    }

    // Outgoing land attacks (gray) - against wilderness
    const landAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID === 0);

    for (const attack of landAttacks) {
      const bubble: AttackBubble = {
        type: "land",
        id: attack.id,
        troops: attack.troops,
        playerName: "Wilderness",
        retreating: attack.retreating,
        attackID: attack.id,
      };
      newBubbles.push(bubble);
    }

    // Boats (blue)
    const boats = myPlayer
      .units()
      .filter((u) => u.type() === UnitType.TransportShip);

    for (const boat of boats) {
      const bubble: AttackBubble = {
        type: "boat",
        id: boat.id(),
        troops: boat.troops(),
        retreating: boat.retreating(),
        unitView: boat,
      };
      newBubbles.push(bubble);
    }

    // Paratroopers (blue)
    const paratroopers = myPlayer
      .units()
      .filter((u) => u.type() === UnitType.Paratrooper);

    for (const para of paratroopers) {
      const bubble: AttackBubble = {
        type: "paratrooper",
        id: para.id(),
        troops: para.troops(),
        unitView: para,
      };
      newBubbles.push(bubble);
    }

    // Only update if changed (shallow comparison of length and IDs)
    const finalBubbles = this.withTradeBubbleFirst(newBubbles);

    if (this.hasBubblesChanged(finalBubbles)) {
      this.bubbles = finalBubbles;
    }
  }

  showTradeIncomeIndicator(amount: number | bigint): void {
    const normalized = Number(amount);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return;
    }

    this.tradeIncomeAmount = normalized;

    if (this.tradeIncomeHideTimeoutId !== null) {
      clearTimeout(this.tradeIncomeHideTimeoutId);
    }
    this.tradeIncomeHideTimeoutId = setTimeout(() => {
      this.tradeIncomeAmount = null;
      this.tradeIncomeAnimating = false;
      this.tradeIncomeHideTimeoutId = null;
      this.rebuildBubbles();
    }, 5000);

    this.tradeIncomeAnimating = false;
    this.rebuildBubbles();
    requestAnimationFrame(() => {
      this.tradeIncomeAnimating = true;
      this.rebuildBubbles();
    });

    if (this.tradeIncomeAnimationTimeoutId !== null) {
      clearTimeout(this.tradeIncomeAnimationTimeoutId);
    }
    this.tradeIncomeAnimationTimeoutId = setTimeout(() => {
      this.tradeIncomeAnimating = false;
      this.tradeIncomeAnimationTimeoutId = null;
      this.rebuildBubbles();
    }, 650);
  }

  clearTradeIncomeIndicator(): void {
    this.tradeIncomeAmount = null;
    this.tradeIncomeAnimating = false;

    if (this.tradeIncomeHideTimeoutId !== null) {
      clearTimeout(this.tradeIncomeHideTimeoutId);
      this.tradeIncomeHideTimeoutId = null;
    }
    if (this.tradeIncomeAnimationTimeoutId !== null) {
      clearTimeout(this.tradeIncomeAnimationTimeoutId);
      this.tradeIncomeAnimationTimeoutId = null;
    }

    this.rebuildBubbles();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.clearTradeIncomeIndicator();
  }

  private withTradeBubbleFirst(base: AttackBubble[]): AttackBubble[] {
    if (this.tradeIncomeAmount === null) {
      return base;
    }

    const tradeBubble: AttackBubble = {
      type: "trade",
      id: "trade-income",
      troops: 0,
      tradeAmount: this.tradeIncomeAmount,
    };

    return [tradeBubble, ...base];
  }

  private rebuildBubbles(): void {
    const nonTrade = this.bubbles.filter((bubble) => bubble.type !== "trade");
    const rebuilt = this.withTradeBubbleFirst(nonTrade);
    if (this.hasBubblesChanged(rebuilt)) {
      this.bubbles = rebuilt;
    }
  }

  private hasBubblesChanged(newBubbles: AttackBubble[]): boolean {
    if (this.bubbles.length !== newBubbles.length) return true;

    for (let i = 0; i < newBubbles.length; i++) {
      const oldB = this.bubbles[i];
      const newB = newBubbles[i];
      if (
        oldB.id !== newB.id ||
        oldB.type !== newB.type ||
        oldB.troops !== newB.troops ||
        oldB.retreating !== newB.retreating
      ) {
        return true;
      }
    }
    return false;
  }

  private getIcon(type: AttackBubble["type"]): string {
    switch (type) {
      case "trade":
        return "💰";
      case "incoming":
        return "⚔️";
      case "outgoing":
      case "land":
        return "🗡️";
      case "boat":
        return "⛵";
      case "paratrooper":
        return "🪂";
    }
  }

  private async handleBubbleTap(bubble: AttackBubble, e: Event): Promise<void> {
    e.stopPropagation();

    if (bubble.type !== "incoming" || bubble.attackerID === undefined) {
      return;
    }

    const attacker = this.game.playerBySmallID(bubble.attackerID) as PlayerView;
    if (attacker && bubble.attackID) {
      const avgPos = await attacker.attackAveragePosition(
        bubble.attackerID,
        bubble.attackID,
      );
      if (avgPos) {
        HapticFeedback.tap();
        this.eventBus.emit(new GoToPositionEvent(avgPos.x, avgPos.y));
        return;
      }
    }
    if (attacker) {
      HapticFeedback.tap();
      this.eventBus.emit(new GoToPlayerEvent(attacker));
    }
  }

  private handleCancel(bubble: AttackBubble, e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    this.bubbles = this.bubbles.filter(
      (b) => !(b.type === bubble.type && b.id === bubble.id),
    );

    switch (bubble.type) {
      case "outgoing":
      case "land":
        if (bubble.attackID) {
          this.eventBus.emit(new CancelAttackIntentEvent(bubble.attackID));
          HapticFeedback.tap();
        }
        break;

      case "boat":
        this.eventBus.emit(new CancelBoatIntentEvent(bubble.id as number));
        HapticFeedback.tap();
        break;

      case "paratrooper":
        this.eventBus.emit(
          new CancelParatrooperIntentEvent(bubble.id as number),
        );
        HapticFeedback.tap();
        break;
    }
  }

  private renderBubble(bubble: AttackBubble): TemplateResult {
    if (bubble.type === "trade") {
      return html`
        <div
          class="bubble trade ${this.tradeIncomeAnimating ? "animating" : ""}"
        >
          <span class="bubble-content">
            <span class="icon">${this.getIcon(bubble.type)}</span>
            <span class="troops"
              >+${renderNumber(bubble.tradeAmount ?? 0)}</span
            >
            <span class="name">Trade</span>
          </span>
        </div>
      `;
    }

    const canCancel = bubble.type !== "incoming" && !bubble.retreating;

    if (canCancel) {
      return html`
        <button
          class="bubble cancelable ${bubble.type} ${bubble.retreating
            ? "retreating"
            : ""}"
          @pointerdown=${(e: Event) => this.handleCancel(bubble, e)}
          @click=${(e: Event) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          aria-label="Cancel"
        >
          <span class="bubble-content">
            <span class="icon">${this.getIcon(bubble.type)}</span>
            <span class="troops">${renderTroops(bubble.troops)}</span>
            ${bubble.playerName
              ? html`<span class="name">${bubble.playerName}</span>`
              : ""}
            ${bubble.retreating
              ? html`<span class="retreating-label">↩</span>`
              : ""}
            <span class="cancel-hint">✕</span>
          </span>
        </button>
      `;
    }

    if (bubble.type !== "incoming") {
      return html`
        <div
          class="bubble ${bubble.type} ${bubble.retreating ? "retreating" : ""}"
        >
          <span class="bubble-content">
            <span class="icon">${this.getIcon(bubble.type)}</span>
            <span class="troops">${renderTroops(bubble.troops)}</span>
            ${bubble.playerName
              ? html`<span class="name">${bubble.playerName}</span>`
              : ""}
            ${bubble.retreating
              ? html`<span class="retreating-label">↩</span>`
              : ""}
          </span>
        </div>
      `;
    }

    return html`
      <div
        class="bubble ${bubble.type} ${bubble.retreating ? "retreating" : ""}"
      >
        <button
          class="bubble-main"
          @pointerup=${(e: Event) => this.handleBubbleTap(bubble, e)}
          aria-label="Focus"
        >
          <span class="icon">${this.getIcon(bubble.type)}</span>
          <span class="troops">${renderTroops(bubble.troops)}</span>
          ${bubble.playerName
            ? html`<span class="name">${bubble.playerName}</span>`
            : ""}
          ${bubble.retreating
            ? html`<span class="retreating-label">↩</span>`
            : ""}
        </button>
      </div>
    `;
  }

  render() {
    if (this.bubbles.length === 0) {
      return html``;
    }

    return html`
      <div class="container">
        ${this.bubbles.map((b) => this.renderBubble(b))}
      </div>
    `;
  }
}
