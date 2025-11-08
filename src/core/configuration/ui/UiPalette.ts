export interface UiPalette {
  buttons: {
    primary: string;
    primaryHover: string;
    primaryDisabled: string;
    secondary: string;
    secondaryHover: string;
    textOnPrimary: string;
  };
  alerts: {
    primary: string;
    hover: string;
    text: string;
  };
  text: {
    default: string;
    light: string;
    accent: string;
    muted: string;
  };
  panels: {
    shellTop: string;
    shellBottom: string;
    border: string;
    shadow: string;
  };
  sliders: {
    track: string;
    attackFill: string;
    troopFill: string;
    thumb: string;
  };
  modals: {
    overlay: string;
    content: string;
    header: string;
  };
  tables: {
    rowBackground: string;
    rowHover: string;
  };
  replay: {
    tabBackground: string;
    tabActiveBackground: string;
  };
  neutrals: {
    light: string;
    muted: string;
    dark: string;
    border: string;
    overlay: string;
  };
  status: {
    success: string;
    warning: string;
    info: string;
  };
  misc: {
    lobbyBackgroundFilter: string;
  };
}
