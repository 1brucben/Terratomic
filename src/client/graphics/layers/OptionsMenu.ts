import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent, RefreshGraphicsEvent } from "../../InputHandler";
import { PauseGameEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

const button = ({
  classes = "",
  onClick = () => {},
  title = "",
  children = "",
  style = "",
}) => html`
  <button
    class="flex items-center justify-center p-1 rounded cursor-pointer transition-colors duration-200 text-sm lg:text-xl ${classes}"
    style="background-color: var(--ui-secondary); color: var(--ui-button-text); border: 1px solid var(--ui-panel-border); ${style}"
    @click=${onClick}
    aria-label=${title}
    title=${title}
  >
    ${children}
  </button>
`;

const secondsToHms = (d: number): string => {
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = Math.floor((d % 3600) % 60);
  let time = d === 0 ? "-" : `${s}s`;
  if (m > 0) time = `${m}m` + time;
  if (h > 0) time = `${h}h` + time;
  return time;
};

@customElement("options-menu")
export class OptionsMenu extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  private userSettings: UserSettings = new UserSettings();

  @state()
  private showPauseButton: boolean = true;

  @state()
  private isPaused: boolean = false;

  @state()
  private timer: number = 0;

  @state()
  private showSettings: boolean = false;

  private isVisible = false;

  private hasWinner = false;

  @state()
  private _peaceTimerRemaining: string | null = null;

  @state()
  private alternateView: boolean = false;

  private onTerrainButtonClick() {
    this.alternateView = !this.alternateView;
    this.eventBus.emit(new AlternateViewEvent(this.alternateView));
    this.requestUpdate();
  }

  private onExitButtonClick() {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm(
        translateText("help_modal.exit_confirmation"),
      );
      if (!isConfirmed) return;
    }
    // redirect to the home page
    window.location.href = "/";
  }

  createRenderRoot() {
    return this;
  }

  private onSettingsButtonClick() {
    this.showSettings = !this.showSettings;
    this.requestUpdate();
  }

  private onPauseButtonClick() {
    this.isPaused = !this.isPaused;
    this.eventBus.emit(new PauseGameEvent(this.isPaused));
  }

  private onToggleEmojisButtonClick() {
    this.userSettings.toggleEmojis();
    this.requestUpdate();
  }

  private onToggleAlertFrameButtonClick() {
    this.userSettings.toggleAlertFrame();
    this.requestUpdate();
  }

  private onToggleSpecialEffectsButtonClick() {
    this.userSettings.toggleFxLayer();
    this.requestUpdate();
  }

  private onToggleDarkModeButtonClick() {
    this.userSettings.toggleDarkMode();
    this.requestUpdate();
    this.eventBus.emit(new RefreshGraphicsEvent());
  }

  private onToggleRandomNameModeButtonClick() {
    this.userSettings.toggleRandomName();
  }

  private onToggleFocusLockedButtonClick() {
    this.userSettings.toggleFocusLocked();
    this.requestUpdate();
  }

  private onToggleLeftClickOpensMenu() {
    this.userSettings.toggleLeftClickOpenMenu();
  }

  init() {
    console.log("init called from OptionsMenu");
    this.showPauseButton =
      this.game.config().gameConfig().gameType === GameType.Singleplayer ||
      this.game.config().isReplay();
    this.isVisible = true;
    this.requestUpdate();
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      this.hasWinner = this.hasWinner || updates[GameUpdateType.Win].length > 0;
    }
    if (this.game.inSpawnPhase()) {
      this.timer = 0;
    } else if (!this.hasWinner && this.game.ticks() % 10 === 0) {
      this.timer++;
    }

    const peaceTimerEndsAtTick = this.game.peaceTimerEndsAtTick();
    if (
      peaceTimerEndsAtTick !== null &&
      this.game.ticks() < peaceTimerEndsAtTick
    ) {
      const remainingTicks = peaceTimerEndsAtTick - this.game.ticks();
      const seconds = Math.ceil(remainingTicks / 10);
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      this._peaceTimerRemaining = `Peace Treaty: ${minutes}m ${remainingSeconds}s`;
    } else {
      this._peaceTimerRemaining = null;
    }

    this.isVisible = true;
    this.requestUpdate();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }
    return html`
      <div
        class="top-0 lg:top-4 right-0 lg:right-4 z-50 pointer-events-auto"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="submarine-panel p-1 lg:p-2"
          style="box-shadow: var(--ui-panel-shadow);"
        >
          <div class="flex items-stretch gap-1 lg:gap-2">
            ${button({
              classes: !this.showPauseButton ? "hidden" : "",
              onClick: this.onPauseButtonClick,
              title: this.isPaused ? "Resume game" : "Pause game",
              children: this.isPaused ? "▶️" : "⏸",
            })}
            <div
              class="w-[55px] h-8 lg:w-24 lg:h-10 flex items-center justify-center rounded text-sm lg:text-xl"
              style="background-color: var(--ui-slider-track); color: var(--ui-text-accent);"
            >
              ${secondsToHms(this.timer)}
            </div>
            ${button({
              onClick: this.onExitButtonClick,
              title: "Exit game",
              children: "❌",
            })}
            ${button({
              onClick: this.onSettingsButtonClick,
              title: "Settings",
              children: "⚙️",
            })}
          </div>     
          ${
            this._peaceTimerRemaining !== null
              ? html`
                  <div
                    class="flex items-center justify-center mt-1 rounded p-1"
                    style="background-color: var(--ui-slider-track); color: var(--ui-text-accent);"
                  >
                    <span
                      class="font-bold text-sm lg:text-base text-white whitespace-normal"
                      >${this._peaceTimerRemaining}</span
                    >
                  </div>
                `
              : ""
          }
        </div>
      </div>

        <div
          class="submarine-panel options-menu flex flex-col justify-around gap-y-3 mt-2 p-1 lg:p-2 ${!this.showSettings ? "hidden" : ""}"
          style="box-shadow: var(--ui-panel-shadow);"
        >
          ${button({
            onClick: this.onTerrainButtonClick,
            title: "Toggle Terrain",
            children: "🌲: " + (this.alternateView ? "On" : "Off"),
          })}
          ${button({
            onClick: this.onToggleDarkModeButtonClick,
            title: "Dark Mode",
            children: "🌙: " + (this.userSettings.darkMode() ? "On" : "Off"),
          })}
          ${button({
            onClick: this.onToggleEmojisButtonClick,
            title: "Toggle Emojis",
            children: "🙂: " + (this.userSettings.emojis() ? "On" : "Off"),
          })}
          ${button({
            onClick: this.onToggleAlertFrameButtonClick,
            title: "Toggle Alert frame",
            children: "🚨: " + (this.userSettings.alertFrame() ? "On" : "Off"),
          })}
          ${button({
            onClick: this.onToggleSpecialEffectsButtonClick,
            title: "Toggle Special effects",
            children: "💥: " + (this.userSettings.fxLayer() ? "On" : "Off"),
          })}
          ${button({
            onClick: this.onToggleRandomNameModeButtonClick,
            title: "Random name mode",
            children:
              "🥷: " + (this.userSettings.anonymousNames() ? "On" : "Off"),
          })}
          ${button({
            onClick: this.onToggleLeftClickOpensMenu,
            title: "Left click",
            children:
              "🖱️: " +
              (this.userSettings.leftClickOpensMenu()
                ? "Opens menu"
                : "Attack"),
          })}
          <!-- ${button({
            onClick: this.onToggleFocusLockedButtonClick,
            title: "Lock Focus",
            children:
              "🗺: " +
              (this.userSettings.focusLocked()
                ? "Focus locked"
                : "Hover focus"),
          })} -->
        </div>
      </div>
    `;
  }
}
