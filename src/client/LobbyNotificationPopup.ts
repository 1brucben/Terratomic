import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserSettings } from "../core/game/UserSettings";
import { SendLobbyNotificationEvent } from "./Transport";
import { getMapsImage } from "./utilities/Maps";
import { translateText } from "./Utils";

@customElement("lobby-notification-popup")
export class LobbyNotificationPopup extends LitElement {
  @state() private visible: boolean = false;
  @state() private currentPlayers: number = 0;
  @state() private maxPlayers: number = 0;
  @state() private timeRemaining: string = "";
  @state() private gameID: string = "";
  @state() private mapName: string = "";
  @state() private gameMode: string = "Free for All";
  private userSettings: UserSettings = new UserSettings();
  private countdownInterval: number | null = null;
  private targetTime: number = 0;

  static styles = css`
    :host {
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%) translateX(100%);
      transition: transform 0.3s ease-out;
      z-index: 1000;
      pointer-events: none;
    }

    :host(.visible) {
      transform: translateY(-50%) translateX(0);
      pointer-events: auto;
    }

    .popup-container {
      position: relative;
      background: linear-gradient(
        135deg,
        rgba(24, 49, 82, 0.95) 0%,
        rgba(14, 26, 51, 0.95) 100%
      );
      border-left: 3px solid var(--ui-primary);
      border-radius: 8px 0 0 8px;
      padding: 20px 24px;
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
      min-width: 270px;
      max-width: 340px;
      color: var(--ui-text-light);
      backdrop-filter: blur(8px);
      overflow: hidden;
    }

    .map-background {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      opacity: 0.3;
      mask-image: linear-gradient(to right, transparent, #fff);
      -webkit-mask-image: linear-gradient(to right, transparent, #fff);
    }

    .popup-header,
    .popup-content,
    .popup-actions {
      position: relative;
      z-index: 1;
    }

    .popup-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .popup-title {
      font-size: 18px;
      font-weight: 700;
      color: #93c5fd;
      text-shadow: 0 0 10px rgba(147, 197, 253, 0.5);
    }

    .close-btn {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: var(--ui-text-muted);
      width: 26px;
      height: 26px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .close-btn:hover {
      background: rgba(239, 68, 68, 0.2);
      border-color: #ef4444;
      color: #ef4444;
    }

    .popup-content {
      margin-bottom: 10px;
    }

    .game-info {
      display: flex;
      gap: 8px;
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
    }

    .game-mode {
      font-size: 12px;
      color: var(--ui-primary);
      background: white;
      display: inline-block;
      padding: 2px 6px;
      border-radius: 2px;
      margin-bottom: 0;
      font-weight: 600;
      text-align: center;
    }

    .map-name {
      font-size: 14px;
      color: #93c5fd;
      background: rgba(14, 26, 51, 0.55);
      border: 1px solid #27476e;
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      margin-bottom: 0;
      font-weight: 600;
      box-shadow: 0 0 8px rgba(14, 26, 51, 0.35);
      text-align: center;
    }

    .lobby-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }

    .player-count {
      font-size: 16px;
      font-weight: 500;
      color: #93c5fd;
    }

    .time-remaining {
      font-size: 16px;
      color: #93c5fd;
      font-weight: 500;
    }

    .popup-actions {
      display: flex;
      gap: 10px;
      flex-direction: column;
    }

    .secondary-actions {
      display: flex;
      gap: 8px;
      flex-direction: row;
    }

    .btn {
      padding: 10px 18px;
      border: none;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
      border: 1px solid transparent;
    }

    .btn-primary {
      background: linear-gradient(
        to right,
        var(--ui-primary),
        var(--ui-primary-hover)
      );
      color: var(--ui-button-text);
      box-shadow: 0 2px 8px rgba(147, 197, 253, 0.3);
    }

    .btn-primary:hover {
      opacity: 0.9;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(147, 197, 253, 0.4);
    }

    .btn-secondary {
      background: rgba(0, 0, 0, 0.3);
      color: var(--ui-text-light);
      border-color: rgba(255, 255, 255, 0.1);
    }

    .btn-secondary:hover {
      background: rgba(0, 0, 0, 0.4);
      border-color: rgba(255, 255, 255, 0.2);
    }
  `;

  public show(event: SendLobbyNotificationEvent) {
    // If player count is 0, hide the popup
    if (event.currentPlayers === 0) {
      this.hide();
      return;
    }

    // Update popup data
    this.currentPlayers = event.currentPlayers;
    this.maxPlayers = event.maxPlayers;
    this.gameID = event.gameID;
    this.mapName = event.mapName;
    this.gameMode = "Free for All"; // Default to FFA for public lobbies
    this.targetTime = Date.now() + event.timeRemaining;

    // If popup is already visible, just update the display
    if (this.visible) {
      this.updateCountdown(); // Update countdown immediately for fresh data
      this.requestUpdate();
      return;
    }

    // Calculate target time
    this.updateCountdown();

    // Start countdown interval
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    this.countdownInterval = window.setInterval(
      () => this.updateCountdown(),
      1000,
    );

    this.visible = true;
    this.classList.add("visible");
  }

  private updateCountdown() {
    const remaining = Math.max(0, this.targetTime - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);

    // Format as "Xm Ys" if over 60 seconds, otherwise just "Xs"
    if (totalSeconds >= 60) {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      this.timeRemaining = `${minutes}m ${seconds}s`;
    } else {
      this.timeRemaining = `${totalSeconds}s`;
    }

    // Stop countdown when it reaches 0
    if (totalSeconds <= 0 && this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  public hide() {
    this.visible = false;
    this.classList.remove("visible");

    // Clear countdown interval
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private handleClose() {
    this.hide();
  }

  private handleMute() {
    const muteUntil = Date.now() + 30 * 60 * 1000;
    localStorage.setItem("lobby_notification_mute_until", muteUntil.toString());
    this.hide();
  }

  private handleDisable() {
    this.userSettings.toggleLobbyNotifications();
    this.hide();
  }

  private handleJoin() {
    // Set the URL hash to join the lobby, then reload the page
    // This will trigger the lobby join on page load
    // Add a flag to indicate this is a public lobby join
    window.location.hash = `join=${this.gameID}&public=true`;
    window.location.reload();
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div class="popup-container">
        <img
          src="${getMapsImage(this.mapName as any)}"
          alt="${this.mapName}"
          class="map-background"
        />
        <div class="popup-header">
          <div class="popup-title">
            ${translateText("lobby_notification.title")}
          </div>
          <button class="close-btn" @click=${this.handleClose}>×</button>
        </div>

        <div class="popup-content">
          <div class="lobby-info">
            <div class="player-count">
              ${this.currentPlayers} / ${this.maxPlayers}
            </div>
            <div class="time-remaining">${this.timeRemaining}</div>
          </div>
          <div class="game-info">
            <div class="game-mode">${this.gameMode}</div>
            <div class="map-name">${this.mapName}</div>
          </div>
        </div>

        <div class="popup-actions">
          <button class="btn btn-primary" @click=${this.handleJoin}>
            ${translateText("lobby_notification.join_game")}
          </button>
          <div class="secondary-actions">
            <button class="btn btn-secondary" @click=${this.handleMute}>
              ${translateText("lobby_notification.mute_30m")}
            </button>
            <button class="btn btn-secondary" @click=${this.handleDisable}>
              ${translateText("lobby_notification.disable")}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
