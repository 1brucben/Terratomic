import { EventBus } from "../core/EventBus";
import { GameRecord, GameStartInfo, ID } from "../core/Schemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { GameType } from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { joinLobby } from "./ClientGameRunner";
import "./DarkModeButton";
import { DarkModeButton } from "./DarkModeButton";
import "./FlagInput";
import { FlagInput } from "./FlagInput";
import { GameStartingModal } from "./GameStartingModal";
import "./GoogleAdElement";
import GoogleAdElement from "./GoogleAdElement";
import { HelpModal } from "./HelpModal";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { JoinPrivateLobbyModal } from "./JoinPrivateLobbyModal";
import "./LangSelector";
import { LangSelector } from "./LangSelector";
import { LanguageModal } from "./LanguageModal";
import { NewsModal } from "./NewsModal";
import "./PublicLobby";
import { PublicLobby } from "./PublicLobby";
import { SinglePlayerModal } from "./SinglePlayerModal";
import "./SoundButton";
import { SendKickPlayerIntentEvent } from "./Transport";
import { UserSettingModal } from "./UserSettingModal";
import "./UsernameInput";
import { UsernameInput } from "./UsernameInput";
import { generateCryptoRandomUUID } from "./Utils";
import "./components/NewsButton";
import { NewsButton } from "./components/NewsButton";
import "./components/baseComponents/Button";
import { OButton } from "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { isLoggedIn } from "./jwt";
import "./styles.css";
import { applyUiPalette, getUiPalette } from "./theme/UiPaletteLoader";

declare global {
  interface Window {
    PageOS: {
      session: {
        newPageView: () => void;
      };
    };
    __LEGACY_UI_PALETTE__?: boolean;
    ramp: {
      que: Array<() => void>;
      passiveMode: boolean;
      spaAddAds: (ads: Array<{ type: string; selectorId: string }>) => void;
      destroyUnits: (adType: string) => void;
      settings?: {
        slots?: any;
      };
      spaNewPage: (url: string) => void;
    };
  }

  // Extend the global interfaces to include your custom events
  interface DocumentEventMap {
    "join-lobby": CustomEvent<JoinLobbyEvent>;
    "kick-player": CustomEvent;
  }
}

export interface JoinLobbyEvent {
  clientID: string;
  // Multiplayer games only have gameID, gameConfig is not known until game starts.
  gameID: string;
  // GameConfig only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
}

class Client {
  private gameStop: (() => void) | null = null;
  private eventBus: EventBus = new EventBus();

  private usernameInput: UsernameInput | null = null;
  private flagInput: FlagInput | null = null;
  private darkModeButton: DarkModeButton | null = null;

  private joinModal: JoinPrivateLobbyModal;
  private publicLobby: PublicLobby;
  private googleAds: NodeListOf<GoogleAdElement>;
  private userSettings: UserSettings = new UserSettings();
  // Main menu background music (loops on menu, paused during gameplay)
  private menuMusic: HTMLAudioElement | null = null;
  // Track whether the UI is currently on the main menu (not in-game)
  private isOnMainMenu = true;

  constructor() {}

  private handleDarkModeChangedEvent = () => {
    this.applyUiPaletteFromSettings();
  };

  private applyUiPaletteFromSettings() {
    if (window.__LEGACY_UI_PALETTE__) {
      return;
    }
    try {
      applyUiPalette(getUiPalette(this.userSettings));
    } catch (error) {
      console.error("Failed to apply UI palette", error);
    }
  }

  initialize(): void {
    this.applyUiPaletteFromSettings();
    window.addEventListener(
      "dark-mode-changed",
      this.handleDarkModeChangedEvent,
    );
    // Prepare main menu background music
    this.setupMenuMusic();
    // Sync menu music with persisted mute state and react to changes
    const syncMute = (muted: boolean) => {
      if (this.menuMusic) this.menuMusic.muted = muted;
    };
    syncMute(this.userSettings.soundMuted());
    window.addEventListener("sound-muted-changed", (e: Event) => {
      const event = e as CustomEvent<{ muted: boolean }>;
      syncMute(event.detail.muted);
      // If unmuting while on main menu, attempt to play
      if (!event.detail.muted && this.isOnMainMenu) {
        this.menuMusic?.play().catch(() => {});
      }
    });
    const newsModal = document.querySelector("news-modal") as NewsModal;
    if (!newsModal) {
      console.warn("News modal element not found");
    } else {
      console.log("News modal element found");
    }
    newsModal instanceof NewsModal;
    const newsButton = document.querySelector("news-button") as NewsButton;
    if (!newsButton) {
      console.warn("News button element not found");
    } else {
      console.log("News button element found");
    }

    // Comment out to show news button.
    // newsButton.hidden = true;

    const langSelector = document.querySelector(
      "lang-selector",
    ) as LangSelector;
    const languageModal = document.querySelector(
      "language-modal",
    ) as LanguageModal;
    if (!langSelector) {
      console.warn("Lang selector element not found");
    }
    if (!languageModal) {
      console.warn("Language modal element not found");
    }

    this.flagInput = document.querySelector("flag-input") as FlagInput;
    if (!this.flagInput) {
      console.warn("Flag input element not found");
    }

    this.darkModeButton = document.querySelector(
      "dark-mode-button",
    ) as DarkModeButton;
    if (!this.darkModeButton) {
      console.warn("Dark mode button element not found");
    }

    // const loginDiscordButton = document.getElementById(
    //   "login-discord",
    // ) as OButton;
    // const logoutDiscordButton = document.getElementById(
    //   "logout-discord",
    // ) as OButton;

    // const logoutDiscordButton = document.getElementById(
    //   "logout-discord",
    // ) as OButton;

    const joinDiscordButton = document.getElementById(
      "join-discord-button",
    ) as OButton;
    joinDiscordButton.addEventListener("click", () => {
      window.open("https://discord.gg/w8HXjhaBkU", "_blank");
    });

    this.usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!this.usernameInput) {
      console.warn("Username input element not found");
    }

    this.publicLobby = document.querySelector("public-lobby") as PublicLobby;
    this.googleAds = document.querySelectorAll(
      "google-ad",
    ) as NodeListOf<GoogleAdElement>;

    window.addEventListener("beforeunload", () => {
      console.log("Browser is closing");
      if (this.gameStop !== null) {
        this.gameStop();
      }
      // Ensure music is stopped on unload
      this.menuMusic?.pause();
      if (this.menuMusic) this.menuMusic.currentTime = 0;
    });

    document.addEventListener("join-lobby", this.handleJoinLobby.bind(this));
    document.addEventListener("leave-lobby", this.handleLeaveLobby.bind(this));
    document.addEventListener("kick-player", this.handleKickPlayer.bind(this));

    const spModal = document.querySelector(
      "single-player-modal",
    ) as SinglePlayerModal;
    spModal instanceof SinglePlayerModal;
    const singlePlayer = document.getElementById("single-player");
    if (singlePlayer === null) throw new Error("Missing single-player");
    singlePlayer.addEventListener("click", () => {
      if (this.usernameInput?.isValid()) {
        spModal.open();
      }
    });

    // const ctModal = document.querySelector("chat-modal") as ChatModal;
    // ctModal instanceof ChatModal;
    // document.getElementById("chat-button").addEventListener("click", () => {
    //   ctModal.open();
    // });

    const hlpModal = document.querySelector("help-modal") as HelpModal;
    hlpModal instanceof HelpModal;
    const helpButton = document.getElementById("help-button");
    if (helpButton === null) throw new Error("Missing help-button");
    helpButton.addEventListener("click", () => {
      hlpModal.open();
    });

    // if (isLoggedIn() === false) {
    //   // Not logged in
    //   loginDiscordButton.disable = false;
    //   loginDiscordButton.translationKey = "main.login_discord";
    //   loginDiscordButton.addEventListener("click", discordLogin);
    //   logoutDiscordButton.hidden = true;
    // } else {
    //   // JWT appears to be valid
    //   loginDiscordButton.disable = true;
    //   loginDiscordButton.translationKey = "main.checking_login";
    //   logoutDiscordButton.hidden = false;
    //   logoutDiscordButton.addEventListener("click", () => {
    //     // Log out
    //     logOut();
    //     loginDiscordButton.disable = false;
    //     loginDiscordButton.translationKey = "main.login_discord";
    //     loginDiscordButton.hidden = false;
    //     loginDiscordButton.addEventListener("click", discordLogin);
    //     logoutDiscordButton.hidden = true;
    //   });
    //   // Look up the discord user object.
    //   // TODO: Add caching
    //   getUserMe().then((userMeResponse) => {
    //     if (userMeResponse === false) {
    //       // Not logged in
    //       loginDiscordButton.disable = false;
    //       loginDiscordButton.translationKey = "main.login_discord";
    //       loginDiscordButton.addEventListener("click", discordLogin);
    //       logoutDiscordButton.hidden = true;
    //       return;
    //     }
    //     loginDiscordButton.translationKey = "main.logged_in";
    //     loginDiscordButton.hidden = true;
    //     const { user, player } = userMeResponse;
    //   });
    // }

    const settingsModal = document.querySelector(
      "user-setting",
    ) as UserSettingModal;
    settingsModal instanceof UserSettingModal;
    document
      .getElementById("settings-button")
      ?.addEventListener("click", () => {
        settingsModal.open();
      });

    const hostModal = document.querySelector(
      "host-lobby-modal",
    ) as HostPrivateLobbyModal;
    hostModal instanceof HostPrivateLobbyModal;
    const hostLobbyButton = document.getElementById("host-lobby-button");
    if (hostLobbyButton === null) throw new Error("Missing host-lobby-button");
    hostLobbyButton.addEventListener("click", () => {
      if (this.usernameInput?.isValid()) {
        hostModal.open();
        this.publicLobby.leaveLobby();
      }
    });

    this.joinModal = document.querySelector(
      "join-private-lobby-modal",
    ) as JoinPrivateLobbyModal;
    this.joinModal instanceof JoinPrivateLobbyModal;
    const joinPrivateLobbyButton = document.getElementById(
      "join-private-lobby-button",
    );
    if (joinPrivateLobbyButton === null)
      throw new Error("Missing join-private-lobby-button");
    joinPrivateLobbyButton.addEventListener("click", () => {
      if (this.usernameInput?.isValid()) {
        this.joinModal.open();
      }
    });

    if (this.userSettings.darkMode()) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // Attempt to join lobby
    this.handleHash();

    const onHashUpdate = () => {
      // Reset the UI to its initial state
      this.joinModal.close();
      if (this.gameStop !== null) {
        this.handleLeaveLobby();
      }

      const modal = document.querySelector("news-modal") as NewsModal;
      if (modal)
        //modal.open();

        // Attempt to join lobby
        this.handleHash();
    };

    // Handle browser navigation & manual hash edits
    window.addEventListener("popstate", onHashUpdate);
    window.addEventListener("hashchange", onHashUpdate);

    function updateSliderProgress(slider: HTMLInputElement) {
      const percent =
        ((Number(slider.value) - Number(slider.min)) /
          (Number(slider.max) - Number(slider.min))) *
        100;
      slider.style.setProperty("--progress", `${percent}%`);
    }

    document
      .querySelectorAll<HTMLInputElement>(
        "#bots-count, #private-lobby-bots-count",
      )
      .forEach((slider) => {
        updateSliderProgress(slider);
        slider.addEventListener("input", () => updateSliderProgress(slider));
      });
    if (newsModal) {
      //newsModal.open();
    }
  }

  private setupMenuMusic(): void {
    try {
      // Avoid creating multiple elements
      if (!this.menuMusic) {
        const audio = new Audio("/music/berlin-beat-362757.mp3");
        audio.loop = true;
        audio.preload = "auto";
        audio.volume = 0.35; // pleasant background level
        // Respect persisted mute state immediately
        audio.muted = this.userSettings.soundMuted();
        this.menuMusic = audio;

        // Try to start on first user interaction to comply with autoplay policies
        const tryPlay = () => {
          // Only play if we're actually on the main menu
          if (this.isOnMainMenu && !this.userSettings.soundMuted()) {
            this.menuMusic?.play().catch(() => {
              // Ignore autoplay rejections; another interaction will retry
            });
          }
        };
        // One-time listeners for common interactions on the menu
        window.addEventListener("pointerdown", tryPlay, { once: true });
        window.addEventListener("keydown", tryPlay, { once: true });

        // Also attempt a delayed play in case policies allow without gesture
        setTimeout(() => {
          if (this.isOnMainMenu && !this.userSettings.soundMuted()) {
            this.menuMusic?.play().catch(() => {});
          }
        }, 500);
      }

      // Ensure music plays when we're on the main menu initially
      if (this.isOnMainMenu && !this.userSettings.soundMuted()) {
        this.menuMusic?.play().catch(() => {
          // Will be retried on user gesture
        });
      }
    } catch (e) {
      console.warn("Failed to set up menu music", e);
    }
  }

  private handleHash() {
    const { hash } = window.location;
    if (hash.startsWith("#")) {
      const params = new URLSearchParams(hash.slice(1));
      const lobbyId = params.get("join");
      if (lobbyId && ID.safeParse(lobbyId).success) {
        this.joinModal.open(lobbyId);
        console.log(`joining lobby ${lobbyId}`);
      }
    }
  }

  private async handleJoinLobby(event: CustomEvent<JoinLobbyEvent>) {
    const lobby = event.detail;
    console.log(`joining lobby ${lobby.gameID}`);
    if (this.gameStop !== null) {
      console.log("joining lobby, stopping existing game");
      this.gameStop();
    }
    const config = await getServerConfigFromClient();

    this.gameStop = joinLobby(
      this.eventBus,
      {
        gameID: lobby.gameID,
        serverConfig: config,
        flag:
          this.flagInput === null || this.flagInput.getCurrentFlag() === "xx"
            ? ""
            : this.flagInput.getCurrentFlag(),
        playerName: this.usernameInput?.getCurrentUsername() ?? "",
        token: getPlayToken(),
        clientID: lobby.clientID,
        gameStartInfo: lobby.gameStartInfo ?? lobby.gameRecord?.info,
        gameRecord: lobby.gameRecord,
      },
      () => {
        console.log("Closing modals");
        // We're leaving the main menu and entering the game
        this.isOnMainMenu = false;
        // Pause menu music when the game is loading/starting
        this.menuMusic?.pause();
        document.getElementById("settings-button")?.classList.add("hidden");
        document
          .getElementById("username-validation-error")
          ?.classList.add("hidden");
        document
          .getElementById("quick-toggle-container")
          ?.classList.add("hidden");
        [
          "single-player-modal",
          "host-lobby-modal",
          "join-private-lobby-modal",
          "game-starting-modal",
          "top-bar",
          "help-modal",
          "user-setting",
          "language-modal",
          "news-modal",
        ].forEach((tag) => {
          const modal = document.querySelector(tag) as HTMLElement & {
            close?: () => void;
            isModalOpen?: boolean;
          };
          if (modal?.close) {
            modal.close();
          } else if ("isModalOpen" in modal) {
            modal.isModalOpen = false;
          }
        });
        this.publicLobby.stop();
        document.querySelectorAll(".ad").forEach((ad) => {
          (ad as HTMLElement).style.display = "none";
        });

        // show when the game loads
        const startingModal = document.querySelector(
          "game-starting-modal",
        ) as GameStartingModal;
        startingModal instanceof GameStartingModal;
        startingModal.show();
      },
      () => {
        this.joinModal.close();
        this.publicLobby.stop();
        document.querySelectorAll(".ad").forEach((ad) => {
          (ad as HTMLElement).style.display = "none";
        });

        if (lobby.gameStartInfo?.config.gameType !== GameType.Singleplayer) {
          history.pushState(null, "", `#join=${lobby.gameID}`);
        }
      },
    );
  }

  private async handleLeaveLobby(/* event: CustomEvent */) {
    if (this.gameStop === null) {
      return;
    }
    console.log("leaving lobby, cancelling game");
    this.gameStop();
    this.gameStop = null;
    this.publicLobby.leaveLobby();
    // We're back on the main menu; allow music again
    this.isOnMainMenu = true;
    document
      .getElementById("quick-toggle-container")
      ?.classList.remove("hidden");
    // Resume menu music when returning to main menu
    this.menuMusic?.play().catch(() => {
      // If autoplay blocks this, attach a one-off listener to start on next interaction
      const resumeOnGesture = () => {
        if (this.isOnMainMenu) {
          this.menuMusic?.play().catch(() => {});
        }
      };
      window.addEventListener("pointerdown", resumeOnGesture, { once: true });
      window.addEventListener("keydown", resumeOnGesture, { once: true });
    });
  }

  private handleKickPlayer(event: CustomEvent) {
    const { target } = event.detail;

    // Forward to eventBus if available
    if (this.eventBus) {
      this.eventBus.emit(new SendKickPlayerIntentEvent(target));
    }
  }
}

// Initialize the client when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new Client().initialize();
});

// WARNING: DO NOT EXPOSE THIS ID
function getPlayToken(): string {
  const result = isLoggedIn();
  if (result !== false) return result.token;
  return getPersistentIDFromCookie();
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentID(): string {
  const result = isLoggedIn();
  if (result !== false) return result.claims.sub;
  return getPersistentIDFromCookie();
}

// WARNING: DO NOT EXPOSE THIS ID
function getPersistentIDFromCookie(): string {
  const COOKIE_NAME = "player_persistent_id";

  // Try to get existing cookie
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.split("=").map((c) => c.trim());
    if (cookieName === COOKIE_NAME) {
      return cookieValue;
    }
  }

  // If no cookie exists, create new ID and set cookie
  const newID = generateCryptoRandomUUID();
  document.cookie = [
    `${COOKIE_NAME}=${newID}`,
    `max-age=${5 * 365 * 24 * 60 * 60}`, // 5 years
    "path=/",
    "SameSite=Strict",
    "Secure",
  ].join(";");

  return newID;
}
