export type MobileViewportSizeClass = "compact" | "regular" | "large";
export type MobileViewportOrientation = "portrait" | "landscape";

export interface MobileViewportProfile {
  width: number;
  height: number;
  shortestSide: number;
  longestSide: number;
  orientation: MobileViewportOrientation;
  sizeClass: MobileViewportSizeClass;
  isReferenceBaseline: boolean;
}

export type MobileResponsiveTokens = Record<string, string>;

export function getMobileViewportProfile(
  width: number,
  height: number,
): MobileViewportProfile {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const shortestSide = Math.min(safeWidth, safeHeight);
  const longestSide = Math.max(safeWidth, safeHeight);

  const orientation: MobileViewportOrientation =
    safeWidth > safeHeight ? "landscape" : "portrait";

  const sizeClass: MobileViewportSizeClass =
    shortestSide <= 360 ? "compact" : shortestSide <= 430 ? "regular" : "large";

  const isReferenceBaseline = shortestSide === 430 && longestSide === 932;

  return {
    width: safeWidth,
    height: safeHeight,
    shortestSide,
    longestSide,
    orientation,
    sizeClass,
    isReferenceBaseline,
  };
}

export function getMobileResponsiveTokens(
  profile: MobileViewportProfile,
): MobileResponsiveTokens {
  const baselineTokens: MobileResponsiveTokens = {
    "--m-panel-top-offset": "0px",
    "--m-panel-safe-top-padding": "env(safe-area-inset-top, 0px)",
    "--m-grid-gap": "8px",
    "--m-grid-max-h": "60vh",
    "--m-grid-padding": "16px",
    "--m-grid-padding-bottom": "16px",
    "--m-grid-radius": "20px",
    "--m-grid-column-min": "65px",
    "--m-grid-tile-min-h": "62px",
    "--m-grid-tile-min-h-multi": "72px",
    "--m-grid-tile-padding": "7px",
    "--m-grid-tile-gap": "3px",
    "--m-grid-icon-size": "28px",
    "--m-grid-icon-size-multi": "36px",
    "--m-grid-font-size": "11px",
    "--m-grid-font-size-multi": "13px",
    "--m-grid-cost-top": "5px",
    "--m-grid-cost-right": "5px",
    "--m-grid-cost-max-width-inset": "10px",
    "--m-grid-cost-min-h": "16px",
    "--m-grid-cost-padding-x": "5px",
    "--m-grid-cost-font-size": "9px",
    "--m-grid-cost-gap": "2px",
    "--m-grid-cost-multi-min-h": "18px",
    "--m-grid-cost-multi-padding-x": "6px",
    "--m-grid-cost-multi-font-size": "10px",
  };

  if (profile.orientation === "landscape" && profile.sizeClass === "compact") {
    return {
      ...baselineTokens,
      "--m-grid-gap": "5px",
      "--m-grid-max-h": "30dvh",
      "--m-grid-padding": "6px",
      "--m-grid-padding-bottom": "6px",
      "--m-grid-radius": "12px",
      "--m-grid-column-min": "46px",
      "--m-grid-tile-min-h": "42px",
      "--m-grid-tile-min-h-multi": "47px",
      "--m-grid-tile-padding": "3px",
      "--m-grid-tile-gap": "1px",
      "--m-grid-icon-size": "17px",
      "--m-grid-icon-size-multi": "20px",
      "--m-grid-font-size": "9px",
      "--m-grid-font-size-multi": "10px",
      "--m-grid-cost-top": "2px",
      "--m-grid-cost-right": "2px",
      "--m-grid-cost-max-width-inset": "5px",
      "--m-grid-cost-min-h": "12px",
      "--m-grid-cost-padding-x": "3px",
      "--m-grid-cost-font-size": "7px",
      "--m-grid-cost-gap": "1px",
      "--m-grid-cost-multi-min-h": "13px",
      "--m-grid-cost-multi-padding-x": "3px",
      "--m-grid-cost-multi-font-size": "7px",
    };
  }

  if (profile.orientation === "landscape" && profile.sizeClass === "regular") {
    return {
      ...baselineTokens,
      "--m-grid-gap": "5px",
      "--m-grid-max-h": "36dvh",
      "--m-grid-padding": "9px",
      "--m-grid-padding-bottom": "9px",
      "--m-grid-radius": "14px",
      "--m-grid-column-min": "47px",
      "--m-grid-tile-min-h": "45px",
      "--m-grid-tile-min-h-multi": "49px",
      "--m-grid-tile-padding": "4px",
      "--m-grid-tile-gap": "1px",
      "--m-grid-icon-size": "18px",
      "--m-grid-icon-size-multi": "21px",
      "--m-grid-font-size": "9px",
      "--m-grid-font-size-multi": "10px",
      "--m-grid-cost-top": "3px",
      "--m-grid-cost-right": "3px",
      "--m-grid-cost-max-width-inset": "5px",
      "--m-grid-cost-min-h": "13px",
      "--m-grid-cost-padding-x": "4px",
      "--m-grid-cost-font-size": "8px",
      "--m-grid-cost-gap": "1px",
      "--m-grid-cost-multi-min-h": "14px",
      "--m-grid-cost-multi-padding-x": "4px",
      "--m-grid-cost-multi-font-size": "8px",
    };
  }

  if (profile.orientation === "portrait" && profile.sizeClass === "compact") {
    return {
      ...baselineTokens,
      "--m-grid-gap": "6px",
      "--m-grid-max-h": "50dvh",
      "--m-grid-padding": "10px",
      "--m-grid-padding-bottom": "10px",
      "--m-grid-radius": "17px",
      "--m-grid-column-min": "57px",
      "--m-grid-tile-min-h": "54px",
      "--m-grid-tile-min-h-multi": "60px",
      "--m-grid-tile-padding": "6px",
      "--m-grid-tile-gap": "1px",
      "--m-grid-icon-size": "22px",
      "--m-grid-icon-size-multi": "26px",
      "--m-grid-font-size": "11px",
      "--m-grid-font-size-multi": "12px",
      "--m-grid-cost-top": "4px",
      "--m-grid-cost-right": "4px",
      "--m-grid-cost-max-width-inset": "8px",
      "--m-grid-cost-min-h": "14px",
      "--m-grid-cost-padding-x": "4px",
      "--m-grid-cost-font-size": "8px",
      "--m-grid-cost-gap": "1px",
      "--m-grid-cost-multi-min-h": "15px",
      "--m-grid-cost-multi-padding-x": "4px",
      "--m-grid-cost-multi-font-size": "8px",
    };
  }

  if (profile.orientation === "portrait" && profile.sizeClass === "regular") {
    return {
      ...baselineTokens,
      "--m-grid-gap": "6px",
      "--m-grid-max-h": "52dvh",
      "--m-grid-padding": "12px",
      "--m-grid-padding-bottom": "12px",
      "--m-grid-radius": "17px",
      "--m-grid-column-min": "58px",
      "--m-grid-tile-min-h": "56px",
      "--m-grid-tile-min-h-multi": "62px",
      "--m-grid-tile-padding": "6px",
      "--m-grid-tile-gap": "2px",
      "--m-grid-icon-size": "23px",
      "--m-grid-icon-size-multi": "28px",
      "--m-grid-font-size": "10px",
      "--m-grid-font-size-multi": "11.5px",
      "--m-grid-cost-top": "4px",
      "--m-grid-cost-right": "4px",
      "--m-grid-cost-max-width-inset": "8px",
      "--m-grid-cost-min-h": "15px",
      "--m-grid-cost-padding-x": "5px",
      "--m-grid-cost-font-size": "8.5px",
      "--m-grid-cost-gap": "1px",
      "--m-grid-cost-multi-min-h": "16px",
      "--m-grid-cost-multi-padding-x": "5px",
      "--m-grid-cost-multi-font-size": "9px",
      "--m-panel-top-offset": profile.isReferenceBaseline
        ? "calc(44px + env(safe-area-inset-top, 0px))"
        : "0px",
      "--m-panel-safe-top-padding": profile.isReferenceBaseline
        ? "0px"
        : "env(safe-area-inset-top, 0px)",
    };
  }

  if (profile.orientation === "landscape" && profile.sizeClass === "large") {
    return {
      ...baselineTokens,
      "--m-panel-top-offset": "calc(44px + env(safe-area-inset-top, 0px))",
      "--m-panel-safe-top-padding": "0px",
      "--m-grid-gap": "9px",
      "--m-grid-max-h": "50dvh",
      "--m-grid-padding": "18px",
      "--m-grid-padding-bottom": "18px",
      "--m-grid-radius": "22px",
      "--m-grid-column-min": "70px",
      "--m-grid-tile-min-h": "68px",
      "--m-grid-tile-min-h-multi": "78px",
      "--m-grid-tile-padding": "8px",
      "--m-grid-tile-gap": "4px",
      "--m-grid-icon-size": "31px",
      "--m-grid-icon-size-multi": "40px",
      "--m-grid-font-size": "12px",
      "--m-grid-font-size-multi": "14px",
    };
  }

  if (profile.orientation === "portrait" && profile.sizeClass === "large") {
    return {
      ...baselineTokens,
      "--m-panel-top-offset": "calc(44px + env(safe-area-inset-top, 0px))",
      "--m-panel-safe-top-padding": "0px",
      "--m-grid-gap": "9px",
      "--m-grid-max-h": "58dvh",
      "--m-grid-padding": "18px",
      "--m-grid-padding-bottom": "18px",
      "--m-grid-radius": "22px",
      "--m-grid-column-min": "70px",
      "--m-grid-tile-min-h": "68px",
      "--m-grid-tile-min-h-multi": "78px",
      "--m-grid-tile-padding": "8px",
      "--m-grid-tile-gap": "4px",
      "--m-grid-icon-size": "31px",
      "--m-grid-icon-size-multi": "40px",
      "--m-grid-font-size": "12px",
      "--m-grid-font-size-multi": "14px",
    };
  }

  return baselineTokens;
}
