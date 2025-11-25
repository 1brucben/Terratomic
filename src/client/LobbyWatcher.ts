import { EventBus } from "../core/EventBus";
import { UserSettings } from "../core/game/UserSettings";
import { GameInfo } from "../core/Schemas";
import { SendLobbyNotificationEvent } from "./Transport";

export class LobbyWatcher {
  private intervalId: number | null = null;
  private lastPlayerCount: number = 0;
  private readonly POLLING_INTERVAL = 10000; // 10 seconds
  private readonly MUTE_DURATION = 30 * 60 * 1000; // 30 minutes
  private readonly MUTE_KEY = "lobby_notification_mute_until";
  private readonly TRIGGER_THRESHOLD = 1; // Configurable threshold

  constructor(private eventBus: EventBus) {}

  public start() {
    if (this.intervalId !== null) return;
    this.checkLobbies(); // Check immediately
    this.intervalId = window.setInterval(
      () => this.checkLobbies(),
      this.POLLING_INTERVAL,
    );
  }

  public stop() {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async checkLobbies() {
    // Check if notifications are disabled
    const userSettings = new UserSettings();
    if (!userSettings.lobbyNotificationsEnabled()) return;

    if (this.isMuted()) return;

    try {
      const response = await fetch("/api/public_lobbies");
      if (!response.ok) return;
      const data = await response.json();
      const lobbies: GameInfo[] = data.lobbies;

      if (lobbies.length === 0) return;

      const mainLobby = lobbies[0];
      if (!mainLobby || !mainLobby.gameConfig) return;

      const currentCount = mainLobby.numClients ?? 0;
      const maxPlayers = mainLobby.gameConfig.maxPlayers;
      if (maxPlayers === undefined) return;
      const msUntilStart = mainLobby.msUntilStart ?? 0;

      // Logic:
      // 1. Must meet threshold.
      // 2. Must be an increase from last check (to avoid spamming same count).
      // 3. Must not be muted (checked at start).

      if (
        currentCount >= this.TRIGGER_THRESHOLD &&
        currentCount > this.lastPlayerCount
      ) {
        this.eventBus.emit(
          new SendLobbyNotificationEvent(
            currentCount,
            maxPlayers,
            msUntilStart,
            mainLobby.gameID,
            mainLobby.gameConfig.gameMap ?? "Unknown Map",
          ),
        );
      }

      this.lastPlayerCount = currentCount;
    } catch (error) {
      console.error("Error fetching lobbies in LobbyWatcher:", error);
    }
  }

  private isMuted(): boolean {
    const muteUntil = localStorage.getItem(this.MUTE_KEY);
    if (!muteUntil) return false;
    const now = Date.now();
    if (now > parseInt(muteUntil, 10)) {
      localStorage.removeItem(this.MUTE_KEY);
      return false;
    }
    return true;
  }

  public mute() {
    const muteUntil = Date.now() + this.MUTE_DURATION;
    localStorage.setItem(this.MUTE_KEY, muteUntil.toString());
  }
}
