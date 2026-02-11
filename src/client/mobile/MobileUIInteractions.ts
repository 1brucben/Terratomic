import { EventBus } from "../../core/EventBus";
import { flattenedEmojiTable } from "../../core/Util";
import { AllPlayers, UnitType } from "../../core/game/Game";
import type { TileRef } from "../../core/game/GameMap";
import type { GameView, PlayerView } from "../../core/game/GameView";
import {
  BuildUnitIntentEvent,
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBomberIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDeclareWarIntentEvent,
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendEmojiIntentEvent,
  SendParatrooperAttackIntentEvent,
  SendPeaceRequestIntentEvent,
  SendSpawnIntentEvent,
} from "../Transport";
import { HapticFeedback } from "./utils/HapticFeedback";

export function handleAttackAction(params: {
  action: string;
  game: GameView | null;
  selectedTile: TileRef | null;
  attackRatio: number;
  eventBus: EventBus;
  openIntelSidebar: () => void;
  bomberTargetStructures: UnitType[];
}): void {
  const {
    action,
    game,
    selectedTile,
    attackRatio,
    eventBus,
    openIntelSidebar,
    bomberTargetStructures,
  } = params;

  if (!game || !selectedTile) return;

  const myPlayer = game.myPlayer();
  if (!myPlayer) return;

  const owner = game.owner(selectedTile);
  const troops = Math.floor(Number(myPlayer.troops()) * attackRatio);

  switch (action) {
    case "attack:ground":
      eventBus.emit(
        new SendAttackIntentEvent(
          owner && owner.isPlayer() ? owner.id() : null,
          troops,
        ),
      );
      HapticFeedback.success();
      break;

    case "attack:naval":
      eventBus.emit(
        new SendBoatAttackIntentEvent(
          owner && owner.isPlayer() ? owner.id() : null,
          selectedTile,
          troops,
          null,
        ),
      );
      HapticFeedback.success();
      break;

    case "attack:airstrike":
      eventBus.emit(
        new SendParatrooperAttackIntentEvent(
          owner && owner.isPlayer() ? owner.id() : null,
          selectedTile,
          troops,
        ),
      );
      HapticFeedback.success();
      break;

    case "attack:bomber":
      eventBus.emit(
        new SendBomberIntentEvent(
          owner && owner.isPlayer() ? owner.id() : null,
          bomberTargetStructures,
          true,
        ),
      );
      HapticFeedback.success();
      break;

    case "attack:declare-war":
      if (owner && owner.isPlayer()) {
        eventBus.emit(
          new SendDeclareWarIntentEvent(myPlayer, owner as PlayerView),
        );
        HapticFeedback.success();
      }
      break;

    case "attack:nuke-atom":
      eventBus.emit(new BuildUnitIntentEvent(UnitType.AtomBomb, selectedTile));
      HapticFeedback.success();
      break;

    case "attack:nuke-hbomb":
      eventBus.emit(
        new BuildUnitIntentEvent(UnitType.HydrogenBomb, selectedTile),
      );
      HapticFeedback.success();
      break;

    case "attack:nuke-mirv":
      eventBus.emit(new BuildUnitIntentEvent(UnitType.MIRV, selectedTile));
      HapticFeedback.success();
      break;

    case "attack:mark-target":
      break;

    case "attack:view-intel":
      openIntelSidebar();
      HapticFeedback.tap();
      break;

    default:
  }
}

export function handleDiplomacyAction(params: {
  action: string;
  game: GameView | null;
  selectedTile: TileRef | null;
  eventBus: EventBus;
  openIntelSidebar: () => void;
  openEmojiTableForPlayer: (targetPlayer: PlayerView) => void;
  sendTroopDonationToPlayer: (targetPlayer: PlayerView) => void;
  sendGoldDonationToPlayer: (targetPlayer: PlayerView) => void;
  openChatModalForPlayer: (targetPlayer: PlayerView) => void;
}): void {
  const {
    action,
    game,
    selectedTile,
    eventBus,
    openIntelSidebar,
    openEmojiTableForPlayer,
    sendTroopDonationToPlayer,
    sendGoldDonationToPlayer,
    openChatModalForPlayer,
  } = params;

  if (!game || !selectedTile) return;

  const owner = game.owner(selectedTile);
  if (!owner.isPlayer()) return;

  const targetPlayer = owner as PlayerView;
  const myPlayer = game.myPlayer();
  if (!myPlayer) return;

  switch (action) {
    case "diplomacy:propose-ally":
      eventBus.emit(new SendAllianceRequestIntentEvent(myPlayer, targetPlayer));
      HapticFeedback.success();
      break;

    case "diplomacy:break-alliance":
      eventBus.emit(new SendBreakAllianceIntentEvent(myPlayer, targetPlayer));
      HapticFeedback.success();
      break;

    case "diplomacy:request-peace":
      eventBus.emit(new SendPeaceRequestIntentEvent(myPlayer, targetPlayer));
      HapticFeedback.success();
      break;

    case "diplomacy:send-emoji":
      openEmojiTableForPlayer(targetPlayer);
      HapticFeedback.tap();
      break;

    case "diplomacy:donate-troops":
      sendTroopDonationToPlayer(targetPlayer);
      HapticFeedback.success();
      break;

    case "diplomacy:donate-gold":
      sendGoldDonationToPlayer(targetPlayer);
      HapticFeedback.success();
      break;

    case "diplomacy:chat":
      openChatModalForPlayer(targetPlayer);
      HapticFeedback.tap();
      break;

    case "diplomacy:view-player":
      openIntelSidebar();
      HapticFeedback.tap();
      break;

    default:
  }
}

export function handleSpawnAction(params: {
  game: GameView | null;
  selectedTile: TileRef | null;
  eventBus: EventBus;
}): void {
  const { game, selectedTile, eventBus } = params;

  if (!game || !selectedTile) {
    return;
  }

  if (game.isLand(selectedTile) && !game.hasOwner(selectedTile)) {
    eventBus.emit(new SendSpawnIntentEvent(selectedTile));
    HapticFeedback.success();
  }
}

export function sendTroopDonationToPlayer(params: {
  targetPlayer: PlayerView;
  game: GameView | null;
  eventBus: EventBus;
  attackRatio: number;
}): void {
  const { targetPlayer, game, eventBus, attackRatio } = params;

  if (!game) return;

  const myPlayer = game.myPlayer();
  if (!myPlayer) return;

  eventBus.emit(
    new SendDonateTroopsIntentEvent(
      targetPlayer,
      myPlayer.troops() * attackRatio,
    ),
  );
}

export function sendGoldDonationToPlayer(params: {
  targetPlayer: PlayerView;
  eventBus: EventBus;
}): void {
  const { targetPlayer, eventBus } = params;
  eventBus.emit(new SendDonateGoldIntentEvent(targetPlayer, null));
}

export function openChatModalForPlayer(params: {
  targetPlayer: PlayerView;
  game: GameView | null;
}): void {
  const { targetPlayer, game } = params;

  if (!game) return;

  const myPlayer = game.myPlayer();
  if (!myPlayer) return;

  const chatModal = document.querySelector("chat-modal") as {
    open: (sender?: PlayerView, recipient?: PlayerView) => void;
  } | null;

  if (!chatModal) return;

  chatModal.open(myPlayer, targetPlayer);
}

export function openEmojiTableForPlayer(params: {
  targetPlayer: PlayerView;
  game: GameView | null;
  eventBus: EventBus;
}): void {
  const { targetPlayer, game, eventBus } = params;

  if (!game) return;

  const myPlayer = game.myPlayer();
  if (!myPlayer) return;

  const emojiTable = document.querySelector("emoji-table") as {
    showTable: (onEmojiClicked: (emoji: string) => void) => void;
    hideTable: () => void;
  } | null;

  if (!emojiTable) return;

  emojiTable.showTable((emoji: string) => {
    const recipient = targetPlayer === myPlayer ? AllPlayers : targetPlayer;
    eventBus.emit(
      new SendEmojiIntentEvent(recipient, flattenedEmojiTable.indexOf(emoji)),
    );
    emojiTable.hideTable();
  });
}

export async function handlePlayerToastLongPress(params: {
  game: GameView;
  tile: TileRef;
  playerToast: {
    canDonate: boolean;
    canSendEmoji: boolean;
    show: (player: PlayerView, duration?: number) => void;
  };
}): Promise<boolean> {
  const { game, tile, playerToast } = params;

  const myPlayer = game.myPlayer();
  if (!myPlayer) {
    return false;
  }

  const owner = game.owner(tile);
  if (!owner.isPlayer()) {
    return false;
  }

  const actions = await myPlayer.actions(tile);
  const targetPlayer = owner as PlayerView;

  playerToast.canDonate =
    targetPlayer === myPlayer
      ? false
      : (actions.interaction?.canDonate ?? false);

  playerToast.canSendEmoji =
    targetPlayer === myPlayer
      ? (actions.canSendEmojiAllPlayers ?? false)
      : (actions.interaction?.canSendEmoji ?? false);

  playerToast.show(targetPlayer, 5000);
  HapticFeedback.longPress();
  return true;
}
