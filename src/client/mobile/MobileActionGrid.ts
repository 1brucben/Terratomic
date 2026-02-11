/**
 * MobileActionGrid - Bottom-anchored action grid that shows context-appropriate actions
 * Replaces FAB + popup pattern with direct action selection
 */

import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { UnitType, UpgradeType } from "../../core/game/Game";
import type { TileRef } from "../../core/game/GameMap";
import type { GameView, PlayerView } from "../../core/game/GameView";
import { renderNumber } from "../Utils";
import { HapticFeedback, HapticPattern } from "./utils/HapticFeedback";
import { getActionIcon, getUnitIcon } from "./utils/Icons";

export interface ActionGridItem {
  id: string;
  icon: string;
  label: string;
  cost?: number;
  disabled?: boolean;
  disabledReason?: string;
  locked?: boolean;
  lockedReason?: string;
  priority?: "high" | "normal"; // High priority = shown first
  columnSpan?: number; // Dynamically calculated percentage width for perfect grid filling
}

export type ActionCategory =
  | "own-land"
  | "own-shore"
  | "own-water"
  | "enemy-can-attack"
  | "enemy-can-boat-attack"
  | "enemy-no-attack"
  | "neutral-can-attack"
  | "neutral-can-boat-attack"
  | "spawn-phase";

@customElement("mobile-action-grid")
export class MobileActionGrid extends LitElement {
  @property({ type: Boolean, reflect: true }) visible: boolean = false;
  @property({ type: Boolean, reflect: true }) ready: boolean = false; // Items calculated and ready to show
  @property({ type: Boolean }) stackModeEnabled: boolean = false;
  @property({ type: Object }) tile: TileRef | null = null;
  @property({ type: Object }) game: GameView | null = null;
  @property({ type: Array }) items: ActionGridItem[] = [];
  @property({ type: Number }) attackRatio: number = 0.3;
  private lastOpenedTime: number = 0;

  static styles = css`
    :host {
      --m-grid-gap: 8px;
      --m-grid-max-h: 60vh;
      --m-grid-padding: 16px;
      --m-grid-padding-bottom: 16px;
      --m-grid-radius: 20px;
      --m-grid-column-min: 65px;
      --m-grid-tile-min-h: 62px;
      --m-grid-tile-min-h-multi: 72px;
      --m-grid-tile-padding: 7px;
      --m-grid-tile-gap: 3px;
      --m-grid-icon-size: 28px;
      --m-grid-icon-size-multi: 36px;
      --m-grid-font-size: 11px;
      --m-grid-font-size-multi: 13px;
      --m-grid-cost-top: 5px;
      --m-grid-cost-right: 5px;
      --m-grid-cost-max-width-inset: 10px;
      --m-grid-cost-min-h: 16px;
      --m-grid-cost-padding-x: 5px;
      --m-grid-cost-font-size: 9px;
      --m-grid-cost-gap: 2px;
      --m-grid-cost-multi-min-h: 18px;
      --m-grid-cost-multi-padding-x: 6px;
      --m-grid-cost-multi-font-size: 10px;

      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 2000;
      pointer-events: none;
    }

    .backdrop {
      position: fixed;
      top: calc(44px + env(safe-area-inset-top, 0px));
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.38);
      opacity: 0;
      transition: opacity 0.25s ease;
      pointer-events: none;
    }

    :host([visible]) .backdrop {
      opacity: 1;
      pointer-events: all;
    }

    .backdrop.no-backdrop {
      opacity: 0 !important;
      pointer-events: none !important;
    }

    .grid-container {
      background:
        linear-gradient(
          180deg,
          rgba(145, 154, 166, 0.16) 0%,
          rgba(82, 90, 102, 0.1) 34%,
          rgba(19, 23, 30, 0.04) 100%
        ),
        linear-gradient(
          180deg,
          rgba(39, 45, 55, 0.97) 0%,
          rgba(26, 31, 39, 0.98) 48%,
          rgba(16, 20, 27, 0.98) 100%
        );
      border-top-left-radius: var(--m-grid-radius, 20px);
      border-top-right-radius: var(--m-grid-radius, 20px);
      border-top: 1px solid rgba(188, 198, 210, 0.3);
      border-left: 1px solid rgba(40, 46, 56, 0.8);
      border-right: 1px solid rgba(40, 46, 56, 0.8);
      padding: var(--m-grid-padding, 16px);
      padding-bottom: calc(
        var(--m-grid-padding-bottom, 16px) + env(safe-area-inset-bottom, 0px)
      );
      transform: translateY(100%);
      transition: transform 0.25s ease;
      pointer-events: none;
      box-shadow:
        inset 0 1px 0 rgba(216, 224, 233, 0.2),
        inset 0 -1px 0 rgba(0, 0, 0, 0.55),
        0 -8px 22px rgba(0, 0, 0, 0.5);
      position: relative;
      overflow: hidden;
    }

    .grid-container::before,
    .grid-container::after {
      content: "";
      position: absolute;
      top: 10px;
      bottom: 14px;
      width: 14px;
      pointer-events: none;
      background: linear-gradient(
        180deg,
        rgba(192, 201, 212, 0.16) 0%,
        rgba(17, 22, 29, 0.38) 100%
      );
      border: 1px solid rgba(14, 18, 24, 0.82);
      box-shadow: inset 0 1px 0 rgba(225, 233, 242, 0.1);
    }

    .grid-container::before {
      left: 0;
      clip-path: polygon(0 18%, 100% 0, 100% 100%, 0 84%);
      border-right: none;
    }

    .grid-container::after {
      right: 0;
      clip-path: polygon(0 0, 100% 18%, 100% 84%, 0 100%);
      border-left: none;
    }

    :host([visible]) .grid-container {
      transform: translateY(0);
      pointer-events: all;
    }

    .grid {
      display: flex;
      flex-wrap: wrap;
      gap: var(--m-grid-gap, 8px);
      max-height: var(--m-grid-max-h, 60vh);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    :host([ready]) .grid {
      opacity: 1;
    }

    .action-tile {
      --cat-rgb: 59, 130, 246;
      background:
        linear-gradient(
          180deg,
          rgba(228, 236, 245, 0.05) 0%,
          rgba(95, 106, 120, 0.04) 18%,
          rgba(15, 19, 25, 0.86) 30%,
          rgba(10, 14, 20, 0.92) 100%
        ),
        radial-gradient(
          120% 110% at 50% 0%,
          rgba(var(--cat-rgb), 0.14) 0%,
          rgba(var(--cat-rgb), 0.05) 38%,
          rgba(0, 0, 0, 0) 72%
        );
      border: 1px solid rgba(var(--cat-rgb), 0.45);
      border-radius: 10px;
      padding: var(--m-grid-tile-padding, 7px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--m-grid-tile-gap, 3px);
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition: all 0.15s ease;
      min-height: var(--m-grid-tile-min-h, 62px);
      flex: 0 0 auto;
      width: var(--item-width);
      min-width: 0;
      box-sizing: border-box;
      position: relative;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        inset 0 -2px 6px rgba(0, 0, 0, 0.45),
        0 1px 2px rgba(0, 0, 0, 0.35);
    }

    /* Category Colors */
    .action-tile.cat-spawn {
      --cat-rgb: 34, 197, 94;
    }

    .action-tile.cat-infrastructure {
      --cat-rgb: 59, 130, 246;
    }

    .action-tile.cat-military {
      --cat-rgb: 139, 92, 246;
    }

    .action-tile.cat-combat {
      --cat-rgb: 239, 68, 68;
    }

    .action-tile.cat-nuclear {
      --cat-rgb: 245, 158, 11;
    }

    .action-tile.cat-diplomacy {
      --cat-rgb: 20, 184, 166;
    }

    .action-tile.cat-diplomacy-war {
      --cat-rgb: 245, 158, 11;
    }

    .action-tile.cat-diplomacy-peace {
      --cat-rgb: 203, 213, 225;
    }

    .action-tile.cat-diplomacy-alliance {
      --cat-rgb: 34, 197, 94;
    }

    /* Expanded tiles (2+ column span) */
    .action-tile.multi-column {
      min-height: var(--m-grid-tile-min-h-multi, 72px);
      border-width: 1px;
      background:
        linear-gradient(
          180deg,
          rgba(233, 239, 247, 0.07) 0%,
          rgba(105, 115, 128, 0.05) 18%,
          rgba(17, 21, 28, 0.86) 32%,
          rgba(11, 15, 21, 0.93) 100%
        ),
        radial-gradient(
          130% 115% at 50% 0%,
          rgba(var(--cat-rgb), 0.2) 0%,
          rgba(var(--cat-rgb), 0.08) 40%,
          rgba(0, 0, 0, 0) 76%
        );
    }

    .action-tile.multi-column.cat-spawn {
      border-color: rgba(34, 197, 94, 0.54);
    }

    .action-tile.multi-column.cat-infrastructure {
      border-color: rgba(59, 130, 246, 0.54);
    }

    .action-tile.multi-column.cat-military {
      border-color: rgba(139, 92, 246, 0.54);
    }

    .action-tile.multi-column.cat-combat {
      border-color: rgba(239, 68, 68, 0.54);
    }

    .action-tile.multi-column.cat-nuclear {
      border-color: rgba(245, 158, 11, 0.54);
    }

    .action-tile.multi-column.cat-diplomacy {
      border-color: rgba(20, 184, 166, 0.54);
    }

    .action-tile.multi-column.cat-diplomacy-war {
      border-color: rgba(245, 158, 11, 0.54);
    }

    .action-tile.multi-column.cat-diplomacy-peace {
      border-color: rgba(203, 213, 225, 0.5);
    }

    .action-tile.multi-column.cat-diplomacy-alliance {
      border-color: rgba(34, 197, 94, 0.54);
    }

    .action-tile:active {
      transform: scale(0.95);
      background:
        linear-gradient(
          180deg,
          rgba(18, 24, 32, 0.95) 0%,
          rgba(8, 11, 17, 0.95) 100%
        ),
        radial-gradient(
          120% 115% at 50% 0%,
          rgba(var(--cat-rgb), 0.25) 0%,
          rgba(var(--cat-rgb), 0.1) 45%,
          rgba(0, 0, 0, 0) 78%
        );
      border-color: rgba(var(--cat-rgb), 0.6);
    }

    .action-tile.cat-spawn:active {
      border-color: rgba(34, 197, 94, 0.62);
    }

    .action-tile.cat-infrastructure:active {
      border-color: rgba(59, 130, 246, 0.62);
    }

    .action-tile.cat-military:active {
      border-color: rgba(139, 92, 246, 0.62);
    }

    .action-tile.cat-combat:active {
      border-color: rgba(239, 68, 68, 0.62);
    }

    .action-tile.cat-nuclear:active {
      border-color: rgba(245, 158, 11, 0.62);
    }

    .action-tile.cat-diplomacy:active {
      border-color: rgba(20, 184, 166, 0.62);
    }

    .action-tile.cat-diplomacy-war:active {
      border-color: rgba(245, 158, 11, 0.62);
    }

    .action-tile.cat-diplomacy-peace:active {
      border-color: rgba(203, 213, 225, 0.58);
    }

    .action-tile.cat-diplomacy-alliance:active {
      border-color: rgba(34, 197, 94, 0.62);
    }

    .action-tile.disabled {
      opacity: 0.55;
      cursor: not-allowed;
      background: linear-gradient(
        180deg,
        rgba(95, 103, 114, 0.13) 0%,
        rgba(45, 52, 61, 0.25) 100%
      );
      border-color: rgba(120, 129, 141, 0.32);
    }

    .action-tile.locked {
      opacity: 0.6;
      background: linear-gradient(
        180deg,
        rgba(239, 68, 68, 0.18) 0%,
        rgba(36, 14, 18, 0.3) 100%
      );
      border-color: rgba(239, 68, 68, 0.44);
    }

    .action-tile.disabled:active,
    .action-tile.locked:active {
      transform: none;
    }

    .action-icon {
      font-size: var(--m-grid-icon-size, 28px);
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--m-grid-icon-size, 28px);
      height: var(--m-grid-icon-size, 28px);
      z-index: 1;
    }

    .action-icon img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      filter: brightness(1.08) saturate(0.95);
    }

    .action-tile.multi-column .action-icon {
      font-size: var(--m-grid-icon-size-multi, 36px);
      width: var(--m-grid-icon-size-multi, 36px);
      height: var(--m-grid-icon-size-multi, 36px);
    }

    .action-label {
      color: rgba(236, 241, 247, 0.96);
      font-size: var(--m-grid-font-size, 11px);
      text-align: center;
      font-weight: 600;
      line-height: 1.2;
      text-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
      z-index: 1;
    }

    .action-tile.multi-column .action-label {
      font-size: var(--m-grid-font-size-multi, 13px);
      font-weight: 600;
    }

    .action-cost {
      position: absolute;
      top: var(--m-grid-cost-top, 5px);
      right: var(--m-grid-cost-right, 5px);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--m-grid-cost-gap, 2px);
      max-width: calc(100% - var(--m-grid-cost-max-width-inset, 10px));
      min-height: var(--m-grid-cost-min-h, 16px);
      padding: 0 var(--m-grid-cost-padding-x, 5px);
      border-radius: 999px;
      border: 1px solid rgba(234, 179, 8, 0.52);
      background: rgba(36, 23, 4, 0.82);
      color: rgba(251, 191, 36, 0.98);
      font-size: var(--m-grid-cost-font-size, 9px);
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      text-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
      pointer-events: none;
      z-index: 3;
    }

    .action-tile.multi-column .action-cost {
      font-size: var(--m-grid-cost-multi-font-size, 10px);
      min-height: var(--m-grid-cost-multi-min-h, 18px);
      padding: 0 var(--m-grid-cost-multi-padding-x, 6px);
    }
  `;

  render() {
    return html`
      <div
        class="backdrop ${this.stackModeEnabled ? "no-backdrop" : ""}"
        @click=${this.handleBackdropClick}
      ></div>
      <div class="grid-container">
        <div class="grid">
          ${this.items.map((item) => this.renderActionTile(item))}
        </div>
      </div>
    `;
  }

  private renderActionTile(item: ActionGridItem) {
    const category = this.getActionCategory(item.id);
    const itemWidth = item.columnSpan ?? 1;
    const classes = [
      "action-tile",
      category ? `cat-${category}` : "",
      itemWidth > 1 ? "multi-column" : "",
      item.disabled ? "disabled" : "",
      item.locked ? "locked" : "",
    ]
      .filter(Boolean)
      .join(" ");

    // Render icon as image if it's a path, otherwise as text/emoji
    const iconHtml = item.icon.startsWith("/")
      ? html`<img src="${item.icon}" alt="${item.label}" />`
      : item.icon;

    return html`
      <div
        class=${classes}
        style="--item-width: ${itemWidth}%"
        @click=${() => this.handleActionClick(item)}
      >
        ${item.cost
          ? html`<div class="action-cost">${this.formatNumber(item.cost)}</div>`
          : ""}
        <div class="action-icon">${iconHtml}</div>
        <div class="action-label">${item.label}</div>
      </div>
    `;
  }

  private formatNumber(num: number): string {
    return renderNumber(num)
      .replace(/\.00(?=[KM]$)/, "")
      .replace(/(\.\d)0(?=[KM]$)/, "$1")
      .replace(/\.0(?=[KM]$)/, "");
  }

  private handleActionClick(item: ActionGridItem): void {
    if (item.disabled || item.locked) {
      HapticFeedback.trigger(HapticPattern.ERROR);
      return;
    }

    HapticFeedback.trigger(HapticPattern.TAP);
    this.dispatchEvent(
      new CustomEvent("action-selected", {
        detail: { action: item.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleBackdropClick(): void {
    if (this.stackModeEnabled) {
      return;
    }

    // Prevent immediate closure if grid just opened (within 300ms)
    const timeSinceOpen = Date.now() - this.lastOpenedTime;
    if (timeSinceOpen < 300) {
      return;
    }
    HapticFeedback.trigger(HapticPattern.TAP);
    this.close();
  }

  /**
   * Show action grid for a tile
   */
  async showForTile(
    tile: TileRef,
    game: GameView,
    attackRatio: number,
  ): Promise<void> {
    this.tile = tile;
    this.game = game;
    this.attackRatio = attackRatio;

    // Clear old items immediately to prevent flicker
    this.items = [];
    this.ready = false;
    this.visible = true;
    this.lastOpenedTime = Date.now();

    if (this.stackModeEnabled) {
      this.items = [this.getStackModeToggleItem(true)];
      this.ready = true;
      this.requestUpdate();
      return;
    }

    // Wait for grid container to render and establish layout
    await this.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Fast path for spawn phase - no async needed
    if (game.inSpawnPhase()) {
      const myPlayer = game.myPlayer();
      if (myPlayer) {
        const actions = this.getSpawnActions(tile, game, myPlayer);
        const columns = this.calculateColumns(actions.length);
        this.items = this.processItemsForGrid(actions, columns);
        this.ready = true;
        this.requestUpdate();
      }
      return;
    }

    const category = await this.determineTileCategory(tile, game);
    const actions = await this.getActionsForCategory(category, tile, game);
    const columns = this.calculateColumns(actions.length);
    this.items = this.processItemsForGrid(actions, columns);
    this.ready = true;
    this.requestUpdate();
  }

  /**
   * Close the action grid
   */
  close(): void {
    this.visible = false;
    this.ready = false;
    this.dispatchEvent(
      new CustomEvent("grid-closed", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  setStackModeEnabled(enabled: boolean): void {
    this.stackModeEnabled = enabled;

    if (enabled) {
      this.visible = true;
      this.ready = true;
      this.items = [this.getStackModeToggleItem(true)];
      this.requestUpdate();
      return;
    }

    if (this.tile && this.game) {
      void this.showForTile(this.tile, this.game, this.attackRatio);
      return;
    }

    this.requestUpdate();
  }
  /**
   * Determine the category of actions to show based on tile context
   */
  private async determineTileCategory(
    tile: TileRef,
    game: GameView,
  ): Promise<ActionCategory> {
    const myPlayer = game.myPlayer();
    if (!myPlayer) return "neutral-can-attack";

    const owner = game.owner(tile);
    const isMyTile = owner === myPlayer;
    const isWater = !game.isLand(tile);
    const isNeutral = !owner.isPlayer();

    if (isMyTile) {
      // Own territory
      if (isWater) {
        return "own-water";
      } else if (game.isShoreline(tile)) {
        return "own-shore";
      } else {
        return "own-land";
      }
    } else {
      // Enemy or neutral territory
      const actions = await myPlayer.actions(tile);

      if (isNeutral) {
        // Neutral territory
        // For ocean tiles, always show ship building options
        if (isWater) {
          return "neutral-can-attack";
        }

        if (actions.canAttack) {
          return "neutral-can-attack";
        } else {
          // Check if boat attack is possible (for land tiles only)
          const transportShipBuildable = actions.buildableUnits.find(
            (bu) => bu.type === UnitType.TransportShip,
          );
          if (
            transportShipBuildable &&
            transportShipBuildable.canBuild !== false
          ) {
            return "neutral-can-boat-attack";
          }
          return "neutral-can-attack";
        }
      } else {
        // Enemy player territory
        if (actions.canAttack) {
          return "enemy-can-attack";
        } else {
          // Check if boat attack is possible
          const transportShipBuildable = actions.buildableUnits.find(
            (bu) => bu.type === UnitType.TransportShip,
          );
          if (
            transportShipBuildable &&
            transportShipBuildable.canBuild !== false &&
            game.isLand(tile)
          ) {
            return "enemy-can-boat-attack";
          }
          return "enemy-no-attack";
        }
      }
    }
  }

  /**
   * Get actions for a specific category
   */
  private async getActionsForCategory(
    category: ActionCategory,
    tile: TileRef,
    game: GameView,
  ): Promise<ActionGridItem[]> {
    const myPlayer = game.myPlayer();
    if (!myPlayer) return [];

    switch (category) {
      case "spawn-phase":
        return this.getSpawnActions(tile, game, myPlayer);
      case "own-land":
        return this.appendStackModeToggle(
          this.getOwnLandActions(tile, game, myPlayer),
        );
      case "own-shore":
        return this.appendStackModeToggle(
          this.getOwnLandActions(tile, game, myPlayer),
        );
      case "own-water":
        return this.appendStackModeToggle(
          this.getOwnWaterActions(tile, game, myPlayer),
        );
      case "enemy-can-attack":
        return this.getEnemyCanAttackActions(tile, game, myPlayer);
      case "enemy-can-boat-attack":
        return this.getEnemyCanBoatAttackActions(tile, game, myPlayer);
      case "enemy-no-attack":
        return this.getEnemyNoAttackActions(tile, game, myPlayer);
      case "neutral-can-attack":
        return this.getNeutralCanAttackActions(tile, game, myPlayer);
      case "neutral-can-boat-attack":
        return this.getNeutralCanBoatAttackActions(tile, game, myPlayer);
      default:
        return [];
    }
  }

  private appendStackModeToggle(actions: ActionGridItem[]): ActionGridItem[] {
    return [...actions, this.getStackModeToggleItem()];
  }

  private getStackModeToggleItem(fullWidth: boolean = false): ActionGridItem {
    return {
      id: "mode:stack-toggle",
      icon: "/images/UpgradeArrowIcon.svg",
      label: this.stackModeEnabled ? "Stack ON" : "Stack Mode",
      columnSpan: fullWidth ? 100 : undefined,
    };
  }

  private getSpawnActions(
    tile: TileRef,
    game: GameView,
    myPlayer: PlayerView,
  ): ActionGridItem[] {
    const isLand = game.isLand(tile);
    const hasOwner = game.hasOwner(tile);

    if (isLand && !hasOwner) {
      return [
        {
          id: "spawn",
          icon: getActionIcon("spawn"),
          label: "Spawn Here",
          priority: "high",
        },
      ];
    }

    return [];
  }

  private getOwnLandActions(
    tile: TileRef,
    game: GameView,
    myPlayer: PlayerView,
  ): ActionGridItem[] {
    const gold = Number(myPlayer.gold());
    const actions: ActionGridItem[] = [];

    // Check if there's nearby owned ocean shore for port placement
    const nearbyShore = Array.from(
      game.bfs(tile, (gm, t) => game.manhattanDist(tile, t) <= 10),
    ).some((t) => game.owner(t) === myPlayer && game.isOceanShore(t));

    if (nearbyShore) {
      const portCost = this.getUnitCost(UnitType.Port, myPlayer);
      actions.push({
        id: `build:${UnitType.Port}`,
        icon: getUnitIcon(UnitType.Port) ?? "⚓",
        label: "Port",
        cost: portCost,
        disabled: gold < portCost,
        disabledReason: gold < portCost ? "Not enough gold" : undefined,
        priority: "high",
      });
    }

    // All land structures
    const landStructures = [
      {
        type: UnitType.City,
        icon: getUnitIcon(UnitType.City) ?? "🏙️",
        label: "City",
        priority: "high" as const,
      },
      {
        type: UnitType.Factory,
        icon: getUnitIcon(UnitType.Factory) ?? "🏭",
        label: "Factory",
        priority: "high" as const,
      },
      {
        type: UnitType.DefensePost,
        icon: getUnitIcon(UnitType.DefensePost) ?? "🛡️",
        label: "Defense Post",
      },
      {
        type: UnitType.Airfield,
        icon: getUnitIcon(UnitType.Airfield) ?? "✈️",
        label: "Airfield",
        priority: "high" as const,
      },
      {
        type: UnitType.Hospital,
        icon: getUnitIcon(UnitType.Hospital) ?? "🏥",
        label: "Hospital",
        upgrade: UpgradeType.HospitalResearch,
      },
      {
        type: UnitType.MissileSilo,
        icon: getUnitIcon(UnitType.MissileSilo) ?? "⚛️",
        label: "Missile Silo",
        upgrade: UpgradeType.NuclearFission,
      },
      {
        type: UnitType.ResearchLab,
        icon: getUnitIcon(UnitType.ResearchLab) ?? "🔬",
        label: "Research Lab",
      },
      {
        type: UnitType.Academy,
        icon: getUnitIcon(UnitType.Academy) ?? "🏛️",
        label: "Academy",
      },
      {
        type: UnitType.SAMLauncher,
        icon: getUnitIcon(UnitType.SAMLauncher) ?? "🎯",
        label: "SAM Launcher",
      },
      {
        type: UnitType.DoomsdayDevice,
        icon: getUnitIcon(UnitType.DoomsdayDevice) ?? "💀",
        label: "Doomsday Device",
        upgrade: UpgradeType.DoomsdayDeviceResearch,
      },
    ];

    for (const structure of landStructures) {
      // Skip if locked (requires upgrade)
      if (structure.upgrade && !myPlayer.hasUpgrade(structure.upgrade)) {
        continue;
      }

      const cost = this.getUnitCost(structure.type, myPlayer);
      actions.push({
        id: `build:${structure.type}`,
        icon: structure.icon,
        label: structure.label,
        cost,
        disabled: gold < cost,
        disabledReason: gold < cost ? "Not enough gold" : undefined,
        priority: structure.priority,
      });
    }

    // Artillery (only if factory and artillery research)
    const hasFactory = this.playerHasFactory(myPlayer);
    if (hasFactory) {
      const hasArtilleryResearch = myPlayer.hasUpgrade(
        UpgradeType.ArtilleryResearch,
      );
      if (hasArtilleryResearch) {
        const artilleryCost = this.getUnitCost(UnitType.Artillery, myPlayer);
        actions.push({
          id: `build:${UnitType.Artillery}`,
          icon:
            getUnitIcon(UnitType.Artillery) ?? getActionIcon("artilleryAttack"),
          label: "Artillery",
          cost: artilleryCost,
          disabled: gold < artilleryCost,
          disabledReason: gold < artilleryCost ? "Not enough gold" : undefined,
        });
      }
    }

    // Fighter Jet (only if airfield and jet engines)
    const hasAirfield = this.playerHasAirfield(myPlayer);
    if (hasAirfield) {
      const hasJetEngines = myPlayer.hasUpgrade(UpgradeType.JetEngines);
      if (hasJetEngines) {
        const jetCost = this.getUnitCost(UnitType.FighterJet, myPlayer);
        actions.push({
          id: `build:${UnitType.FighterJet}`,
          icon: getUnitIcon(UnitType.FighterJet) ?? getActionIcon("airAttack"),
          label: "Fighter Jet",
          cost: jetCost,
          disabled: gold < jetCost,
          disabledReason: gold < jetCost ? "Not enough gold" : undefined,
        });
      }
    }

    return actions;
  }

  private getOwnWaterActions(
    tile: TileRef,
    game: GameView,
    myPlayer: PlayerView,
  ): ActionGridItem[] {
    const gold = Number(myPlayer.gold());
    const actions: ActionGridItem[] = [];

    // Check if there's nearby owned shore for port placement
    const nearbyShore = Array.from(
      game.bfs(tile, (gm, t) => game.manhattanDist(tile, t) <= 10),
    ).some((t) => game.owner(t) === myPlayer && game.isOceanShore(t));

    if (nearbyShore) {
      const portCost = this.getUnitCost(UnitType.Port, myPlayer);
      actions.push({
        id: `build:${UnitType.Port}`,
        icon: getUnitIcon(UnitType.Port) ?? "⚓",
        label: "Port",
        cost: portCost,
        disabled: gold < portCost,
        disabledReason: gold < portCost ? "Not enough gold" : undefined,
        priority: "high",
      });
    }

    // Check if player has a port (required for water units)
    const hasPort = this.playerHasPort(myPlayer);

    // Only show water units if port exists
    if (hasPort) {
      // Warship
      const warshipCost = this.getUnitCost(UnitType.Warship, myPlayer);
      actions.push({
        id: `build:${UnitType.Warship}`,
        icon: getUnitIcon(UnitType.Warship) ?? getActionIcon("navyAssault"),
        label: "Warship",
        cost: warshipCost,
        disabled: gold < warshipCost,
        disabledReason: gold < warshipCost ? "Not enough gold" : undefined,
        priority: "high",
      });

      // Submarine (only if research unlocked)
      const hasSubResearch = myPlayer.hasUpgrade(UpgradeType.SubmarineResearch);
      if (hasSubResearch) {
        const submarineCost = this.getUnitCost(UnitType.Submarine, myPlayer);
        actions.push({
          id: `build:${UnitType.Submarine}`,
          icon: getUnitIcon(UnitType.Submarine) ?? getActionIcon("submarine"),
          label: "Submarine",
          cost: submarineCost,
          disabled: gold < submarineCost,
          disabledReason: gold < submarineCost ? "Not enough gold" : undefined,
          priority: "high",
        });
      }
    }

    // Fighter Jet (only if airfield and jet engines)
    const hasAirfield = this.playerHasAirfield(myPlayer);
    if (hasAirfield) {
      const hasJetEngines = myPlayer.hasUpgrade(UpgradeType.JetEngines);
      if (hasJetEngines) {
        const jetCost = this.getUnitCost(UnitType.FighterJet, myPlayer);
        actions.push({
          id: `build:${UnitType.FighterJet}`,
          icon: getUnitIcon(UnitType.FighterJet) ?? getActionIcon("airAttack"),
          label: "Fighter Jet",
          cost: jetCost,
          disabled: gold < jetCost,
          disabledReason: gold < jetCost ? "Not enough gold" : undefined,
        });
      }
    }

    return actions;
  }

  private getEnemyCanAttackActions(
    tile: TileRef,
    game: GameView,
    myPlayer: PlayerView,
  ): ActionGridItem[] {
    const actions: ActionGridItem[] = [];
    const troops = Number(myPlayer.troops());
    const owner = game.owner(tile);
    const targetPlayer = owner.isPlayer() ? (owner as PlayerView) : null;

    // Ground attack (high priority)
    actions.push({
      id: "attack:ground",
      icon: getActionIcon("attack"),
      label: "Ground Attack",
      disabled: troops === 0,
      disabledReason: troops === 0 ? "No troops" : undefined,
      priority: "high",
    });

    // Air attacks (if airfield exists)
    const hasAirfield = this.playerHasAirfield(myPlayer);
    const hasJetEngines = myPlayer.hasUpgrade(UpgradeType.JetEngines);
    const isAtWar = targetPlayer ? myPlayer.isAtWarWith(targetPlayer) : false;

    if (hasAirfield && hasJetEngines) {
      // Paratroopers (requires JetEngines)
      actions.push({
        id: "attack:airstrike",
        icon: getActionIcon("paratrooper"),
        label: "Paratroopers",
        disabled: troops === 0,
        disabledReason: troops === 0 ? "No troops" : undefined,
      });
    }

    if (hasAirfield && isAtWar) {
      // Bomber run (requires war declaration)
      actions.push({
        id: "attack:bomber",
        icon: getActionIcon("bomber"),
        label: "Bomber Run",
      });
    }

    // Fighter Jet (only if airfield and jet engines)
    if (hasAirfield && hasJetEngines) {
      const jetCost = this.getUnitCost(UnitType.FighterJet, myPlayer);
      const gold = Number(myPlayer.gold());
      actions.push({
        id: `build:${UnitType.FighterJet}`,
        icon: getUnitIcon(UnitType.FighterJet) ?? getActionIcon("airAttack"),
        label: "Fighter Jet",
        cost: jetCost,
        disabled: gold < jetCost,
        disabledReason: gold < jetCost ? "Not enough gold" : undefined,
      });
    }

    if (targetPlayer) {
      this.pushDiplomacyActions(actions, myPlayer, targetPlayer);
    }

    this.pushNukeActions(actions, myPlayer);

    return actions;
  }

  private getEnemyCanBoatAttackActions(
    tile: TileRef,
    game: GameView,
    myPlayer: PlayerView,
  ): ActionGridItem[] {
    const actions: ActionGridItem[] = [];
    const troops = Number(myPlayer.troops());
    const owner = game.owner(tile);
    const targetPlayer = owner.isPlayer() ? (owner as PlayerView) : null;

    // Naval assault (high priority)
    actions.push({
      id: "attack:naval",
      icon: getActionIcon("navyAssault"),
      label: "Naval Assault",
      disabled: troops === 0,
      disabledReason: troops === 0 ? "No troops" : undefined,
      priority: "high",
    });

    // Air attacks (if airfield exists)
    const hasAirfield = this.playerHasAirfield(myPlayer);
    const hasJetEngines = myPlayer.hasUpgrade(UpgradeType.JetEngines);
    const isAtWar = targetPlayer ? myPlayer.isAtWarWith(targetPlayer) : false;

    if (hasAirfield && hasJetEngines) {
      // Paratroopers (requires JetEngines)
      actions.push({
        id: "attack:airstrike",
        icon: getActionIcon("paratrooper"),
        label: "Paratroopers",
        disabled: troops === 0,
        disabledReason: troops === 0 ? "No troops" : undefined,
      });
    }

    if (hasAirfield && isAtWar) {
      // Bomber run (requires war declaration)
      actions.push({
        id: "attack:bomber",
        icon: getActionIcon("bomber"),
        label: "Bomber Run",
      });
    }

    if (targetPlayer) {
      this.pushDiplomacyActions(actions, myPlayer, targetPlayer);
    }

    this.pushNukeActions(actions, myPlayer);

    return actions;
  }

  private getEnemyNoAttackActions(
    tile: TileRef,
    game: GameView,
    myPlayer: PlayerView,
  ): ActionGridItem[] {
    const actions: ActionGridItem[] = [];
    const owner = game.owner(tile);
    const targetPlayer = owner.isPlayer() ? (owner as PlayerView) : null;
    const troops = Number(myPlayer.troops());

    // Air attacks (if airfield exists)
    const hasAirfield = this.playerHasAirfield(myPlayer);
    const hasJetEngines = myPlayer.hasUpgrade(UpgradeType.JetEngines);
    const isAtWar = targetPlayer ? myPlayer.isAtWarWith(targetPlayer) : false;

    if (hasAirfield && hasJetEngines) {
      // Paratroopers (requires JetEngines)
      actions.push({
        id: "attack:airstrike",
        icon: getActionIcon("paratrooper"),
        label: "Paratroopers",
        disabled: troops === 0,
        disabledReason: troops === 0 ? "No troops" : undefined,
        priority: "high",
      });
    }

    if (hasAirfield && isAtWar) {
      // Bomber run (requires war declaration)
      actions.push({
        id: "attack:bomber",
        icon: getActionIcon("bomber"),
        label: "Bomber Run",
        priority: "high",
      });
    }

    if (targetPlayer) {
      this.pushDiplomacyActions(actions, myPlayer, targetPlayer, {
        prioritizePeace: true,
        prioritizeProposeAlliance: true,
      });
    }

    this.pushNukeActions(actions, myPlayer);
    return actions;
  }

  private getNeutralCanAttackActions(
    tile: TileRef,
    game: GameView,
    myPlayer: PlayerView,
  ): ActionGridItem[] {
    const actions: ActionGridItem[] = [];
    const troops = Number(myPlayer.troops());
    const gold = Number(myPlayer.gold());
    const isOcean = !game.isLand(tile);

    // Ground attack (for land tiles only - can't attack empty ocean)
    if (!isOcean) {
      actions.push({
        id: "attack:ground",
        icon: getActionIcon("attack"),
        label: "Attack",
        disabled: troops === 0,
        disabledReason: troops === 0 ? "No troops" : undefined,
        priority: "high",
      });
    }

    // If ocean tile, check for port building and water units
    if (isOcean) {
      // Check if there's nearby owned shore for port placement
      const nearbyShore = Array.from(
        game.bfs(tile, (gm, t) => game.manhattanDist(tile, t) <= 10),
      ).some((t) => game.owner(t) === myPlayer && game.isOceanShore(t));

      if (nearbyShore) {
        const portCost = this.getUnitCost(UnitType.Port, myPlayer);
        actions.push({
          id: `build:${UnitType.Port}`,
          icon: getUnitIcon(UnitType.Port) ?? "⚓",
          label: "Port",
          cost: portCost,
          disabled: gold < portCost,
          disabledReason: gold < portCost ? "Not enough gold" : undefined,
          priority: "high",
        });
      }

      const hasPort = this.playerHasPort(myPlayer);

      if (hasPort) {
        // Warship
        const warshipCost = this.getUnitCost(UnitType.Warship, myPlayer);
        actions.push({
          id: `build:${UnitType.Warship}`,
          icon: getUnitIcon(UnitType.Warship) ?? getActionIcon("navyAssault"),
          label: "Warship",
          cost: warshipCost,
          disabled: gold < warshipCost,
          disabledReason: gold < warshipCost ? "Not enough gold" : undefined,
          priority: "high",
        });

        // Submarine (only if SubmarineResearch unlocked)
        const hasSubResearch = myPlayer.hasUpgrade(
          UpgradeType.SubmarineResearch,
        );
        if (hasSubResearch) {
          const submarineCost = this.getUnitCost(UnitType.Submarine, myPlayer);
          actions.push({
            id: `build:${UnitType.Submarine}`,
            icon: getUnitIcon(UnitType.Submarine) ?? getActionIcon("submarine"),
            label: "Submarine",
            cost: submarineCost,
            disabled: gold < submarineCost,
            disabledReason:
              gold < submarineCost ? "Not enough gold" : undefined,
            priority: "high",
          });
        }
      }

      // Fighter Jet (only if airfield and jet engines)
      const hasAirfield = this.playerHasAirfield(myPlayer);
      if (hasAirfield) {
        const hasJetEngines = myPlayer.hasUpgrade(UpgradeType.JetEngines);
        if (hasJetEngines) {
          const jetCost = this.getUnitCost(UnitType.FighterJet, myPlayer);
          actions.push({
            id: `build:${UnitType.FighterJet}`,
            icon:
              getUnitIcon(UnitType.FighterJet) ?? getActionIcon("airAttack"),
            label: "Fighter Jet",
            cost: jetCost,
            disabled: gold < jetCost,
            disabledReason: gold < jetCost ? "Not enough gold" : undefined,
          });
        }
      }
    }

    return actions;
  }

  private getNeutralCanBoatAttackActions(
    tile: TileRef,
    game: GameView,
    myPlayer: PlayerView,
  ): ActionGridItem[] {
    const troops = Number(myPlayer.troops());

    return [
      {
        id: "attack:naval",
        icon: getActionIcon("navyAssault"),
        label: "Naval Assault",
        disabled: troops === 0,
        disabledReason: troops === 0 ? "No troops" : undefined,
        priority: "high",
      },
    ];
  }

  private getUnitCost(unitType: UnitType, myPlayer: PlayerView): number {
    if (!this.game) return 0;

    const immediateCost = this.game.config().unitInfo(unitType).cost(myPlayer);
    return Number(immediateCost);
  }

  private playerHasPort(myPlayer: PlayerView): boolean {
    // Only count completed ports, not ports under construction
    return myPlayer.units(UnitType.Port).length > 0;
  }

  private playerHasAirfield(myPlayer: PlayerView): boolean {
    // Only count completed airfields, not airfields under construction
    return myPlayer.units(UnitType.Airfield).length > 0;
  }

  private playerHasFactory(myPlayer: PlayerView): boolean {
    // Only count completed factories, not factories under construction
    return myPlayer.units(UnitType.Factory).length > 0;
  }

  private pushNukeActions(
    actions: ActionGridItem[],
    myPlayer: PlayerView,
  ): void {
    const gold = Number(myPlayer.gold());

    const nukeOptions: Array<{
      type: "atom" | "hbomb" | "mirv";
      id: string;
      icon: string;
      label: string;
      cost: number;
    }> = [
      {
        type: "atom",
        id: "attack:nuke-atom",
        icon: getActionIcon("atomBomb"),
        label: "Atom Bomb",
        cost: 5000,
      },
      {
        type: "hbomb",
        id: "attack:nuke-hbomb",
        icon: getActionIcon("hBomb"),
        label: "H-Bomb",
        cost: 15000,
      },
      {
        type: "mirv",
        id: "attack:nuke-mirv",
        icon: getActionIcon("mirv"),
        label: "MIRV",
        cost: 50000,
      },
    ];

    for (const option of nukeOptions) {
      if (!this.canLaunchNuke(myPlayer, option.type)) {
        continue;
      }

      actions.push({
        id: option.id,
        icon: option.icon,
        label: option.label,
        cost: option.cost,
        disabled: gold < option.cost,
        disabledReason: gold < option.cost ? "Not enough gold" : undefined,
      });
    }
  }

  private pushDiplomacyActions(
    actions: ActionGridItem[],
    myPlayer: PlayerView,
    targetPlayer: PlayerView,
    options?: {
      prioritizePeace?: boolean;
      prioritizeProposeAlliance?: boolean;
    },
  ): void {
    const isAllied = myPlayer.isAlliedWith(targetPlayer);
    const isAtWar = myPlayer.isAtWarWith(targetPlayer);

    if (isAtWar) {
      actions.push({
        id: "diplomacy:request-peace",
        icon: getActionIcon("peace"),
        label: "Request Peace",
        priority: options?.prioritizePeace ? "high" : undefined,
      });
    } else if (isAllied) {
      actions.push({
        id: "diplomacy:break-alliance",
        icon: getActionIcon("breakAlliance"),
        label: "Break Alliance",
      });
    } else {
      actions.push({
        id: "diplomacy:propose-ally",
        icon: getActionIcon("alliance"),
        label: "Propose Alliance",
        priority: options?.prioritizeProposeAlliance ? "high" : undefined,
      });
    }

    if (!isAtWar) {
      actions.push({
        id: "attack:declare-war",
        icon: getActionIcon("declareWar"),
        label: "Declare War",
      });
    }
  }

  private canLaunchNuke(
    myPlayer: PlayerView,
    nukeType: "atom" | "hbomb" | "mirv",
  ): boolean {
    if (!this.game) return false;

    // Only count completed missile silos, not silos under construction
    const silos = myPlayer.units(UnitType.MissileSilo).length;
    if (silos === 0) return false; // No silos

    const gold = Number(myPlayer.gold());
    const cost =
      nukeType === "atom" ? 5000 : nukeType === "hbomb" ? 15000 : 50000;
    if (gold < cost) return false; // Can't afford

    // Check research requirements
    if (nukeType === "atom") {
      if (!myPlayer.hasUpgrade(UpgradeType.NuclearFission)) return false;
    } else if (nukeType === "hbomb") {
      if (!myPlayer.hasUpgrade(UpgradeType.ThermonuclearStaging)) return false;
    } else if (nukeType === "mirv") {
      if (!myPlayer.hasUpgrade(UpgradeType.MIRVTechnology)) return false;
    }

    return true;
  }

  /**
   * Calculate actual number of columns based on container width
   * CSS: repeat(auto-fill, minmax(65px, 1fr)) with 8px gap
   */
  private calculateColumns(expectedItems: number = 0): number {
    const gridElement = this.shadowRoot?.querySelector(".grid") as HTMLElement;
    if (!gridElement) {
      return 5; // Fallback if grid not rendered yet
    }

    const width = gridElement.clientWidth;
    const minColumnWidth = this.getGridMinColumnWidthPx();
    const gap = this.getGridGapPx();

    if (
      this.isOneRowLandscapeProfile() &&
      expectedItems > 0 &&
      expectedItems <= 15
    ) {
      return expectedItems;
    }

    // Calculate: how many columns fit?
    // Formula: (width + gap) / (minColumnWidth + gap)
    const columns = Math.floor((width + gap) / (minColumnWidth + gap));
    return Math.max(1, columns);
  }

  /**
   * Process items for grid display:
   * 1. Sort high priority first
   * 2. Fill grid naturally
   * 3. If top row is incomplete, expand top row items to fill it completely
   *
   * Uses percentage widths for perfect fractional precision (e.g., 2.5 columns = 50%)
   */
  private processItemsForGrid(
    items: ActionGridItem[],
    columns: number,
  ): ActionGridItem[] {
    const stackToggle = items.find((item) => item.id === "mode:stack-toggle");
    const sortableItems = items.filter(
      (item) => item.id !== "mode:stack-toggle",
    );

    // Sort: high priority first, then normal
    const sortedWithoutToggle = [...sortableItems].sort((a, b) => {
      const aPriority = a.priority === "high" ? 1 : 0;
      const bPriority = b.priority === "high" ? 1 : 0;
      return bPriority - aPriority;
    });

    const sorted = stackToggle
      ? [...sortedWithoutToggle, stackToggle]
      : sortedWithoutToggle;

    const totalItems = sorted.length;
    const remainder = totalItems % columns;

    // Calculate single column percentage (accounts for gap)
    const gap = this.getGridGapPx();
    const gapPercent = (gap / this.getGridWidth()) * 100;
    const singleColPercent = (100 - gapPercent * (columns - 1)) / columns;

    // If perfectly divisible, all items are single column
    if (remainder === 0) {
      return sorted.map((item) => ({
        ...item,
        columnSpan: singleColPercent,
      }));
    }

    // Top row has `remainder` items that need to fill all columns
    // Each gets: (columns / remainder) columns worth of space
    const topRowColSpan = columns / remainder;
    const topRowPercent =
      topRowColSpan * singleColPercent + (topRowColSpan - 1) * gapPercent;

    return sorted.map((item, index) => {
      if (index < remainder) {
        return { ...item, columnSpan: topRowPercent };
      }

      return { ...item, columnSpan: singleColPercent };
    });
  }

  /**
   * Get grid container width for percentage calculations
   */
  private getGridWidth(): number {
    const gridElement = this.shadowRoot?.querySelector(".grid") as HTMLElement;
    return gridElement?.clientWidth || 390; // Fallback to typical mobile width
  }

  private getGridGapPx(): number {
    const rawGap = getComputedStyle(this)
      .getPropertyValue("--m-grid-gap")
      .trim();
    const gap = Number.parseFloat(rawGap);
    return Number.isFinite(gap) && gap > 0 ? gap : 8;
  }

  private getGridMinColumnWidthPx(): number {
    const rawMin = getComputedStyle(this)
      .getPropertyValue("--m-grid-column-min")
      .trim();
    const minWidth = Number.parseFloat(rawMin);
    return Number.isFinite(minWidth) && minWidth > 0 ? minWidth : 65;
  }

  private isOneRowLandscapeProfile(): boolean {
    const orientation = document.body.dataset.mobileOrientation;
    const sizeClass = document.body.dataset.mobileClass;

    return orientation === "landscape" && sizeClass !== "large";
  }

  /**
   * Determine the category of an action based on its ID
   * Used for color-coding action tiles
   */
  private getActionCategory(
    actionId: string,
  ):
    | "spawn"
    | "infrastructure"
    | "military"
    | "combat"
    | "nuclear"
    | "diplomacy"
    | "diplomacy-war"
    | "diplomacy-peace"
    | "diplomacy-alliance"
    | null {
    // Spawn
    if (actionId === "spawn") return "spawn";

    // Infrastructure & Buildings
    if (actionId.startsWith("build:")) {
      const unitType = actionId.replace("build:", "");
      // Military units
      if (
        unitType === UnitType.Artillery ||
        unitType === UnitType.Warship ||
        unitType === UnitType.Submarine ||
        unitType === UnitType.FighterJet
      ) {
        return "military";
      }
      // Everything else is infrastructure
      return "infrastructure";
    }

    if (actionId === "mode:stack-toggle") {
      return "infrastructure";
    }

    // Diplomacy - specific actions
    if (actionId === "diplomacy:request-peace") {
      return "diplomacy-peace";
    }
    if (actionId === "diplomacy:propose-ally") {
      return "diplomacy-alliance";
    }
    if (
      actionId === "diplomacy:break-alliance" ||
      actionId === "attack:declare-war"
    ) {
      return "diplomacy-war";
    }

    // Generic diplomacy fallback
    if (actionId.startsWith("diplomacy:")) {
      return "diplomacy";
    }

    // Combat Actions
    if (actionId.startsWith("attack:")) {
      // Nuclear weapons
      if (actionId.includes("nuke")) {
        return "nuclear";
      }
      // Regular combat
      return "combat";
    }

    return null;
  }
}
