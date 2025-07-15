import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerType, UnitType } from "../../../core/game/Game";
import { euclDistFN, TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { AlternateViewEvent, DragEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class TerritoryLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;

  private tileToRenderQueue: PriorityQueue<{
    tile: TileRef;
    lastUpdate: number;
  }> = new PriorityQueue((a, b) => {
    return a.lastUpdate - b.lastUpdate;
  });
  private random = new PseudoRandom(123);
  private theme: Theme;

  // Used for spawn highlighting
  private highlightCanvas: HTMLCanvasElement;
  private highlightContext: CanvasRenderingContext2D;

  private alternativeView = false;
  private lastDragTime = 0;
  private nodrawDragDuration = 200;

  private refreshRate = 15; //refresh every 15ms
  private lastRefresh = 0;

  private lastFocusedPlayer: PlayerView | null = null;
  private lastCleanupTick = 0;
  private hotBorderTiles: Map<TileRef, { expiration: number; color: Colord }> =
    new Map();
  private hotBorderColorRed: Colord;
  private hotBorderColorBlack: Colord;
  private previousBorderStatus: Map<TileRef, boolean> = new Map();

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.hotBorderColorRed = this.theme.hotBorderColorRed();
    this.hotBorderColorBlack = this.theme.hotBorderColorBlack();
  }

  shouldTransform(): boolean {
    return true;
  }

  async paintPlayerBorder(player: PlayerView | null) {
    if (!player || typeof player.borderTiles !== "function") {
      return;
    }
    const tiles = await player.borderTiles();
    tiles.borderTiles.forEach((tile: TileRef) => {
      this.paintTerritory(tile, true); // Immediately paint the tile instead of enqueueing
    });
  }

  tick() {
    this.game.recentlyUpdatedTiles().forEach((t) => this.enqueueTile(t));

    const CLEANUP_INTERVAL_TICKS = 10; // Adjust as needed, e.g., 10-30 ticks
    if (this.game.ticks() - this.lastCleanupTick >= CLEANUP_INTERVAL_TICKS) {
      this.lastCleanupTick = this.game.ticks(); // Update last cleanup time

      const now = Date.now();
      // Clean up hot borders
      for (const [tile, { expiration }] of this.hotBorderTiles.entries()) {
        if (now > expiration) {
          this.hotBorderTiles.delete(tile);
          this.enqueueTile(tile); // Re-queue to repaint to normal state
        }
      }
    }

    const focusedPlayer = this.game.focusedPlayer();
    const recentlyUpdatedTilesSet = new Set(this.game.recentlyUpdatedTiles());

    const tilesToProcess = new Set<TileRef>();
    const newPreviousBorderStatus = new Map<TileRef, boolean>();
    const tilesToEnqueue = new Set<TileRef>(); // Collect tiles to enqueue once

    if (focusedPlayer) {
      // Add existing hot border tiles
      for (const tile of this.hotBorderTiles.keys()) {
        tilesToProcess.add(tile);
      }

      // Add tiles from previous border status
      for (const tile of this.previousBorderStatus.keys()) {
        tilesToProcess.add(tile);
      }

      // Add recently updated tiles and their neighbors, but only if relevant to focused player's border
      recentlyUpdatedTilesSet.forEach((updatedTile) => {
        // Check the updated tile itself
        if (
          this.game.owner(updatedTile) === focusedPlayer &&
          this.game.isBorder(updatedTile)
        ) {
          tilesToProcess.add(updatedTile);
        }
        // Check neighbors of the updated tile
        for (const neighbor of this.game.neighbors(updatedTile)) {
          if (
            this.game.owner(neighbor) === focusedPlayer &&
            this.game.isBorder(neighbor)
          ) {
            tilesToProcess.add(neighbor);
          }
        }
      });

      for (const tile of tilesToProcess) {
        const owner = this.game.owner(tile);
        const isCurrentBorder =
          owner === focusedPlayer && this.game.isBorder(tile);
        const wasPreviousBorder = this.previousBorderStatus.get(tile) || false;

        if (isCurrentBorder && !wasPreviousBorder) {
          // This tile just became a border
          let hotBorderColor = this.hotBorderColorRed; // Default to red (shrinking)

          if (recentlyUpdatedTilesSet.has(tile)) {
            // If the tile itself was recently updated, it implies expansion
            hotBorderColor = this.hotBorderColorBlack;
          } else {
            // Check if any neighbor was recently updated (implies shrinking)
            for (const neighbor of this.game.neighbors(tile)) {
              if (recentlyUpdatedTilesSet.has(neighbor)) {
                // If a neighbor was updated, and it's not the current tile, it's likely shrinking
                hotBorderColor = this.hotBorderColorRed;
                break;
              }
            }
          }

          this.hotBorderTiles.set(tile, {
            expiration: Date.now() + 1000,
            color: hotBorderColor,
          });
          tilesToEnqueue.add(tile);
        } else if (!isCurrentBorder && this.hotBorderTiles.has(tile)) {
          // Was a hot border but is no longer a border
          this.hotBorderTiles.delete(tile);
          tilesToEnqueue.add(tile);
        } else if (this.hotBorderTiles.has(tile)) {
          // Still a hot border, re-enqueue to ensure it's painted
          tilesToEnqueue.add(tile);
        }

        // Update newPreviousBorderStatus for this tile
        newPreviousBorderStatus.set(tile, isCurrentBorder);
      }
    } else {
      // If no focused player, clear all hot borders and previous border status
      this.hotBorderTiles.clear();
      newPreviousBorderStatus.clear(); // Clear this too
    }

    // Update previousBorderStatus for the next tick
    this.previousBorderStatus = newPreviousBorderStatus;

    // Enqueue all tiles that need to be rendered
    tilesToEnqueue.forEach((t) => this.enqueueTile(t));

    const updates = this.game.updatesSinceLastTick();

    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];
    unitUpdates.forEach((update) => {
      if (update.unitType === UnitType.DefensePost) {
        const tile = update.pos;
        this.game
          .bfs(tile, euclDistFN(tile, this.game.config().defensePostRange()))
          .forEach((t) => {
            if (
              this.game.isBorder(t) &&
              (this.game.ownerID(t) === update.ownerID ||
                this.game.ownerID(t) === update.lastOwnerID)
            ) {
              this.enqueueTile(t);
            }
          });
      }
    });

    if (focusedPlayer !== this.lastFocusedPlayer) {
      if (this.lastFocusedPlayer) {
        this.paintPlayerBorder(this.lastFocusedPlayer);
      }
      if (focusedPlayer) {
        this.paintPlayerBorder(focusedPlayer);
      }
      this.lastFocusedPlayer = focusedPlayer;
    }

    if (!this.game.inSpawnPhase()) {
      return;
    }
    if (this.game.ticks() % 5 === 0) {
      return;
    }

    this.highlightContext.clearRect(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );
    const humans = this.game
      .playerViews()
      .filter((p) => p.type() === PlayerType.Human);

    for (const human of humans) {
      const center = human.nameLocation();
      if (!center) {
        continue;
      }
      const centerTile = this.game.ref(center.x, center.y);
      if (!centerTile) {
        continue;
      }
      let color = this.theme.spawnHighlightColor();
      const myPlayer = this.game.myPlayer();
      if (
        myPlayer !== null &&
        myPlayer !== human &&
        myPlayer.isFriendly(human)
      ) {
        color = this.theme.selfColor();
      }
      for (const tile of this.game.bfs(
        centerTile,
        euclDistFN(centerTile, 9, true),
      )) {
        if (!this.game.hasOwner(tile)) {
          this.paintHighlightTile(tile, color, 255);
        }
      }
    }
  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
    });
    this.eventBus.on(DragEvent, (e) => {
      // TODO: consider re-enabling this on mobile or low end devices for smoother dragging.
      // this.lastDragTime = Date.now();
    });
    this.redraw();
  }

  redraw() {
    console.log("redrew territory layer");
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    this.imageData = this.context.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.initImageData();
    this.context.putImageData(this.imageData, 0, 0);

    // Add a second canvas for highlights
    this.highlightCanvas = document.createElement("canvas");
    const highlightContext = this.highlightCanvas.getContext("2d", {
      alpha: true,
    });
    if (highlightContext === null) throw new Error("2d context not supported");
    this.highlightContext = highlightContext;
    this.highlightCanvas.width = this.game.width();
    this.highlightCanvas.height = this.game.height();

    this.game.forEachTile((t) => {
      this.paintTerritory(t);
    });
  }

  initImageData() {
    this.game.forEachTile((tile) => {
      const cell = new Cell(this.game.x(tile), this.game.y(tile));
      const index = cell.y * this.game.width() + cell.x;
      const offset = index * 4;
      this.imageData.data[offset + 3] = 0;
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const now = Date.now();
    if (
      now > this.lastDragTime + this.nodrawDragDuration &&
      now > this.lastRefresh + this.refreshRate
    ) {
      this.lastRefresh = now;
      this.renderTerritory();

      const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
      const vx0 = Math.max(0, topLeft.x);
      const vy0 = Math.max(0, topLeft.y);
      const vx1 = Math.min(this.game.width() - 1, bottomRight.x);
      const vy1 = Math.min(this.game.height() - 1, bottomRight.y);

      const w = vx1 - vx0 + 1;
      const h = vy1 - vy0 + 1;

      if (w > 0 && h > 0) {
        this.context.putImageData(this.imageData, 0, 0, vx0, vy0, w, h);
      }
    }
    if (this.alternativeView) {
      return;
    }

    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    if (this.game.inSpawnPhase()) {
      context.drawImage(
        this.highlightCanvas,
        -this.game.width() / 2,
        -this.game.height() / 2,
        this.game.width(),
        this.game.height(),
      );
    }
  }

  renderTerritory() {
    let numToRender = Math.floor(this.tileToRenderQueue.size() / 10);
    if (numToRender === 0 || this.game.inSpawnPhase()) {
      numToRender = this.tileToRenderQueue.size();
    }

    while (numToRender > 0) {
      numToRender--;

      const entry = this.tileToRenderQueue.pop();
      if (!entry) {
        break;
      }

      const tile = entry.tile;
      this.paintTerritory(tile);
      for (const neighbor of this.game.neighbors(tile)) {
        this.paintTerritory(neighbor, true);
      }
    }
  }

  paintTerritory(tile: TileRef, isBorder: boolean = false) {
    if (isBorder && !this.game.hasOwner(tile)) {
      return;
    }
    if (!this.game.hasOwner(tile)) {
      if (this.game.hasFallout(tile)) {
        this.paintTile(tile, this.theme.falloutColor(), 150);
        return;
      }
      this.clearTile(tile);
      return;
    }
    const owner = this.game.owner(tile) as PlayerView;
    let finalColor = this.theme.territoryColor(owner);
    let finalAlpha = 150;

    if (this.game.isBorder(tile)) {
      finalAlpha = 255; // Borders are always opaque
      const playerIsFocused = owner && this.game.focusedPlayer() === owner;

      if (
        this.game.hasUnitNearby(
          tile,
          this.game.config().defensePostRange(),
          UnitType.DefensePost,
          owner.id(),
        )
      ) {
        // Defense post border
        if (playerIsFocused && this.hotBorderTiles.has(tile)) {
          finalColor = this.hotBorderTiles.get(tile)!.color;
        } else {
          const borderColors = this.theme.defendedBorderColors(owner);
          const x = this.game.x(tile);
          const y = this.game.y(tile);
          const lightTile =
            (x % 2 === 0 && y % 2 === 0) || (y % 2 === 1 && x % 2 === 1);
          finalColor = lightTile ? borderColors.light : borderColors.dark;
        }
      } else {
        // Regular border
        if (playerIsFocused && this.hotBorderTiles.has(tile)) {
          finalColor = this.hotBorderTiles.get(tile)!.color;
        } else {
          finalColor = playerIsFocused
            ? this.theme.focusedBorderColor()
            : this.theme.borderColor(owner);
        }
      }
    }

    this.paintTile(tile, finalColor, finalAlpha);
  }

  paintTile(tile: TileRef, color: Colord, alpha: number) {
    const offset = tile * 4;
    this.imageData.data[offset] = color.rgba.r;
    this.imageData.data[offset + 1] = color.rgba.g;
    this.imageData.data[offset + 2] = color.rgba.b;
    this.imageData.data[offset + 3] = alpha;
  }

  clearTile(tile: TileRef) {
    const offset = tile * 4;
    this.imageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
  }

  enqueueTile(tile: TileRef) {
    this.tileToRenderQueue.push({
      tile: tile,
      lastUpdate: this.game.ticks() + this.random.nextFloat(0, 0.5),
    });
  }

  async enqueuePlayerBorder(player: PlayerView | null) {
    if (!player || typeof player.borderTiles !== "function") {
      return;
    }
    const playerBorderTiles = await player.borderTiles();
    playerBorderTiles.borderTiles.forEach((tile: TileRef) => {
      this.enqueueTile(tile);
    });
  }

  paintHighlightTile(tile: TileRef, color: Colord, alpha: number) {
    this.clearTile(tile);
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    this.highlightContext.fillStyle = color.alpha(alpha / 255).toRgbString();
    this.highlightContext.fillRect(x, y, 1, 1);
  }

  clearHighlightTile(tile: TileRef) {
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    this.highlightContext.clearRect(x, y, 1, 1);
  }
}
