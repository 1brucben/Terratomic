import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import multiBuildIcon from "../../../../resources/images/MultiBuildIcon.svg";
import upgradeArrowIcon from "../../../../resources/images/UpgradeArrowIcon.svg";
import type { EventBus } from "../../../core/EventBus";
import type { Gold, PlayerID } from "../../../core/game/Game";
import { PlayerType, UnitType, UpgradeType } from "../../../core/game/Game";
import type {
  GameView,
  PlayerView,
  UnitView,
} from "../../../core/game/GameView";
import {
  isUnitAvailable,
  maxStructureLevel,
  maxUnitLevel,
  playerMaxStructureLevel,
  playerMaxUnitLevel,
} from "../../../core/game/Upgradeables";
import { getTechMeta, RESEARCH_TECH_IDS } from "../../../core/tech/TechEffects";
import { translateText } from "../../Utils";
// Ensure modal custom elements register at runtime
import "../../BuildSettingsModal";
import {
  INVESTMENT_REQUEST_EVENT,
  INVESTMENT_SYNC_EVENT,
  INVESTMENT_SYNC_REQUEST_EVENT,
  type InvestmentRequestDetail,
  type InvestmentSyncDetail,
} from "../../events/InvestmentEvents";
import { PlayerListChangedEvent } from "../../events/PlayerListChangedEvent";
import { ToggleBomberUpgradeModeEvent } from "../../events/ToggleBomberUpgradeModeEvent";
import { ToggleUpgradeModeEvent } from "../../events/ToggleUpgradeModeEvent";
import { AttackRatioEvent } from "../../InputHandler";
import "../../StatisticsModal"; // ensure statistics modal is registered
import {
  SendAllianceRequestIntentEvent,
  SendBomberIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDeclareWarIntentEvent,
  SendEmbargoIntentEvent,
  SendPeaceRequestIntentEvent,
  SendSetAutoBombingEvent,
  SendSetInvestmentRateEvent,
  SendSetResearchInvestmentEvent,
  SendSetRoadInvestmentEvent,
  SendSetTargetTroopRatioEvent,
} from "../../Transport";
import "../../UnitUpgradeSettingsModal";
import type { UIState } from "../UIState";
import { ToggleBuildPanelEvent } from "./ControlPanel";
import type { Layer } from "./Layer";

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

  // Track if we've set the default road investment when Roads upgrade is unlocked
  @state()
  private _hasSetRoadInvestmentDefault: boolean = false;

  @state()
  private _population: number;

  @state()
  private _isVisible = false;

  @state()
  private isOpen = false;

  @state()
  private _gold: Gold;

  @state()
  private _productivity: number;

  @state()
  private _productivityGrowth: number;

  private init_: boolean = false;

  @state()
  private activeTab:
    | "Build"
    | "Attack"
    | "Economy"
    | "Bombers"
    | "Trade"
    | "Diplomacy" = "Build";

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
  private _currentTargetStructureTypes: UnitType[] = [];

  @state()
  private _currentTargetPlayerName: string | null = null;

  @state()
  private _bomberPreferClosest: boolean = true;

  @state()
  private _isAutoBombingEnabled: boolean = false;

  @state()
  private _lastSelectedBomberTarget: PlayerID | null = null;

  @state()
  private _multibuildEnabled: boolean = false;

  @state()
  private _structureLevels: Record<string, number> = {};

  @state()
  private _unitLevels: Record<string, number> = {};

  @state()
  private _uiSelectedStructures: UnitType[] = [];

  private unitIconMap: { [key: string]: string } = {
    City: "/images/CityIconWhite.svg",
    Hospital: "/images/HospitalIconWhite.svg",
    "Research Lab": "/images/researchlab.png",
    Academy: "/images/AcademyIconWhite.png",
    Factory: "/images/factoryicon.png",
    Port: "/images/PortIcon.svg",
    "Missile Silo": "/images/MissileSiloIconWhite.svg",
    "SAM Launcher": "/images/SamLauncherIconWhite.svg",
    "Air Field": "/images/AirfieldIcon.svg",
    "Defense Post": "/images/ShieldIconWhite.svg",
    "Doomsday Device": "/images/Doomsdayicon.png",
  };

  // Per-unit icon scale used for small inline icons in this panel
  private static readonly ICON_SCALE: Partial<Record<UnitType, number>> = {
    [UnitType.City]: 1,
    [UnitType.Hospital]: 1,
    [UnitType.ResearchLab]: 1.1,
    [UnitType.Academy]: 1,
    [UnitType.Factory]: 1,
    [UnitType.Port]: 1,
    [UnitType.MissileSilo]: 1,
    [UnitType.SAMLauncher]: 1,
    [UnitType.Airfield]: 1,
    [UnitType.DefensePost]: 1,
    [UnitType.DoomsdayDevice]: 1,
  };

  private iconPixelSize(t: UnitType | null, base = 16): number {
    if (!t) return base;
    const factor = ControlPanel2.ICON_SCALE[t] ?? 1;
    return Math.max(1, Math.round(base * factor));
  }

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
    UnitType.ResearchLab,
    UnitType.Academy,
    UnitType.Factory,
    UnitType.City,
    UnitType.DoomsdayDevice,
  ];

  private readonly investmentRequestHandler = (event: Event) => {
    const { detail } = event as CustomEvent<InvestmentRequestDetail>;
    if (!detail) return;
    if (detail.type === "set") {
      const value = Math.max(0, Math.min(1, detail.value ?? 0));
      if (detail.slider === "road" && !this.playerHasRoadsUpgrade()) return;
      this.applyInvestmentChange(detail.slider, value);
    } else if (detail.type === "toggle-lock") {
      if (detail.slider === "prod") {
        this._lockProd = !this._lockProd;
      } else if (detail.slider === "road") {
        if (!this.playerHasRoadsUpgrade()) return;
        this._lockRoad = !this._lockRoad;
      } else if (detail.slider === "research") {
        this._lockResearch = !this._lockResearch;
      }
      this.emitInvestmentSync();
      this.requestUpdate();
    }
  };

  private readonly investmentSyncRequestHandler = () => {
    this.emitInvestmentSync();
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(
      INVESTMENT_REQUEST_EVENT,
      this.investmentRequestHandler as EventListener,
    );
    window.addEventListener(
      INVESTMENT_SYNC_REQUEST_EVENT,
      this.investmentSyncRequestHandler,
    );
  }

  disconnectedCallback(): void {
    window.removeEventListener(
      INVESTMENT_REQUEST_EVENT,
      this.investmentRequestHandler as EventListener,
    );
    window.removeEventListener(
      INVESTMENT_SYNC_REQUEST_EVENT,
      this.investmentSyncRequestHandler,
    );
    super.disconnectedCallback();
  }

  // Restore disabled shadow DOM so legacy global CSS and querySelector usage continue working
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this; // Render into light DOM
  }

  init() {
    this.attackRatio = Number(
      localStorage.getItem("settings.attackRatio") ?? "0.3",
    );
    this.targetTroopRatio = Number(
      localStorage.getItem("settings.troopRatio") ?? "0.6",
    );
    // Set default investment values to help new players discover these features
    // Values are configurable in DefaultConfig
    this.investmentRate = 0; // Production investment starts at 0%
    this._roadInvestmentRate = 0; // Roads start at 0% (will be set when unlocked)
    this._researchInvestmentRate = this.game
      .config()
      .defaultResearchInvestment();
    // Persist default values so UI and other readers start with these defaults
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

    // Select first 6 structures by default for the UI
    this._uiSelectedStructures = [
      UnitType.City,
      UnitType.DefensePost,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.Airfield,
    ];

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

    // Load structure levels
    try {
      const raw = localStorage.getItem("buildSettings.levels");
      if (raw) {
        this._structureLevels = JSON.parse(raw);
      }
    } catch (e) {
      console.warn("Failed to load build settings", e);
    }

    // Load unit levels
    try {
      const raw = localStorage.getItem("unitUpgradeSettings.levels");
      if (raw) {
        this._unitLevels = JSON.parse(raw);
      }
    } catch (e) {
      console.warn("Failed to load unit upgrade settings", e);
    }
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
    if (!player?.isAlive()) {
      this.setVisibile(false);
      return;
    }

    this._population = player.population();
    this._gold = player.gold();
    this._productivity = player.productivity();
    this._productivityGrowth = player.productivityGrowthPerMinute();
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
      // Reset the flag so we can set default again if they re-research it
      this._hasSetRoadInvestmentDefault = false;
    }

    // Auto-activate road investment when Roads upgrade is first unlocked
    // This helps new players discover the road investment feature
    // Default value is configurable in DefaultConfig
    if (
      hasRoadsUpgrade &&
      !this._hasSetRoadInvestmentDefault &&
      this._roadInvestmentRate === 0
    ) {
      this._roadInvestmentRate = this.game.config().defaultRoadInvestment();
      this.onRoadInvestmentChange(this._roadInvestmentRate);
      localStorage.setItem(
        "settings.roadInvestmentRate",
        this._roadInvestmentRate.toString(),
      );
      this._hasSetRoadInvestmentDefault = true;
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

  private applyInvestmentChange(
    changed: "prod" | "road" | "research",
    proposed: number,
  ) {
    const { prod, road, research } = this._applyTripleInvestmentConstraint(
      changed,
      proposed,
    );
    this.commitInvestmentRates(prod, road, research);
  }

  private commitInvestmentRates(
    prod: number,
    road: number,
    research: number,
  ): boolean {
    const prodChanged = Math.abs(prod - this.investmentRate) > 1e-6;
    const roadChanged = Math.abs(road - this._roadInvestmentRate) > 1e-6;
    const researchChanged =
      Math.abs(research - this._researchInvestmentRate) > 1e-6;

    if (!prodChanged && !roadChanged && !researchChanged) {
      return false;
    }

    this.investmentRate = prod;
    this._roadInvestmentRate = road;
    this._researchInvestmentRate = research;

    if (prodChanged) {
      this.onInvestmentRateChange(this.investmentRate);
      this.uiState.investmentRate = this.investmentRate;
      localStorage.setItem(
        "settings.investmentRate",
        this.investmentRate.toString(),
      );
    }
    if (roadChanged) {
      this.onRoadInvestmentChange(this._roadInvestmentRate);
      localStorage.setItem(
        "settings.roadInvestmentRate",
        this._roadInvestmentRate.toString(),
      );
    }
    if (researchChanged) {
      this.onResearchInvestmentChange(this._researchInvestmentRate);
      localStorage.setItem(
        "settings.researchInvestmentRate",
        this._researchInvestmentRate.toString(),
      );
    }

    this.emitInvestmentSync();
    return true;
  }

  private emitInvestmentSync() {
    const detail: InvestmentSyncDetail = {
      prod: this.investmentRate,
      road: this._roadInvestmentRate,
      research: this._researchInvestmentRate,
      lockProd: this._lockProd,
      lockRoad: this._lockRoad,
      lockResearch: this._lockResearch,
      roadEnabled: this.playerHasRoadsUpgrade(),
    };
    window.dispatchEvent(
      new CustomEvent<InvestmentSyncDetail>(INVESTMENT_SYNC_EVENT, {
        detail,
      }),
    );
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

  onTroopChange(newRatio: number) {
    this.eventBus.emit(new SendSetTargetTroopRatioEvent(newRatio));
  }

  private playerHasRoadsUpgrade(): boolean {
    const player = this.game?.myPlayer?.();
    return player?.hasUpgrade?.(UpgradeType.Roads) ?? false;
  }

  private _getPlayersInAirfieldRange(): PlayerView[] {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer?.isAlive()) {
      return [];
    }

    const myAirfields = myPlayer
      .units(UnitType.Airfield)
      .filter((u) => u.isActive());
    if (myAirfields.length === 0) {
      return [];
    }

    const reachablePlayers = new Map<PlayerID, PlayerView>();

    const structureIndex = this.game.getStructureIndex();

    for (const airfield of myAirfields) {
      const bomberRange = this.game
        .config()
        .bomberTargetRange(airfield.bomberLevel());
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

    // Apply translations to tooltips after rendering
    this.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key) {
        el.setAttribute("title", translateText(key));
      }
    });
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

    if (!playerSelect || this._uiSelectedStructures.length === 0) return;

    const targetID = String(playerSelect.value);
    // Use the state variable instead of querying the DOM
    const structures = [...this._uiSelectedStructures];

    this.sendBomberIntent(targetID, structures, this._bomberPreferClosest);
  }

  sendBomberIntent(
    targetID: string | null,
    structures: UnitType[] | null,
    preferClosest: boolean,
  ) {
    if (!this.eventBus) return;
    this._currentTargetPlayerId = targetID;
    this._currentTargetStructureTypes = structures ?? [];
    this._bomberPreferClosest = preferClosest;
    if (targetID) {
      const targetPlayer = this.game.players().find((p) => p.id() === targetID);
      this._currentTargetPlayerName = targetPlayer ? targetPlayer.name() : null;
    } else {
      this._currentTargetPlayerName = null;
    }
    this.eventBus.emit(
      new SendBomberIntentEvent(targetID, structures, preferClosest),
    );
  }

  _startAutoBombing() {
    this._isAutoBombingEnabled = true;
    this.eventBus.emit(new SendSetAutoBombingEvent(true));
    // Clear any manual target when auto-bombing is enabled
    this.sendBomberIntent(null, null, true);
  }

  async _stopAutoBombing() {
    this._isAutoBombingEnabled = false;
    this.eventBus.emit(new SendSetAutoBombingEvent(false));
    // Clear any manual target when auto-bombing is disabled
    this.sendBomberIntent(null, null, true);

    await this.updateComplete; // Wait for the UI to update

    this._refreshBomberPlayerLists(); // NOW refresh the list
  }

  handleStructureChange(e: Event) {
    const checkbox = e.target as HTMLInputElement;
    const value = checkbox.value as UnitType;

    if (checkbox.checked) {
      if (!this._uiSelectedStructures.includes(value)) {
        this._uiSelectedStructures = [...this._uiSelectedStructures, value];
      }
    } else {
      this._uiSelectedStructures = this._uiSelectedStructures.filter(
        (s) => s !== value,
      );
    }
    this.requestUpdate();
  }

  private _handleBomberTargetChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this._lastSelectedBomberTarget = select.value;
  }

  private _handleMultibuildToggle() {
    this._multibuildEnabled = !this._multibuildEnabled;
    this.uiState.multibuildEnabled = this._multibuildEnabled;
    // Disable upgrade mode if mass production is enabled
    if (this._multibuildEnabled && this.uiState.upgradeMode) {
      this.uiState.upgradeMode = false;
      this.eventBus.emit(new ToggleUpgradeModeEvent(false));
    }
    // Disable bomber upgrade mode if mass production is enabled
    if (this._multibuildEnabled && this.uiState.bomberUpgradeMode) {
      this.uiState.bomberUpgradeMode = false;
      this.eventBus.emit(new ToggleBomberUpgradeModeEvent(false));
    }
    this.requestUpdate();
  }

  private _openBuildSettings() {
    const modal =
      (document.querySelector("build-settings-modal") as any) ??
      this._ensureBuildSettingsModal();
    if (!modal) {
      console.warn("BuildSettingsModal element not found or failed to create");
      return;
    }
    const openFn = modal.open;
    // Get player-specific max level and availability functions for structures
    const player = this.game?.myPlayer();
    const maxLevelFn = player
      ? (type: UnitType) => playerMaxStructureLevel(player, type)
      : undefined;
    const isAvailableFn = player
      ? (type: UnitType) => isUnitAvailable(player, type)
      : undefined;
    if (typeof openFn !== "function") {
      // Fallback if element existed before registration; re-import then retry
      import("../../BuildSettingsModal").then(() => {
        const retryOpen = modal.open;
        if (typeof retryOpen === "function") {
          retryOpen.call(
            modal,
            this.StructureTypes,
            this.unitIconMap,
            maxLevelFn,
            isAvailableFn,
          );
        } else {
          console.warn("BuildSettingsModal still missing open() after import");
        }
      });
      return;
    }
    openFn.call(
      modal,
      this.StructureTypes,
      this.unitIconMap,
      maxLevelFn,
      isAvailableFn,
    );
  }

  private _ensureBuildSettingsModal(): HTMLElement | null {
    let el = document.querySelector(
      "build-settings-modal",
    ) as HTMLElement | null;
    if (!el) {
      el = document.createElement("build-settings-modal");
      document.body.appendChild(el);
    }
    return el;
  }

  private _openUnitUpgradeSettings() {
    const modal =
      (document.querySelector("unit-upgrade-settings-modal") as any) ??
      this._ensureUnitUpgradeSettingsModal();
    if (!modal) {
      console.warn(
        "UnitUpgradeSettingsModal element not found or failed to create",
      );
      return;
    }
    const openFn = modal.open;
    const unitTypes = [
      UnitType.Warship,
      UnitType.FighterJet,
      UnitType.Submarine,
      UnitType.Bomber,
    ];
    if (typeof openFn !== "function") {
      console.warn("UnitUpgradeSettingsModal missing open() method");
      return;
    }
    // Pass player-specific max level function and availability check based on researched techs
    const player = this.game?.myPlayer();
    const maxLevelFn = player
      ? (type: UnitType) => playerMaxUnitLevel(player, type)
      : undefined;
    const isAvailableFn = player
      ? (type: UnitType) => isUnitAvailable(player, type)
      : undefined;
    openFn.call(modal, unitTypes, {}, maxLevelFn, isAvailableFn);
  }

  private _ensureUnitUpgradeSettingsModal(): HTMLElement | null {
    let el = document.querySelector(
      "unit-upgrade-settings-modal",
    ) as HTMLElement | null;
    if (!el) {
      el = document.createElement("unit-upgrade-settings-modal");
      document.body.appendChild(el);
    }
    return el;
  }

  private _changeTab(
    tab: "Build" | "Attack" | "Economy" | "Bombers" | "Trade" | "Diplomacy",
  ) {
    this.activeTab = tab;
    if (this.uiState.pendingBuildUnitType) {
      this.uiState.pendingBuildUnitType = null;
    }
  }

  private _openStatistics() {
    const modal =
      (document.querySelector("statistics-modal") as any) ??
      this._ensureStatisticsModal();
    if (!modal) {
      console.warn("StatisticsModal element not found or failed to create");
      return;
    }
    const openFn = modal.open;
    if (typeof openFn === "function") {
      // Pass current GameView so modal can populate player dropdown
      try {
        if (this.game) {
          modal.game = this.game; // property defined on statistics-modal
        }
      } catch (_) {
        /* non-fatal */
      }
      openFn.call(modal);
    }
  }

  private _ensureStatisticsModal(): HTMLElement | null {
    let el = document.querySelector("statistics-modal") as HTMLElement | null;
    if (!el) {
      el = document.createElement("statistics-modal");
      document.body.appendChild(el);
    }
    return el;
  }

  render() {
    if (!this.game) {
      return html``;
    }

    const player = this.game.myPlayer();
    const hasRoads = player?.hasUpgrade(UpgradeType.Roads) ?? false;

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

        /* Top-level ControlPanel2 tabs (Build/Attack/Economy/Bombers) */
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
          ? `w-full h-[260px] text-sm lg:text-m submarine-panel border-2 border-gray-700 p-2 pr-3 lg:p-4 flex flex-col transition-all duration-300 ml-2 lg:ml-0`
          : "hidden"}"
        style="box-shadow: inset 0 0 18px rgba(2, 8, 20, 0.8), 0 2px 6px rgba(0, 0, 0, 0.5);"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="flex border-b items-stretch"
          style="border-color: var(--ui-panel-border)"
          mb-4
        >
          <button
            class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
              .activeTab === "Build"
              ? "active"
              : ""}"
            @click=${() => this._changeTab("Build")}
            data-i18n-title="control_panel2.build_tab_tooltip"
          >
            Build
          </button>
          <button
            class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
              .activeTab === "Attack"
              ? "active"
              : ""}"
            @click=${() => this._changeTab("Attack")}
            data-i18n-title="control_panel2.attack_tab_tooltip"
          >
            Attack
          </button>
          <button
            class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
              .activeTab === "Economy"
              ? "active"
              : ""}"
            @click=${() => this._changeTab("Economy")}
            data-i18n-title="control_panel2.economy_tab_tooltip"
          >
            Economy
          </button>
          <button
            class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
              .activeTab === "Trade"
              ? "active"
              : ""}"
            @click=${() => this._changeTab("Trade")}
            data-i18n-title="control_panel2.trade_tab_tooltip"
          >
            Trade
          </button>
          <button
            class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
              .activeTab === "Diplomacy"
              ? "active"
              : ""}"
            @click=${() => this._changeTab("Diplomacy")}
            data-i18n-title="control_panel2.diplomacy_tab_tooltip"
          >
            Diplomacy
          </button>
          ${this._hasAirfields
            ? html`
                <button
                  class="py-2 px-4 text-center font-ocr uppercase cp2-tab ${this
                    .activeTab === "Bombers"
                    ? "active"
                    : ""} ${this._highlightBombersTab ? "highlight-tab" : ""}"
                  @click=${() => this._changeTab("Bombers")}
                  data-i18n-title="control_panel2.bombers_tab_tooltip"
                >
                  Bombers
                </button>
              `
            : ""}
          <div class="ml-auto flex items-center">
            <button
              class="cp2-tab flex items-center justify-center mx-1"
              style="width:34px; height:34px; padding:0;"
              title="Statistics"
              @click=${() => this._openStatistics()}
            >
              <img
                src="/images/Statisticsicon.png"
                alt="Statistics"
                style="width:27px; height:27px; object-fit:contain; border-radius:4px; display:block;"
              />
            </button>
          </div>
        </div>

        <div class="tab-content flex-grow overflow-y-auto max-w-full pr-4 pt-2">
          ${this.activeTab === "Bombers"
            ? html`

                <div class="flex w-full gap-2 h-full">
                  <!-- Column 1: Targeting Configuration (2/3 width) -->
                  <div class="w-2/3 flex flex-col gap-2">
                    ${
                      this._isAutoBombingEnabled
                        ? html`
                            <div
                              class="flex flex-col items-center justify-center h-full text-blue-300 font-bold text-center border border-dashed border-blue-900 rounded bg-blue-900/20"
                            >
                              <div class="text-lg mb-2">
                                AUTO-BOMBING ACTIVE
                              </div>
                              <div class="text-sm opacity-80">
                                Bombers are automatically targeting nearby
                                enemies.
                              </div>
                            </div>
                          `
                        : html`
                            <div class="flex gap-2 items-end">
                              <label class="flex-grow text-sm military-label">
                                Target Player
                                <select
                                  id="bomber-player-select"
                                  class="mt-1 block w-full p-1 text-white rounded-sm truncate text-sm"
                                  style="background-color: var(--ui-secondary); border: 1px solid var(--ui-panel-border);"
                                  @change=${this._handleBomberTargetChange}
                                ></select>
                              </label>

                              <div class="flex flex-col justify-end pb-0.5">
                                <span class="text-[10px] military-label mb-1"
                                  >Priority</span
                                >
                                <div class="flex bg-gray-800 rounded p-0.5">
                                  <label
                                    class="flex items-center px-2 py-0.5 cursor-pointer hover:bg-gray-700 rounded transition-colors"
                                    title="Target closest structures first"
                                  >
                                    <input
                                      type="radio"
                                      name="distance-pref"
                                      value="closest"
                                      ?checked=${this._bomberPreferClosest}
                                      @change=${() => {
                                        this._bomberPreferClosest = true;
                                      }}
                                      class="hidden"
                                    />
                                    <span
                                      class="text-xs ${this._bomberPreferClosest
                                        ? "text-blue-400 font-bold"
                                        : "text-gray-400"}"
                                      >Closest</span
                                    >
                                  </label>
                                  <div class="w-px bg-gray-700 mx-0.5"></div>
                                  <label
                                    class="flex items-center px-2 py-0.5 cursor-pointer hover:bg-gray-700 rounded transition-colors"
                                    title="Target furthest structures first"
                                  >
                                    <input
                                      type="radio"
                                      name="distance-pref"
                                      value="furthest"
                                      ?checked=${!this._bomberPreferClosest}
                                      @change=${() => {
                                        this._bomberPreferClosest = false;
                                      }}
                                      class="hidden"
                                    />
                                    <span
                                      class="text-xs ${!this
                                        ._bomberPreferClosest
                                        ? "text-blue-400 font-bold"
                                        : "text-gray-400"}"
                                      >Furthest</span
                                    >
                                  </label>
                                </div>
                              </div>
                            </div>

                            <div class="flex-grow flex flex-col min-h-0">
                              <label class="text-xs military-label mb-1"
                                >Target Structures</label
                              >
                              <div
                                class="grid grid-cols-11 gap-1.5 overflow-y-auto pr-1"
                              >
                                ${[
                                  UnitType.City,
                                  UnitType.DefensePost,
                                  UnitType.SAMLauncher,
                                  UnitType.MissileSilo,
                                  UnitType.Port,
                                  UnitType.Airfield,
                                  UnitType.Hospital,
                                  UnitType.Academy,
                                  UnitType.ResearchLab,
                                  UnitType.Factory,
                                  UnitType.DoomsdayDevice,
                                ].map((s) => {
                                  const isSelected =
                                    this._uiSelectedStructures.includes(s);
                                  return html`
                                    <label
                                      class="flex flex-col items-center justify-center p-0.5 rounded cursor-pointer transition-all aspect-square ${isSelected
                                        ? "border-[0.5px] border-white shadow-[0_0_5px_rgba(29,58,96,1.0)]"
                                        : "border border-gray-700 hover:bg-gray-800"}"
                                      style="${isSelected
                                        ? "background-color: rgb(29, 58, 96);"
                                        : ""}"
                                      title="${s}"
                                    >
                                      <input
                                        type="checkbox"
                                        name="structure"
                                        value="${s}"
                                        class="hidden"
                                        .checked=${isSelected}
                                        @change=${this.handleStructureChange}
                                      />
                                      <img
                                        src="${this.unitIconMap[s]}"
                                        alt="${s}"
                                        class="w-4 h-4 object-contain"
                                      />
                                    </label>
                                  `;
                                })}
                              </div>
                            </div>

                            <!-- SET TARGET Button -->
                            <div class="flex gap-2 items-center mt-2">
                              <button
                                type="button"
                                class="military-button py-2 px-4 font-bold"
                                @click=${this.handleBomberIntent}
                              >
                                SET TARGET
                              </button>
                              <button
                                type="button"
                                class="text-xs text-gray-400 hover:text-white underline"
                                @click=${() =>
                                  this.sendBomberIntent(null, null, true)}
                              >
                                Clear
                              </button>
                              <div class="text-xs flex-grow">
                                ${this._currentTargetPlayerId &&
                                this._currentTargetStructureTypes.length > 0
                                  ? html`
                                      <div class="flex items-center gap-2">
                                        <span class="font-bold text-blue-300"
                                          >${this
                                            ._currentTargetPlayerName}</span
                                        >
                                        <span class="text-[10px] text-gray-400"
                                          >${this._bomberPreferClosest
                                            ? "Closest"
                                            : "Furthest"}</span
                                        >
                                        <div class="flex gap-0.5">
                                          ${this._currentTargetStructureTypes.map(
                                            (structType) => html`
                                              <img
                                                src="${this.unitIconMap[
                                                  structType
                                                ]}"
                                                class="w-3 h-3 opacity-80"
                                              />
                                            `,
                                          )}
                                        </div>
                                      </div>
                                    `
                                  : html`<span class="text-gray-500 italic"
                                      >No target set</span
                                    >`}
                              </div>
                            </div>
                          `
                    }
                  </div>

                  <!-- Column 2: Actions & Status (1/3 width) -->
                  <div class="w-1/3 flex flex-col gap-2 pl-2 border-l border-gray-800">
                    <!-- Upgrade Bombers Button -->
                    <div class="bg-gray-900/50 p-2 rounded border border-gray-800">
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-xs font-bold text-gray-300"
                          >Upgrade Bombers</span
                        >
                        <div
                          class="w-2 h-2 rounded-full ${
                            this.uiState.bomberUpgradeMode
                              ? "bg-green-500 shadow-[0_0_5px_#22c55e]"
                              : "bg-gray-600"
                          }"
                        ></div>
                      </div>
                      <button
                        type="button"
                        class="military-button w-full text-xs py-1.5"
                        title="Click airfields to upgrade their bombers"
                        @click=${() => {
                          const enabled = !this.uiState.bomberUpgradeMode;
                          this.uiState.bomberUpgradeMode = enabled;
                          this.eventBus.emit(
                            new ToggleBomberUpgradeModeEvent(enabled),
                          );
                          // Disable structure upgrade mode if bomber upgrade is enabled
                          if (enabled && this.uiState.upgradeMode) {
                            this.uiState.upgradeMode = false;
                            this.eventBus.emit(
                              new ToggleUpgradeModeEvent(false),
                            );
                          }
                          // Clear pending build selection when upgrade is enabled
                          if (enabled) {
                            this.uiState.pendingBuildUnitType = null;
                          }
                          this.requestUpdate();
                        }}
                      >
                        Upgrade Bombers
                      </button>
                    </div>

                    <!-- Auto-Bombing Toggle -->
                    <div class="bg-gray-900/50 p-2 rounded border border-gray-800">
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-xs font-bold text-gray-300"
                          >Auto-Bomb</span
                        >
                        <div
                          class="w-2 h-2 rounded-full ${
                            this._isAutoBombingEnabled
                              ? "bg-green-500 shadow-[0_0_5px_#22c55e]"
                              : "bg-gray-600"
                          }"
                        ></div>
                      </div>
                      ${
                        this._isAutoBombingEnabled
                          ? html`
                              <button
                                type="button"
                                class="military-button w-full text-xs py-1.5"
                                style="background-color: var(--alertColor); border-color: var(--alertColor);"
                                @click=${this._stopAutoBombing}
                              >
                                Stop Auto
                              </button>
                            `
                          : html`
                              <button
                                type="button"
                                class="military-button w-full text-xs py-1.5"
                                @click=${this._startAutoBombing}
                                title="Automatically target nearby enemies"
                              >
                                Start Auto
                              </button>
                            `
                      }
                    </div>
                  </div>
                  </div>
                </div>
              `
            : ""}
          ${this.activeTab === "Build"
            ? html` <div class="flex items-center mb-2 gap-4 ml-1"></div> `
            : ""}
          ${this.activeTab === "Build"
            ? html`
                <div class="flex items-center mb-2 gap-4 ml-1">
                  <button
                    class="upgrade-structures-button ${this._multibuildEnabled
                      ? "selected"
                      : ""}"
                    title="Place multiple structures without re-selecting"
                    @click=${this._handleMultibuildToggle}
                  >
                    <img
                      class="upgrade-icon"
                      src=${multiBuildIcon}
                      alt="Multi-Build"
                    />
                    <span>Multi-Build Structures</span>
                  </button>
                  <div class="relative inline-block">
                    <div
                      class="flex items-center h-[36px] px-3"
                      style="
                        border: 2px solid var(--ui-panel-border);
                        background: var(--ui-primary);
                        border-radius: 6px;
                        box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4);
                        white-space: nowrap;
                      "
                      title="Select a structure below to set its level"
                    >
                      <span
                        style="font-size: 11px; margin-right: 8px; font-weight: bold; color: var(--ui-text-accent);"
                      >
                        ${this.uiState.pendingBuildUnitType
                          ? `Set ${this.uiState.pendingBuildUnitType} Level`
                          : "Select a structure..."}
                      </span>
                      <button
                        class="w-6 h-6 flex items-center justify-center bg-[#4c516d] hover:bg-[#5a617c] text-white rounded mr-1 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                        ?disabled=${!this.uiState.pendingBuildUnitType}
                        @click=${() => {
                          if (!this.uiState.pendingBuildUnitType) return;
                          const type = this.uiState.pendingBuildUnitType;
                          const current = this._structureLevels[type] || 1;
                          const max = maxStructureLevel(type);
                          const next = Math.min(max, current + 1);
                          this._structureLevels = {
                            ...this._structureLevels,
                            [type]: next,
                          };
                          localStorage.setItem(
                            "buildSettings.levels",
                            JSON.stringify(this._structureLevels),
                          );
                        }}
                      >
                        +
                      </button>
                      <button
                        class="w-6 h-6 flex items-center justify-center bg-[#4c516d] hover:bg-[#5a617c] text-white rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                        ?disabled=${!this.uiState.pendingBuildUnitType}
                        @click=${() => {
                          if (!this.uiState.pendingBuildUnitType) return;
                          const type = this.uiState.pendingBuildUnitType;
                          const current = this._structureLevels[type] || 1;
                          const next = Math.max(1, current - 1);
                          this._structureLevels = {
                            ...this._structureLevels,
                            [type]: next,
                          };
                          localStorage.setItem(
                            "buildSettings.levels",
                            JSON.stringify(this._structureLevels),
                          );
                        }}
                      >
                        -
                      </button>
                    </div>
                  </div>
                  <button
                    class="upgrade-structures-button ${this.uiState.upgradeMode
                      ? "selected"
                      : ""}"
                    title="Click structures to upgrade them"
                    @click=${() => {
                      const enabled = !this.uiState.upgradeMode;
                      this.uiState.upgradeMode = enabled;
                      this.eventBus.emit(new ToggleUpgradeModeEvent(enabled));
                      // Disable mass production if upgrade is enabled
                      if (enabled && this._multibuildEnabled) {
                        this._multibuildEnabled = false;
                        this.uiState.multibuildEnabled = false;
                      }
                      // Disable bomber upgrade mode if structure upgrade is enabled
                      if (enabled && this.uiState.bomberUpgradeMode) {
                        this.uiState.bomberUpgradeMode = false;
                        this.eventBus.emit(
                          new ToggleBomberUpgradeModeEvent(false),
                        );
                      }
                      // Clear pending build selection when upgrade is enabled
                      if (enabled) {
                        this.uiState.pendingBuildUnitType = null;
                      }
                      this.requestUpdate();
                    }}
                  >
                    <img
                      class="upgrade-icon"
                      src=${upgradeArrowIcon}
                      alt="Upgrade"
                    />
                    <span>Upgrade Structures</span>
                  </button>
                </div>
                <build-menu
                  style="width: 100%; display: block;"
                  .game=${this.game}
                  .eventBus=${this.eventBus}
                  .uiState=${this.uiState}
                  .unitFilter=${this.StructureTypes}
                  .structureLevels=${this._structureLevels}
                ></build-menu>
              `
            : ""}
          ${this.activeTab === "Attack"
            ? html`
                <div class="flex items-center mb-2 gap-4 ml-1">
                  <button
                    class="upgrade-structures-button ${this._multibuildEnabled
                      ? "selected"
                      : ""}"
                    title="Multi-Build Units"
                    @click=${this._handleMultibuildToggle}
                  >
                    <img
                      class="upgrade-icon"
                      src=${multiBuildIcon}
                      alt="Multi-Build"
                    />
                    <span>Multi-Build Units</span>
                  </button>
                  <div class="relative inline-block">
                    <div
                      class="flex items-center h-[36px] px-3"
                      style="
                        border: 2px solid var(--ui-panel-border);
                        background: var(--ui-primary);
                        border-radius: 6px;
                        box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4);
                        white-space: nowrap;
                      "
                      title="Select a unit below to set its level"
                    >
                      <span
                        style="font-size: 11px; margin-right: 8px; font-weight: bold; color: var(--ui-text-accent);"
                      >
                        ${this.uiState.pendingBuildUnitType
                          ? `Set ${this.uiState.pendingBuildUnitType} Level`
                          : "Select a unit..."}
                      </span>
                      <button
                        class="w-6 h-6 flex items-center justify-center bg-[#4c516d] hover:bg-[#5a617c] text-white rounded mr-1 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                        ?disabled=${!this.uiState.pendingBuildUnitType}
                        @click=${() => {
                          if (!this.uiState.pendingBuildUnitType) return;
                          const type = this.uiState.pendingBuildUnitType;
                          const current = this._unitLevels[type] || 1;
                          const max = maxUnitLevel(type);
                          const next = Math.min(max, current + 1);
                          this._unitLevels = {
                            ...this._unitLevels,
                            [type]: next,
                          };
                          localStorage.setItem(
                            "unitUpgradeSettings.levels",
                            JSON.stringify(this._unitLevels),
                          );
                        }}
                      >
                        +
                      </button>
                      <button
                        class="w-6 h-6 flex items-center justify-center bg-[#4c516d] hover:bg-[#5a617c] text-white rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                        ?disabled=${!this.uiState.pendingBuildUnitType}
                        @click=${() => {
                          if (!this.uiState.pendingBuildUnitType) return;
                          const type = this.uiState.pendingBuildUnitType;
                          const current = this._unitLevels[type] || 1;
                          const next = Math.max(1, current - 1);
                          this._unitLevels = {
                            ...this._unitLevels,
                            [type]: next,
                          };
                          localStorage.setItem(
                            "unitUpgradeSettings.levels",
                            JSON.stringify(this._unitLevels),
                          );
                        }}
                      >
                        -
                      </button>
                    </div>
                  </div>
                  <button
                    class="upgrade-structures-button"
                    title="Set default upgrade levels for units"
                    @click=${() => this._openUnitUpgradeSettings()}
                  >
                    <img
                      class="upgrade-icon"
                      src=${upgradeArrowIcon}
                      alt="Upgrade"
                    />
                    <span>Upgrade Units</span>
                  </button>
                </div>
                <build-menu
                  style="width: 100%; display: block;"
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
                      data-i18n-title="control_panel2.production_investment_tooltip"
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
                        style="background-color: var(--ui-slider-track)"
                      ></div>
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:${(this.investmentRate /
                          this.game.config().maxInvestmentRate()) *
                        100}%; background-color: var(--ui-slider-troop);"
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
                        data-i18n-title="control_panel2.production_investment_tooltip"
                        @dblclick=${() => {
                          this._lockProd = !this._lockProd;
                          this.emitInvestmentSync();
                        }}
                        @input=${(e: Event) => {
                          const input = e.target as HTMLInputElement;
                          const proposed = parseInt(input.value) / 100;
                          this.applyInvestmentChange("prod", proposed);
                          input.value = (this.investmentRate * 100).toString();
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
                          data-i18n-title="control_panel2.road_investment_tooltip"
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
                                title=${`Research '${getTechMeta(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM, { strict: false }).name}' to enable road investment`}
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
                        style="background-color: var(--ui-slider-track)"
                      ></div>
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:${(
                          (hasRoads ? this._roadInvestmentRate : 0) * 200
                        ).toFixed(
                          2,
                        )}%; background-color: var(--ui-slider-troop);"
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
                        max="50"
                        step="1"
                        .value=${(this._roadInvestmentRate * 100).toString()}
                        ?disabled=${!hasRoads}
                        title=${!hasRoads
                          ? `Research '${getTechMeta(RESEARCH_TECH_IDS.NATIONAL_RECONSTRUCTION_PROGRAM, { strict: false }).name}' to enable road investment`
                          : ""}
                        data-i18n-title="control_panel2.road_investment_tooltip"
                        @input=${(e: Event) => {
                          if (!hasRoads) return;
                          const input = e.target as HTMLInputElement;
                          const proposed = parseInt(input.value) / 100;
                          this.applyInvestmentChange("road", proposed);
                          input.value = (
                            this._roadInvestmentRate * 100
                          ).toString();
                        }}
                        class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer military-slider ${this
                          ._lockRoad && hasRoads
                          ? "slider-locked"
                          : ""}"
                        @dblclick=${() => {
                          if (hasRoads) {
                            this._lockRoad = !this._lockRoad;
                            this.emitInvestmentSync();
                          }
                        }}
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
                        <label
                          class="block military-label mb-1"
                          translate="no"
                          data-i18n-title="control_panel2.research_investment_tooltip"
                        >
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
                        style="background-color: var(--ui-slider-track)"
                      ></div>
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:${(
                          this._researchInvestmentRate * 200
                        ).toFixed(
                          2,
                        )}%; background-color: var(--ui-slider-troop);"
                      ></div>
                      <input
                        type="range"
                        min="0"
                        max="50"
                        step="1"
                        .value=${(
                          this._researchInvestmentRate * 100
                        ).toString()}
                        data-i18n-title="control_panel2.research_investment_tooltip"
                        @input=${(e: Event) => {
                          const input = e.target as HTMLInputElement;
                          const proposed = parseInt(input.value) / 100;
                          this.applyInvestmentChange("research", proposed);
                          input.value = (
                            this._researchInvestmentRate * 100
                          ).toString();
                        }}
                        class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer military-slider ${this
                          ._lockResearch
                          ? "slider-locked"
                          : ""}"
                        @dblclick=${() => {
                          this._lockResearch = !this._lockResearch;
                          this.emitInvestmentSync();
                        }}
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
                        style="background-color: var(--ui-slider-track)"
                      ></div>
                      <div
                        class="absolute left-0 top-3 h-2 rounded transition-all duration-300"
                        style="width:0%; background-color: var(--ui-slider-troop);"
                      ></div>
                      <input
                        type="range"
                        min="0"
                        max="50"
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
          ${this.activeTab === "Trade" ? this._renderTradeTab() : ""}
          ${this.activeTab === "Diplomacy" ? this.renderDiplomacyTab() : ""}
        </div>
      </div>
    `;
  }

  private _renderTradeTab() {
    const me = this.game.myPlayer();
    if (!me) return html``;
    const ships = me.units(UnitType.TradeShip).filter((u) => u.isActive());
    const ports = me.units(UnitType.Port).filter((p) => p.isActive());
    const ticks = this.game.ticks();
    const delay = this.game.config().tradeShipReplacementDelayTicks();
    // Multi-build: gather all pending construction due ticks across ports
    const pendingEntries: Array<{ port: UnitView; due: number }> = [];
    for (const p of ports) {
      const arr: number[] = (p as any).pendingTradeShipDueTicks?.() ?? [];
      for (const due of arr) {
        if (due > ticks) pendingEntries.push({ port: p, due });
      }
    }
    pendingEntries.sort((a, b) => a.due - b.due);
    const pendingRows = pendingEntries.map(({ port, due }, idx) => {
      const remaining = due - ticks;
      const pct = Math.min(
        100,
        Math.max(0, Math.round(((delay - remaining) / delay) * 100)),
      );
      return html`<div
        class="py-1 px-2 border-b"
        style="border-color: var(--ui-panel-border)"
      >
        <div class="mb-1 text-gray-300">
          Cargo Ship #${idx + 1} (Port #${port.id()}) constructing…
        </div>
        <div class="progress-track" style="height:6px;">
          <div class="progress-fill" style="width:${pct}%;"></div>
        </div>
      </div>`;
    });

    const mapHeight = this.game.height();
    const rows = ships.map((ship) => {
      const tile = ship.tile();
      const x = this.game.x(tile);
      const topOriginY = this.game.y(tile);
      const y = mapHeight - 1 - topOriginY; // display with bottom-left origin
      const status = this._computeTradeShipStatus(ship);
      return html`
        <div
          class="flex items-center justify-between py-1 px-2 border-b"
          style="border-color: var(--ui-panel-border)"
        >
          <div class="truncate">
            <span class="text-blue-200">Ship #${ship.id()}</span>
            <span class="text-gray-400 ml-2">${status}</span>
          </div>
          <div class="text-gray-300 font-mono">(${x}, ${y})</div>
        </div>
      `;
    });

    // Compute demand indicator (global: all cargo ships, not just mine)
    const allTradeShips = this.game
      .units(UnitType.TradeShip)
      .filter((u) => u.isActive());
    const totalShips = allTradeShips.length;
    const availableShips = allTradeShips.filter((s) => {
      const isReturning = s.returning();
      const phase = s.tradePhase();
      const hasTarget = s.targetUnitId() !== undefined;
      const dockOwner = s.dockedAtPortOwner();
      return !isReturning && phase === null && !hasTarget && dockOwner !== null;
    }).length;
    const queueLen = me.tradeDemandQueueLength();
    const denom = Math.max(1, totalShips);
    const queuedPct = queueLen / denom;
    const availablePct = availableShips / denom;
    let demandLabel = "Medium";
    let demandColor = "var(--ui-text-default)";
    if (queuedPct > 0.5) {
      demandLabel = "Very High";
      demandColor = "var(--ui-alert)";
    } else if (queuedPct > 0.25) {
      demandLabel = "High";
      demandColor = "var(--ui-warning)";
    } else if (availablePct > 0.5) {
      demandLabel = "Very Low";
      demandColor = "var(--ui-info)";
    } else if (availablePct > 0.25) {
      demandLabel = "Low";
      demandColor = "var(--ui-success)";
    } else {
      demandLabel = "Medium";
      demandColor = "var(--ui-text-default)";
    }

    return html`
      <div class="w-full">
        <div class="flex items-center justify-between mb-2">
          <h3 class="military-heading">Cargo Ships</h3>
          <div
            class="text-sm"
            title="Demand is based on queued routes vs total ships and available ships"
          >
            <span
              class="px-2 py-0.5 rounded-full border"
              style="border-color: var(--ui-panel-border); color: ${demandColor};"
            >
              Trade Demand: ${demandLabel}
            </span>
          </div>
        </div>
        ${pendingRows.length > 0
          ? html`<div class="mb-2">
              <h4 class="text-gray-200 text-sm mb-1">Under Construction</h4>
              <style>
                /* Reuse research progress bar styling */
                .progress-track {
                  width: 100%;
                  background: color-mix(
                    in srgb,
                    var(--ui-secondary) 25%,
                    transparent
                  );
                  border: 1px solid
                    color-mix(in srgb, var(--ui-secondary) 35%, transparent);
                  border-radius: 6px;
                  overflow: hidden;
                  margin: 0;
                }
                .progress-fill {
                  height: 100%;
                  background: linear-gradient(
                    90deg,
                    color-mix(in srgb, var(--ui-info) 90%, transparent) 0%,
                    color-mix(in srgb, var(--ui-info) 70%, transparent) 100%
                  );
                  box-shadow:
                    0 0 10px color-mix(in srgb, var(--ui-info) 55%, transparent),
                    0 0 16px color-mix(in srgb, var(--ui-info) 35%, transparent),
                    inset 0 0 4px
                      color-mix(in srgb, var(--ui-text-light) 10%, transparent);
                }
              </style>
              <div class="divide-y">${pendingRows}</div>
            </div>`
          : ""}
        ${ships.length > 0
          ? html`<div class="divide-y">${rows}</div>`
          : ships.length === 0 && pendingRows.length === 0
            ? html`<div class="text-gray-400">No active cargo ships.</div>`
            : ""}

        <!-- Embargo Management Buttons -->
        <div
          class="mt-4 pt-3 border-t"
          style="border-color: var(--ui-panel-border)"
        >
          <h4 class="text-gray-200 text-sm mb-2">Embargo Management</h4>
          <div class="flex gap-2">
            <button
              class="embargo-btn flex-1 px-3 py-2 text-sm font-semibold rounded border-2 transition-all"
              style="
                border-color: var(--ui-panel-border);
                background: var(--ui-primary);
                color: var(--ui-text-accent);
                box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4);
              "
              data-i18n-title="control_panel2.embargo_all_tooltip"
              @click=${this._handleEmbargoAll}
            >
              Embargo All
            </button>
            <button
              class="embargo-btn flex-1 px-3 py-2 text-sm font-semibold rounded border-2 transition-all"
              style="
                border-color: var(--ui-panel-border);
                background: var(--ui-primary);
                color: var(--ui-text-accent);
                box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4);
              "
              data-i18n-title="control_panel2.remove_all_embargos_tooltip"
              @click=${this._handleRemoveAllEmbargos}
            >
              Remove All Embargos
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderDiplomacyTab() {
    const me = this.game.myPlayer();
    if (!me) return html``;

    const players = this.game
      .players()
      .filter(
        (p) =>
          p.isAlive() &&
          p.id() !== me.id() &&
          (p.type() === PlayerType.Human || p.type() === PlayerType.FakeHuman),
      );

    // Icons and colors reused from radial menu
    const warIcon = "/images/waricon.png";
    const peaceIcon = "/images/dove.png";
    const allianceIcon = "/images/AllianceIconWhite.svg";
    const traitorIcon = "/images/TraitorIconWhite.svg";

    // Colors matching radial menu
    const warColor = "#8B0000"; // dark red for declare war
    const peaceColor = "#e5e7eb"; // light gray for peace
    const allianceColor = "#53ac75"; // green for alliance
    const betrayColor = "#c74848"; // red for betray

    const iconBtn = (
      src: string,
      bgColor: string,
      titleKey: string,
      onClick: () => void,
    ) => html`
      <button
        class="inline-flex items-center justify-center border-2 border-[var(--ui-panel-border)] rounded px-1 py-1 hover:opacity-80 hover:scale-105 transition-all"
        style="background-color: ${bgColor};"
        data-i18n-title=${titleKey}
        @click=${onClick}
      >
        <img src=${src} style="width:16px;height:16px;object-fit:contain;" />
      </button>
    `;

    const renderName = (p: PlayerView) => html`
      <div class="text-sm text-gray-300 truncate" title="${p.name()}">
        ${p.name()}
      </div>
    `;

    const renderBtn = (btn: ReturnType<typeof html>) => html`
      <div class="flex justify-center">${btn}</div>
    `;

    const renderEmpty = () => html`<div>&nbsp;</div>`;

    // Build rows for each player
    const rows = players.map((p) => {
      const atWar = me.isAtWarWith(p);
      const allied = me.isAlliedWith(p);
      const neutral = !atWar && !allied;

      // At War column cell
      let atWarCell;
      if (atWar) {
        atWarCell = renderName(p);
      } else if (neutral) {
        atWarCell = renderBtn(
          iconBtn(
            warIcon,
            warColor,
            "control_panel2.diplomacy_declare_war_tooltip",
            () => this.eventBus.emit(new SendDeclareWarIntentEvent(me, p)),
          ),
        );
      } else if (allied) {
        atWarCell = renderBtn(
          iconBtn(
            traitorIcon,
            betrayColor,
            "control_panel2.diplomacy_betray_tooltip",
            () => this.eventBus.emit(new SendBreakAllianceIntentEvent(me, p)),
          ),
        );
      } else {
        atWarCell = renderEmpty();
      }

      // Allied column cell
      let alliedCell;
      if (allied) {
        alliedCell = renderName(p);
      } else {
        // Can request alliance from both neutral and at-war players
        alliedCell = renderBtn(
          iconBtn(
            allianceIcon,
            allianceColor,
            "control_panel2.diplomacy_request_alliance_tooltip",
            () => this.eventBus.emit(new SendAllianceRequestIntentEvent(me, p)),
          ),
        );
      }

      // Neutral column cell
      let neutralCell;
      if (neutral) {
        neutralCell = renderName(p);
      } else if (atWar) {
        neutralCell = renderBtn(
          iconBtn(
            peaceIcon,
            peaceColor,
            "control_panel2.diplomacy_request_peace_tooltip",
            () => this.eventBus.emit(new SendPeaceRequestIntentEvent(me, p)),
          ),
        );
      } else {
        neutralCell = renderEmpty();
      }

      return html`
        <div class="flex w-full py-1 border-b border-gray-600/50">
          <div class="w-1/3 px-1 flex items-center justify-center">
            ${atWarCell}
          </div>
          <div class="w-1/3 px-1 flex items-center justify-center">
            ${alliedCell}
          </div>
          <div class="w-1/3 px-1 flex items-center justify-center">
            ${neutralCell}
          </div>
        </div>
      `;
    });

    // Bulk action handlers
    const declareWarOnAll = () => {
      players.forEach((p) => {
        if (me.isAlliedWith(p)) {
          // Break alliance first (betray), then declare war
          this.eventBus.emit(new SendBreakAllianceIntentEvent(me, p));
        }
        if (!me.isAtWarWith(p)) {
          this.eventBus.emit(new SendDeclareWarIntentEvent(me, p));
        }
      });
    };

    const requestAllianceWithAll = () => {
      players.forEach((p) => {
        if (!me.isAlliedWith(p)) {
          this.eventBus.emit(new SendAllianceRequestIntentEvent(me, p));
        }
      });
    };

    const requestPeaceWithAll = () => {
      players.forEach((p) => {
        if (me.isAtWarWith(p)) {
          this.eventBus.emit(new SendPeaceRequestIntentEvent(me, p));
        }
      });
    };

    // Small icon button for header bulk actions
    const headerBtn = (
      icon: string,
      bgColor: string,
      titleKey: string,
      onClick: () => void,
    ) => html`
      <button
        class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded hover:opacity-80 hover:scale-105 transition-all"
        style="background-color: ${bgColor};"
        data-i18n-title=${titleKey}
        @click=${onClick}
      >
        <img src=${icon} style="width:12px;height:12px;object-fit:contain;" />
      </button>
    `;

    return html`
      <div class="flex flex-col w-full h-full">
        <!-- Header row -->
        <div class="flex w-full mb-2 border-b border-gray-600/50 pb-2">
          <div class="w-1/3 px-1 flex items-center justify-center">
            <span class="font-bold text-gray-300">At War</span>
            ${headerBtn(
              warIcon,
              warColor,
              "control_panel2.diplomacy_war_all_tooltip",
              declareWarOnAll,
            )}
          </div>
          <div class="w-1/3 px-1 flex items-center justify-center">
            <span class="font-bold text-gray-300">Allied</span>
            ${headerBtn(
              allianceIcon,
              allianceColor,
              "control_panel2.diplomacy_ally_all_tooltip",
              requestAllianceWithAll,
            )}
          </div>
          <div class="w-1/3 px-1 flex items-center justify-center">
            <span class="font-bold text-gray-300">Neutral</span>
            ${headerBtn(
              peaceIcon,
              peaceColor,
              "control_panel2.diplomacy_peace_all_tooltip",
              requestPeaceWithAll,
            )}
          </div>
        </div>
        <!-- Player rows -->
        ${rows}
      </div>
    `;
  }

  private _handleEmbargoAll() {
    const me = this.game.myPlayer();
    if (!me) return;

    const players = this.game
      .players()
      .filter(
        (p) =>
          p.isAlive() &&
          p.id() !== me.id() &&
          (p.type() === PlayerType.Human || p.type() === PlayerType.FakeHuman),
      );

    for (const player of players) {
      if (!me.hasEmbargoAgainst(player)) {
        this.eventBus.emit(new SendEmbargoIntentEvent(player, "start"));
      }
    }
  }

  private _handleRemoveAllEmbargos() {
    const me = this.game.myPlayer();
    if (!me) return;

    const players = this.game
      .players()
      .filter(
        (p) =>
          p.isAlive() &&
          p.id() !== me.id() &&
          (p.type() === PlayerType.Human || p.type() === PlayerType.FakeHuman),
      );

    for (const player of players) {
      if (me.hasEmbargoAgainst(player)) {
        this.eventBus.emit(new SendEmbargoIntentEvent(player, "stop"));
      }
    }
  }

  private _computeTradeShipStatus(ship: UnitView): string {
    // Debug ship status logging removed
    const ownerName = (pv: PlayerView | null) => pv?.displayName() ?? "Unknown";
    const dockOwner = ship.dockedAtPortOwner();
    const startOwner = ship.tradeRouteStartOwner();
    const endOwner = ship.tradeRouteEndOwner();
    const targetId = ship.targetUnitId();
    const targetUnit =
      targetId !== undefined ? this.game.unit(targetId) : undefined;

    if (dockOwner && !ship.returning() && targetId === undefined) {
      return `in port owned by ${ownerName(dockOwner)}`;
    }

    if (ship.returning()) {
      if (targetUnit && targetUnit.type() === UnitType.Port) {
        return `returning to port owned by ${ownerName(targetUnit.owner())}`;
      }
      return "returning to port";
    }

    const phase = ship.tradePhase();

    if (phase === "toStart") {
      return `traveling to start port owned by ${ownerName(startOwner)}`;
    }
    if (phase === "toEnd") {
      if (startOwner || endOwner) {
        return `trading between ${ownerName(startOwner)} and ${ownerName(endOwner)}`;
      }
      if (targetUnit && targetUnit.type() === UnitType.Port) {
        return `traveling to port owned by ${ownerName(targetUnit.owner())}`;
      }
    }

    return "at sea";
  }
}

// Add styles for upgrade button in global scope
const style = document.createElement("style");
style.textContent = `
  .upgrade-structures-button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 2px solid var(--ui-panel-border);
    background: var(--ui-primary);
    color: var(--ui-text-accent);
    border-radius: 6px;
    box-shadow:
      inset 0 0 10px rgba(0, 0, 0, 0.5),
      0 2px 6px rgba(0, 0, 0, 0.4);
    cursor: pointer;
    transition: all 0.3s ease;
    font-size: 13px;
    font-weight: bold;
    white-space: nowrap;
    position: relative;
  }
  .upgrade-structures-button .upgrade-icon {
    width: 18px;
    height: 18px;
  }
  .upgrade-structures-button.selected {
    border-color: var(--ui-secondary-hover);
    box-shadow:
      0 0 12px rgba(50, 98, 155, 0.75),
      inset 0 0 12px rgba(0, 0, 0, 0.6);
    background: var(--ui-secondary);
    transform: scale(1.05);
  }
  .upgrade-structures-button:hover {
    background-color: var(--ui-secondary);
    transform: scale(1.05);
    border-color: var(--ui-secondary);
  }
  .upgrade-structures-button:active {
    background: linear-gradient(
      to bottom,
      var(--ui-secondary-hover),
      var(--ui-secondary)
    );
    transform: scale(0.95);
  }
  .gear-settings-btn {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 22px;
    height: 22px;
    border-radius: 9999px;
    background: var(--ui-primary);
    border: 2px solid var(--ui-panel-border);
    box-shadow:
      inset 0 0 10px rgba(0, 0, 0, 0.5),
      0 2px 6px rgba(0, 0, 0, 0.4);
    color: var(--ui-text-accent);
    display: grid;
    place-items: center;
    box-sizing: border-box;
    line-height: 0;
    overflow: hidden;
    transform-origin: center;
    cursor: pointer;
    z-index: 1;
  }
  .gear-settings-btn:hover {
    background-color: var(--ui-secondary);
    border-color: var(--ui-secondary);
    transform: scale(1.05);
  }
  .gear-settings-btn:active {
    background: linear-gradient(
      to bottom,
      var(--ui-secondary-hover),
      var(--ui-secondary)
    );
    transform: scale(0.95);
  }
  .gear-settings-btn svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
    pointer-events: none;
  }
  .gear-settings-btn img.gear-settings-icon {
    width: 12px;
    height: 12px;
    object-fit: contain;
    pointer-events: none;
    display: block;
  }
  .embargo-btn:hover {
    background-color: var(--ui-secondary) !important;
    border-color: var(--ui-secondary) !important;
    transform: scale(1.05);
  }
  .embargo-btn:active {
    background: linear-gradient(
      to bottom,
      var(--ui-secondary-hover),
      var(--ui-secondary)
    ) !important;
    transform: scale(0.95);
  }
`;
if (!document.head.querySelector("style[data-upgrade-button]")) {
  style.setAttribute("data-upgrade-button", "true");
  document.head.appendChild(style);
}
