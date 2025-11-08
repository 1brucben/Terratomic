import {
  PastelUiPalette,
  PastelUiPaletteDark,
} from "../../core/configuration/ui/PastelUiPalette";
import { UiPalette } from "../../core/configuration/ui/UiPalette";
import { UserSettings } from "../../core/game/UserSettings";

const STYLE_ID = "ui-palette-vars";

let activePalette: UiPalette | null = null;

export function getUiPalette(userSettings: UserSettings): UiPalette {
  return userSettings.darkMode()
    ? new PastelUiPaletteDark()
    : new PastelUiPalette();
}

export function currentUiPalette(): UiPalette {
  if (!activePalette) {
    throw new Error(
      "UI palette has not been applied yet. Call applyUiPalette first.",
    );
  }
  return activePalette;
}

export function applyUiPalette(palette: UiPalette): void {
  activePalette = palette;
  const style = ensureStyleElement();
  style.textContent = buildCssForPalette(palette);
}

function ensureStyleElement(): HTMLStyleElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  return style;
}

function buildCssForPalette(palette: UiPalette): string {
  return `
:root {
  --ui-primary: ${palette.buttons.primary};
  --ui-primary-hover: ${palette.buttons.primaryHover};
  --ui-primary-disabled: ${palette.buttons.primaryDisabled};
  --ui-secondary: ${palette.buttons.secondary};
  --ui-secondary-hover: ${palette.buttons.secondaryHover};
  --ui-button-text: ${palette.buttons.textOnPrimary};

  --ui-alert: ${palette.alerts.primary};
  --ui-alert-hover: ${palette.alerts.hover};
  --ui-alert-text: ${palette.alerts.text};

  --ui-text-default: ${palette.text.default};
  --ui-text-light: ${palette.text.light};
  --ui-text-accent: ${palette.text.accent};
  --ui-text-muted: ${palette.text.muted};

  --ui-panel-shell-top: ${palette.panels.shellTop};
  --ui-panel-shell-bottom: ${palette.panels.shellBottom};
  --ui-panel-border: ${palette.panels.border};
  --ui-panel-shadow: ${palette.panels.shadow};

  --ui-slider-track: ${palette.sliders.track};
  --ui-slider-attack: ${palette.sliders.attackFill};
  --ui-slider-troop: ${palette.sliders.troopFill};
  --ui-slider-thumb: ${palette.sliders.thumb};

  --ui-modal-overlay: ${palette.modals.overlay};
  --ui-modal-content: ${palette.modals.content};
  --ui-modal-header: ${palette.modals.header};

  --ui-table-row-bg: ${palette.tables.rowBackground};
  --ui-table-row-hover: ${palette.tables.rowHover};

  --ui-replay-tab: ${palette.replay.tabBackground};
  --ui-replay-tab-active: ${palette.replay.tabActiveBackground};

  --ui-lobby-filter: ${palette.misc.lobbyBackgroundFilter};

  --ui-surface-muted: ${palette.neutrals.muted};
  --ui-surface-dark: ${palette.neutrals.dark};
  --ui-border-muted: ${palette.neutrals.border};
  --ui-overlay: ${palette.neutrals.overlay};

  --ui-success: ${palette.status.success};
  --ui-warning: ${palette.status.warning};
  --ui-info: ${palette.status.info};

  /* Temporary mirrors for legacy tokens (Phase 2 will remove) */
  --primaryColor: var(--ui-primary);
  --primaryColorHover: var(--ui-primary-hover);
  --primaryColorDisabled: var(--ui-primary-disabled);
  --secondaryColor: var(--ui-secondary);
  --secondaryColorHover: var(--ui-secondary-hover);
  --alertColor: var(--ui-alert);
  --alertColorHover: var(--ui-alert-hover);
  --accentTextColor: var(--ui-text-accent);
  --fontColorLight: var(--ui-text-light);
}
`;
}
