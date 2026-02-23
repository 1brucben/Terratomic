import type { Colord } from "colord";
import type { Theme } from "../../../core/configuration/Config";
import type { EventBus } from "../../../core/EventBus";
import { PlayerType, UnitType } from "../../../core/game/Game";
import type { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import type { GameView } from "../../../core/game/GameView";
import { PlayerView } from "../../../core/game/GameView";
import { AlternateViewEvent, MouseOverEvent } from "../../InputHandler";
import type { TransformHandler } from "../TransformHandler";
import type { Layer } from "./Layer";

export class TerritoryLayer implements Layer {
  layerName = "TerritoryLayer";
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;
  private imageData32: Uint32Array;
  private alternativeImageData: ImageData;
  private altData32: Uint32Array;

  // Used for spawn highlighting
  private highlightCanvas: HTMLCanvasElement;
  private highlightContext: CanvasRenderingContext2D;

  private renderQueue: TileRef[] = [];
  private theme: Theme;

  private highlightedTerritory: PlayerView | null = null;

  private alternativeView = false;
  private lastMousePosition: { x: number; y: number } | null = null;

  private refreshRate = 10; //refresh every 10ms
  private lastRefresh = 0;

  private lastFocusedPlayer: PlayerView | null = null;
  // Track my active wars to redraw only affected territories on change
  private lastMyWars: Set<string> | null = null;

  private defensePostOffsets: { x: number; y: number }[] | null = null;
  private spawnHighlightOffsets: { x: number; y: number }[] | null = null;

  // Caches to avoid heavy calculations per-pixel
  // 0 = unknown, 1 = false, 2 = true
  private borderCache: Uint8Array | null = null;
  private defendedCache: Uint8Array | null = null;

  // Pre-packed RGBA color tables indexed by player smallID
  private territoryPacked!: Uint32Array;
  private borderPacked!: Uint32Array;
  private defLightPacked!: Uint32Array;
  private defDarkPacked!: Uint32Array;
  private focusedBorderPacked = 0;
  private falloutPacked = 0;
  private lastPlayerCount = -1;

  // Bitmap for deduplicating tile repaints in renderTerritory
  private repaintFlags!: Uint8Array;

  // Per-render-pass cached state
  private _cachedMyPlayer: PlayerView | null = null;
  private _cachedFocusedSID = -1;
  private _cachedHighlightedSID = -1;

  // Dirty tracking to minimize putImageData calls
  private isDirty = false;
  private dirtyRect: { x0: number; y0: number; x1: number; y1: number } | null =
    null;
  private needsFullRepaint = false;

  // Cached map dimensions to avoid repeated method calls in hot render path
  private _width: number;
  private _height: number;
  private _widthM1: number;
  private _heightM1: number;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this._width = game.width();
    this._height = game.height();
    this._widthM1 = this._width - 1;
    this._heightM1 = this._height - 1;
  }

  shouldTransform(): boolean {
    return true;
  }

  private static packRGBA(c: Colord, alpha: number): number {
    const { r, g, b } = c.rgba;
    return (
      ((alpha & 0xff) << 24) |
      ((b & 0xff) << 16) |
      ((g & 0xff) << 8) |
      (r & 0xff)
    );
  }

  private buildColorCache(force = false) {
    const players = this.game.playerViews();
    if (!force && players.length === this.lastPlayerCount) return;
    this.lastPlayerCount = players.length;
    let maxSID = 0;
    for (let i = 0; i < players.length; i++) {
      const sid = players[i].smallID();
      if (sid > maxSID) maxSID = sid;
    }
    const size = maxSID + 1;
    this.territoryPacked = new Uint32Array(size);
    this.borderPacked = new Uint32Array(size);
    this.defLightPacked = new Uint32Array(size);
    this.defDarkPacked = new Uint32Array(size);

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const sid = p.smallID();
      this.territoryPacked[sid] = TerritoryLayer.packRGBA(
        this.theme.territoryColor(p),
        150,
      );
      this.borderPacked[sid] = TerritoryLayer.packRGBA(
        this.theme.borderColor(p),
        255,
      );
      const def = this.theme.defendedBorderColors(p);
      this.defLightPacked[sid] = TerritoryLayer.packRGBA(def.light, 255);
      this.defDarkPacked[sid] = TerritoryLayer.packRGBA(def.dark, 255);
    }

    this.focusedBorderPacked = TerritoryLayer.packRGBA(
      this.theme.focusedBorderColor(),
      255,
    );
    this.falloutPacked = TerritoryLayer.packRGBA(
      this.theme.falloutColor(),
      150,
    );
  }

  async paintPlayerBorder(player: PlayerView) {
    const tiles = await player.borderTiles();
    this._cachedMyPlayer = this.game.myPlayer();
    const fp = this.game.focusedPlayer();
    this._cachedFocusedSID = fp ? fp.smallID() : -1;
    this._cachedHighlightedSID = this.highlightedTerritory
      ? this.highlightedTerritory.smallID()
      : -1;
    tiles.borderTiles.forEach((tile: TileRef) => {
      this.paintTerritory(tile, true); // Immediately paint the tile instead of enqueueing
    });
  }

  tick() {
    this.game.recentlyUpdatedTiles().forEach((t) => this.renderQueue.push(t));
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];
    unitUpdates.forEach((update) => {
      if (update.unitType === UnitType.DefensePost) {
        const tile = update.pos;
        this.defensePostOffsets ??= this.getOffsets(
          this.game.config().defensePostRange(),
          false,
        );
        const cx = this.game.x(tile);
        const cy = this.game.y(tile);

        for (const offset of this.defensePostOffsets) {
          const nx = cx + offset.x;
          const ny = cy + offset.y;
          if (!this.game.isValidCoord(nx, ny)) continue;
          const t = this.game.ref(nx, ny);

          // Invalidate defended cache for affected tiles
          if (this.defendedCache) {
            this.defendedCache[t] = 0;
          }

          if (
            (this.game.ownerID(t) === update.ownerID ||
              this.game.ownerID(t) === update.lastOwnerID) &&
            this.game.isBorder(t)
          ) {
            this.renderQueue.push(t);
          }
        }
      }
    });

    // Detect alliance mutations
    const myPlayer = this.game.myPlayer();
    if (myPlayer) {
      updates?.[GameUpdateType.BrokeAlliance]?.forEach((update) => {
        const territory = this.game.playerBySmallID(update.betrayedID);
        if (territory && territory instanceof PlayerView) {
          this.redrawTerritory(territory);
        }
      });

      updates?.[GameUpdateType.AllianceRequestReply]?.forEach((update) => {
        if (
          update.accepted &&
          (update.request.requestorID === myPlayer.smallID() ||
            update.request.recipientID === myPlayer.smallID())
        ) {
          const territoryId =
            update.request.requestorID === myPlayer.smallID()
              ? update.request.recipientID
              : update.request.requestorID;
          const territory = this.game.playerBySmallID(territoryId);
          if (territory && territory instanceof PlayerView) {
            this.redrawTerritory(territory);
          }
        }
      });

      // Diff my war set on Player updates to selectively redraw changed territories
      updates?.[GameUpdateType.Player]?.forEach((pu) => {
        if (pu.smallID !== myPlayer.smallID()) return;
        // Map wars (smallIDs) to PlayerIDs for comparison against PlayerView.id()
        const ids = new Set<string>();
        for (const small of pu.wars ?? []) {
          try {
            const p = this.game.playerBySmallID(small) as PlayerView;
            ids.add(p.id());
          } catch {
            // ignore if player not found yet
          }
        }
        const current = ids;
        if (this.lastMyWars === null) {
          this.lastMyWars = current;
          return;
        }
        const changed: string[] = [];
        // Added wars
        current.forEach((id) => {
          if (!this.lastMyWars!.has(id)) changed.push(id);
        });
        // Removed wars (peace)
        this.lastMyWars.forEach((id) => {
          if (!current.has(id)) changed.push(id);
        });
        if (changed.length > 0) {
          const changedPlayers: PlayerView[] = [];
          const allPlayers = this.game.playerViews();
          for (const pid of changed) {
            const p = allPlayers.find((pv) => pv.id() === pid);
            if (p) changedPlayers.push(p);
          }
          if (changedPlayers.length > 0) this.redrawTerritory(changedPlayers);
        }
        this.lastMyWars = current;
      });
    }

    const tileOwnerChangedUpdates =
      updates !== null ? updates[GameUpdateType.TileOwnerChanged] : [];
    tileOwnerChangedUpdates.forEach((update) => {
      // Invalidate caches
      if (this.borderCache) {
        this.borderCache[update.tile] = 0;
        for (const n of this.game.neighbors(update.tile)) {
          this.borderCache[n] = 0;
        }
      }
      if (this.defendedCache) {
        this.defendedCache[update.tile] = 0;
      }
      this.renderQueue.push(update.tile);
    });

    const focusedPlayer = this.game.focusedPlayer();
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

    this.highlightContext.clearRect(0, 0, this._width, this._height);
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

      this.spawnHighlightOffsets ??= this.getOffsets(9, true);
      const cx = this.game.x(centerTile);
      const cy = this.game.y(centerTile);

      for (const offset of this.spawnHighlightOffsets) {
        const nx = cx + offset.x;
        const ny = cy + offset.y;
        if (!this.game.isValidCoord(nx, ny)) continue;
        const tile = this.game.ref(nx, ny);

        if (!this.game.hasOwner(tile)) {
          this.paintHighlightTile(tile, color, 255);
        }
      }
    }
  }

  init() {
    this.eventBus.on(MouseOverEvent, (e) => this.onMouseOver(e));
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
      this.needsFullRepaint = true;
    });
    this.redraw();
  }

  onMouseOver(event: MouseOverEvent) {
    this.lastMousePosition = { x: event.x, y: event.y };
    this.updateHighlightedTerritory();
  }

  private updateHighlightedTerritory() {
    if (!this.alternativeView) {
      return;
    }

    if (!this.lastMousePosition) {
      return;
    }

    const cell = this.transformHandler.screenToWorldCoordinates(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const previousTerritory = this.highlightedTerritory;
    const territory = this.getTerritoryAtCell(cell);

    if (territory) {
      this.highlightedTerritory = territory;
    } else {
      this.highlightedTerritory = null;
    }

    if (previousTerritory?.id() !== this.highlightedTerritory?.id()) {
      const territories: PlayerView[] = [];
      if (previousTerritory) {
        territories.push(previousTerritory);
      }
      if (this.highlightedTerritory) {
        territories.push(this.highlightedTerritory);
      }
      this.redrawTerritory(territories);
    }
  }

  private getTerritoryAtCell(cell: { x: number; y: number }) {
    const tile = this.game.ref(cell.x, cell.y);
    if (!tile) {
      return null;
    }
    // If the tile has no owner, it is either a fallout tile or a terra nullius tile.
    if (!this.game.hasOwner(tile)) {
      return null;
    }
    const owner = this.game.owner(tile);
    return owner instanceof PlayerView ? owner : null;
  }

  redraw() {
    console.log("redrew territory layer");
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.canvas.width = this._width;
    this.canvas.height = this._height;

    // Allocate blank ImageData buffers rather than reading back from the canvas.
    // This avoids expensive GPU->CPU readbacks and the Chrome warning about getImageData.
    this.imageData = new ImageData(this.canvas.width, this.canvas.height);
    this.imageData32 = new Uint32Array(this.imageData.data.buffer);
    this.alternativeImageData = new ImageData(
      this.canvas.width,
      this.canvas.height,
    );
    this.altData32 = new Uint32Array(this.alternativeImageData.data.buffer);

    this.context.putImageData(
      this.alternativeView ? this.alternativeImageData : this.imageData,
      0,
      0,
    );

    // Add a second canvas for highlights
    this.highlightCanvas = document.createElement("canvas");
    const highlightContext = this.highlightCanvas.getContext("2d", {
      alpha: true,
    });
    if (highlightContext === null) throw new Error("2d context not supported");
    this.highlightContext = highlightContext;
    this.highlightCanvas.width = this._width;
    this.highlightCanvas.height = this._height;

    // Initialize caches
    const size = this._width * this._height;
    this.borderCache = new Uint8Array(size);
    this.defendedCache = new Uint8Array(size);
    this.repaintFlags = new Uint8Array(size);
    this.buildColorCache(true);

    // Cache per-pass values for the full redraw
    this._cachedMyPlayer = this.game.myPlayer();
    const fp = this.game.focusedPlayer();
    this._cachedFocusedSID = fp ? fp.smallID() : -1;
    this._cachedHighlightedSID = this.highlightedTerritory
      ? this.highlightedTerritory.smallID()
      : -1;

    this.game.forEachTile((t) => {
      this.paintTerritory(t);
    });
  }

  redrawTerritory(territory: PlayerView | PlayerView[]) {
    const territories = Array.isArray(territory) ? territory : [territory];
    const territorySet = new Set(territories);

    this._cachedMyPlayer = this.game.myPlayer();
    const fp = this.game.focusedPlayer();
    this._cachedFocusedSID = fp ? fp.smallID() : -1;
    this._cachedHighlightedSID = this.highlightedTerritory
      ? this.highlightedTerritory.smallID()
      : -1;

    this.game.forEachTile((t) => {
      const owner = this.game.owner(t) as PlayerView;
      if (territorySet.has(owner)) {
        this.paintTerritory(t);
      }
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const now = Date.now();
    if (now > this.lastRefresh + this.refreshRate) {
      this.lastRefresh = now;
      this.renderTerritory();

      // Full repaint when switching between normal and diplomacy view
      if (this.needsFullRepaint) {
        this.context.putImageData(
          this.alternativeView ? this.alternativeImageData : this.imageData,
          0,
          0,
        );
        this.needsFullRepaint = false;
        this.isDirty = false;
        this.dirtyRect = null;
      } else if (this.isDirty && this.dirtyRect) {
        // Apply the dirty rect directly without viewport clipping
        // The canvas needs to stay in sync with ImageData even for off-screen areas
        // so that when the user zooms out, those areas are already rendered
        const x0 = Math.max(0, this.dirtyRect.x0);
        const y0 = Math.max(0, this.dirtyRect.y0);
        const x1 = Math.min(this._width - 1, this.dirtyRect.x1);
        const y1 = Math.min(this._height - 1, this.dirtyRect.y1);

        const w = x1 - x0 + 1;
        const h = y1 - y0 + 1;

        if (w > 0 && h > 0) {
          this.context.putImageData(
            this.alternativeView ? this.alternativeImageData : this.imageData,
            0,
            0,
            x0,
            y0,
            w,
            h,
          );
        }
        this.isDirty = false;
        this.dirtyRect = null;
      }
    }

    context.drawImage(
      this.canvas,
      -this._width / 2,
      -this._height / 2,
      this._width,
      this._height,
    );
    if (this.game.inSpawnPhase()) {
      context.drawImage(
        this.highlightCanvas,
        -this._width / 2,
        -this._height / 2,
        this._width,
        this._height,
      );
    }
  }

  renderTerritory() {
    const queue = this.renderQueue;
    const len = queue.length;
    if (len === 0) return;

    // Rebuild color tables so new players are always covered
    this.buildColorCache();

    let numToRender = (len / 10) | 0;
    if (numToRender === 0 || this.game.inSpawnPhase()) {
      numToRender = len;
    }

    // Cache per-pass values
    this._cachedMyPlayer = this.game.myPlayer();
    const fp = this.game.focusedPlayer();
    this._cachedFocusedSID = fp ? fp.smallID() : -1;
    this._cachedHighlightedSID = this.highlightedTerritory
      ? this.highlightedTerritory.smallID()
      : -1;

    const flags = this.repaintFlags;
    const w = this._width;
    const FLAG_MAIN = 1;
    const FLAG_NEIGHBOR = 2;
    const repaintList: TileRef[] = [];

    // Collect tiles to repaint with deduplication via bitmap
    for (let i = 0; i < numToRender; i++) {
      const tile = queue[i];

      // Invalidate caches for queued tile
      this.borderCache![tile] = 0;
      this.defendedCache![tile] = 0;

      if (flags[tile] === 0) repaintList.push(tile);
      flags[tile] |= FLAG_MAIN;

      // Inline neighbor processing
      const x = tile % w;
      const y = (tile / w) | 0;
      let n: number;
      if (x > 0) {
        n = tile - 1;
        this.borderCache![n] = 0;
        if (flags[n] === 0) repaintList.push(n);
        flags[n] |= FLAG_NEIGHBOR;
      }
      if (x < this._widthM1) {
        n = tile + 1;
        this.borderCache![n] = 0;
        if (flags[n] === 0) repaintList.push(n);
        flags[n] |= FLAG_NEIGHBOR;
      }
      if (y > 0) {
        n = tile - w;
        this.borderCache![n] = 0;
        if (flags[n] === 0) repaintList.push(n);
        flags[n] |= FLAG_NEIGHBOR;
      }
      if (y < this._heightM1) {
        n = tile + w;
        this.borderCache![n] = 0;
        if (flags[n] === 0) repaintList.push(n);
        flags[n] |= FLAG_NEIGHBOR;
      }
    }

    // Remove processed entries
    if (numToRender >= len) {
      queue.length = 0;
    } else {
      this.renderQueue = queue.slice(numToRender);
    }

    // Paint all unique tiles exactly once
    for (let i = 0; i < repaintList.length; i++) {
      const tile = repaintList[i];
      const tileFlags = flags[tile];
      flags[tile] = 0; // reset for next pass
      const isNeighborOnly = (tileFlags & FLAG_MAIN) === 0;
      this.paintTerritory(tile, isNeighborOnly);
    }
  }

  paintTerritory(tile: TileRef, isBorder: boolean = false) {
    if (isBorder && !this.game.hasOwner(tile)) {
      return;
    }

    if (!this.game.hasOwner(tile)) {
      if (this.game.hasFallout(tile)) {
        this.imageData32[tile] = this.falloutPacked;
        this.altData32[tile] = this.falloutPacked;
        this.markDirty(tile);
        return;
      }
      this.clearTile(tile);
      return;
    }
    const sid = this.game.ownerID(tile);
    const isHighlighted = this._cachedHighlightedSID === sid;
    const myPlayer = this._cachedMyPlayer;
    const focusedSID = this._cachedFocusedSID;

    // Check border cache
    let isBorderTile = false;
    if (this.borderCache) {
      if (this.borderCache[tile] === 0) {
        this.borderCache[tile] = this.game.isBorder(tile) ? 2 : 1;
      }
      isBorderTile = this.borderCache[tile] === 2;
    } else {
      isBorderTile = this.game.isBorder(tile);
    }

    if (isBorderTile) {
      const playerIsFocused = focusedSID >= 0 && focusedSID === sid;
      if (myPlayer) {
        const owner = this.game.owner(tile) as PlayerView;
        const alternativeColor = this.getDiplomacyColor(owner, myPlayer);
        this.altData32[tile] = TerritoryLayer.packRGBA(alternativeColor, 255);
      }

      // Check defended cache
      let isDefended = false;
      if (this.defendedCache) {
        if (this.defendedCache[tile] === 0) {
          const owner = this.game.owner(tile) as PlayerView;
          const defended = this.game.hasUnitNearby(
            tile,
            this.game.config().defensePostRange(),
            UnitType.DefensePost,
            owner.id(),
          );
          this.defendedCache[tile] = defended ? 2 : 1;
        }
        isDefended = this.defendedCache[tile] === 2;
      } else {
        const owner = this.game.owner(tile) as PlayerView;
        isDefended = this.game.hasUnitNearby(
          tile,
          this.game.config().defensePostRange(),
          UnitType.DefensePost,
          owner.id(),
        );
      }

      if (isDefended) {
        const x = this.game.x(tile);
        const y = this.game.y(tile);
        const lightTile =
          (x % 2 === 0 && y % 2 === 0) || (y % 2 === 1 && x % 2 === 1);
        this.imageData32[tile] = lightTile
          ? this.defLightPacked[sid]
          : this.defDarkPacked[sid];
      } else {
        this.imageData32[tile] = playerIsFocused
          ? this.focusedBorderPacked
          : this.borderPacked[sid];
      }
    } else {
      if (myPlayer) {
        const owner = this.game.owner(tile) as PlayerView;
        const alternativeColor = this.getDiplomacyColor(owner, myPlayer);
        this.altData32[tile] = TerritoryLayer.packRGBA(
          alternativeColor,
          isHighlighted ? 150 : 60,
        );
      }

      this.imageData32[tile] = this.territoryPacked[sid];
    }

    this.markDirty(tile);
  }

  clearTile(tile: TileRef) {
    this.imageData32[tile] = 0;
    this.altData32[tile] = 0;
    this.markDirty(tile);
  }

  private markDirty(tile: TileRef) {
    this.isDirty = true;
    const x = tile % this._width;
    const y = Math.floor(tile / this._width);
    if (!this.dirtyRect) {
      this.dirtyRect = { x0: x, y0: y, x1: x, y1: y };
    } else {
      if (x < this.dirtyRect.x0) this.dirtyRect.x0 = x;
      if (y < this.dirtyRect.y0) this.dirtyRect.y0 = y;
      if (x > this.dirtyRect.x1) this.dirtyRect.x1 = x;
      if (y > this.dirtyRect.y1) this.dirtyRect.y1 = y;
    }
  }

  paintHighlightTile(tile: TileRef, color: Colord, alpha: number) {
    this.clearTile(tile);
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    this.highlightContext.fillStyle = color.alpha(alpha / 255).toRgbString();
    this.highlightContext.fillRect(x, y, 1, 1);
  }

  /** Diplomacy alternate view color for a tile owner relative to myPlayer. */
  private getDiplomacyColor(owner: PlayerView, myPlayer: PlayerView): Colord {
    if (owner.type() === PlayerType.Bot) {
      return this.theme.enemyColor();
    }
    if (owner.smallID() === myPlayer.smallID() || owner.isFriendly(myPlayer)) {
      return this.theme.selfColor();
    }
    if (myPlayer.isAtWarWith(owner)) {
      return this.theme.enemyColor();
    }
    return this.theme.allyColor();
  }

  private getOffsets(
    range: number,
    center: boolean,
  ): { x: number; y: number }[] {
    const offsets: { x: number; y: number }[] = [];
    const r2 = range * range;
    const ceilRange = Math.ceil(range);

    for (let dy = -ceilRange; dy <= ceilRange; dy++) {
      for (let dx = -ceilRange; dx <= ceilRange; dx++) {
        let dist2 = 0;
        if (!center) {
          dist2 = dx * dx + dy * dy;
        } else {
          // Matches euclDistFN with center=true: (delta + 0.5)^2
          const ddx = dx + 0.5;
          const ddy = dy + 0.5;
          dist2 = ddx * ddx + ddy * ddy;
        }

        if (dist2 <= r2) {
          offsets.push({ x: dx, y: dy });
        }
      }
    }
    return offsets;
  }
}
