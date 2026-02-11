/**
 * Mobile device detection and platform utilities
 * Used to determine device type, orientation, and safe area insets
 */

export interface DeviceInfo {
  isTablet: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  screenSize: "small" | "medium" | "large";
}

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export class MobileDetector {
  private static readonly SAFE_AREA_STYLE_ID = "mobile-safe-area-insets";

  private static isTabletUA(userAgent: string): boolean {
    return /iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent);
  }

  private static isIpadDesktopMode(userAgent: string): boolean {
    const isMacLikeUA = /Macintosh|Mac OS X/i.test(userAgent);
    return isMacLikeUA && navigator.maxTouchPoints > 1;
  }

  /**
   * Detects if the current device is a mobile device
   * Checks for touch capability, screen size, and user agent
   * Prioritizes screen size and user agent over touch to avoid false positives on desktop touchscreens
   */
  static isMobile(): boolean {
    const smallScreen = window.innerWidth < 768;
    const shortestSide = Math.min(window.innerWidth, window.innerHeight);
    const longestSide = Math.max(window.innerWidth, window.innerHeight);
    const tabletViewport = shortestSide <= 1024 && longestSide <= 1400;
    const uaDataMobile =
      "userAgentData" in navigator &&
      Boolean(
        (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
          .userAgentData?.mobile,
      );
    const userAgent = navigator.userAgent;
    const mobileUA =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        userAgent,
      );
    const tabletUA =
      this.isTabletUA(userAgent) || this.isIpadDesktopMode(userAgent);
    const touchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;

    // Mobile/tablet UA always enables mobile UI (supports device emulation)
    if (uaDataMobile || mobileUA || tabletUA) {
      return true;
    }

    // Fallback for UA edge-cases (tablet emulators / desktop-mode iPad):
    // require touch + coarse pointer + phone/tablet viewport bounds.
    const touchProfile = touchDevice && coarsePointer;
    return touchProfile && (smallScreen || tabletViewport);
  }

  /**
   * Gets detailed device information
   */
  static getDeviceInfo(): DeviceInfo {
    const ua = navigator.userAgent;
    const isTablet = this.isTabletUA(ua) || this.isIpadDesktopMode(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const width = window.innerWidth;

    let screenSize: "small" | "medium" | "large";
    if (width < 375) {
      screenSize = "small";
    } else if (width < 768) {
      screenSize = "medium";
    } else {
      screenSize = "large";
    }

    return {
      isTablet,
      isIOS,
      isAndroid,
      screenSize,
    };
  }

  /**
   * Gets current device orientation
   */
  static getOrientation(): "portrait" | "landscape" {
    return window.innerHeight > window.innerWidth ? "portrait" : "landscape";
  }

  /**
   * Gets safe area insets for notched devices (iPhone X+, etc.)
   */
  static getSafeAreaInsets(): SafeAreaInsets {
    this.ensureSafeAreaStyle();
    const style = getComputedStyle(document.documentElement);

    const parseInset = (property: string): number => {
      const value = style.getPropertyValue(property);
      return Number.parseFloat(value) || 0;
    };

    return {
      top: parseInset("--mobile-safe-area-top"),
      bottom: parseInset("--mobile-safe-area-bottom"),
      left: parseInset("--mobile-safe-area-left"),
      right: parseInset("--mobile-safe-area-right"),
    };
  }

  private static ensureSafeAreaStyle(): void {
    if (document.getElementById(this.SAFE_AREA_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = this.SAFE_AREA_STYLE_ID;
    style.textContent = `:root {
      --mobile-safe-area-top: env(safe-area-inset-top, 0px);
      --mobile-safe-area-bottom: env(safe-area-inset-bottom, 0px);
      --mobile-safe-area-left: env(safe-area-inset-left, 0px);
      --mobile-safe-area-right: env(safe-area-inset-right, 0px);
    }`;
    document.head.appendChild(style);
  }
}
