import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { Gold } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { AttackRatioEvent } from "../../InputHandler";
import {
  SendSetInvestmentRateEvent,
  SendSetTargetTroopRatioEvent,
} from "../../Transport";
import { renderNumber, renderTroops } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

export class ToggleBuildPanelEvent implements GameEvent {
  constructor(public readonly isOpen: boolean) {}
}

@customElement("control-panel")
export class ControlPanel extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;

  @state()
  private attackRatio: number = 0.3;

  @state()
  private targetTroopRatio = 0.6;

  @state()
  private currentTroopRatio = 0.6;

  @state()
  private investmentRate: number = 0; // default to 0%

  @state()
  private _population: number;

  @state()
  private _maxPopulation: number;

  @state()
  private popRate: number;

  @state()
  private _hospitalReturns: number = 0;

  @state()
  private _troops: number;

  @state()
  private _workers: number;

  @state()
  private _isVisible = false;

  @state()
  private _manpower: number = 0;

  @state()
  private _gold: Gold;

  @state()
  private _productivity: number;

  @state()
  private _productivityGrowth: number;

  @state()
  private _goldPerSecond: Gold;

  @state()
  private _netGoldPerSecond: Gold;

  @state()
  private isBuildPanelOpen = false;

  private _lastPopulationIncreaseRate: number;

  private _popRateIsIncreasing: boolean = true;

  private init_: boolean = false;

  private _hoverTimeoutId: number | null = null; // New property

  private _ignoreNextClick = false;

  init() {
    this.attackRatio = Number(
      localStorage.getItem("settings.attackRatio") ?? "0.3",
    );
    this.targetTroopRatio = Number(
      localStorage.getItem("settings.troopRatio") ?? "0.6",
    );
    this.investmentRate = Number(
      localStorage.getItem("settings.investmentRate") ?? "0",
    );
    this.uiState.investmentRate = this.investmentRate;
    this.init_ = true;
    this.uiState.attackRatio = this.attackRatio;
    this.currentTroopRatio = this.targetTroopRatio;

    this.eventBus.on(AttackRatioEvent, (event: AttackRatioEvent) => {
      let newAttackRatio =
        (parseInt(
          (document.getElementById("attack-ratio") as HTMLInputElement).value,
        ) +
          event.attackRatio) /
        100;

      if (newAttackRatio < 0.01) {
        newAttackRatio = 0.01;
      }

      if (newAttackRatio > 1) {
        newAttackRatio = 1;
      }

      if (newAttackRatio === 0.11 && this.attackRatio === 0.01) {
        // If we're changing the ratio from 1%, then set it to 10% instead of 11% to keep a consistency
        newAttackRatio = 0.1;
      }

      this.attackRatio = newAttackRatio;
      this.onAttackRatioChange(this.attackRatio);
    });
  }

  tick() {
    if (this.init_) {
      this.eventBus.emit(
        new SendSetTargetTroopRatioEvent(this.targetTroopRatio),
      );
      this.eventBus.emit(new SendSetInvestmentRateEvent(this.investmentRate));
      this.init_ = false;
    }

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    const popIncreaseRate = player.population() - this._population;
    if (this.game.ticks() % 5 === 0) {
      this._popRateIsIncreasing =
        popIncreaseRate >= this._lastPopulationIncreaseRate;
      this._lastPopulationIncreaseRate = popIncreaseRate;
    }

    this._population = player.population();
    this._maxPopulation = this.game.config().maxPopulation(player);
    this._hospitalReturns = player.hospitalReturns() * 10;
    this._gold = player.gold();
    this._productivity = player.productivity();
    this._productivityGrowth = player.productivityGrowthPerMinute();
    this._troops = player.troops();
    this._workers = player.workers();
    this.popRate = this.game.config().populationIncreaseRate(player) * 10;
    // For display: estimate net gold/sec including all investments
    // Use centralized gross gold calculation from config
    const grossPerSecond =
      10 * this.game.config().grossGoldAdditionRate(player);
    // Read persisted sliders
    const prodStr = localStorage.getItem("settings.investmentRate");
    const roadStr = localStorage.getItem("settings.roadInvestmentRate");
    const researchStr = localStorage.getItem("settings.researchInvestmentRate");
    const prodRate = prodStr ? Number(prodStr) : 0;
    const roadRate = roadStr ? Number(roadStr) : 0;
    const researchRate = researchStr ? Number(researchStr) : 0;
    const hasTreasury = (this._gold ?? 0n) > 0n;
    const maxTotal = hasTreasury ? 1.1 : 1.0;
    const total = Math.min(prodRate + roadRate + researchRate, maxTotal);
    const netPerSecondDouble = grossPerSecond * (1 - total);
    const netPerSecond = BigInt(
      Math.floor(Number.isFinite(netPerSecondDouble) ? netPerSecondDouble : 0),
    );
    this._netGoldPerSecond = netPerSecond;

    this.investmentRate = player.investmentRate();
    this.currentTroopRatio = player.troops() / player.population();

    this.requestUpdate();
  }

  onAttackRatioChange(newRatio: number) {
    this.uiState.attackRatio = newRatio;
  }
  onInvestmentRateChange(newRate: number) {
    this.eventBus.emit(new SendSetInvestmentRateEvent(newRate));
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Render any necessary canvas elements
  }

  shouldTransform(): boolean {
    return false;
  }

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  targetTroops(): number {
    return this._manpower * this.targetTroopRatio;
  }

  onTroopChange(newRatio: number) {
    this.eventBus.emit(new SendSetTargetTroopRatioEvent(newRatio));
  }

  delta(): number {
    const d = this._population - this.targetTroops();
    return d;
  }

  openBuildPanel() {
    if (!this.isBuildPanelOpen) {
      this.isBuildPanelOpen = true;
      this.eventBus.emit(new ToggleBuildPanelEvent(true));
      this._ignoreNextClick = true;
      setTimeout(() => {
        this._ignoreNextClick = false;
      }, 200);
    }
  }

  toggleBuildPanel() {
    if (this._ignoreNextClick) {
      this._ignoreNextClick = false;
      return;
    }
    this.isBuildPanelOpen = !this.isBuildPanelOpen;
    this.eventBus.emit(new ToggleBuildPanelEvent(this.isBuildPanelOpen));
  }

  handleMouseEnterBuildPanel() {
    if (this._hoverTimeoutId) {
      clearTimeout(this._hoverTimeoutId);
    }
    this._hoverTimeoutId = window.setTimeout(() => {
      this.openBuildPanel();
      this._hoverTimeoutId = null;
    }, 300); // 500ms delay
  }

  handleMouseLeaveBuildPanel() {
    if (this._hoverTimeoutId) {
      clearTimeout(this._hoverTimeoutId);
      this._hoverTimeoutId = null;
    }
  }

  render() {
    if (!this.game) {
      return html``;
    }
    return html`
      <style>
        /* Make the inputs transparent so our custom track/thumb show */
        input[type="range"] {
          -webkit-appearance: none;
          background: transparent;
          outline: none;
        }
        /* Thumb base (we color with borders below) */
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: var(--ui-slider-thumb);
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
          border-color: var(--ui-secondary);
          box-shadow: 0 0 0 1px rgba(39, 71, 110, 0.35) inset;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: var(--ui-slider-thumb);
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
          border-color: var(--ui-secondary);
          box-shadow: 0 0 0 1px rgba(39, 71, 110, 0.35) inset;
        }
        /* Subtle affordance on hover/focus */
        input[type="range"]:hover::-webkit-slider-thumb,
        input[type="range"]:focus::-webkit-slider-thumb {
          border-color: var(--ui-secondary-hover);
          box-shadow: 0 0 0 2px rgba(50, 98, 155, 0.45) inset;
        }
        input[type="range"]:hover::-moz-range-thumb,
        input[type="range"]:focus::-moz-range-thumb {
          border-color: var(--ui-secondary-hover);
          box-shadow: 0 0 0 2px rgba(50, 98, 155, 0.45) inset;
        }
        /* Standardize thumb rims to submarine blue (no per-slider overrides) */

        .build-tab {
          writing-mode: vertical-rl;
          transform: none; /* Changed from rotate(180deg) */
        }

        /* Pull-tab indicator: three vertical bars */
        .pull-tab-indicator {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        .pull-tab-indicator .bar {
          width: 3px;
          height: 22px;
          background-color: var(--ui-text-accent);
          border-radius: 2px;
          opacity: 0.9;
          transition: opacity 0.15s ease-in-out;
        }
        .pull-tab-indicator:hover .bar {
          opacity: 1;
        }
      </style>

      ${this._isVisible
        ? html`
            <!-- Root panel shell (submarine-panel provides background/border/colors) -->
            <div class="relative submarine-panel">
              <div
                class="w-full h-[255px] text-sm lg:text-m bg-transparent border-0 shadow-inner p-2 pr-3 lg:p-4 rounded-md flex"
                @contextmenu=${(e: MouseEvent) => e.preventDefault()}
              >
                <div class="flex-grow flex flex-col h-full">
                  <!-- Top stats block -->
                  <div
                    class="hidden lg:block mb-4 p-2 rounded-sm"
                    style="background-color: var(--ui-table-row-bg)"
                  >
                    <div class="flex justify-between mb-1">
                      <span class="font-bold military-heading">
                        ${translateText("control_panel.pop")}:
                      </span>
                      <span translate="no" class="military-label normal-case">
                        ${renderTroops(this._population)} /
                        ${renderTroops(this._maxPopulation)}
                        <span
                          translate="no"
                          style="color: ${this._popRateIsIncreasing
                            ? "var(--ui-slider-troop)"
                            : "var(--ui-alert)"}"
                        >
                          (+${renderTroops(this.popRate)})
                        </span>
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="font-bold military-heading">
                        ${translateText("control_panel.gold")}:
                      </span>
                      <span translate="no" class="military-label normal-case">
                        ${renderNumber(this._gold)}
                        ${(() => {
                          const net = this._netGoldPerSecond ?? 0n;
                          const isNeg = net < 0n;
                          const mag = isNeg ? -net : net;
                          const sign = isNeg ? "-" : "+";
                          return html`(${sign}${renderNumber(mag)})`;
                        })()}
                      </span>
                    </div>
                  </div>

                  <!-- Troops/Workers ratio -->
                  <div class="relative">
                    <label class="block military-label mb-1" translate="no">
                      ${translateText("control_panel.troops")}:
                      <span translate="no" class="normal-case"
                        >${renderTroops(this._troops)}</span
                      >
                      | ${translateText("control_panel.workers")}:
                      <span translate="no" class="normal-case"
                        >${renderTroops(this._workers)}</span
                      >
                    </label>
                    <div class="relative h-8">
                      <!-- Background track (exact color) -->
                      <div
                        class="absolute left-0 right-0 top-3 h-2 rounded"
                        style="background-color: var(--ui-slider-track)"
                      ></div>
                      <!-- Fill track (teal-blue for troops/workers) -->
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:${this.currentTroopRatio *
                        100}%; background-color: var(--ui-slider-troop);"
                      ></div>
                      <!-- Range input -->
                      <input
                        type="range"
                        min="1"
                        max="100"
                        .value=${(this.targetTroopRatio * 100).toString()}
                        @input=${(e: Event) => {
                          this.targetTroopRatio =
                            parseInt((e.target as HTMLInputElement).value) /
                            100;
                          this.onTroopChange(this.targetTroopRatio);
                        }}
                        class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer targetTroopRatio military-slider"
                      />
                    </div>
                  </div>

                  <!-- Attack ratio -->
                  <div class="relative">
                    <label class="block military-label mb-1" translate="no">
                      ${translateText("control_panel.attack_ratio")}:
                      ${(this.attackRatio * 100).toFixed(0)}%
                      (${renderTroops(
                        (this.game?.myPlayer()?.troops() ?? 0) *
                          this.attackRatio,
                      )})
                    </label>
                    <div class="relative h-8">
                      <!-- Background track (blue track) -->
                      <div
                        class="absolute left-0 right-0 top-3 h-2 rounded"
                        style="background-color: var(--ui-slider-track)"
                      ></div>
                      <!-- Fill track (deep indigo for attack) -->
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:${this.attackRatio *
                        100}%; background-color: var(--ui-slider-attack);"
                      ></div>
                      <!-- Range input -->
                      <input
                        id="attack-ratio"
                        type="range"
                        min="1"
                        max="100"
                        .value=${(this.attackRatio * 100).toString()}
                        @input=${(e: Event) => {
                          this.attackRatio =
                            parseInt((e.target as HTMLInputElement).value) /
                            100;
                          this.onAttackRatioChange(this.attackRatio);
                        }}
                        class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer attackRatio military-slider"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Vertical Build tab (no functionality change) -->
              <div
                class="absolute top-0 -right-8 w-8 h-full rounded-r-md flex items-center justify-center cursor-pointer border-2 border-l-0 transition-all duration-200 hover:brightness-125"
                style="background-color: var(--ui-secondary); border-color: var(--ui-panel-border);"
                @mouseenter=${this.handleMouseEnterBuildPanel}
                @mouseleave=${this.handleMouseLeaveBuildPanel}
                @click=${this.toggleBuildPanel}
              >
                <div
                  class="pull-tab-indicator"
                  title="Open panel"
                  aria-label="Open panel"
                >
                  <span class="bar" aria-hidden="true"></span>
                  <span class="bar" aria-hidden="true"></span>
                  <span class="bar" aria-hidden="true"></span>
                </div>
              </div>
            </div>
          `
        : ""}
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
