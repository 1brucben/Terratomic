import { EventBus } from "../../../core/EventBus";
import { PlayerType, UnitType } from "../../../core/game/Game";
import { GameUpdateType, PlayerUpdate } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { tutorialManager } from "../../TutorialManager";
import { ToggleBuildPanelEvent } from "./ControlPanel";
import { Layer } from "./Layer";

/**
 * TutorialTriggers monitors game state and triggers tutorial tips at appropriate moments.
 * It doesn't render anything - it just watches for events and calls tutorialManager.showTip().
 */
export class TutorialTriggers implements Layer {
  layerName = "TutorialTriggers";
  shouldTransform(): boolean {
    return false;
  }

  public game: GameView;
  public eventBus: EventBus;

  private wasInSpawnPhase = false;
  private tickCount = 0;
  private lastTileCount = 0;
  private previousGoldPerSecond = BigInt(0);
  private previousAlliesCount = 0;
  private expansionsCount = 0;
  private spawnEndTime = 0;
  private shownTips = new Set<string>();
  private hadPvPThisTick = false;

  constructor(game: GameView, eventBus: EventBus) {
    this.game = game;
    this.eventBus = eventBus;
  }

  init() {
    // Show initial spawn tip when game starts
    if (this.game.inSpawnPhase()) {
      setTimeout(() => {
        this.showTip("spawn_welcome");
      }, 1000); // Small delay to let UI load
    }
  }

  tick() {
    this.tickCount++;
    this.hadPvPThisTick = false; // reset per tick
    const player = this.game.myPlayer();

    // Spawn phase tips
    if (this.game.inSpawnPhase()) {
      this.wasInSpawnPhase = true;
      if (!this.hasTipBeenShown("spawn_welcome") && this.tickCount > 10) {
        this.showTip("spawn_welcome");
      }
    }

    // Transition out of spawn
    if (this.wasInSpawnPhase && !this.game.inSpawnPhase()) {
      this.showTip("expansion_basics");
      this.wasInSpawnPhase = false;
      this.spawnEndTime = Date.now();
      // Initialize lastTileCount to current tiles to not count spawn tiles
      if (player) {
        this.lastTileCount = player.numTilesOwned();
      }
    }

    // Only check player-specific tips if player exists and is alive
    if (!player || !player.isAlive()) {
      return;
    }

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      const playerUpdates =
        (updates[GameUpdateType.Player] as PlayerUpdate[]) ?? [];

      for (const update of playerUpdates) {
        if (update.id !== player.id()) continue;

        // Detect PvP activity (attacks involving real human players)
        if (!this.game.inSpawnPhase()) {
          const incoming = update.incomingAttacks ?? [];
          const outgoing = update.outgoingAttacks ?? [];
          for (const atk of [...incoming, ...outgoing]) {
            const otherSmallId =
              atk.attackerID === player.smallID()
                ? atk.targetID
                : atk.attackerID;
            if (otherSmallId === 0 || otherSmallId === player.smallID())
              continue;
            const other = this.game.playerBySmallID(otherSmallId) as any;
            const ptype = other?.data?.playerType;
            if (ptype === PlayerType.Human) {
              this.hadPvPThisTick = true;
              break;
            }
          }
        }

        // Track tile count and expansion-based tips (only after spawn phase)
        if (update.tilesOwned !== undefined && !this.game.inSpawnPhase()) {
          const gained = update.tilesOwned - this.lastTileCount;
          if (gained > 0 && this.lastTileCount > 0) {
            this.expansionsCount += gained;
          }
          this.lastTileCount = update.tilesOwned;

          // Show control panel sliders tip: 5 expansions AND 30s minimum
          const timeSinceSpawn =
            this.spawnEndTime > 0 ? Date.now() - this.spawnEndTime : 0;
          if (
            !this.hasTipBeenShown("control_panel_sliders") &&
            this.expansionsCount >= 5 &&
            timeSinceSpawn >= 30000
          ) {
            this.showTip("control_panel_sliders", "control-panel");
          }
        }

        // Research discovery
        if (
          update.researchTreeTechs &&
          update.researchTreeTechs.length > 0 &&
          !this.hasTipBeenShown("research_first") &&
          !this.isAllTechMode()
        ) {
          this.showTip("research_first", "research-tree-button");

          // Show investment_research tip 10s later (muted in all-tech mode)
          setTimeout(() => {
            if (
              !this.hasTipBeenShown("investment_research") &&
              !this.isAllTechMode()
            ) {
              this.eventBus.emit(new ToggleBuildPanelEvent(true));
              this.showTip("investment_research", "command-center-economy");
            }
          }, 10000);
        }

        // Check for Roads tech unlock
        if (update.researchTreeTechs) {
          if (
            update.researchTreeTechs.includes("Roads") &&
            !this.hasTipBeenShown("investment_roads")
          ) {
            this.eventBus.emit(new ToggleBuildPanelEvent(true));
            this.showTip("investment_roads", "command-center-economy");
          }
        }

        // Gold thresholds and income
        if (update.gold !== undefined) {
          const currentGold = update.gold;
          if (
            !this.hasTipBeenShown("command_center_intro") &&
            currentGold >= BigInt(45000)
          ) {
            this.eventBus.emit(new ToggleBuildPanelEvent(true));
            this.showTip("command_center_intro", "command-center");
          }
        }

        const goldPerSecond = this.game.config().goldAdditionRate(player) * 10n;
        if (!this.hasTipBeenShown("economy_gold") && goldPerSecond < 0n) {
          this.showTip("economy_gold");
        }
        this.previousGoldPerSecond = goldPerSecond;

        // Structures (city/factory/port/airfield)
        const units = player.units(
          UnitType.City,
          UnitType.Factory,
          UnitType.Port,
          UnitType.Airfield,
        );
        const hasCity = units.some((u) => u.type() === UnitType.City);
        const hasFactory = units.some((u) => u.type() === UnitType.Factory);
        const hasPort = units.some((u) => u.type() === UnitType.Port);
        const hasAirfield = units.some((u) => u.type() === UnitType.Airfield);

        if (hasCity && !this.hasTipBeenShown("first_city")) {
          this.showTip("first_city");
        }
        if (hasFactory && !this.hasTipBeenShown("first_factory")) {
          this.showTip("first_factory");

          // Show investment_productivity tip 15s later
          setTimeout(() => {
            if (!this.hasTipBeenShown("investment_productivity")) {
              this.eventBus.emit(new ToggleBuildPanelEvent(true));
              this.showTip("investment_productivity", "command-center-economy");
            }
          }, 15000);
        }
        if (hasPort && !this.hasTipBeenShown("first_port")) {
          this.showTip("first_port");
        }
        if (hasAirfield && !this.hasTipBeenShown("first_airfield")) {
          this.showTip("first_airfield");
        }

        // Diplomacy events
        if (update.allies !== undefined) {
          const currentAlliesCount = update.allies.length;

          if (
            currentAlliesCount > this.previousAlliesCount &&
            !this.hasTipBeenShown("diplomacy_alliance")
          ) {
            this.showTip("diplomacy_alliance");
          }

          if (
            currentAlliesCount < this.previousAlliesCount &&
            !this.hasTipBeenShown("diplomacy_betrayal")
          ) {
            this.showTip("diplomacy_betrayal");
          }

          this.previousAlliesCount = currentAlliesCount;
        }

        if (update.wars !== undefined && update.wars.length > 0) {
          if (!this.hasTipBeenShown("diplomacy_peace")) {
            this.showTip("diplomacy_peace");
          }
        }
      }

      // Bot encirclement tip at 1 minute after spawn
      const timeSinceSpawn =
        this.spawnEndTime > 0 ? Date.now() - this.spawnEndTime : 0;
      if (
        !this.hasTipBeenShown("bot_encirclement") &&
        timeSinceSpawn >= 60000
      ) {
        this.showTip("bot_encirclement");
      }
    }

    // PvP awareness
    if (this.hadPvPThisTick && !this.hasTipBeenShown("attack_basics")) {
      this.showTip("attack_basics");
    }

    // Map control awareness
    if (player && this.game.players().length > 0) {
      const totalLandTiles = this.game.numLandTiles();
      const mapControl = (player.numTilesOwned() / totalLandTiles) * 100;

      if (mapControl >= 10 && !this.hasTipBeenShown("leaderboard")) {
        this.showTip("leaderboard", "leaderboard");
      }

      if (
        (this.tickCount >= 18000 || mapControl >= 20) &&
        !this.hasTipBeenShown("victory_condition")
      ) {
        this.showTip("victory_condition");
      }
    }
  }

  private showTip(tipId: string, highlightTarget?: string): void {
    if (!this.hasTipBeenShown(tipId)) {
      tutorialManager.showTip(tipId, false, highlightTarget);
      this.shownTips.add(tipId);
    }
  }

  private hasTipBeenShown(tipId: string): boolean {
    return this.shownTips.has(tipId) || tutorialManager.hasSeen(tipId);
  }

  private isAllTechMode(): boolean {
    try {
      return !!this.game.config().gameConfig().researchAllTechs;
    } catch {
      return false;
    }
  }

  render() {
    // This layer doesn't render anything
    return null;
  }
}
