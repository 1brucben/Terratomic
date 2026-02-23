/**
 * Haptic feedback utility for mobile devices
 * Provides consistent vibration patterns across mobile UI
 */

export enum HapticPattern {
  /** Short tap feedback (10ms) - for button taps, toggles */
  TAP = 10,
  /** Medium long-press feedback (50ms) - for long-press triggers */
  LONG_PRESS = 50,
  /** Strong error feedback (100ms) - for errors, invalid actions */
  ERROR = 100,
  /** Light success feedback (15ms) - for successful actions */
  SUCCESS = 15,
  /** Medium warning feedback (30ms) - for warnings, confirmations */
  WARNING = 30,
}

export class HapticFeedback {
  private static enabled: boolean = true;

  /**
   * Check if haptics are supported on this device
   */
  static isSupported(): boolean {
    return "vibrate" in navigator;
  }

  /**
   * Enable haptic feedback
   */
  static enable(): void {
    this.enabled = true;
  }

  /**
   * Disable haptic feedback
   */
  static disable(): void {
    this.enabled = false;
  }

  /**
   * Trigger haptic feedback with specified pattern
   */
  static trigger(pattern: HapticPattern): void {
    if (!this.enabled || !this.isSupported()) {
      return;
    }

    try {
      navigator.vibrate(pattern);
    } catch (error) {
      // Silently fail if vibration API throws
      console.debug("Haptic feedback failed:", error);
    }
  }

  /**
   * Trigger tap haptic (10ms) - for button taps
   */
  static tap(): void {
    this.trigger(HapticPattern.TAP);
  }

  /**
   * Trigger long-press haptic (50ms) - for long-press triggers
   */
  static longPress(): void {
    this.trigger(HapticPattern.LONG_PRESS);
  }

  /**
   * Trigger error haptic (100ms) - for errors, invalid actions
   */
  static error(): void {
    this.trigger(HapticPattern.ERROR);
  }

  /**
   * Trigger success haptic (15ms) - for successful actions
   */
  static success(): void {
    this.trigger(HapticPattern.SUCCESS);
  }

  /**
   * Trigger warning haptic (30ms) - for warnings
   */
  static warning(): void {
    this.trigger(HapticPattern.WARNING);
  }

  /**
   * Trigger custom haptic pattern
   */
  static custom(duration: number): void {
    if (!this.enabled || !this.isSupported()) {
      return;
    }

    try {
      navigator.vibrate(duration);
    } catch (error) {
      console.debug("Custom haptic feedback failed:", error);
    }
  }

  /**
   * Trigger complex vibration pattern (e.g., [100, 50, 100] for double pulse)
   */
  static pattern(pattern: number[]): void {
    if (!this.enabled || !this.isSupported()) {
      return;
    }

    try {
      navigator.vibrate(pattern);
    } catch (error) {
      console.debug("Pattern haptic feedback failed:", error);
    }
  }
}
