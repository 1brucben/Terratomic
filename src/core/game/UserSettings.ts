interface TutorialState {
  enabled: boolean;
  seenTips: string[];
  version: number;
}

export class UserSettings {
  get(key: string, defaultValue: boolean): boolean {
    const value = localStorage.getItem(key);
    if (!value) return defaultValue;

    if (value === "true") return true;

    if (value === "false") return false;

    return defaultValue;
  }

  set(key: string, value: boolean) {
    localStorage.setItem(key, value ? "true" : "false");
  }

  getJSON<T>(key: string, defaultValue: T): T {
    const value = localStorage.getItem(key);
    if (!value) return defaultValue;
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  }

  setJSON<T>(key: string, value: T) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  emojis() {
    return this.get("settings.emojis", true);
  }

  alertFrame() {
    return this.get("settings.alertFrame", true);
  }

  anonymousNames() {
    return this.get("settings.anonymousNames", false);
  }

  lobbyIdVisibility() {
    return this.get("settings.lobbyIdVisibility", true);
  }

  fxLayer() {
    return this.get("settings.specialEffects", true);
  }

  darkMode() {
    return this.get("settings.darkMode", false);
  }

  // Global sound mute setting (true = muted)
  soundMuted() {
    return this.get("settings.soundMuted", false);
  }

  lobbyNotificationsEnabled() {
    return this.get("settings.lobbyNotifications", true);
  }

  leftClickOpensMenu() {
    return this.get("settings.leftClickOpensMenu", false);
  }

  focusLocked() {
    return false;
    // TODO: renable when performance issues are fixed.
    this.get("settings.focusLocked", true);
  }

  toggleLeftClickOpenMenu() {
    this.set("settings.leftClickOpensMenu", !this.leftClickOpensMenu());
  }

  toggleFocusLocked() {
    this.set("settings.focusLocked", !this.focusLocked());
  }

  toggleEmojis() {
    this.set("settings.emojis", !this.emojis());
  }

  toggleAlertFrame() {
    this.set("settings.alertFrame", !this.alertFrame());
  }

  toggleRandomName() {
    this.set("settings.anonymousNames", !this.anonymousNames());
  }

  toggleLobbyIdVisibility() {
    this.set("settings.lobbyIdVisibility", !this.lobbyIdVisibility());
  }

  toggleFxLayer() {
    this.set("settings.specialEffects", !this.fxLayer());
  }

  toggleDarkMode() {
    this.set("settings.darkMode", !this.darkMode());
    const enabled = this.darkMode();
    if (enabled) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    window.dispatchEvent(
      new CustomEvent("dark-mode-changed", {
        detail: { darkMode: enabled },
      }),
    );
  }

  toggleSoundMuted() {
    const next = !this.soundMuted();
    this.set("settings.soundMuted", next);
    // Broadcast to any listeners (menu music, UI buttons, etc.)
    window.dispatchEvent(
      new CustomEvent("sound-muted-changed", {
        detail: { muted: next },
      }),
    );
  }

  toggleLobbyNotifications() {
    this.set("settings.lobbyNotifications", !this.lobbyNotificationsEnabled());
  }

  showDevHud() {
    return this.get("settings.showDevHud", false);
  }

  toggleDevHud() {
    this.set("settings.showDevHud", !this.showDevHud());
  }

  // Tutorial system methods
  tutorialEnabled(): boolean {
    return this.get("settings.tutorialEnabled", true); // Enabled by default
  }

  toggleTutorialEnabled() {
    this.set("settings.tutorialEnabled", !this.tutorialEnabled());
  }

  getTutorialState(): TutorialState | null {
    return this.getJSON<TutorialState | null>("settings.tutorialState", null);
  }

  setTutorialState(state: TutorialState) {
    this.setJSON("settings.tutorialState", state);
  }

  isTutorialTipSeen(tipId: string): boolean {
    const state = this.getTutorialState();
    if (!state) return false;
    return state.seenTips.includes(tipId);
  }

  markTutorialTipSeen(tipId: string) {
    let state = this.getTutorialState();
    state ??= { enabled: true, seenTips: [], version: 1 };
    if (!state.seenTips.includes(tipId)) {
      state.seenTips.push(tipId);
      this.setTutorialState(state);
    }
  }

  resetTutorialProgress() {
    const state: TutorialState = {
      enabled: true,
      seenTips: [],
      version: 1,
    };
    this.setTutorialState(state);
  }
}
