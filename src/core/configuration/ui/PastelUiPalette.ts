import { colord } from "colord";
import { UiPalette } from "./UiPalette";

type ColorMapper = (input: string) => string;
type FilterMapper = (input: string) => string;

const BASE_COLORS = {
  buttons: {
    primary: "#183152",
    primaryHover: "#1d3a60",
    primaryDisabled: "#0f172a",
    secondary: "#27476e",
    secondaryHover: "#32629b",
    textOnPrimary: "#ffffff",
  },
  alerts: {
    primary: "#b91c1c",
    hover: "#dc2626",
    text: "#ffffff",
  },
  text: {
    default: "#ffffff",
    light: "#e5e7eb",
    accent: "#dbe7ff",
    muted: "#94a3b8",
  },
  panels: {
    shellTop: "rgba(11,18,32,0.92)",
    shellBottom: "rgba(16,27,51,0.92)",
    border: "#0e1a33",
    shadow: "inset 0 0 18px rgba(2, 8, 20, 0.8), 0 2px 6px rgba(0, 0, 0, 0.5)",
  },
  sliders: {
    track: "rgba(24,39,66,0.85)",
    attackFill: "rgba(33,56,112,0.8)",
    troopFill: "rgba(56,162,179,0.68)",
    thumb: "#0b1220",
  },
  modals: {
    overlay: "rgba(29, 58, 96, 0.6)",
    content: "rgba(24, 49, 82,0.51)",
    header: "#041a36a1",
  },
  tables: {
    rowBackground: "rgba(24,39,66,0.3)",
    rowHover: "rgba(24,39,66,0.5)",
  },
  replay: {
    tabBackground: "#1a2e4a",
    tabActiveBackground: "#27476e",
  },
  misc: {
    lobbyBackgroundFilter: "brightness(0.8) saturate(1.3)",
  },
  neutrals: {
    light: "#f5f5f5",
    muted: "#cccccc",
    dark: "#1a1a1a",
    border: "#444444",
    overlay: "rgba(0, 0, 0, 0.6)",
  },
  status: {
    success: "#86efac",
    warning: "#fbbf24",
    info: "#60a5fa",
  },
} as const;

function buildPalette(
  mapColor: ColorMapper,
  mapFilter: FilterMapper,
): UiPalette {
  return {
    buttons: {
      primary: mapColor(BASE_COLORS.buttons.primary),
      primaryHover: mapColor(BASE_COLORS.buttons.primaryHover),
      primaryDisabled: mapColor(BASE_COLORS.buttons.primaryDisabled),
      secondary: mapColor(BASE_COLORS.buttons.secondary),
      secondaryHover: mapColor(BASE_COLORS.buttons.secondaryHover),
      textOnPrimary: mapColor(BASE_COLORS.buttons.textOnPrimary),
    },
    alerts: {
      primary: mapColor(BASE_COLORS.alerts.primary),
      hover: mapColor(BASE_COLORS.alerts.hover),
      text: mapColor(BASE_COLORS.alerts.text),
    },
    text: {
      default: mapColor(BASE_COLORS.text.default),
      light: mapColor(BASE_COLORS.text.light),
      accent: mapColor(BASE_COLORS.text.accent),
      muted: mapColor(BASE_COLORS.text.muted),
    },
    panels: {
      shellTop: mapColor(BASE_COLORS.panels.shellTop),
      shellBottom: mapColor(BASE_COLORS.panels.shellBottom),
      border: mapColor(BASE_COLORS.panels.border),
      shadow: BASE_COLORS.panels.shadow,
    },
    sliders: {
      track: mapColor(BASE_COLORS.sliders.track),
      attackFill: mapColor(BASE_COLORS.sliders.attackFill),
      troopFill: mapColor(BASE_COLORS.sliders.troopFill),
      thumb: mapColor(BASE_COLORS.sliders.thumb),
    },
    modals: {
      overlay: mapColor(BASE_COLORS.modals.overlay),
      content: mapColor(BASE_COLORS.modals.content),
      header: mapColor(BASE_COLORS.modals.header),
    },
    tables: {
      rowBackground: mapColor(BASE_COLORS.tables.rowBackground),
      rowHover: mapColor(BASE_COLORS.tables.rowHover),
    },
    replay: {
      tabBackground: mapColor(BASE_COLORS.replay.tabBackground),
      tabActiveBackground: mapColor(BASE_COLORS.replay.tabActiveBackground),
    },
    misc: {
      lobbyBackgroundFilter: mapFilter(BASE_COLORS.misc.lobbyBackgroundFilter),
    },
    neutrals: {
      light: mapColor(BASE_COLORS.neutrals.light),
      muted: mapColor(BASE_COLORS.neutrals.muted),
      dark: mapColor(BASE_COLORS.neutrals.dark),
      border: mapColor(BASE_COLORS.neutrals.border),
      overlay: mapColor(BASE_COLORS.neutrals.overlay),
    },
    status: {
      success: mapColor(BASE_COLORS.status.success),
      warning: mapColor(BASE_COLORS.status.warning),
      info: mapColor(BASE_COLORS.status.info),
    },
  };
}

function identity<T>(value: T): T {
  return value;
}

function lightenColor(input: string, amount = 0.08): string {
  const parsed = colord(input);
  if (!parsed.isValid()) {
    return input;
  }
  const lightened = parsed.lighten(amount);
  const trimmed = input.trim();
  if (trimmed.startsWith("#")) {
    return lightened.toHex();
  }
  return lightened.toRgbString();
}

function lightenFilter(_: string): string {
  // Slightly softer blur with brighter, less saturated background for light mode.
  return "brightness(1) saturate(1) contrast(1)";
}

const DARK_PALETTE = buildPalette(identity, identity);
const LIGHT_PALETTE = buildPalette(lightenColor, lightenFilter);

export class PastelUiPaletteDark implements UiPalette {
  public readonly buttons = DARK_PALETTE.buttons;
  public readonly alerts = DARK_PALETTE.alerts;
  public readonly text = DARK_PALETTE.text;
  public readonly panels = DARK_PALETTE.panels;
  public readonly sliders = DARK_PALETTE.sliders;
  public readonly modals = DARK_PALETTE.modals;
  public readonly tables = DARK_PALETTE.tables;
  public readonly replay = DARK_PALETTE.replay;
  public readonly misc = DARK_PALETTE.misc;
  public readonly neutrals = DARK_PALETTE.neutrals;
  public readonly status = DARK_PALETTE.status;
}

export class PastelUiPalette implements UiPalette {
  public readonly buttons = LIGHT_PALETTE.buttons;
  public readonly alerts = LIGHT_PALETTE.alerts;
  public readonly text = LIGHT_PALETTE.text;
  public readonly panels = LIGHT_PALETTE.panels;
  public readonly sliders = LIGHT_PALETTE.sliders;
  public readonly modals = LIGHT_PALETTE.modals;
  public readonly tables = LIGHT_PALETTE.tables;
  public readonly replay = LIGHT_PALETTE.replay;
  public readonly misc = LIGHT_PALETTE.misc;
  public readonly neutrals = LIGHT_PALETTE.neutrals;
  public readonly status = LIGHT_PALETTE.status;
}
