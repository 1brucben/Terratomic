import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import chatIcon from "../../../../resources/images/ChatIconWhite.svg";
import donateGoldIcon from "../../../../resources/images/DonateGoldIconWhite.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  getMessageCategory,
  MessageCategory,
  MessageType,
  PlayerType,
  Tick,
  UnitType,
} from "../../../core/game/Game";
import {
  AllianceExpiredUpdate,
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  AttackUpdate,
  BrokeAllianceUpdate,
  DisplayChatMessageUpdate,
  DisplayMessageUpdate,
  EmojiUpdate,
  GameUpdateType,
  TargetPlayerUpdate,
  UnitIncomingUpdate,
} from "../../../core/game/GameUpdates";
import {
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  CancelParatrooperIntentEvent,
  SendAllianceExtensionIntentEvent,
  SendAllianceReplyIntentEvent,
} from "../../Transport";
import { Layer } from "./Layer";

import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { onlyImages } from "../../../core/Util";
import { renderNumber, renderTroops } from "../../Utils";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "./Leaderboard";

import { UserSettings } from "../../../core/game/UserSettings";
import { getMessageTypeClasses, translateText } from "../../Utils";

interface GameEvent {
  description: string;
  unsafeDescription?: boolean;
  buttons?: {
    text: string;
    className: string;
    action: () => void;
    preventClose?: boolean;
  }[];
  type: MessageType;
  highlight?: boolean;
  createdAt: number;
  onDelete?: () => void;
  // lower number: lower on the display
  priority?: number;
  duration?: Tick;
  focusID?: number;
  unitView?: UnitView;
  tags?: string[];
}

@customElement("events-display")
export class EventsDisplay extends LitElement implements Layer {
  layerName = "EventsDisplay";
  public eventBus: EventBus;
  public game: GameView;

  private userSettings: UserSettings = new UserSettings();
  private active: boolean = false;
  private events: GameEvent[] = [];
  @state() private incomingAttacks: AttackUpdate[] = [];
  @state() private outgoingAttacks: AttackUpdate[] = [];
  @state() private outgoingLandAttacks: AttackUpdate[] = [];
  @state() private outgoingBoats: UnitView[] = [];
  @state() private outgoingParatroopers: UnitView[] = [];
  @state() private _hidden: boolean = false;
  @state() private _isVisible: boolean = false;
  @state() private newEvents: number = 0;
  @state() private latestGoldAmount: bigint | null = null;
  @state() private goldAmountAnimating: boolean = false;
  private goldAmountTimeoutId: ReturnType<typeof setTimeout> | null = null;
  @state() private eventsFilters: Map<MessageCategory, boolean> = new Map([
    [MessageCategory.ATTACK, false],
    [MessageCategory.TRADE, false],
    [MessageCategory.ALLIANCE, false],
    [MessageCategory.CHAT, false],
    [MessageCategory.FINANCIAL, false],
  ]);

  private renderButton(options: {
    content: any; // Can be string, TemplateResult, or other renderable content
    onClick?: () => void;
    className?: string;
    disabled?: boolean;
    translate?: boolean;
    hidden?: boolean;
    title?: string;
    ariaLabel?: string;
  }) {
    const {
      content,
      onClick,
      className = "",
      disabled = false,
      translate = true,
      hidden = false,
      title,
      ariaLabel,
    } = options;

    if (hidden) {
      return html``;
    }

    return html`
      <button
        class="${className}"
        @click=${onClick}
        ?disabled=${disabled}
        ?translate=${translate}
        title=${title ?? null}
        aria-label=${ariaLabel ?? null}
      >
        ${content}
      </button>
    `;
  }

  private toggleHidden() {
    this._hidden = !this._hidden;
    if (this._hidden) {
      this.newEvents = 0;
    }
    this.requestUpdate();
  }

  private toggleEventFilter(filterName: MessageCategory) {
    const currentState = this.eventsFilters.get(filterName) ?? false;
    this.eventsFilters.set(filterName, !currentState);
    this.requestUpdate();
  }

  private updateMap = [
    [GameUpdateType.DisplayEvent, this.onDisplayMessageEvent.bind(this)],
    [GameUpdateType.DisplayChatEvent, this.onDisplayChatEvent.bind(this)],
    [GameUpdateType.AllianceRequest, this.onAllianceRequestEvent.bind(this)],
    [
      GameUpdateType.AllianceRequestReply,
      this.onAllianceRequestReplyEvent.bind(this),
    ],
    [GameUpdateType.BrokeAlliance, this.onBrokeAllianceEvent.bind(this)],
    [GameUpdateType.TargetPlayer, this.onTargetPlayerEvent.bind(this)],
    [GameUpdateType.Emoji, this.onEmojiMessageEvent.bind(this)],
    [GameUpdateType.UnitIncoming, this.onUnitIncomingEvent.bind(this)],
    [GameUpdateType.AllianceExpired, this.onAllianceExpiredEvent.bind(this)],
  ] as const;

  constructor() {
    super();
    this.events = [];
    this.incomingAttacks = [];
    this.outgoingAttacks = [];
    this.outgoingBoats = [];
  }

  init() {}

  tick() {
    this.active = true;

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this._isVisible = true;
      this.requestUpdate();
    }

    let myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this._isVisible) {
        this._isVisible = false;
        this.requestUpdate();
      }
      return;
    }

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const [ut, fn] of this.updateMap) {
        updates[ut]?.forEach(fn as (event: unknown) => void);
      }
    }

    myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this._isVisible) {
        this._isVisible = false;
        this.requestUpdate();
      }
      return;
    }

    // ---- Start Alliance Extension Prompt Logic ----
    const alliances = this.game.alliances(); // from gameview
    const ticks = this.game.ticks();
    const duration = this.game.config().allianceDuration();
    const promptOffset = this.game.config().allianceExtensionPromptOffset();

    for (const alliance of alliances) {
      const createdAt = alliance.createdAt;
      const timeSinceCreation = ticks - createdAt;
      const ticksLeft = duration - timeSinceCreation;

      if (ticksLeft < promptOffset || ticksLeft > promptOffset + 3) continue;

      // Only check alliances involving the local player
      if (
        alliance.requestorID !== myPlayer.smallID() &&
        alliance.recipientID !== myPlayer.smallID()
      ) {
        continue;
      }

      const otherID =
        alliance.requestorID === myPlayer.smallID()
          ? alliance.recipientID
          : alliance.requestorID;

      // avoid duplicate events
      const tag = `about_to_expire_${alliance.requestorID}_${alliance.recipientID}_${alliance.createdAt}`;
      if (this.events.some((e) => e.tags?.includes(tag))) continue;

      const other = this.game.playerBySmallID(otherID);
      if (
        !other ||
        !(other instanceof PlayerView) ||
        !myPlayer.isAlive() ||
        !other.isAlive()
      )
        continue;

      this.addEvent({
        description: translateText("events_display.about_to_expire", {
          name: other.name(),
        }),
        tags: [tag],
        type: MessageType.WARN,
        duration: 100,
        buttons: [
          {
            text: translateText("buttons.focus"),
            className: "btn-gray",
            action: () => this.eventBus.emit(new GoToPlayerEvent(other)),
            preventClose: true,
          },
          {
            text: translateText("buttons.i_want_to_renew"),
            className: "btn",
            action: () =>
              this.eventBus.emit(new SendAllianceExtensionIntentEvent(other)),
          },
        ],
        highlight: true,
        createdAt: ticks,
        focusID: otherID,
      });
    }
    // ---- End Alliance Extension Prompt Logic ----

    let remainingEvents = this.events.filter((event) => {
      const shouldKeep =
        this.game.ticks() - event.createdAt < (event.duration ?? 600);
      if (!shouldKeep && event.onDelete) {
        event.onDelete();
      }
      return shouldKeep;
    });

    if (remainingEvents.length > 30) {
      remainingEvents = remainingEvents.slice(-30);
    }

    if (this.events.length !== remainingEvents.length) {
      this.events = remainingEvents;
      this.requestUpdate();
    }

    // Update attacks
    this.incomingAttacks = myPlayer.incomingAttacks().filter((a) => {
      const t = (this.game.playerBySmallID(a.attackerID) as PlayerView).type();
      return t !== PlayerType.Bot;
    });

    this.outgoingAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID !== 0);

    this.outgoingLandAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID === 0);

    this.outgoingBoats = myPlayer
      .units()
      .filter((u) => u.type() === UnitType.TransportShip);

    this.outgoingParatroopers = myPlayer
      .units()
      .filter((u) => u.type() === UnitType.Paratrooper);

    this.requestUpdate();
  }

  disconnectedCallback() {
    if (this.goldAmountTimeoutId !== null) {
      clearTimeout(this.goldAmountTimeoutId);
      this.goldAmountTimeoutId = null;
    }
  }

  private addEvent(event: GameEvent) {
    this.events = [...this.events, event];
    if (this._hidden === true) {
      this.newEvents++;
    }
    this.requestUpdate();
  }

  private removeEvent(index: number) {
    this.events = [
      ...this.events.slice(0, index),
      ...this.events.slice(index + 1),
    ];
  }

  private removeEventByTags(tags: string[]) {
    this.events = this.events.filter((event) => {
      if (!event.tags) return true;
      for (const tag of tags) {
        if (event.tags.includes(tag)) return false;
      }
      return true;
    });
    this.requestUpdate();
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(): void {}

  onDisplayMessageEvent(event: DisplayMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID !== null &&
      (!myPlayer || myPlayer.smallID() !== event.playerID)
    ) {
      return;
    }

    if (event.goldAmount !== undefined) {
      const hasChanged = this.latestGoldAmount !== event.goldAmount;
      this.latestGoldAmount = event.goldAmount;

      if (this.goldAmountTimeoutId !== null) {
        clearTimeout(this.goldAmountTimeoutId);
      }

      this.goldAmountTimeoutId = setTimeout(() => {
        this.latestGoldAmount = null;
        this.goldAmountTimeoutId = null;
        this.requestUpdate();
      }, 5000);

      if (hasChanged) {
        this.goldAmountAnimating = true;
        setTimeout(() => {
          this.goldAmountAnimating = false;
          this.requestUpdate();
        }, 600);
      }
    }

    let description: string = event.message;
    // Check if the message is a translation key (starts with "events_display." or "messages.")
    if (
      event.message.startsWith("events_display.") ||
      event.message.startsWith("messages.")
    ) {
      description = translateText(event.message, event.params);
    }

    this.addEvent({
      description: description,
      createdAt: this.game.ticks(),
      highlight: true,
      type: event.messageType,
      unsafeDescription: true,
    });
  }

  onDisplayChatEvent(event: DisplayChatMessageUpdate) {
    const myPlayer = this.game.myPlayer();
    if (
      event.playerID === null ||
      !myPlayer ||
      myPlayer.smallID() !== event.playerID
    ) {
      return;
    }

    const baseMessage = translateText(`chat.${event.category}.${event.key}`);
    let translatedMessage = baseMessage;
    if (event.target) {
      try {
        const targetPlayer = this.game.player(event.target);
        const targetName = targetPlayer?.displayName() ?? event.target;
        translatedMessage = baseMessage.replace("[P1]", targetName);
      } catch (e) {
        console.warn(
          `Failed to resolve player for target ID '${event.target}'`,
          e,
        );
        return;
      }
    }

    let otherPlayerDiplayName: string = "";
    if (event.recipient !== null) {
      //'recipient' parameter contains sender ID or recipient ID
      const player = this.game.player(event.recipient);
      otherPlayerDiplayName = player ? player.displayName() : "";
    }

    this.addEvent({
      description: translateText(event.isFrom ? "chat.from" : "chat.to", {
        user: otherPlayerDiplayName,
        msg: translatedMessage,
      }),
      createdAt: this.game.ticks(),
      highlight: true,
      type: MessageType.CHAT,
      unsafeDescription: false,
    });
  }

  onAllianceRequestEvent(update: AllianceRequestUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || update.recipientID !== myPlayer.smallID()) {
      return;
    }

    const requestor = this.game.playerBySmallID(
      update.requestorID,
    ) as PlayerView;
    const recipient = this.game.playerBySmallID(
      update.recipientID,
    ) as PlayerView;

    this.addEvent({
      description: translateText("events_display.request_alliance", {
        name: requestor.name(),
      }),
      buttons: [
        {
          text: translateText("events_display.focus"),
          className: "btn-gray",
          action: () => this.eventBus.emit(new GoToPlayerEvent(requestor)),
          preventClose: true,
        },
        {
          text: translateText("events_display.accept_alliance"),
          className: "btn",
          action: () =>
            this.eventBus.emit(
              new SendAllianceReplyIntentEvent(requestor, recipient, true),
            ),
        },
        {
          text: translateText("events_display.reject_alliance"),
          className: "btn-info",
          action: () =>
            this.eventBus.emit(
              new SendAllianceReplyIntentEvent(requestor, recipient, false),
            ),
        },
      ],
      highlight: true,
      type: MessageType.ALLIANCE_REQUEST,
      createdAt: this.game.ticks(),
      onDelete: () =>
        this.eventBus.emit(
          new SendAllianceReplyIntentEvent(requestor, recipient, false),
        ),
      priority: 0,
      duration: 150,
      focusID: update.requestorID,
    });

    this.removeEventByTags(["alliance" + update.requestorID]);
  }

  onAllianceRequestReplyEvent(update: AllianceRequestReplyUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return;
    }
    // myPlayer can deny alliances without clicking on the button
    if (update.request.recipientID === myPlayer.smallID()) {
      // Remove alliance requests whose requestors are the same as the reply's requestor
      // Noop unless the request was denied through other means (e.g attacking the requestor)
      this.events = this.events.filter(
        (event) =>
          !(
            event.type === MessageType.ALLIANCE_REQUEST &&
            event.focusID === update.request.requestorID
          ),
      );
      this.requestUpdate();
      return;
    }
    if (update.request.requestorID !== myPlayer.smallID()) {
      return;
    }

    const myID = myPlayer.smallID();
    const requestorID = update.request.requestorID;
    const recipientID = update.request.recipientID;

    // Only show message to recipient if it was accepted
    if (!update.accepted && requestorID !== myID) {
      return;
    }

    const otherID = requestorID === myID ? recipientID : requestorID;
    const otherPlayer = this.game.playerBySmallID(otherID) as PlayerView;

    this.addEvent({
      description: translateText("events_display.alliance_request_status", {
        name: otherPlayer.name(),
        status: update.accepted
          ? translateText("events_display.alliance_accepted")
          : translateText("events_display.alliance_rejected"),
      }),
      type: update.accepted
        ? MessageType.ALLIANCE_ACCEPTED
        : MessageType.ALLIANCE_REJECTED,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: otherID,
    });
  }

  onBrokeAllianceEvent(update: BrokeAllianceUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const betrayed = this.game.playerBySmallID(update.betrayedID) as PlayerView;
    const traitor = this.game.playerBySmallID(update.traitorID) as PlayerView;

    if (betrayed.isDisconnected()) return; // Do not send the message if betraying a disconnected player

    if (!betrayed.isTraitor() && traitor === myPlayer) {
      const malusPercent = Math.round(
        (1 - this.game.config().traitorDefenseDebuff()) * 100,
      );

      const traitorDuration = Math.floor(
        this.game.config().traitorDuration() * 0.1,
      );
      const durationText =
        traitorDuration === 1
          ? translateText("events_display.duration_second")
          : translateText("events_display.duration_seconds_plural", {
              seconds: traitorDuration,
            });

      this.addEvent({
        description: translateText("events_display.betrayal_description", {
          name: betrayed.name(),
          malusPercent: malusPercent,
          durationText: durationText,
        }),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.betrayedID,
      });
    } else if (betrayed === myPlayer) {
      const buttons = [
        {
          text: translateText("events_display.focus"),
          className: "btn-gray",
          action: () => this.eventBus.emit(new GoToPlayerEvent(traitor)),
          preventClose: true,
        },
      ];
      this.addEvent({
        description: translateText("events_display.betrayed_you", {
          name: traitor.name(),
        }),
        type: MessageType.ALLIANCE_BROKEN,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.traitorID,
        buttons,
      });
    }
  }

  onAllianceExpiredEvent(update: AllianceExpiredUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    if (
      update.player1ID !== myPlayer.smallID() &&
      update.player2ID !== myPlayer.smallID()
    ) {
      return;
    }
    const otherID =
      update.player1ID === myPlayer.smallID()
        ? update.player2ID
        : update.player1ID;

    const other = this.game.playerBySmallID(otherID) as PlayerView;
    if (!other || !myPlayer.isAlive() || !other.isAlive()) return;

    this.addEvent({
      description: translateText("events_display.alliance_expired", {
        name: other.name(),
      }),
      type: MessageType.ALLIANCE_EXPIRED,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: otherID,
    });
  }

  onTargetPlayerEvent(event: TargetPlayerUpdate) {
    const other = this.game.playerBySmallID(event.playerID) as PlayerView;
    const myPlayer = this.game.myPlayer() as PlayerView;
    if (!myPlayer || !myPlayer.isFriendly(other)) return;

    const target = this.game.playerBySmallID(event.targetID) as PlayerView;

    this.addEvent({
      description: translateText("events_display.attack_request", {
        name: other.name(),
        target: target.name(),
      }),
      type: MessageType.ATTACK_REQUEST,
      highlight: true,
      createdAt: this.game.ticks(),
      focusID: event.targetID,
    });
  }

  emitCancelAttackIntent(id: string) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelAttackIntentEvent(id));
  }

  emitBoatCancelIntent(id: number) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelBoatIntentEvent(id));
  }

  emitGoToPlayerEvent(attackerID: number) {
    const attacker = this.game.playerBySmallID(attackerID) as PlayerView;
    if (!attacker) return;
    this.eventBus.emit(new GoToPlayerEvent(attacker));
  }

  emitGoToPositionEvent(x: number, y: number) {
    this.eventBus.emit(new GoToPositionEvent(x, y));
  }

  emitGoToUnitEvent(unit: UnitView) {
    this.eventBus.emit(new GoToUnitEvent(unit));
  }

  onEmojiMessageEvent(update: EmojiUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const recipient =
      update.emoji.recipientID === AllPlayers
        ? AllPlayers
        : this.game.playerBySmallID(update.emoji.recipientID);
    const sender = this.game.playerBySmallID(
      update.emoji.senderID,
    ) as PlayerView;

    if (recipient === myPlayer) {
      this.addEvent({
        description: `${sender.displayName()}: ${update.emoji.message}`,
        unsafeDescription: true,
        type: MessageType.CHAT,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: update.emoji.senderID,
      });
    } else if (sender === myPlayer && recipient !== AllPlayers) {
      this.addEvent({
        description: translateText("events_display.sent_emoji", {
          name: (recipient as PlayerView).displayName(),
          emoji: update.emoji.message,
        }),
        unsafeDescription: true,
        type: MessageType.CHAT,
        highlight: true,
        createdAt: this.game.ticks(),
        focusID: recipient.smallID(),
      });
    }
  }

  onUnitIncomingEvent(event: UnitIncomingUpdate) {
    const myPlayer = this.game.myPlayer();

    if (!myPlayer || myPlayer.smallID() !== event.playerID) {
      return;
    }

    const unitView = this.game.unit(event.unitID);

    const translatedDescription = event.message;

    this.addEvent({
      description: translatedDescription,
      type: event.messageType,
      unsafeDescription: false,
      highlight: true,
      createdAt: this.game.ticks(),
      unitView: unitView,
    });
  }

  private getEventDescription(
    event: GameEvent,
  ): string | DirectiveResult<typeof UnsafeHTMLDirective> {
    return event.unsafeDescription
      ? unsafeHTML(onlyImages(event.description))
      : event.description;
  }

  private async attackWarningOnClick(attack: AttackUpdate) {
    const playerView = this.game.playerBySmallID(attack.attackerID);
    if (playerView !== undefined) {
      if (playerView instanceof PlayerView) {
        const averagePosition = await playerView.attackAveragePosition(
          attack.attackerID,
          attack.id,
        );

        if (averagePosition === null) {
          this.emitGoToPlayerEvent(attack.attackerID);
        } else {
          this.emitGoToPositionEvent(averagePosition.x, averagePosition.y);
        }
      }
    } else {
      this.emitGoToPlayerEvent(attack.attackerID);
    }
  }

  private renderIncomingAttacks() {
    return html`
      ${this.incomingAttacks.length > 0
        ? html`
            ${this.incomingAttacks.map(
              (attack) => html`
                ${this.renderButton({
                  content: html`
                    ${renderTroops(attack.troops)}
                    ${(
                      this.game.playerBySmallID(attack.attackerID) as PlayerView
                    )?.name()}
                    ${attack.retreating
                      ? `(${translateText("events_display.retreating")}...)`
                      : ""}
                  `,
                  onClick: () => this.attackWarningOnClick(attack),
                  className: "text-left text-red-400",
                  translate: false,
                })}
              `,
            )}
          `
        : ""}
    `;
  }

  private renderOutgoingAttacks() {
    return html`
      ${this.outgoingAttacks.length > 0
        ? html`
            <div class="flex flex-wrap gap-y-1 gap-x-2">
              ${this.outgoingAttacks.map(
                (attack) => html`
                  <div class="inline-flex items-center gap-1">
                    ${this.renderButton({
                      content: html`
                        ${renderTroops(attack.troops)}
                        ${(
                          this.game.playerBySmallID(
                            attack.targetID,
                          ) as PlayerView
                        )?.name()}
                      `,
                      onClick: async () => this.attackWarningOnClick(attack),
                      className: "text-left text-blue-400",
                      translate: false,
                    })}
                    ${!attack.retreating
                      ? this.renderButton({
                          content: "❌",
                          onClick: () => this.emitCancelAttackIntent(attack.id),
                          className: "text-left flex-shrink-0",
                          disabled: attack.retreating,
                        })
                      : html`<span class="flex-shrink-0 text-blue-400"
                          >(${translateText(
                            "events_display.retreating",
                          )}...)</span
                        >`}
                  </div>
                `,
              )}
            </div>
          `
        : ""}
    `;
  }

  private renderOutgoingLandAttacks() {
    return html`
      ${this.outgoingLandAttacks.length > 0
        ? html`
            <div class="flex flex-wrap gap-y-1 gap-x-2">
              ${this.outgoingLandAttacks.map(
                (landAttack) => html`
                  <div class="inline-flex items-center gap-1">
                    ${this.renderButton({
                      content: html`${renderTroops(landAttack.troops)}
                      ${translateText("help_modal.ui_wilderness")}`,
                      className: "text-left text-gray-400",
                      translate: false,
                    })}
                    ${!landAttack.retreating
                      ? this.renderButton({
                          content: "❌",
                          onClick: () =>
                            this.emitCancelAttackIntent(landAttack.id),
                          className: "text-left flex-shrink-0",
                          disabled: landAttack.retreating,
                        })
                      : html`<span class="flex-shrink-0 text-blue-400"
                          >(${translateText(
                            "events_display.retreating",
                          )}...)</span
                        >`}
                  </div>
                `,
              )}
            </div>
          `
        : ""}
    `;
  }

  private renderBoats() {
    return html`
      ${this.outgoingBoats.length > 0
        ? html`
            <div class="flex flex-wrap gap-y-1 gap-x-2">
              ${this.outgoingBoats.map(
                (boat) => html`
                  <div class="inline-flex items-center gap-1">
                    ${this.renderButton({
                      content: html`${translateText("events_display.boat")}:
                      ${renderTroops(boat.troops())}`,
                      onClick: () => this.emitGoToUnitEvent(boat),
                      className: "text-left text-blue-400",
                      translate: false,
                    })}
                    ${!boat.retreating()
                      ? this.renderButton({
                          content: "❌",
                          onClick: () => this.emitBoatCancelIntent(boat.id()),
                          className: "text-left flex-shrink-0",
                          disabled: boat.retreating(),
                        })
                      : html`<span class="flex-shrink-0 text-blue-400"
                          >(${translateText(
                            "events_display.retreating",
                          )}...)</span
                        >`}
                  </div>
                `,
              )}
            </div>
          `
        : ""}
    `;
  }

  private renderAttackRow() {
    return html`
      ${this.renderIncomingAttacks()} ${this.renderOutgoingAttacks()}
      ${this.renderOutgoingLandAttacks()} ${this.renderBoats()}
      ${this.renderParatroopers()}
      ${this.incomingAttacks.length === 0 &&
      this.outgoingAttacks.length === 0 &&
      this.outgoingLandAttacks.length === 0 &&
      this.outgoingBoats.length === 0 &&
      this.outgoingParatroopers.length === 0
        ? html`&nbsp;`
        : ""}
    `;
  }

  private renderParatroopers() {
    return html`
      ${this.outgoingParatroopers.length > 0
        ? html`
            <div class="flex flex-wrap gap-y-1 gap-x-2">
              ${this.outgoingParatroopers.map(
                (paratrooper) => html`
                  <div class="inline-flex items-center gap-1">
                    ${this.renderButton({
                      content: html`${translateText(
                        "events_display.paratrooper_sent",
                      )}:
                      ${renderTroops(paratrooper.troops())}`,
                      onClick: () => this.emitGoToUnitEvent(paratrooper),
                      className: "text-left text-blue-400",
                      translate: false,
                    })}
                    ${this.renderButton({
                      content: "❌",
                      onClick: () =>
                        this.eventBus.emit(
                          new CancelParatrooperIntentEvent(paratrooper.id()),
                        ),
                      className: "text-left flex-shrink-0",
                    })}
                  </div>
                `,
              )}
            </div>
          `
        : ""}
    `;
  }

  render() {
    if (!this.active || !this._isVisible) {
      return html``;
    }

    const styles = html`
      <style>
        @keyframes goldBounce {
          0% {
            transform: scale(1);
          }
          30% {
            transform: scale(1.3);
          }
          50% {
            transform: scale(1.1);
          }
          70% {
            transform: scale(1.2);
          }
          100% {
            transform: scale(1);
          }
        }
      </style>
    `;

    const filteredEvents = this.events.filter((event) => {
      const category = getMessageCategory(event.type);
      return !this.eventsFilters.get(category);
    });

    filteredEvents.sort((a, b) => {
      const aPrior = a.priority ?? 100000;
      const bPrior = b.priority ?? 100000;
      if (aPrior === bPrior) {
        return a.createdAt - b.createdAt;
      }
      return bPrior - aPrior;
    });

    return html`
      ${styles}
      <!-- Events Toggle (when hidden) -->
      ${this._hidden
        ? html`
            <div
              class="absolute bottom-0 right-0 z-50"
              style="background-color: var(--ui-slider-track)"
            >
              ${this.renderButton({
                content: html`
                  Events
                  <span
                    class="${this.newEvents
                      ? ""
                      : "hidden"} inline-block px-2 bg-red-500 rounded-xl text-sm"
                    >${this.newEvents}</span
                  >
                `,
                onClick: this.toggleHidden,
                // Inherit surrounding text color from panel
                className:
                  "cursor-pointer pointer-events-auto w-fit p-2 lg:p-3 rounded-md",
              })}
            </div>
          `
        : html`
            <!-- Main Events Display -->
            <div
              class="relative w-full submarine-panel p-2 pr-3 lg:p-4"
              style="box-shadow: inset 0 0 18px rgba(2, 8, 20, 0.8), 0 2px 6px rgba(0, 0, 0, 0.5);"
            >
              <!-- Button Bar -->
              <div class="w-full p-2 lg:p-3 rounded-t-none md:rounded-t-md">
                <div class="flex justify-between items-center">
                  <div class="flex gap-4">
                    ${this.renderButton({
                      content: html`<img
                        src="${swordIcon}"
                        class="w-5 h-5"
                        style="filter: ${this.eventsFilters.get(
                          MessageCategory.ATTACK,
                        )
                          ? "grayscale(1) opacity(0.5)"
                          : "none"}"
                      />`,
                      onClick: () =>
                        this.toggleEventFilter(MessageCategory.ATTACK),
                      className:
                        "cursor-pointer pointer-events-auto text-gray-200",
                      title: translateText("events_display.filter_attack"),
                      ariaLabel: translateText("events_display.filter_attack"),
                    })}
                    ${this.renderButton({
                      content: html`<img
                        src="${donateGoldIcon}"
                        class="w-5 h-5"
                        style="filter: ${this.eventsFilters.get(
                          MessageCategory.TRADE,
                        )
                          ? "grayscale(1) opacity(0.5)"
                          : "none"}"
                      />`,
                      onClick: () =>
                        this.toggleEventFilter(MessageCategory.TRADE),
                      className:
                        "cursor-pointer pointer-events-auto text-gray-200",
                      title: translateText("events_display.filter_trade"),
                      ariaLabel: translateText("events_display.filter_trade"),
                    })}
                    ${this.renderButton({
                      content: html`<img
                        src="${allianceIcon}"
                        class="w-5 h-5"
                        style="filter: ${this.eventsFilters.get(
                          MessageCategory.ALLIANCE,
                        )
                          ? "grayscale(1) opacity(0.5)"
                          : "none"}"
                      />`,
                      onClick: () =>
                        this.toggleEventFilter(MessageCategory.ALLIANCE),
                      className:
                        "cursor-pointer pointer-events-auto text-gray-200",
                      title: translateText("events_display.filter_alliance"),
                      ariaLabel: translateText(
                        "events_display.filter_alliance",
                      ),
                    })}
                    ${this.renderButton({
                      content: html`<img
                        src="${chatIcon}"
                        class="w-5 h-5"
                        style="filter: ${this.eventsFilters.get(
                          MessageCategory.CHAT,
                        )
                          ? "grayscale(1) opacity(0.5)"
                          : "none"}"
                      />`,
                      onClick: () =>
                        this.toggleEventFilter(MessageCategory.CHAT),
                      className:
                        "cursor-pointer pointer-events-auto text-gray-200",
                      title: translateText("events_display.filter_chat"),
                      ariaLabel: translateText("events_display.filter_chat"),
                    })}
                  </div>
                  <div class="flex items-center gap-3">
                    ${this.latestGoldAmount !== null
                      ? html`<span
                          class="text-blue-300 font-semibold transition-all duration-300 ${this
                            .goldAmountAnimating
                            ? "animate-pulse scale-110"
                            : "scale-100"}"
                          style="animation: ${this.goldAmountAnimating
                            ? "goldBounce 0.6s ease-out"
                            : "none"}"
                          >+${renderNumber(this.latestGoldAmount)}</span
                        >`
                      : ""}
                    ${this.renderButton({
                      content: translateText("leaderboard.hide"),
                      onClick: this.toggleHidden,
                      // Inherit panel text color instead of forcing old tan
                      className: "cursor-pointer pointer-events-auto",
                    })}
                  </div>
                </div>
              </div>

              <!-- Content Area -->
              <div
                class="rounded-b-none md:rounded-b-md flex flex-col-reverse overflow-y-auto w-full max-h-[178px] min-h-[2rem]"
                style="height: auto;"
              >
                <div>
                  <table
                    class="w-full max-h-none border-collapse text-gray-200 shadow-lg text-[0.95rem] leading-[1rem]"
                    style="pointer-events: auto;"
                  >
                    <tbody>
                      ${filteredEvents.map(
                        (event, index) => html`
                          <tr>
                            <td
                              class="lg:px-2 lg:py-1 p-1 text-left ${getMessageTypeClasses(
                                event.type,
                              )}"
                            >
                              ${event.focusID
                                ? this.renderButton({
                                    content: this.getEventDescription(event),
                                    onClick: () => {
                                      event.focusID &&
                                        this.emitGoToPlayerEvent(event.focusID);
                                    },
                                    className: "text-left text-gray-200",
                                  })
                                : event.unitView
                                  ? this.renderButton({
                                      content: this.getEventDescription(event),
                                      onClick: () => {
                                        event.unitView &&
                                          this.emitGoToUnitEvent(
                                            event.unitView,
                                          );
                                      },
                                      className: "text-left text-gray-200",
                                    })
                                  : this.getEventDescription(event)}
                              <!-- Events with buttons (Alliance requests) -->
                              ${event.buttons
                                ? html`
                                    <div class="flex flex-wrap gap-1.5 mt-1">
                                      ${event.buttons.map(
                                        (btn) => html`
                                          <button
                                            class="inline-block px-3 py-1 text-white rounded text-md md:text-sm cursor-pointer transition-colors duration-300
                            ${btn.className.includes("btn-info")
                                              ? "bg-red-700 hover:bg-red-800" /* Use standard Tailwind red */
                                              : btn.className.includes(
                                                    "btn-gray",
                                                  )
                                                ? "bg-gray-700 hover:bg-gray-600" /* Standard gray */
                                                : "bg-blue-700 hover:bg-blue-600"} /* Blue primary to match submarine theme */"
                                            @click=${() => {
                                              btn.action();
                                              if (!btn.preventClose) {
                                                const originalIndex =
                                                  this.events.findIndex(
                                                    (e) => e === event,
                                                  );
                                                if (originalIndex !== -1) {
                                                  this.removeEvent(
                                                    originalIndex,
                                                  );
                                                }
                                              }
                                              this.requestUpdate();
                                            }}
                                          >
                                            ${btn.text}
                                          </button>
                                        `,
                                      )}
                                    </div>
                                  `
                                : ""}
                            </td>
                          </tr>
                        `,
                      )}
                      <tr>
                        <td class="lg:px-2 lg:py-1 p-1 text-left">
                          ${this.renderAttackRow()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `}
    `;
  }

  createRenderRoot() {
    return this;
  }
}
