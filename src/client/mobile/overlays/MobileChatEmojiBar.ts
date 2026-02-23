import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import {
  DisplayChatMessageUpdate,
  EmojiUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { translateText } from "../../Utils";
import { GoToPlayerEvent } from "../../graphics/layers/Leaderboard";
import { HapticFeedback } from "../utils/HapticFeedback";

interface ChatEmojiBubble {
  id: string;
  senderID: number;
  label: string;
  expiresAt: number;
}

const MAX_BUBBLES = 3;
const BUBBLE_TTL_TICKS = 40;

@customElement("mobile-chat-emoji-bar")
export class MobileChatEmojiBar extends LitElement {
  @property({ type: Object }) eventBus!: EventBus;
  @property({ type: Object }) game!: GameView;

  @state() private bubbles: ChatEmojiBubble[] = [];

  static styles = css`
    :host {
      display: block;
      position: fixed;
      top: calc(44px + env(safe-area-inset-top, 0px));
      left: 0;
      right: 0;
      z-index: 1758;
      pointer-events: none;
    }

    .container {
      display: flex;
      justify-content: center;
      gap: 6px;
      padding: 0 8px;
      flex-wrap: nowrap;
      overflow: hidden;
    }

    .bubble {
      pointer-events: auto;
      border: 1px solid rgba(122, 136, 154, 0.32);
      border-radius: 999px;
      background: linear-gradient(
        180deg,
        rgba(21, 28, 37, 0.9) 0%,
        rgba(12, 18, 25, 0.94) 100%
      );
      color: rgba(236, 242, 249, 0.96);
      min-height: 32px;
      max-width: min(30vw, 180px);
      padding: 6px 10px;
      font-size: 12px;
      line-height: 1.2;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 5px 14px rgba(0, 0, 0, 0.38);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    .bubble:active {
      transform: translateY(1px) scale(0.98);
      filter: brightness(1.07);
    }
  `;

  tick(): void {
    if (!this.game) {
      return;
    }

    const updates = this.game.updatesSinceLastTick();
    if (!updates) {
      this.pruneExpiredBubbles();
      return;
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this.bubbles.length !== 0) {
        this.bubbles = [];
      }
      return;
    }

    const newBubbles: ChatEmojiBubble[] = [];
    const currentTick = this.game.ticks();

    const chatUpdates = updates[GameUpdateType.DisplayChatEvent] as
      | DisplayChatMessageUpdate[]
      | undefined;
    if (chatUpdates) {
      for (let index = 0; index < chatUpdates.length; index++) {
        const update = chatUpdates[index];
        if (
          update.playerID === null ||
          update.playerID !== myPlayer.smallID()
        ) {
          continue;
        }

        const senderID = update.isFrom
          ? Number(update.recipient)
          : myPlayer.smallID();
        if (!Number.isFinite(senderID)) {
          continue;
        }

        const sender = this.game.playerBySmallID(senderID);
        if (!sender || !(sender instanceof PlayerView)) {
          continue;
        }

        const translatedMessage = this.translateQuickChatMessage(update);
        newBubbles.push({
          id: `chat-${currentTick}-${index}-${senderID}`,
          senderID,
          label: `${sender.displayName()}: ${translatedMessage}`,
          expiresAt: currentTick + BUBBLE_TTL_TICKS,
        });
      }
    }

    const emojiUpdates = updates[GameUpdateType.Emoji] as
      | EmojiUpdate[]
      | undefined;
    if (emojiUpdates) {
      for (let index = 0; index < emojiUpdates.length; index++) {
        const update = emojiUpdates[index];
        const isToMe = update.emoji.recipientID === myPlayer.smallID();
        const isFromMe = update.emoji.senderID === myPlayer.smallID();
        if (!isToMe && !isFromMe) {
          continue;
        }

        const sender = this.game.playerBySmallID(update.emoji.senderID);
        if (!sender || !(sender instanceof PlayerView)) {
          continue;
        }

        newBubbles.push({
          id: `emoji-${currentTick}-${index}-${update.emoji.senderID}`,
          senderID: update.emoji.senderID,
          label: `${sender.displayName()}: ${update.emoji.message}`,
          expiresAt: currentTick + BUBBLE_TTL_TICKS,
        });
      }
    }

    const persisted = this.bubbles.filter(
      (bubble) => bubble.expiresAt > currentTick,
    );
    const merged = [...persisted, ...newBubbles];
    const capped =
      merged.length > MAX_BUBBLES ? merged.slice(-MAX_BUBBLES) : merged;

    if (this.hasChanged(capped)) {
      this.bubbles = capped;
    }
  }

  private pruneExpiredBubbles(): void {
    const currentTick = this.game.ticks();
    const next = this.bubbles.filter(
      (bubble) => bubble.expiresAt > currentTick,
    );
    if (this.hasChanged(next)) {
      this.bubbles = next;
    }
  }

  private hasChanged(next: ChatEmojiBubble[]): boolean {
    if (next.length !== this.bubbles.length) {
      return true;
    }

    for (let index = 0; index < next.length; index++) {
      const oldBubble = this.bubbles[index];
      const newBubble = next[index];
      if (
        oldBubble.id !== newBubble.id ||
        oldBubble.label !== newBubble.label ||
        oldBubble.expiresAt !== newBubble.expiresAt
      ) {
        return true;
      }
    }

    return false;
  }

  private translateQuickChatMessage(update: DisplayChatMessageUpdate): string {
    const baseMessage = translateText(`chat.${update.category}.${update.key}`);
    if (!update.target) {
      return baseMessage;
    }

    try {
      const targetPlayer = this.game.player(update.target);
      const targetName = targetPlayer?.displayName() ?? update.target;
      return baseMessage.replace("[P1]", targetName);
    } catch {
      return baseMessage;
    }
  }

  private handleBubbleTap(bubble: ChatEmojiBubble, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const sender = this.game.playerBySmallID(bubble.senderID);
    if (sender && sender instanceof PlayerView) {
      HapticFeedback.tap();
      this.eventBus.emit(new GoToPlayerEvent(sender));
    }
  }

  render() {
    if (this.bubbles.length === 0) {
      return html``;
    }

    return html`
      <div class="container">
        ${this.bubbles.map(
          (bubble) => html`
            <button
              class="bubble"
              @pointerup=${(event: Event) =>
                this.handleBubbleTap(bubble, event)}
              aria-label="Focus sender"
            >
              ${bubble.label}
            </button>
          `,
        )}
      </div>
    `;
  }
}
