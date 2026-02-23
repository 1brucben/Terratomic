import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import {
  getMessageCategory,
  MessageCategory,
  MessageType,
  Tick,
} from "../../../core/game/Game";
import {
  AllianceExpiredUpdate,
  AllianceRequestReplyUpdate,
  BrokeAllianceUpdate,
  DisplayChatMessageUpdate,
  DisplayMessageUpdate,
  EmojiUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { translateText } from "../../Utils";
import { HapticFeedback } from "../utils/HapticFeedback";

interface MobileEvent {
  description: string;
  type: MessageType;
  category: MessageCategory;
  createdAt: Tick;
  playerID?: number;
  icon?: string;
}

/**
 * Mobile-friendly events display - shows simplified event log
 * without complex buttons/interactions (uses toasts and action confirmations instead)
 */
@customElement("mobile-events-display")
export class MobileEventsDisplay extends LitElement {
  @property({ type: Object }) eventBus!: EventBus;
  @property({ type: Object }) game!: GameView;

  @state() private events: MobileEvent[] = [];
  @state() private eventsFilters: Map<MessageCategory, boolean> = new Map([
    [MessageCategory.ATTACK, false],
    [MessageCategory.TRADE, false],
    [MessageCategory.ALLIANCE, false],
    [MessageCategory.CHAT, false],
  ]);
  private maxEvents = 50;

  static styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: hidden;
    }

    .events-container {
      height: 100%;
      overflow-y: auto;
      padding: 8px;
      background: linear-gradient(
        180deg,
        rgba(12, 16, 22, 0.76) 0%,
        rgba(9, 13, 18, 0.82) 100%
      );
    }

    .event-item {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 9px 10px;
      margin-bottom: 7px;
      background: linear-gradient(
        180deg,
        rgba(22, 29, 38, 0.84) 0%,
        rgba(13, 18, 25, 0.92) 100%
      );
      border-radius: 8px;
      border: 1px solid rgba(124, 135, 149, 0.24);
      border-left: 3px solid var(--event-color, #748294);
      font-size: 12px;
      line-height: 1.4;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .event-icon {
      flex-shrink: 0;
      font-size: 1.25rem;
      margin-top: 0.125rem;
    }

    .event-content {
      flex: 1;
      min-width: 0;
    }

    .event-description {
      color: rgba(232, 238, 246, 0.95);
      word-wrap: break-word;
    }

    .event-time {
      color: rgba(184, 194, 206, 0.74);
      font-size: 11px;
      margin-top: 3px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: rgba(176, 187, 200, 0.7);
      text-align: center;
      padding: 2rem;
    }

    .empty-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
      opacity: 0.45;
    }

    /* Filter buttons */
    .filter-bar {
      display: flex;
      gap: 6px;
      padding: 7px 8px;
      background: linear-gradient(
        180deg,
        rgba(16, 21, 28, 0.82) 0%,
        rgba(11, 16, 22, 0.9) 100%
      );
      border-bottom: 1px solid rgba(150, 160, 173, 0.2);
      justify-content: center;
      flex-wrap: wrap;
    }

    .filter-btn {
      background: linear-gradient(
        180deg,
        rgba(19, 25, 34, 0.86) 0%,
        rgba(11, 16, 23, 0.92) 100%
      );
      border: 1px solid rgba(123, 134, 147, 0.28);
      border-radius: 6px;
      padding: 5px 7px;
      color: rgba(220, 228, 238, 0.9);
      font-size: 11px;
      cursor: pointer;
      transition:
        transform 0.12s ease,
        filter 0.12s ease,
        border-color 0.15s ease;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      line-height: 1;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .filter-btn:active {
      transform: translateY(1px) scale(0.97);
      filter: brightness(1.08);
    }

    .filter-btn.active {
      background: linear-gradient(
        180deg,
        rgba(34, 62, 100, 0.64) 0%,
        rgba(16, 28, 43, 0.9) 100%
      );
      border-color: rgba(95, 157, 236, 0.48);
      color: rgba(240, 246, 252, 0.97);
    }

    .filter-btn.filtered {
      opacity: 0.4;
      filter: grayscale(1);
    }

    /* Event type colors */
    .event-item[data-type="chat"] {
      --event-color: #4a9eff;
    }
    .event-item[data-type="alliance"] {
      --event-color: #4ade80;
    }
    .event-item[data-type="attack"] {
      --event-color: #ef4444;
    }
    .event-item[data-type="trade"] {
      --event-color: #fbbf24;
    }
    .event-item[data-type="warn"] {
      --event-color: #f97316;
    }
  `;

  private updateMap = [
    [GameUpdateType.DisplayEvent, this.onDisplayMessageEvent.bind(this)],
    [GameUpdateType.DisplayChatEvent, this.onDisplayChatEvent.bind(this)],
    [
      GameUpdateType.AllianceRequestReply,
      this.onAllianceRequestReplyEvent.bind(this),
    ],
    [GameUpdateType.BrokeAlliance, this.onBrokeAllianceEvent.bind(this)],
    [GameUpdateType.Emoji, this.onEmojiMessageEvent.bind(this)],
    [GameUpdateType.AllianceExpired, this.onAllianceExpiredEvent.bind(this)],
  ] as const;

  tick() {
    if (!this.game) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) return;

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const [ut, fn] of this.updateMap) {
        updates[ut]?.forEach(fn as (event: unknown) => void);
      }
    }

    // Trim old events (keep last 600 ticks = ~10 minutes)
    const currentTick = this.game.ticks();
    this.events = this.events.filter((e) => currentTick - e.createdAt < 600);

    // Keep only most recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  private addEvent(event: MobileEvent) {
    this.events = [...this.events, event];
    this.requestUpdate();
  }

  private onDisplayMessageEvent(event: DisplayMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID !== null &&
      (!myPlayer || myPlayer.smallID() !== event.playerID)
    ) {
      return;
    }

    const category = getMessageCategory(event.messageType);

    // Translate the message if it has params
    let description = event.message;
    if (event.params) {
      try {
        description = translateText(event.message, event.params);
      } catch (e) {
        // If translation fails, use the original message
        description = event.message;
      }
    }

    this.addEvent({
      description,
      type: event.messageType,
      category,
      createdAt: this.game.ticks(),
      icon: this.getIconForType(event.messageType),
    });
  }

  private onDisplayChatEvent(event: DisplayChatMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    if (event.playerID !== null && event.playerID !== myPlayer.smallID()) {
      return;
    }

    let otherPlayerDisplayName = "";
    if (event.recipient !== null) {
      const player = this.game.player(event.recipient);
      otherPlayerDisplayName = player ? player.displayName() : "";
    }

    const message = translateText(event.isFrom ? "chat.from" : "chat.to", {
      user: otherPlayerDisplayName,
      msg: translateText(event.key),
    });

    this.addEvent({
      description: message,
      type: MessageType.CHAT,
      category: MessageCategory.CHAT,
      createdAt: this.game.ticks(),
      playerID: event.playerID ?? undefined,
      icon: "💬",
    });
  }

  private onAllianceRequestReplyEvent(event: AllianceRequestReplyUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const myID = myPlayer.smallID();
    const requestorID = event.request.requestorID;
    const recipientID = event.request.recipientID;

    // Only show message to recipient if it was accepted
    if (!event.accepted && requestorID !== myID) {
      return;
    }

    const otherID = requestorID === myID ? recipientID : requestorID;
    const other = this.game.playerBySmallID(otherID);
    if (!other || !(other instanceof PlayerView)) return;

    const isAccepted = event.accepted;
    this.addEvent({
      description: translateText("events_display.alliance_request_status", {
        name: other.name(),
        status: isAccepted
          ? translateText("events_display.alliance_accepted")
          : translateText("events_display.alliance_rejected"),
      }),
      type: isAccepted
        ? MessageType.ALLIANCE_ACCEPTED
        : MessageType.ALLIANCE_REJECTED,
      category: MessageCategory.ALLIANCE,
      createdAt: this.game.ticks(),
      playerID: otherID,
      icon: isAccepted ? "✅" : "❌",
    });
  }

  private onBrokeAllianceEvent(event: BrokeAllianceUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const betrayed = this.game.playerBySmallID(event.betrayedID);
    const traitor = this.game.playerBySmallID(event.traitorID);

    if (
      !betrayed ||
      !(betrayed instanceof PlayerView) ||
      !traitor ||
      !(traitor instanceof PlayerView)
    )
      return;

    if (betrayed.isDisconnected()) return;

    if (!betrayed.isTraitor() && traitor.smallID() === myPlayer.smallID()) {
      // You broke the alliance
      this.addEvent({
        description: translateText("events_display.broke_alliance", {
          name: betrayed.name(),
        }),
        type: MessageType.ALLIANCE_BROKEN,
        category: MessageCategory.ALLIANCE,
        createdAt: this.game.ticks(),
        playerID: event.betrayedID,
        icon: "💔",
      });
    } else if (betrayed.smallID() === myPlayer.smallID()) {
      // They broke the alliance with you
      this.addEvent({
        description: translateText("events_display.betrayed_you", {
          name: traitor.name(),
        }),
        type: MessageType.ALLIANCE_BROKEN,
        category: MessageCategory.ALLIANCE,
        createdAt: this.game.ticks(),
        playerID: event.traitorID,
        icon: "💔",
      });
    }
  }

  private onAllianceExpiredEvent(event: AllianceExpiredUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    if (
      event.player1ID !== myPlayer.smallID() &&
      event.player2ID !== myPlayer.smallID()
    ) {
      return;
    }

    const otherID =
      event.player1ID === myPlayer.smallID()
        ? event.player2ID
        : event.player1ID;

    const other = this.game.playerBySmallID(otherID);
    if (!other || !(other instanceof PlayerView)) return;

    this.addEvent({
      description: translateText("events_display.alliance_expired", {
        name: other.name(),
      }),
      type: MessageType.ALLIANCE_EXPIRED,
      category: MessageCategory.ALLIANCE,
      createdAt: this.game.ticks(),
      playerID: otherID,
      icon: "⏱️",
    });
  }

  private onEmojiMessageEvent(event: EmojiUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const sender = this.game.playerBySmallID(event.emoji.senderID);
    if (!sender || !(sender instanceof PlayerView)) return;

    // Only show if sent to us or by us
    const isToMe = event.emoji.recipientID === myPlayer.smallID();
    const isFromMe = event.emoji.senderID === myPlayer.smallID();

    if (!isToMe && !isFromMe) return;

    this.addEvent({
      description: isFromMe
        ? `You sent: ${event.emoji.message}`
        : `${sender.name()} sent: ${event.emoji.message}`,
      type: MessageType.CHAT,
      category: MessageCategory.CHAT,
      createdAt: this.game.ticks(),
      playerID: event.emoji.senderID,
      icon: "💬",
    });
  }

  private getIconForType(type: MessageType): string {
    switch (type) {
      case MessageType.CHAT:
        return "💬";
      case MessageType.ALLIANCE_REQUEST:
      case MessageType.ALLIANCE_ACCEPTED:
      case MessageType.ALLIANCE_REJECTED:
        return "🤝";
      case MessageType.ALLIANCE_BROKEN:
        return "💔";
      case MessageType.ALLIANCE_EXPIRED:
        return "⏱️";
      case MessageType.ATTACK_REQUEST:
        return "⚔️";
      case MessageType.WARN:
        return "⚠️";
      case MessageType.UNIT_DESTROYED:
        return "💥";
      default:
        return "ℹ️";
    }
  }

  private getEventTypeAttribute(category: MessageCategory): string {
    switch (category) {
      case MessageCategory.CHAT:
        return "chat";
      case MessageCategory.ALLIANCE:
        return "alliance";
      case MessageCategory.ATTACK:
        return "attack";
      case MessageCategory.TRADE:
        return "trade";
      default:
        return "";
    }
  }

  private formatTimeAgo(createdAt: Tick): string {
    const currentTick = this.game.ticks();
    const ticksAgo = currentTick - createdAt;
    const secondsAgo = Math.max(0, Math.floor(ticksAgo / 10));

    if (secondsAgo < 60) return `${secondsAgo}s ago`;
    if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
    return `${Math.floor(secondsAgo / 3600)}h ago`;
  }

  private toggleEventFilter(filterName: MessageCategory) {
    const currentState = this.eventsFilters.get(filterName) ?? false;
    this.eventsFilters.set(filterName, !currentState);
    HapticFeedback.tap();
    this.requestUpdate();
  }

  private renderFilterBar() {
    return html`
      <div class="filter-bar">
        <button
          class="filter-btn ${this.eventsFilters.get(MessageCategory.ATTACK)
            ? "filtered"
            : ""}"
          @click="${() => this.toggleEventFilter(MessageCategory.ATTACK)}"
        >
          ⚔️ Attack
        </button>
        <button
          class="filter-btn ${this.eventsFilters.get(MessageCategory.TRADE)
            ? "filtered"
            : ""}"
          @click="${() => this.toggleEventFilter(MessageCategory.TRADE)}"
        >
          💰 Trade
        </button>
        <button
          class="filter-btn ${this.eventsFilters.get(MessageCategory.ALLIANCE)
            ? "filtered"
            : ""}"
          @click="${() => this.toggleEventFilter(MessageCategory.ALLIANCE)}"
        >
          🤝 Alliance
        </button>
        <button
          class="filter-btn ${this.eventsFilters.get(MessageCategory.CHAT)
            ? "filtered"
            : ""}"
          @click="${() => this.toggleEventFilter(MessageCategory.CHAT)}"
        >
          💬 Chat
        </button>
      </div>
    `;
  }

  render() {
    // Filter events based on active filters
    const filteredEvents = this.events.filter((event) => {
      const isFiltered = this.eventsFilters.get(event.category) ?? false;
      return !isFiltered;
    });

    const hasFilters = Array.from(this.eventsFilters.values()).some((v) => v);

    return html`
      ${this.renderFilterBar()}
      ${filteredEvents.length === 0
        ? html`
            <div class="empty-state">
              <div class="empty-icon">📜</div>
              <div>
                ${hasFilters ? "No events match filters" : "No events yet"}
              </div>
              <div style="font-size: 0.75rem; margin-top: 0.5rem;">
                ${hasFilters
                  ? "Try adjusting filters above"
                  : "Game events will appear here"}
              </div>
            </div>
          `
        : html`
            <div class="events-container">
              ${[...filteredEvents].reverse().map(
                (event) => html`
                  <div
                    class="event-item"
                    data-type="${this.getEventTypeAttribute(event.category)}"
                  >
                    <div class="event-icon">${event.icon}</div>
                    <div class="event-content">
                      <div class="event-description">${event.description}</div>
                      <div class="event-time">
                        ${this.formatTimeAgo(event.createdAt)}
                      </div>
                    </div>
                  </div>
                `,
              )}
            </div>
          `}
    `;
  }
}
