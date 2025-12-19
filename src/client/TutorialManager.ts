import { UserSettings } from "../core/game/UserSettings";
import type { TutorialTipPayload } from "./graphics/layers/TutorialToast";
import { translateText } from "./Utils";

/**
 * TutorialManager handles the logic for when and how tutorial tips are shown.
 * It tracks which tips have been seen, manages tip timing, and emits events
 * for the TutorialToast component to display.
 */
export class TutorialManager {
  private settings = new UserSettings();
  private shownThisSession = new Set<string>();
  private lastTipTime = 0;
  private readonly MIN_TIP_INTERVAL_MS = 3000; // Minimum 3 seconds between tips

  constructor() {
    // Initialize tutorial system
    this.ensureTutorialStateInitialized();
  }

  /**
   * Show a tutorial tip by ID. The tip will only be shown if:
   * - Tutorials are enabled
   * - The tip hasn't been seen before
   * - Enough time has passed since the last tip
   * - The tip hasn't been shown this session
   */
  showTip(
    tipId: string,
    force: boolean = false,
    highlightTarget?: string,
  ): void {
    // Check if tutorials are enabled
    if (!this.settings.tutorialEnabled() && !force) {
      return;
    }

    // Check if already shown this session (unless forced)
    if (!force && this.shownThisSession.has(tipId)) {
      return;
    }

    // Prevent showing same tip multiple times in one session
    if (this.shownThisSession.has(tipId)) {
      return;
    }

    // Rate limit tips to avoid overwhelming the player
    const now = Date.now();
    if (now - this.lastTipTime < this.MIN_TIP_INTERVAL_MS && !force) {
      // Queue for later if not forced
      setTimeout(() => this.showTip(tipId, false), this.MIN_TIP_INTERVAL_MS);
      return;
    }

    // Get tip content from translations
    const tipKey = `tutorial.${tipId}`;
    const titleKey = `${tipKey}.title`;
    const descKey = `${tipKey}.description`;

    const title = translateText(titleKey);
    const description = translateText(descKey);

    // Don't show if translation is missing
    if (title === titleKey || description === descKey) {
      console.warn(`Tutorial tip "${tipId}" not found in translations`);
      return;
    }

    // Create and dispatch the tip
    const payload: TutorialTipPayload = {
      id: tipId,
      title,
      description,
      highlightTarget,
    };

    window.dispatchEvent(
      new CustomEvent("show-tutorial-tip", { detail: payload }),
    );

    // Update tracking
    this.shownThisSession.add(tipId);
    this.lastTipTime = now;
  }

  /**
   * Check if a specific tip has been seen
   */
  hasSeen(tipId: string): boolean {
    // Only consider current session for seen-state
    return this.shownThisSession.has(tipId);
  }

  /**
   * Mark a tip as seen without showing it
   */
  markSeen(tipId: string): void {
    // Mark as seen for this session only
    this.shownThisSession.add(tipId);
  }

  /**
   * Reset all tutorial progress (useful for testing or new player experience)
   */
  resetAll(): void {
    this.shownThisSession.clear();
  }

  /**
   * Check if tutorials are enabled
   */
  isEnabled(): boolean {
    return this.settings.tutorialEnabled();
  }

  /**
   * Enable or disable tutorials
   */
  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.settings.set("settings.tutorialEnabled", true);
    } else {
      this.settings.set("settings.tutorialEnabled", false);
    }
  }

  /**
   * Get list of all available tutorial tip IDs
   */
  getAllTipIds(): string[] {
    return [
      // Phase 1: Absolute Basics (0-2 minutes)
      "spawn_welcome",
      "spawn_location",
      "game_started",
      "first_expand",
      "worker_troop_slider",
      "attack_ratio_slider",
      "bot_encirclement",
      "economy_gold",

      // Phase 2: Economy Foundation (2-10 minutes)
      "command_center_intro",
      "first_city",
      "first_factory",
      "first_port",
      "trade_ships",

      // Phase 3: UI Awareness (5-15 minutes)
      "radial_menu",
      "event_display",
      "leaderboard",

      // Phase 4: Military Basics (10-20 minutes)
      "attack_basics",
      "attack_ratio_explained",
      "first_defense",
      "first_hospital",
      "population_growth",

      // Phase 5: Advanced Economy (15-25 minutes)
      "research_first",
      "research_priority",
      "investment_research",
      "investment_roads",
      "investment_productivity",

      // Phase 6: Advanced Military (20-35 minutes)
      "unit_submarine",
      "unit_transport",
      "first_airfield",
      "unit_bomber",
      "first_academy",
      "nukes_intro",
      "sam_defense",

      // Phase 7: Diplomacy (Event-triggered)
      "diplomacy_alliance",
      "diplomacy_betrayal_warning",
      "diplomacy_betrayal",
      "diplomacy_peace",

      // Phase 8: Late Game & Victory (30+ minutes)
      "strategy_mid",
      "strategy_late",
      "victory_condition",
      "victory_close",
    ];
  }

  /**
   * Get tutorial completion percentage
   */
  getCompletionPercentage(): number {
    const allTips = this.getAllTipIds();
    const seenCount = allTips.filter((id) => this.hasSeen(id)).length;
    return Math.round((seenCount / allTips.length) * 100);
  }

  private ensureTutorialStateInitialized(): void {
    // Ensure tutorial state exists in localStorage
    const state = this.settings.getTutorialState();
    if (!state) {
      this.settings.resetTutorialProgress();
    }
  }
}

// Export singleton instance
export const tutorialManager = new TutorialManager();
