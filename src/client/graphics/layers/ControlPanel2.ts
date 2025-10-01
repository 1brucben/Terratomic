import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import {
  Gold,
  PlayerID,
  PlayerType,
  UnitType,
  UpgradeType,
} from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { getTechNodes } from "../../../core/tech/ResearchTree";
import { getTechMeta, RESEARCH_TECH_IDS } from "../../../core/tech/TechEffects";
import { PlayerListChangedEvent } from "../../events/PlayerListChangedEvent";
import { AttackRatioEvent } from "../../InputHandler";
import "../../ResearchTreeModal";
import {
  SendBomberIntentEvent,
  SendSetAutoBombingEvent,
  SendSetInvestmentRateEvent,
  SendSetResearchInvestmentEvent,
  SendSetRoadInvestmentEvent,
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
  private _roadInvestmentRate: number = 0; // 0..1 of per-tick income allocated to roads

  @state()
  private _researchInvestmentRate: number = 0; // 0..1 of per-tick income allocated to research (UI only for now)

  // Lock states for investment sliders
  @state()
  private _lockProd: boolean = false;
  @state()
  private _lockRoad: boolean = false;
  @state()
  private _lockResearch: boolean = false;

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
    UnitType.Submarine,
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
    // Force both investment sliders to start at 0 at the beginning of the game
    this.investmentRate = 0;
    this._roadInvestmentRate = 0;
    this._researchInvestmentRate = 0;
    // Persist zeros so UI and any other readers start from 0
    localStorage.setItem(
      "settings.investmentRate",
      this.investmentRate.toString(),
    );
    localStorage.setItem(
      "settings.roadInvestmentRate",
      this._roadInvestmentRate.toString(),
    );
    localStorage.setItem(
      "settings.researchInvestmentRate",
      this._researchInvestmentRate.toString(),
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
      this.eventBus.emit(
        new SendSetRoadInvestmentEvent(this._roadInvestmentRate),
      );
      this.eventBus.emit(
        new SendSetResearchInvestmentEvent(this._researchInvestmentRate),
      );
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
    // Compute net gold/sec consistent with server logic
    {
      const grossPerTick = this.game.config().grossGoldAdditionRate(player);
      const prod = player.investmentRate?.() ?? 0;
      const hasRoads = player.hasUpgrade(UpgradeType.Roads);
      const effectiveRoad = hasRoads ? this._roadInvestmentRate : 0;
      let totalInvest = prod + effectiveRoad + this._researchInvestmentRate;
      const hasTreasury = (this._gold ?? 0n) > 0n;
      const maxTotal = hasTreasury ? 1.1 : 1.0;
      if (!Number.isFinite(totalInvest)) totalInvest = 0;
      if (totalInvest > maxTotal) totalInvest = maxTotal;
      let netPerTickDouble = grossPerTick * (1 - totalInvest);
      if (!Number.isFinite(netPerTickDouble)) netPerTickDouble = 0;
      const netPerTick = BigInt(Math.floor(netPerTickDouble));
      this._goldPerSecond = netPerTick * 10n;
    }

    this.investmentRate = player.investmentRate();
    // If Roads are not researched, force road investment to 0 and persist
    const hasRoadsUpgrade = player.hasUpgrade(UpgradeType.Roads);
    if (!hasRoadsUpgrade && this._roadInvestmentRate !== 0) {
      this._roadInvestmentRate = 0;
      this.onRoadInvestmentChange(0);
      localStorage.setItem(
        "settings.roadInvestmentRate",
        this._roadInvestmentRate.toString(),
      );
    }

    // Enforce cap so UI never exceeds allowed total; prefer reducing unlocked sliders first
    {
      const cap = this._maxTotalInvestment();
      const maxProd = this.game?.config?.().maxInvestmentRate?.() ?? 0.5;
      let prod = Math.max(0, Math.min(maxProd, this.investmentRate));
      let road = Math.max(0, Math.min(1, this._roadInvestmentRate));
      let research = Math.max(0, Math.min(1, this._researchInvestmentRate));
      const sum = prod + road + research;
      if (sum > cap) {
        let over = sum - cap;
        const values: Record<"prod" | "road" | "research", number> = {
          prod,
          road,
          research,
        };
        const locks: Record<"prod" | "road" | "research", boolean> = {
          prod: this._lockProd,
          road: this._lockRoad,
          research: this._lockResearch,
        };

        // Reduce unlocked sliders first
        const unlocked = (
          Object.keys(values) as Array<"prod" | "road" | "research">
        ).filter((k) => !locks[k] && values[k] > 0);
        const unlockedSum = unlocked.reduce((a, k) => a + values[k], 0);
        if (unlockedSum > 0) {
          if (unlockedSum >= over - 1e-9) {
            for (const k of unlocked) {
              const v = values[k];
              const delta = over * (v / unlockedSum) || 0;
              values[k] = Math.max(0, v - delta);
            }
            over = 0;
          } else {
            for (const k of unlocked) values[k] = 0;
            over -= unlockedSum;
          }
        }

        // If still over, reduce locked sliders as last resort
        if (over > 1e-9) {
          const locked = (
            Object.keys(values) as Array<"prod" | "road" | "research">
          ).filter((k) => locks[k] && values[k] > 0);
          const lockedSum = locked.reduce((a, k) => a + values[k], 0);
          if (lockedSum > 0) {
            for (const k of locked) {
              const v = values[k];
              const delta = over * (v / lockedSum) || 0;
              values[k] = Math.max(0, v - delta);
            }
            over = 0;
          }
        }

        prod = Math.max(0, Math.min(maxProd, values.prod));
        road = Math.max(0, Math.min(1, values.road));
        research = Math.max(0, Math.min(1, values.research));

        const prodChanged = prod !== this.investmentRate;
        const roadChanged = road !== this._roadInvestmentRate;
        const researchChanged = research !== this._researchInvestmentRate;
        if (prodChanged || roadChanged || researchChanged) {
          this.investmentRate = prod;
          this._roadInvestmentRate = road;
          this._researchInvestmentRate = research;
          if (prodChanged) this.onInvestmentRateChange(this.investmentRate);
          if (roadChanged)
            this.onRoadInvestmentChange(this._roadInvestmentRate);
          if (researchChanged)
            this.onResearchInvestmentChange(this._researchInvestmentRate);
          localStorage.setItem(
            "settings.investmentRate",
            this.investmentRate.toString(),
          );
          localStorage.setItem(
            "settings.roadInvestmentRate",
            this._roadInvestmentRate.toString(),
          );
          localStorage.setItem(
            "settings.researchInvestmentRate",
            this._researchInvestmentRate.toString(),
          );
        }
      }
    }
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
  onRoadInvestmentChange(newRate: number) {
    this.eventBus.emit(new SendSetRoadInvestmentEvent(newRate));
  }
  onResearchInvestmentChange(newRate: number) {
    this.eventBus.emit(new SendSetResearchInvestmentEvent(newRate));
  }

  /**
   * Compute the dynamic cap for total investments.
   * Matches server logic: allow up to 110% if treasury > 0, else cap at 100%.
   */
  private _maxTotalInvestment(): number {
    try {
      return (this._gold ?? 0n) > 0n ? 1.1 : 1.0;
    } catch {
      return 1.1; // safe default
    }
  }

  /**
   * Adjust the three investment sliders so their sum does not exceed the cap.
   * If the changed one tries to push the total above the cap, reduce the other two proportionally.
   */
  private _applyTripleInvestmentConstraint(
    changed: "prod" | "road" | "research",
    proposed: number,
  ): { prod: number; road: number; research: number } {
    const maxProd = this.game?.config?.().maxInvestmentRate?.() ?? 0.5;

    const currentProd = this.investmentRate;
    const currentRoad = this._roadInvestmentRate;
    const currentResearch = this._researchInvestmentRate;

    // If the changed slider is locked, block the change entirely
    if (
      (changed === "prod" && this._lockProd) ||
      (changed === "road" && this._lockRoad) ||
      (changed === "research" && this._lockResearch)
    ) {
      return {
        prod: currentProd,
        road: currentRoad,
        research: currentResearch,
      };
    }

    const prod = Math.max(
      0,
      Math.min(maxProd, changed === "prod" ? proposed : currentProd),
    );
    const road = Math.max(
      0,
      Math.min(1, changed === "road" ? proposed : currentRoad),
    );
    const research = Math.max(
      0,
      Math.min(1, changed === "research" ? proposed : currentResearch),
    );

    const cap = this._maxTotalInvestment();
    const sum = prod + road + research;
    if (sum <= cap) return { prod, road, research };

    // Over cap: try to reduce only the other unlocked sliders; if not enough, block the change
    const over = sum - cap;
    const values: Record<"prod" | "road" | "research", number> = {
      prod,
      road,
      research,
    };
    const locks: Record<"prod" | "road" | "research", boolean> = {
      prod: this._lockProd,
      road: this._lockRoad,
      research: this._lockResearch,
    };

    const others: Array<"prod" | "road" | "research"> =
      changed === "prod"
        ? ["road", "research"]
        : changed === "road"
          ? ["prod", "research"]
          : ["prod", "road"];
    const reducible = others.filter((k) => !locks[k] && values[k] > 0);
    const reducibleSum = reducible.reduce((a, k) => a + values[k], 0);

    if (reducibleSum >= over - 1e-9) {
      for (const k of reducible) {
        const v = values[k];
        const delta = over * (v / reducibleSum) || 0;
        values[k] = Math.max(0, v - delta);
      }
      return {
        prod: values.prod,
        road: values.road,
        research: values.research,
      };
    }

    // Not enough room in other sliders; block the change to the changed slider
    return { prod: currentProd, road: currentRoad, research: currentResearch };
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
    const hasRoads = player?.hasUpgrade(UpgradeType.Roads) ?? false;
    // Research tab has been simplified; upgrade buttons and sub-tabs removed.

    return html`
      <style>
        .nowrap {
          white-space: nowrap;
        }
        .build-button {
          position: relative;
          width: 100%; /* Full width of the column */
          height: 50px;
          border: 2px solid #2d3748;
          /* Darker idle surface */
          background-color: #232d40;
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

        /* Top-level ControlPanel2 tabs (Build/Attack/Economy/Research/Bombers) */
        .cp2-tab {
          color: #c9dbff;
          border: 1px solid #0e1a33;
          background-color: #0b1220;
          border-radius: 6px;
          transition:
            background-color 0.15s ease-in-out,
            color 0.15s ease-in-out,
            border-color 0.15s ease-in-out,
            box-shadow 0.15s ease-in-out;
        }
        .cp2-tab:hover:not(.active) {
          background-color: #162544;
          color: #e3edff;
          border-color: #183152;
        }
        .cp2-tab.active {
          background-color: #182742;
          color: #e3edff;
          border-color: #27476e;
          box-shadow: 0 0 0 1px rgba(39, 71, 110, 0.35) inset;
        }

        .research-tabs {
          display: flex;
          margin-top: auto;
          /* submarine palette divider */
          border-top: 1px solid #27476e;
        }

        .research-tab {
          flex-grow: 1;
          padding: 8px 0;
          text-align: center;
          cursor: pointer;
          /* submarine palette button base */
          border: 1px solid #0e1a33;
          border-top: none;
          background-color: #0b1220;
          color: #c9dbff;
          box-shadow: inset 0px 2px 5px rgba(0, 0, 0, 0.4);
        }

        .research-tab:hover:not(.active) {
          background-color: #162544;
          color: #e3edff;
        }

        .research-tab.active {
          background-color: #182742;
          color: #e3edff;
          border-color: #27476e;
          border-bottom-color: transparent;
          box-shadow: 0px -2px 5px rgba(0, 0, 0, 0.2);
          position: relative;
          top: -1px;
          border-radius: 6px 6px 0 0;
        }

        /* Dedicated Research Tree button aligned to submarine palette */
        .research-button {
          background-color: #183152; /* slightly brighter than panel */
          color: #e3edff;
          border: 1px solid #27476e;
          padding: 4px 10px;
          text-transform: uppercase;
          font-size: 12px;
          font-family: monospace;
          transition:
            background-color 0.15s ease-in-out,
            box-shadow 0.15s ease-in-out,
            border-color 0.15s ease-in-out;
          box-shadow: 0 0 0 1px rgba(39, 71, 110, 0.35) inset;
          border-radius: 6px;
        }
        .research-button:hover {
          background-color: #1d3a60;
          border-color: #32629b;
          box-shadow: 0 0 0 2px rgba(50, 98, 155, 0.45) inset;
        }

        /* Simple progress bar for research items */
        .progress-track {
          width: 100%;
          height: 6px;
          background: rgba(39, 71, 110, 0.25);
          border: 1px solid rgba(39, 71, 110, 0.35);
          border-radius: 6px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #60a5fa, #3b82f6);
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
          background: #0b1220; /* dark navy to match submarine */
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
          border-color: #27476e; /* default subtle blue rim */
          box-shadow: 0 0 0 1px rgba(39, 71, 110, 0.35) inset;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: #0b1220; /* dark navy to match submarine */
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
          border-color: #27476e; /* default subtle blue rim */
          box-shadow: 0 0 0 1px rgba(39, 71, 110, 0.35) inset;
        }
        /* Subtle affordance on hover/focus */
        input[type="range"]:hover::-webkit-slider-thumb,
        input[type="range"]:focus::-webkit-slider-thumb {
          border-color: #32629b;
          box-shadow: 0 0 0 2px rgba(50, 98, 155, 0.45) inset;
        }
        input[type="range"]:hover::-moz-range-thumb,
        input[type="range"]:focus::-moz-range-thumb {
          border-color: #32629b;
          box-shadow: 0 0 0 2px rgba(50, 98, 155, 0.45) inset;
        }
        /* Standardize thumb rims to submarine blue (no per-slider overrides) */
        /* Removed unused green pulse styles */
        /* Disabled slider visual */
        .slider-disabled {
          opacity: 0.5;
          filter: grayscale(0.3);
        }
        /* Locked slider visual */
        .slider-locked::-webkit-slider-thumb {
          border-color: #f59e0b; /* amber */
          box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.45) inset;
        }
        .slider-locked::-moz-range-thumb {
          border-color: #f59e0b; /* amber */
          box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.45) inset;
        }
        .lock-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-left: 6px;
          color: #a0aec0;
          font-size: 11px;
          /* Ensure the badge aligns with surrounding text like "0%" */
          vertical-align: middle;
          line-height: 1em;
        }
        .lock-icon {
          width: 12px;
          height: 12px;
          fill: #a0aec0;
          /* Keep icon from affecting baseline height and align nicely */
          display: inline-block;
          vertical-align: middle;
          position: relative;
          top: -1px; /* nudge up to visually center with text */
        }
      </style>
      <div
        class="${this._isVisible && this.isOpen
          ? `w-full h-[260px] text-sm lg:text-m submarine-panel border-2 border-gray-700 p-2 pr-3 lg:p-4 flex flex-col transition-all duration-300 ml-8`
          : "hidden"}"
        style="box-shadow: inset 0 0 18px rgba(2, 8, 20, 0.8), 0 2px 6px rgba(0, 0, 0, 0.5);"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="flex border-b"
          style="border-color: rgba(24,39,66,0.7)"
          mb-4
        >
          <button
            class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
              .activeTab === "Build"
              ? "active"
              : ""}"
            @click=${() => this._changeTab("Build")}
          >
            Build
          </button>
          <button
            class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
              .activeTab === "Attack"
              ? "active"
              : ""}"
            @click=${() => this._changeTab("Attack")}
          >
            Attack
          </button>
          <button
            class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
              .activeTab === "Economy"
              ? "active"
              : ""}"
            @click=${() => this._changeTab("Economy")}
          >
            Economy
          </button>
          <button
            class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
              .activeTab === "Research"
              ? "active"
              : ""}"
            @click=${() => this._changeTab("Research")}
          >
            Research
          </button>
          ${this._hasAirfields
            ? html`
                <button
                  class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
                    .activeTab === "Bombers"
                    ? "active"
                    : ""} ${this._highlightBombersTab ? "highlight-tab" : ""}"
                  @click=${() => this._changeTab("Bombers")}
                >
                  Bombers
                </button>
              `
            : ""}
        </div>

        <div class="tab-content flex-grow overflow-y-auto max-w-full pr-4 pt-2">
          ${this.activeTab === "Bombers"
            ? html`
                <div class="flex w-full">
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
                            class="flex flex-col items-center justify-center h-full text-blue-300 font-bold text-center"
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
                                class="ml-1 p-1 bg-[#132036] text-white border border-[#27476e] rounded-sm w-full truncate"
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
                                    class="flex items-center space-x-1 p-1 border border-gray-700 rounded-sm cursor-pointer has-checked:border-blue-400"
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
                                      class="form-checkbox h-4 w-4 text-blue-400 bg-gray-700 border-gray-500 rounded-sm focus:ring-blue-400"
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
                          <div class="text-sm min-h-[20px]">
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
                <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                  <!-- Top-Left: Production -->
                  <div class="relative">
                    <label
                      class="block military-label mb-1 whitespace-nowrap"
                      translate="no"
                    >
                      Production Investment Rate:
                      ${(this.investmentRate * 100).toFixed(0)}%
                      ${this._lockProd
                        ? html`<span
                            class="lock-badge"
                            title="Slider is locked. Double-click the slider to unlock."
                          >
                            <svg
                              class="lock-icon"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                d="M8 10V7a4 4 0 118 0v3h1a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8a2 2 0 012-2h1zm2 0h4V7a2 2 0 10-4 0v3z"
                              />
                            </svg>
                            Locked
                          </span>`
                        : ""}
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
                        style="background-color:rgba(24,39,66,0.85)"
                      ></div>
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:${(this.investmentRate /
                          this.game.config().maxInvestmentRate()) *
                        100}%; background-color: rgba(64,123,189,0.6);"
                      ></div>
                      <input
                        type="range"
                        min="0"
                        max="${this.game?.config()?.maxInvestmentRate() * 100}"
                        .value=${(this.investmentRate * 100).toString()}
                        class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer military-slider ${this
                          ._lockProd
                          ? "slider-locked"
                          : ""}"
                        @dblclick=${() => (this._lockProd = !this._lockProd)}
                        @input=${(e: Event) => {
                          if (this._lockProd) {
                            (e.target as HTMLInputElement).value = (
                              this.investmentRate * 100
                            ).toString();
                            return;
                          }
                          const proposed =
                            parseInt((e.target as HTMLInputElement).value) /
                            100;
                          const { prod, road, research } =
                            this._applyTripleInvestmentConstraint(
                              "prod",
                              proposed,
                            );

                          const prodChanged = prod !== this.investmentRate;
                          const roadChanged = road !== this._roadInvestmentRate;
                          const researchChanged =
                            research !== this._researchInvestmentRate;

                          this.investmentRate = prod;
                          this._roadInvestmentRate = road;
                          this._researchInvestmentRate = research;

                          if (prodChanged)
                            this.onInvestmentRateChange(this.investmentRate);
                          if (roadChanged)
                            this.onRoadInvestmentChange(
                              this._roadInvestmentRate,
                            );
                          if (researchChanged)
                            this.onResearchInvestmentChange(
                              this._researchInvestmentRate,
                            );

                          localStorage.setItem(
                            "settings.investmentRate",
                            this.investmentRate.toString(),
                          );
                          localStorage.setItem(
                            "settings.roadInvestmentRate",
                            this._roadInvestmentRate.toString(),
                          );
                          localStorage.setItem(
                            "settings.researchInvestmentRate",
                            this._researchInvestmentRate.toString(),
                          );
                          // Snap slider back to the effective value in case constraint blocked change
                          (e.target as HTMLInputElement).value = (
                            this.investmentRate * 100
                          ).toString();
                        }}
                      />
                    </div>
                  </div>

                  <!-- Top-Right: Roads -->
                  <div class="relative ${!hasRoads ? "slider-disabled" : ""}">
                    ${(() => {
                      const me = this.game?.myPlayer?.();
                      const effectiveRoad = hasRoads
                        ? this._roadInvestmentRate
                        : 0;
                      // Use server-provided net pixels per second to avoid duplication
                      const pxPerSecond = me?.roadNetPixelsPerSecond?.() ?? 0;
                      // Compute break-even road investment (covers maintenance only)
                      const base = this.game
                        .config()
                        .roadConstructionBaseCost();
                      const maintMult = this.game
                        .config()
                        .roadMaintenanceMultiplier();
                      const length = me?.roadNetworkLength?.() ?? 0;
                      const prod = me?.productivity?.() ?? 1;
                      // Scale maintenance by current road quality (client mirrors server logic)
                      const quality = me?.roadNetworkQuality?.() ?? 100;
                      const minQ = this.game.config().roadQualityMin?.() ?? 0;
                      const maxQ = this.game.config().roadQualityMax?.() ?? 150;
                      const clampedQ = Math.max(minQ, Math.min(maxQ, quality));
                      const qFactor = clampedQ / 100;
                      const maintenancePerSecond =
                        base *
                        maintMult *
                        Math.max(0.0001, prod) *
                        length *
                        qFactor *
                        10; // per second
                      const grossPerSecond = me
                        ? this.game.config().grossGoldAdditionRate(me) * 10
                        : 0;
                      let breakEven = 0;
                      if (grossPerSecond > 0) {
                        breakEven = maintenancePerSecond / grossPerSecond;
                      } else {
                        breakEven = maintenancePerSecond > 0 ? 1 : 0;
                      }
                      if (!Number.isFinite(breakEven)) breakEven = 0;
                      breakEven = Math.max(0, Math.min(1, breakEven));
                      return html`
                        <label
                          class="block military-label mb-1 whitespace-nowrap"
                          translate="no"
                        >
                          Road investment: ${(effectiveRoad * 100).toFixed(0)}%
                          ${this._lockRoad && hasRoads
                            ? html`<span
                                class="lock-badge"
                                title="Slider is locked. Double-click the slider to unlock."
                              >
                                <svg
                                  class="lock-icon"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M8 10V7a4 4 0 118 0v3h1a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8a2 2 0 012-2h1zm2 0h4V7a2 2 0 10-4 0v3z"
                                  />
                                </svg>
                                Locked
                              </span>`
                            : ""}
                          ${!hasRoads
                            ? html`<span
                                class="lock-badge"
                                title=${`Research '${getTechMeta(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION, { strict: false }).name}' to enable road investment`}
                              >
                                <svg
                                  class="lock-icon"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M8 10V7a4 4 0 118 0v3h1a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8a2 2 0 012-2h1zm2 0h4V7a2 2 0 10-4 0v3z"
                                  />
                                </svg>
                                Locked
                              </span>`
                            : ""}
                        </label>
                        <div
                          class="text-right text-xs opacity-60 mt-1 military-label normal-case"
                          translate="no"
                        >
                          Road: ${pxPerSecond.toFixed(2)} px/s
                        </div>
                      `;
                    })()}
                    <div class="relative h-8">
                      <div
                        class="absolute left-0 right-0 top-3 h-2 rounded"
                        style="background-color:rgba(24,39,66,0.85)"
                      ></div>
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:${(
                          (hasRoads ? this._roadInvestmentRate : 0) * 100
                        ).toFixed(2)}%; background-color: rgba(64,123,189,0.6);"
                      ></div>
                      ${(() => {
                        const me = this.game?.myPlayer?.();
                        const base = this.game
                          .config()
                          .roadConstructionBaseCost();
                        const maintMult = this.game
                          .config()
                          .roadMaintenanceMultiplier();
                        const length = me?.roadNetworkLength?.() ?? 0;
                        const prod = me?.productivity?.() ?? 1;
                        // Scale maintenance by current road quality (client mirrors server logic)
                        const quality = me?.roadNetworkQuality?.() ?? 100;
                        const minQ = this.game.config().roadQualityMin?.() ?? 0;
                        const maxQ =
                          this.game.config().roadQualityMax?.() ?? 150;
                        const clampedQ = Math.max(
                          minQ,
                          Math.min(maxQ, quality),
                        );
                        const qFactor = clampedQ / 100;
                        const maintenancePerSecond =
                          base *
                          maintMult *
                          Math.max(0.0001, prod) *
                          length *
                          qFactor *
                          10;
                        const grossPerSecond = me
                          ? this.game.config().grossGoldAdditionRate(me) * 10
                          : 0;
                        let breakEven = 0;
                        if (grossPerSecond > 0) {
                          breakEven = maintenancePerSecond / grossPerSecond;
                        } else {
                          breakEven = maintenancePerSecond > 0 ? 1 : 0;
                        }
                        if (!Number.isFinite(breakEven)) breakEven = 0;
                        breakEven = Math.max(0, Math.min(1, breakEven));
                        const leftPct = (breakEven * 100).toFixed(2) + "%";
                        const percentLabel = (breakEven * 100).toFixed(0) + "%";
                        return html`
                          <div
                            class="absolute top-1"
                            style="left:${leftPct}; width:2px; height:10px; background-color: rgba(255,255,255,0.85); transform: translateX(-1px); border-radius: 1px;"
                            title=${`Break-even: ${percentLabel} (covers maintenance)`}
                          ></div>
                        `;
                      })()}
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        .value=${(this._roadInvestmentRate * 100).toString()}
                        ?disabled=${!hasRoads}
                        title=${!hasRoads
                          ? `Research '${getTechMeta(RESEARCH_TECH_IDS.POST_WAR_RECONSTRUCTION, { strict: false }).name}' to enable road investment`
                          : ""}
                        @input=${(e: Event) => {
                          if (!hasRoads) return;
                          if (this._lockRoad) {
                            (e.target as HTMLInputElement).value = (
                              this._roadInvestmentRate * 100
                            ).toString();
                            return;
                          }
                          const proposed =
                            parseInt((e.target as HTMLInputElement).value) /
                            100;
                          const { prod, road, research } =
                            this._applyTripleInvestmentConstraint(
                              "road",
                              proposed,
                            );

                          const prodChanged = prod !== this.investmentRate;
                          const roadChanged = road !== this._roadInvestmentRate;
                          const researchChanged =
                            research !== this._researchInvestmentRate;

                          this.investmentRate = prod;
                          this._roadInvestmentRate = road;
                          this._researchInvestmentRate = research;

                          if (roadChanged)
                            this.onRoadInvestmentChange(
                              this._roadInvestmentRate,
                            );
                          if (prodChanged)
                            this.onInvestmentRateChange(this.investmentRate);
                          if (researchChanged)
                            this.onResearchInvestmentChange(
                              this._researchInvestmentRate,
                            );

                          localStorage.setItem(
                            "settings.roadInvestmentRate",
                            this._roadInvestmentRate.toString(),
                          );
                          localStorage.setItem(
                            "settings.investmentRate",
                            this.investmentRate.toString(),
                          );
                          localStorage.setItem(
                            "settings.researchInvestmentRate",
                            this._researchInvestmentRate.toString(),
                          );
                          // Snap slider to effective value
                          (e.target as HTMLInputElement).value = (
                            this._roadInvestmentRate * 100
                          ).toString();
                        }}
                        class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer military-slider ${this
                          ._lockRoad && hasRoads
                          ? "slider-locked"
                          : ""}"
                        @dblclick=${() =>
                          hasRoads && (this._lockRoad = !this._lockRoad)}
                      />
                    </div>
                    <div
                      class="text-right text-xs opacity-60 mt-1 military-label normal-case"
                      translate="no"
                    >
                      ${(() => {
                        const p = this.game?.myPlayer?.();
                        const quality = p ? p.roadNetworkQuality() : 100;
                        const completion = p ? p.roadNetworkCompletion() : 100;
                        return html`Road network:
                          <span class="nowrap"
                            >Quality ${quality.toFixed(1)}%</span
                          >
                          ·
                          <span class="nowrap"
                            >Completion: ${Math.round(completion)}%</span
                          >`;
                      })()}
                    </div>
                  </div>
                  <div class="relative">
                    ${(() => {
                      // Removed gold cost display next to the research slider per request
                      return html`
                        <label class="block military-label mb-1" translate="no">
                          Research investment:
                          ${(this._researchInvestmentRate * 100).toFixed(0)}%
                          ${this._lockResearch
                            ? html`<span
                                class="lock-badge"
                                title="Slider is locked. Double-click the slider to unlock."
                              >
                                <svg
                                  class="lock-icon"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M8 10V7a4 4 0 118 0v3h1a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8a2 2 0 012-2h1zm2 0h4V7a2 2 0 10-4 0v3z"
                                  />
                                </svg>
                                Locked
                              </span>`
                            : ""}
                        </label>
                      `;
                    })()}
                    <div class="relative h-8">
                      <div
                        class="absolute left-0 right-0 top-3 h-2 rounded"
                        style="background-color:rgba(24,39,66,0.85)"
                      ></div>
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:${(
                          this._researchInvestmentRate * 100
                        ).toFixed(2)}%; background-color: rgba(64,123,189,0.6);"
                      ></div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        .value=${(
                          this._researchInvestmentRate * 100
                        ).toString()}
                        @input=${(e: Event) => {
                          if (this._lockResearch) {
                            (e.target as HTMLInputElement).value = (
                              this._researchInvestmentRate * 100
                            ).toString();
                            return;
                          }
                          const proposed =
                            parseInt((e.target as HTMLInputElement).value) /
                            100;
                          const { prod, road, research } =
                            this._applyTripleInvestmentConstraint(
                              "research",
                              proposed,
                            );

                          const prodChanged = prod !== this.investmentRate;
                          const roadChanged = road !== this._roadInvestmentRate;
                          const researchChanged =
                            research !== this._researchInvestmentRate;

                          this.investmentRate = prod;
                          this._roadInvestmentRate = road;
                          this._researchInvestmentRate = research;

                          if (prodChanged)
                            this.onInvestmentRateChange(this.investmentRate);
                          if (roadChanged)
                            this.onRoadInvestmentChange(
                              this._roadInvestmentRate,
                            );
                          if (researchChanged)
                            this.onResearchInvestmentChange(
                              this._researchInvestmentRate,
                            );

                          localStorage.setItem(
                            "settings.investmentRate",
                            this.investmentRate.toString(),
                          );
                          localStorage.setItem(
                            "settings.roadInvestmentRate",
                            this._roadInvestmentRate.toString(),
                          );
                          localStorage.setItem(
                            "settings.researchInvestmentRate",
                            this._researchInvestmentRate.toString(),
                          );
                          // Snap slider to effective value
                          (e.target as HTMLInputElement).value = (
                            this._researchInvestmentRate * 100
                          ).toString();
                        }}
                        class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer military-slider ${this
                          ._lockResearch
                          ? "slider-locked"
                          : ""}"
                        @dblclick=${() =>
                          (this._lockResearch = !this._lockResearch)}
                      />
                    </div>
                  </div>
                  <!-- Bottom-Right: Military Expenditure (locked) -->
                  <div class="relative slider-disabled">
                    <label class="block military-label mb-1" translate="no">
                      Military Expenditure: 0%
                      <span
                        class="lock-badge"
                        title="This slider is locked and not yet available."
                      >
                        <svg
                          class="lock-icon"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            d="M8 10V7a4 4 0 118 0v3h1a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8a2 2 0 012-2h1zm2 0h4V7a2 2 0 10-4 0v3z"
                          />
                        </svg>
                        Locked
                      </span>
                    </label>
                    <div class="relative h-8">
                      <div
                        class="absolute left-0 right-0 top-3 h-2 rounded"
                        style="background-color:rgba(24,39,66,0.85)"
                      ></div>
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:0%; background-color: rgba(64,123,189,0.6);"
                      ></div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        .value=${"0"}
                        disabled
                        title="Locked"
                        class="absolute left-0 right-0 top-2 m-0 h-4 military-slider slider-locked cursor-not-allowed"
                      />
                    </div>
                  </div>
                </div>
              `
            : ""}
          ${this.activeTab === "Research"
            ? (() => {
                const me = this.game?.myPlayer?.();
                const techs = getTechNodes();
                const researched = new Set<string>();
                if (me) {
                  for (const t of techs)
                    if (me.hasResearchedTech(t.id)) researched.add(t.id);
                }
                const active = me
                  ? techs
                      .map((t) => {
                        const beakers = me.researchBeakers?.(t.id) ?? 0;
                        const cost = t.cost || 1;
                        const pct = Math.max(
                          0,
                          Math.min(100, Math.floor((beakers / cost) * 100)),
                        );
                        return {
                          id: t.id,
                          name: t.name,
                          beakers,
                          cost,
                          pct,
                          isDone: researched.has(t.id),
                        };
                      })
                      .filter((x) => x.beakers > 0 && !x.isDone)
                      .sort((a, b) => b.pct - a.pct)
                  : [];
                const priorityId = me?.researchPriorityTech?.() ?? null;
                const priorityName = priorityId
                  ? getTechMeta(priorityId, { strict: false }).name
                  : "None";
                return html`<div class="flex h-full flex-col">
                  <h3 class="military-heading mb-2">Research</h3>
                  <div class="mb-2 military-label" style="font-size: 11px;">
                    Current Priority:
                    <span class="font-semibold">${priorityName}</span>
                  </div>
                  <div
                    class="grid grid-cols-2 gap-x-3 gap-y-1 pr-1"
                    style="font-size: 11px;"
                  >
                    ${active.length === 0
                      ? html`<div class="opacity-70 col-span-2">
                          No active research yet. Set a priority in the Research
                          Tree or allocate Research investment.
                        </div>`
                      : (() => {
                          const n = active.length;
                          const leftCount = Math.ceil(n / 2);
                          const remapped: typeof active = [];
                          for (let i = 0; i < leftCount; i++) {
                            remapped.push(active[i]);
                            if (i + leftCount < n)
                              remapped.push(active[i + leftCount]);
                          }
                          return remapped.map(
                            (it) =>
                              html`<div
                                class="flex items-center justify-between"
                                title="${it.name}"
                              >
                                <div class="truncate pr-2">${it.name}</div>
                                <div class="opacity-80" translate="no">
                                  ${it.beakers.toLocaleString()} /
                                  ${it.cost.toLocaleString()} (${it.pct}%)
                                </div>
                              </div>`,
                          );
                        })()}
                  </div>
                  <div class="mt-auto flex justify-end pt-2">
                    <button
                      class="research-button"
                      title="Open Research Tree"
                      @click=${() => {
                        const modal = document.querySelector(
                          "research-tree-modal",
                        ) as any;
                        if (modal) {
                          modal.game = this.game;
                          modal.eventBus = this.eventBus;
                          modal.open();
                        }
                      }}
                    >
                      Research Tree
                    </button>
                  </div>
                </div>`;
              })()
            : ""}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
