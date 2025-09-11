import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import goldCoinIcon from "../../../../resources/images/GoldCoinIcon.svg";
import { EventBus } from "../../../core/EventBus";
import {
  Gold,
  PlayerID,
  PlayerType,
  UnitType,
  UpgradeType,
} from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { PlayerListChangedEvent } from "../../events/PlayerListChangedEvent";
import { AttackRatioEvent } from "../../InputHandler";
import {
  SendBomberIntentEvent,
  SendPurchaseUpgradeIntentEvent,
  SendSetAutoBombingEvent,
  SendSetInvestmentRateEvent,
  SendSetTargetTroopRatioEvent,
} from "../../Transport";
import { UIState } from "../UIState";
import { ToggleBuildPanelEvent } from "./ControlPanel";
import { Layer } from "./Layer";

@customElement("control-panel2")
export class ControlPanel2 extends LitElement implements Layer {
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
  private isOpen = false;

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

  private _lastPopulationIncreaseRate: number;

  private _popRateIsIncreasing: boolean = true;

  private init_: boolean = false;

  @state()
  private activeTab: "Build" | "Attack" | "Economy" | "Research" | "Bombers" =
    "Build";

  @state()
  private activeResearchTab: "Land" | "Water" | "Air" | "Economy" = "Land";

  @state()
  private _lastAirfieldCount: number = 0;

  @state()
  private _lastPlayersHash: string = "";

  @state()
  private _reachablePlayersHash: string = "";

  @state()
  private _hasAirfields: boolean = false;

  @state()
  private _highlightBombersTab: boolean = false;

  @state()
  private _currentTargetPlayerId: PlayerID | null = null;

  @state()
  private _currentTargetStructureType: UnitType | null = null;

  @state()
  private _currentTargetPlayerName: string | null = null;

  @state()
  private _isAutoBombingEnabled: boolean = false;

  @state()
  private _lastSelectedBomberTarget: PlayerID | null = null;

  @state()
  private _multibuildEnabled: boolean = false;

  private unitIconMap: { [key: string]: string } = {
    City: "/images/CityIconWhite.svg",
    Hospital: "/images/HospitalIconWhite.svg",
    Academy: "/images/AcademyIconWhite.png",
    Port: "/images/PortIcon.svg",
    "Missile Silo": "/images/MissileSiloIconWhite.svg",
    "SAM Launcher": "/images/SamLauncherIconWhite.svg",
    "Air Field": "/images/AirfieldIcon.svg",
    "Defense Post": "/images/ShieldIconWhite.svg",
  };

  private readonly NukeTypes: UnitType[] = [
    UnitType.AtomBomb,
    UnitType.MIRV,
    UnitType.HydrogenBomb,
  ];

  private readonly CombatUnitTypes: UnitType[] = [
    UnitType.FighterJet,
    UnitType.Warship,
  ];

  private readonly AttackTypes: UnitType[] = [
    UnitType.AtomBomb,
    UnitType.MIRV,
    UnitType.HydrogenBomb,
    UnitType.FighterJet,
    UnitType.Warship,
  ];

  private readonly StructureTypes: UnitType[] = [
    UnitType.Airfield,
    UnitType.Port,
    UnitType.MissileSilo,
    UnitType.SAMLauncher,
    UnitType.DefensePost,
    UnitType.Hospital,
    UnitType.Academy,
    UnitType.City,
  ];

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

    this.eventBus.on(ToggleBuildPanelEvent, (event: ToggleBuildPanelEvent) => {
      this.isOpen = event.isOpen;
    });

    this.eventBus.on(PlayerListChangedEvent, () => {
      this._updatePlayerHashAndRefresh();
    });
    this._updatePlayerHashAndRefresh(); // Initial hash calculation
  }

  private _updatePlayerHashAndRefresh() {
    const currentPlayersHash = this.game
      .players()
      .map((p) => p.id())
      .sort()
      .join(",");

    if (this._lastPlayersHash !== currentPlayersHash) {
      this._lastPlayersHash = currentPlayersHash;
      // Only refresh the list if the relevant tab is active
      if (this.activeTab === "Bombers") {
        this._refreshBomberPlayerLists();
      }
    }
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
    this._goldPerSecond = this.game.config().goldAdditionRate(player) * 10n;

    this.investmentRate = player.investmentRate();
    this.currentTroopRatio = player.troops() / player.population();

    // Track relevant state for dynamic updates
    const currentAirfieldCount = player.units(UnitType.Airfield).length;
    this._hasAirfields = currentAirfieldCount > 0;

    if (this.activeTab === "Bombers" && this.game.ticks() % 10 === 0) {
      const currentReachablePlayersHash = this._getPlayersInAirfieldRange()
        .map((p) => p.id())
        .sort()
        .join(",");

      if (
        this._lastAirfieldCount !== currentAirfieldCount ||
        this._reachablePlayersHash !== currentReachablePlayersHash
      ) {
        this._refreshBomberPlayerLists();
        this._lastAirfieldCount = currentAirfieldCount;
        this._reachablePlayersHash = currentReachablePlayersHash;
      }
    }

    if (this.activeTab === "Bombers" && !this._hasAirfields) {
      this.activeTab = "Build"; // Changed from "Controls"
    }

    this.requestUpdate();

    // Force build-menu to re-render if its tab is active
    if (this.activeTab === "Build" || this.activeTab === "Attack") {
      const buildMenuElement = this.querySelector(
        "build-menu",
      ) as LitElement | null;
      if (buildMenuElement) {
        buildMenuElement.requestUpdate();
      }
    }
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

  private _getPlayersInAirfieldRange(): PlayerView[] {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      return [];
    }

    const myAirfields = myPlayer
      .units(UnitType.Airfield)
      .filter((u) => u.isActive());
    if (myAirfields.length === 0) {
      return [];
    }

    const bomberRange = this.game.config().bomberTargetRange();
    const reachablePlayers = new Map<PlayerID, PlayerView>();

    const structureIndex = this.game.getStructureIndex();

    for (const airfield of myAirfields) {
      const airfieldPos = {
        x: this.game.x(airfield.tile()),
        y: this.game.y(airfield.tile()),
      };
      const nearbyStructures = structureIndex.getInRange(
        airfieldPos.x,
        airfieldPos.y,
        bomberRange,
      );

      for (const structure of nearbyStructures) {
        const owner = structure.owner();
        if (
          owner &&
          owner.isPlayer() &&
          owner.id() !== myPlayer.id() && // Prevent self-targeting
          !myPlayer.isFriendly(owner) &&
          owner.type() !== PlayerType.Bot
        ) {
          if (!reachablePlayers.has(owner.id())) {
            reachablePlayers.set(owner.id(), owner);
          }
        }
      }
    }

    return Array.from(reachablePlayers.values()).sort((a, b) =>
      a.name().localeCompare(b.name()),
    );
  }

  private _refreshBomberPlayerLists() {
    this.populateBomberForm(); // Populates the main player select list
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has("isOpen")) {
      if (this.isOpen) {
        this.classList.remove("hidden");
      } else {
        this.classList.add("hidden");
      }
    }

    if (this.activeTab === "Bombers") {
      if (
        changedProperties.has("activeTab") ||
        changedProperties.has("_hasAirfields")
      ) {
        this._refreshBomberPlayerLists();
      }
    }

    if (changedProperties.has("_hasAirfields")) {
      const oldHasAirfields = changedProperties.get("_hasAirfields");
      if (this._hasAirfields && !oldHasAirfields) {
        // Airfields just became available, highlight the tab
        this._highlightBombersTab = true;
        setTimeout(() => {
          this._highlightBombersTab = false;
        }, 3000); // Highlight for 3 seconds
      }
    }
  }

  populateBomberForm() {
    const playerSelect = this.querySelector(
      "#bomber-player-select",
    ) as HTMLSelectElement | null;
    if (!this.game || !playerSelect) return;

    const me = this.game.myPlayer();
    if (!me) return;

    const playersToDisplay: PlayerView[] = this._getPlayersInAirfieldRange();

    if (playersToDisplay.length === 0) {
      playerSelect.innerHTML = `<option value="" disabled selected>No building in bomber reach.</option>`;
      playerSelect.disabled = true;
      this._lastSelectedBomberTarget = null; // Clear selection if no targets are available
    } else {
      const optsPlayers = playersToDisplay
        .map((p) => `<option value="${p.id()}">${p.name()}</option>`)
        .join("");
      playerSelect.innerHTML = optsPlayers;
      playerSelect.disabled = false;

      const stillAValidTarget = playersToDisplay.some(
        (p) => p.id() === this._lastSelectedBomberTarget,
      );

      if (stillAValidTarget) {
        playerSelect.value = this._lastSelectedBomberTarget as string;
      } else {
        // If the last target is no longer valid, default to the first in the list and update the state
        this._lastSelectedBomberTarget = playerSelect.value;
      }
    }
  }

  handleBomberIntent() {
    const playerSelect = this.querySelector(
      "#bomber-player-select",
    ) as HTMLSelectElement;
    const selectedStructure = this.querySelector(
      "input[name='structure']:checked",
    ) as HTMLInputElement | null;

    if (!playerSelect || !selectedStructure) return;

    const targetID = String(playerSelect.value);
    const structure = selectedStructure.value as unknown as UnitType;

    this.sendBomberIntent(targetID, structure);
  }

  sendBomberIntent(targetID: string | null, structure: UnitType | null) {
    if (!this.eventBus) return;
    this._currentTargetPlayerId = targetID;
    this._currentTargetStructureType = structure;
    if (targetID) {
      const targetPlayer = this.game.players().find((p) => p.id() === targetID);
      this._currentTargetPlayerName = targetPlayer ? targetPlayer.name() : null;
    } else {
      this._currentTargetPlayerName = null;
    }
    this.eventBus.emit(new SendBomberIntentEvent(targetID, structure));
  }

  _startAutoBombing() {
    this._isAutoBombingEnabled = true;
    this.eventBus.emit(new SendSetAutoBombingEvent(true));
    // Clear any manual target when auto-bombing is enabled
    this.sendBomberIntent(null, null);
  }

  async _stopAutoBombing() {
    this._isAutoBombingEnabled = false;
    this.eventBus.emit(new SendSetAutoBombingEvent(false));
    // Clear any manual target when auto-bombing is disabled
    this.sendBomberIntent(null, null);

    await this.updateComplete; // Wait for the UI to update

    this._refreshBomberPlayerLists(); // NOW refresh the list
  }

  handleStructureChange(e: Event) {
    const changedCheckbox = e.target as HTMLInputElement;
    if (changedCheckbox.checked) {
      const checkboxes = this.querySelectorAll(
        "input[name='structure']",
      ) as NodeListOf<HTMLInputElement>;
      checkboxes.forEach((checkbox) => {
        if (checkbox !== changedCheckbox) {
          checkbox.checked = false;
        }
      });
    }
  }

  private _handleBomberTargetChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this._lastSelectedBomberTarget = select.value;
  }

  private _handleMultibuildToggle(event: Event) {
    const checkbox = event.target as HTMLInputElement;
    this._multibuildEnabled = checkbox.checked;
    this.uiState.multibuildEnabled = checkbox.checked;
  }

  private _changeTab(
    tab: "Build" | "Attack" | "Economy" | "Research" | "Bombers",
  ) {
    this.activeTab = tab;
    if (this.uiState.pendingBuildUnitType) {
      this.uiState.pendingBuildUnitType = null;
    }
  }

  render() {
    if (!this.game) {
      return html``;
    }

    const player = this.game.myPlayer();

    const getUpgradeCost = (upgradeType: UpgradeType) => {
      if (!player) return 0n;
      return this.game.config().upgradeInfo(upgradeType).cost(player);
    };

    const canPurchaseUpgrade = (upgradeType: UpgradeType) => {
      if (!player) return true;

      if (upgradeType === UpgradeType.ScorchedEarth) {
        if (!player.hasUpgrade(UpgradeType.Roads)) {
          return true;
        }
      }

      const cost = getUpgradeCost(upgradeType);
      const hasUpgrade = player.hasUpgrade(upgradeType);
      const canAfford = player.gold() >= cost;
      return hasUpgrade || !canAfford;
    };

    const renderUpgradeButton = (
      upgradeType: UpgradeType,
      name: string,
      level: number,
      tooltip: string = "",
    ) => {
      const cost = getUpgradeCost(upgradeType);
      const hasUpgrade = player?.hasUpgrade(upgradeType);
      const canAfford = player && player.gold() >= cost;

      const buttonClass = hasUpgrade
        ? "build-button upgrade-unlocked"
        : canAfford
          ? "build-button upgrade-available"
          : "build-button upgrade-locked";

      const buttonText = hasUpgrade
        ? html`${name} Unlocked`
        : html`<div class="build-item-details flex flex-col items-center">
            <span class="build-name">${name}</span>
            <span class="build-cost flex items-center gap-1" translate="no">
              ${(Number(cost) / 1_000_000).toFixed(0)}M
              <img src=${goldCoinIcon} alt="gold" width="12" height="12" />
            </span>
          </div>`;
      return html`
        <button
          class="build-button"
          title=${tooltip}
          ?disabled=${canPurchaseUpgrade(upgradeType)}
          @click=${() => {
            if (!hasUpgrade) {
              this.eventBus.emit(
                new SendPurchaseUpgradeIntentEvent(upgradeType),
              );
            }
          }}
        >
          ${buttonText}
        </button>
      `;
    };

    return html`
      <style>
        /* Copied and adapted from BuildMenu.ts for consistency */
        .build-button {
          position: relative;
          width: 100%; /* Full width of the column */
          height: 50px;
          border: 2px solid #2d3748;
          background-color: #2d3748;
          color: #e2e8f0;
          border-radius: 6px;
          box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5);
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 5px;
          font-size: 12px;
          text-align: center;
        }
        .upgrade-available {
          background-color: #4c516d;
          border-color: #5a617c;
          color: #e2e8f0;
        }
        .upgrade-available:hover {
          background-color: #5a617c;
          border-color: #6a718c;
        }
        .upgrade-available:active {
          background-color: #3c4157;
        }
        .upgrade-locked {
          background-color: #1a202c;
          border-color: #2d3748;
          color: #718096;
        }
        .upgrade-unlocked {
          background-color: #2d3748;
          border-color: #4a5568;
          color: #a0aec0;
          cursor: default;
        }
        .build-button:not(:disabled):hover {
          transform: scale(1.02);
          box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5);
        }
        .build-button:not(:disabled):active {
          transform: scale(0.98);
          box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.7);
        }
        .build-button:disabled {
          background-color: #1a202c;
          border-color: #2d3748;
          color: #888;
          cursor: not-allowed;
          opacity: 0.6;
          box-shadow: none;
        }

        .research-tabs {
          display: flex;
          margin-top: auto;
          border-top: 1px solid #4a5568; /* gray-700 */
        }

        .research-tab {
          flex-grow: 1;
          padding: 8px 0;
          text-align: center;
          cursor: pointer;
          border: 1px solid #1a202c;
          border-top: none;
          background-color: #1a202c;
          color: #a0aec0;
          box-shadow: inset 0px 2px 5px rgba(0, 0, 0, 0.4);
        }

        .research-tab:hover:not(.active) {
          background-color: #2d3748;
          color: #e2e8f0;
        }

        .research-tab.active {
          background-color: #2d3748;
          color: #e2e8f0;
          border-color: #4a5568;
          border-bottom-color: transparent;
          box-shadow: 0px -2px 5px rgba(0, 0, 0, 0.2);
          position: relative;
          top: -1px;
          border-radius: 6px 6px 0 0;
        }

        input[type="range"] {
          -webkit-appearance: none;
          background: transparent;
          outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: white;
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: white;
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
        }
        .targetTroopRatio::-webkit-slider-thumb {
          border-color: rgb(59 130 246);
        }
        .targetTroopRatio::-moz-range-thumb {
          border-color: rgb(59 130 246);
        }
        .attackRatio::-webkit-slider-thumb {
          border-color: rgb(239 68 68);
        }
        .attackRatio::-moz-range-thumb {
          border-color: rgb(239 68 68);
        }
        .highlight-tab {
          animation: pulse 1s infinite alternate;
        }
        @keyframes pulse {
          from {
            background-color: rgba(78, 176, 87, 0.4);
          }
          to {
            background-color: rgba(78, 176, 87, 0.9);
          }
        }
      </style>
      <div
        class="${this._isVisible && this.isOpen
          ? `w-full h-[260px] text-sm lg:text-m military-panel border-2 border-gray-700 p-2 pr-3 lg:p-4 flex flex-col transition-all duration-300 ml-8`
          : "hidden"}"
        style="box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4);"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="flex border-b border-gray-700 mb-4">
          <button
            class="py-2 px-4 text-center font-ocr uppercase ${this.activeTab ===
            "Build"
              ? "bg-gray-700 text-crt-green border border-crt-green"
              : "text-tan"}"
            @click=${() => this._changeTab("Build")}
          >
            Build
          </button>
          <button
            class="py-2 px-4 text-center font-ocr uppercase ${this.activeTab ===
            "Attack"
              ? "bg-gray-700 text-crt-green border border-crt-green"
              : "text-tan"}"
            @click=${() => this._changeTab("Attack")}
          >
            Attack
          </button>
          <button
            class="py-2 px-4 text-center font-ocr uppercase ${this.activeTab ===
            "Economy"
              ? "bg-gray-700 text-crt-green border border-crt-green"
              : "text-tan"}"
            @click=${() => this._changeTab("Economy")}
          >
            Economy
          </button>
          <button
            class="py-2 px-4 text-center font-ocr uppercase ${this.activeTab ===
            "Research"
              ? "bg-gray-700 text-crt-green border border-crt-green"
              : "text-tan"}"
            @click=${() => this._changeTab("Research")}
          >
            Research
          </button>
          ${this._hasAirfields
            ? html`
                <button
                  class="py-2 px-4 text-center font-ocr uppercase ${this
                    .activeTab === "Bombers"
                    ? "bg-gray-700 text-crt-green border border-crt-green"
                    : "text-tan"} ${this._highlightBombersTab
                    ? "highlight-tab"
                    : ""}"
                  @click=${() => this._changeTab("Bombers")}
                >
                  Bombers
                </button>
              `
            : ""}
        </div>

        <div class="tab-content flex-grow overflow-y-auto max-w-full">
          ${this.activeTab === "Bombers"
            ? html`
                <div class="text-tan flex w-full">
                  <!-- Column 1: Auto-Bombing -->
                  <div class="w-1/3 pr-2">
                    <h3 class="military-heading mb-2">Auto-Bombing</h3>
                    <div class="flex flex-col gap-2">
                      <button
                        type="button"
                        class="military-button w-full"
                        @click=${this._startAutoBombing}
                      >
                        Start Auto Bombing
                      </button>
                      <button
                        type="button"
                        class="military-button w-full"
                        style="background-color: var(--alertColor); border-color: var(--alertColor);"
                        @click=${this._stopAutoBombing}
                      >
                        Stop Auto Bombing
                      </button>
                    </div>
                    <p class="text-xs mt-3 text-gray-400">
                      Autobombing sends bombers to nearby non-allied territory
                      and bombs their structures.
                    </p>
                  </div>

                  <!-- Column 2: Manual Targeting -->
                  <div class="w-1/3 px-2">
                    ${this._isAutoBombingEnabled
                      ? html`
                          <div
                            class="flex flex-col items-center justify-center h-full text-crt-green font-bold text-center"
                          >
                            Automatic bombing is enabled.
                          </div>
                        `
                      : html`
                          <h3 class="military-heading mb-2">
                            Manual Targeting
                          </h3>
                          <form
                            @submit=${(e: Event) => e.preventDefault()}
                            class="flex flex-col gap-2"
                          >
                            <label
                              class="inline-flex items-center text-sm military-label"
                            >
                              Select Target
                              <select
                                id="bomber-player-select"
                                class="ml-1 p-1 bg-gray-700 text-tan border border-gray-500 rounded-sm w-full truncate"
                                @change=${this._handleBomberTargetChange}
                              ></select>
                            </label>

                            <label class="block text-sm military-label"
                              >Select Structure</label
                            >
                            <div class="grid grid-cols-4 gap-2">
                              ${[
                                UnitType.City,
                                UnitType.DefensePost,
                                UnitType.SAMLauncher,
                                UnitType.MissileSilo,
                                UnitType.Port,
                                UnitType.Airfield,
                                UnitType.Hospital,
                                UnitType.Academy,
                              ].map((s) => {
                                return html`
                                  <label
                                    class="flex items-center space-x-1 p-1 border border-gray-700 rounded-sm cursor-pointer has-checked:border-crt-green"
                                  >
                                    <img
                                      src="${this.unitIconMap[s]}"
                                      alt="${s}"
                                      class="w-4 h-4"
                                    />
                                    <input
                                      type="checkbox"
                                      name="structure"
                                      value="${s}"
                                      ?checked=${s === UnitType.City}
                                      class="form-checkbox h-4 w-4 text-crt-green bg-gray-700 border-gray-500 rounded-sm focus:ring-crt-green"
                                      @change=${this.handleStructureChange}
                                    />
                                  </label>
                                `;
                              })}
                            </div>
                          </form>
                        `}
                  </div>

                  <!-- Column 3: Target Actions -->
                  <div class="w-1/3 pl-2">
                    ${this._isAutoBombingEnabled
                      ? ""
                      : html`
                          <h3 class="military-heading mb-2">Target Actions</h3>
                          <div class="text-tan text-sm min-h-[20px]">
                            ${this._currentTargetPlayerId &&
                            this._currentTargetStructureType
                              ? html`<span class="font-bold military-label"
                                    >Target:</span
                                  >
                                  ${this._currentTargetPlayerName}
                                  <img
                                    src="${this.unitIconMap[
                                      this._currentTargetStructureType
                                    ]}"
                                    alt="${this._currentTargetStructureType}"
                                    class="inline-block w-4 h-4 align-top ml-1"
                                  />`
                              : html`<span class="military-label"
                                  >No target selected</span
                                >`}
                          </div>

                          <div class="flex gap-2 mt-auto">
                            <button
                              type="button"
                              class="military-button flex-1"
                              @click=${this.handleBomberIntent}
                            >
                              Set Target
                            </button>
                            <button
                              type="button"
                              class="military-button flex-1"
                              @click=${() => this.sendBomberIntent(null, null)}
                            >
                              Clear Target
                            </button>
                          </div>
                        `}
                  </div>
                </div>
              `
            : ""}
          ${this.activeTab === "Build"
            ? html`
                <div class="flex items-center mb-2">
                  <input
                    type="checkbox"
                    id="multibuild-toggle"
                    class="mr-2"
                    .checked=${this._multibuildEnabled}
                    @change=${this._handleMultibuildToggle}
                  />
                  <label for="multibuild-toggle" class="military-label"
                    >Enable Mass Production</label
                  >
                </div>
                <build-menu
                  style="width: 100%;"
                  .game=${this.game}
                  .eventBus=${this.eventBus}
                  .uiState=${this.uiState}
                  .unitFilter=${this.StructureTypes}
                ></build-menu>
              `
            : ""}
          ${this.activeTab === "Attack"
            ? html`
                <div class="flex items-center mb-2">
                  <input
                    type="checkbox"
                    id="multibuild-toggle"
                    class="mr-2"
                    .checked=${this._multibuildEnabled}
                    @change=${this._handleMultibuildToggle}
                  />
                  <label for="multibuild-toggle" class="military-label"
                    >Enable Mass Production</label
                  >
                </div>
                <build-menu
                  style="width: 100%;"
                  .game=${this.game}
                  .eventBus=${this.eventBus}
                  .uiState=${this.uiState}
                  .unitFilter=${this.AttackTypes}
                ></build-menu>
              `
            : ""}
          ${this.activeTab === "Economy"
            ? html`
                <div class="text-tan">
                  <div class="relative">
                    <label class="block military-label mb-1" translate="no">
                      Production Investment Rate:
                      ${(this.investmentRate * 100).toFixed(0)}%
                    </label>
                    <div
                      class="text-right text-xs opacity-60 mt-1 military-label normal-case"
                      translate="no"
                    >
                      Prod: ${Math.round(this._productivity * 100)}%
                      (${this._productivityGrowth >= 0 ? "+" : ""}${(
                        this._productivityGrowth * 100
                      ).toFixed(1)}%/min)
                    </div>
                    <div class="relative h-8">
                      <div
                        class="absolute left-0 right-0 top-3 h-2 rounded"
                        style="background-color:#4E513A"
                      ></div>
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:${(this.investmentRate /
                          this.game.config().maxInvestmentRate()) *
                        100}%; background-color: rgba(78,176,87,0.6);"
                      ></div>
                      <input
                        type="range"
                        min="0"
                        max="${this.game?.config()?.maxInvestmentRate() * 100}"
                        .value=${(this.investmentRate * 100).toString()}
                        @input=${(e: Event) => {
                          this.investmentRate =
                            parseInt((e.target as HTMLInputElement).value) /
                            100;
                          this.onInvestmentRateChange(this.investmentRate);
                        }}
                        class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer military-slider"
                      />
                    </div>
                  </div>
                </div>
              `
            : ""}
          ${this.activeTab === "Research"
            ? html`
                <div class="text-tan flex flex-col h-full">
                  <!-- Research Sub-Tab Content -->
                  <div class="flex-grow pt-4 overflow-x-hidden">
                    ${this.activeResearchTab === "Land"
                      ? html`
                          <div class="grid grid-cols-3 gap-4">
                            ${renderUpgradeButton(
                              UpgradeType.Roads,
                              "Roads",
                              1,
                            )}
                            ${renderUpgradeButton(
                              UpgradeType.InternationalTrade,
                              "International Trade",
                              2,
                            )}
                            ${renderUpgradeButton(
                              UpgradeType.ScorchedEarth,
                              "Scorched Earth",
                              3,
                              "This upgrade will remove your road network",
                            )}
                          </div>
                        `
                      : ""}
                    ${this.activeResearchTab === "Water"
                      ? html`
                          <div class="grid grid-cols-3 gap-4">
                            ${renderUpgradeButton(
                              UpgradeType.WaterUpgrade1,
                              "Water 1",
                              1,
                            )}
                            ${renderUpgradeButton(
                              UpgradeType.WaterUpgrade2,
                              "Water 2",
                              2,
                            )}
                            ${renderUpgradeButton(
                              UpgradeType.WaterUpgrade3,
                              "Water 3",
                              3,
                            )}
                          </div>
                        `
                      : ""}
                    ${this.activeResearchTab === "Air"
                      ? html`
                          <div class="grid grid-cols-3 gap-4">
                            ${renderUpgradeButton(
                              UpgradeType.AirUpgrade1,
                              "Air 1",
                              1,
                            )}
                            ${renderUpgradeButton(
                              UpgradeType.AirUpgrade2,
                              "Air 2",
                              2,
                            )}
                            ${renderUpgradeButton(
                              UpgradeType.AirUpgrade3,
                              "Air 3",
                              3,
                            )}
                          </div>
                        `
                      : ""}
                    ${this.activeResearchTab === "Economy"
                      ? html`
                          <div class="grid grid-cols-3 gap-4">
                            ${renderUpgradeButton(
                              UpgradeType.EconomyUpgrade1,
                              "Econ 1",
                              1,
                            )}
                            ${renderUpgradeButton(
                              UpgradeType.EconomyUpgrade2,
                              "Econ 2",
                              2,
                            )}
                            ${renderUpgradeButton(
                              UpgradeType.EconomyUpgrade3,
                              "Econ 3",
                              3,
                            )}
                          </div>
                        `
                      : ""}
                  </div>

                  <!-- Research Sub-Tabs -->
                  <div class="research-tabs">
                    <button
                      class="research-tab ${this.activeResearchTab === "Land"
                        ? "active"
                        : ""}"
                      @click=${() => (this.activeResearchTab = "Land")}
                    >
                      Land
                    </button>
                    <button
                      class="research-tab ${this.activeResearchTab === "Water"
                        ? "active"
                        : ""}"
                      @click=${() => (this.activeResearchTab = "Water")}
                    >
                      Water
                    </button>
                    <button
                      class="research-tab ${this.activeResearchTab === "Air"
                        ? "active"
                        : ""}"
                      @click=${() => (this.activeResearchTab = "Air")}
                    >
                      Air
                    </button>
                    <button
                      class="research-tab ${this.activeResearchTab === "Economy"
                        ? "active"
                        : ""}"
                      @click=${() => (this.activeResearchTab = "Economy")}
                    >
                      Economy
                    </button>
                  </div>
                </div>
              `
            : ""}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
