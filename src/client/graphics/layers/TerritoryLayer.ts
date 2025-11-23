import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerType, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { PseudoRandom } from "../../../core/PseudoRandom";
import {
  AlternateViewEvent,
  DragEvent,
  MouseOverEvent,
} from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class TerritoryLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;
  private alternativeImageData: ImageData;

  // Used for spawn highlighting
  private highlightCanvas: HTMLCanvasElement;
  private highlightContext: CanvasRenderingContext2D;

  private tileToRenderQueue: Set<TileRef> = new Set();
  private random = new PseudoRandom(123);
  private theme: Theme;

  private highlightedTerritory: PlayerView | null = null;

  private alternativeView = false;
  private lastDragTime = 0;
  private nodrawDragDuration = 200;
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
  private borderColorsCache = new Map<
    string,
    { light: Colord; dark: Colord }
  >();

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
  }

  shouldTransform(): boolean {
    return true;
  }

  async paintPlayerBorder(player: PlayerView) {
    const tiles = await player.borderTiles();
    tiles.borderTiles.forEach((tile: TileRef) => {
      this.paintTerritory(tile, true); // Immediately paint the tile instead of enqueueing
    });
  }

  tick() {
    this.game.recentlyUpdatedTiles().forEach((t) => this.enqueueTile(t));
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];
    unitUpdates.forEach((update) => {
      if (update.unitType === UnitType.DefensePost) {
        const tile = update.pos;
        if (!this.defensePostOffsets) {
          this.defensePostOffsets = this.getOffsets(
            this.game.config().defensePostRange(),
            false,
          );
        }
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
            this.enqueueTile(t);
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
      this.enqueueTile(update.tile);
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

      if (!this.spawnHighlightOffsets) {
        this.spawnHighlightOffsets = this.getOffsets(9, true);
      }
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
    });
    this.eventBus.on(DragEvent, (e) => {
      // TODO: consider re-enabling this on mobile or low end devices for smoother dragging.
      // this.lastDragTime = Date.now();
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
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    // Allocate blank ImageData buffers rather than reading back from the canvas.
    // This avoids expensive GPU->CPU readbacks and the Chrome warning about getImageData.
    this.imageData = new ImageData(this.canvas.width, this.canvas.height);
    this.alternativeImageData = new ImageData(
      this.canvas.width,
      this.canvas.height,
    );
    this.initImageData();

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
    this.highlightCanvas.width = this.game.width();
    this.highlightCanvas.height = this.game.height();

    // Initialize caches
    const size = this.game.width() * this.game.height();
    this.borderCache = new Uint8Array(size);
    this.defendedCache = new Uint8Array(size);
    this.borderColorsCache.clear();

    this.game.forEachTile((t) => {
      this.paintTerritory(t);
    });
  }

  redrawTerritory(territory: PlayerView | PlayerView[]) {
    const territories = Array.isArray(territory) ? territory : [territory];
    const territorySet = new Set(territories);

    this.game.forEachTile((t) => {
      const owner = this.game.owner(t) as PlayerView;
      if (territorySet.has(owner)) {
        this.paintTerritory(t);
      }
    });
  }

  initImageData() {
    this.game.forEachTile((tile) => {
      const cell = new Cell(this.game.x(tile), this.game.y(tile));
      const index = cell.y * this.game.width() + cell.x;
      const offset = index * 4;
      this.imageData.data[offset + 3] = 0;
      this.alternativeImageData.data[offset + 3] = 0;
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
        this.context.putImageData(
          this.alternativeView ? this.alternativeImageData : this.imageData,
          0,
          0,
          vx0,
          vy0,
          w,
          h,
        );
      }
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
    if (this.tileToRenderQueue.size === 0) return;

    const tilesToPaint = new Set<TileRef>();
    for (const tile of this.tileToRenderQueue) {
      tilesToPaint.add(tile);
      for (const neighbor of this.game.neighbors(tile)) {
        tilesToPaint.add(neighbor);
      }
    }
    this.tileToRenderQueue.clear();

    for (const tile of tilesToPaint) {
      this.paintTerritory(tile);
    }
  }

  paintTerritory(tile: TileRef, isBorder: boolean = false) {
    if (isBorder && !this.game.hasOwner(tile)) {
      return;
    }

    if (!this.game.hasOwner(tile)) {
      if (this.game.hasFallout(tile)) {
        this.paintTile(this.imageData, tile, this.theme.falloutColor(), 150);
        this.paintTile(
          this.alternativeImageData,
          tile,
          this.theme.falloutColor(),
          150,
        );
        return;
      }
      this.clearTile(tile);
      return;
    }
    const owner = this.game.owner(tile) as PlayerView;
    const isHighlighted =
      this.highlightedTerritory &&
      this.highlightedTerritory.id() === owner.id();
    const myPlayer = this.game.myPlayer();

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
      const playerIsFocused = owner && this.game.focusedPlayer() === owner;
      if (myPlayer) {
        // Diplomacy alternate view colors:
        // - Red (enemyColor) for bots and players at war
        // - Green (selfColor) for self and allies
        // - Yellow (allyColor) for neutral/peace
        let alternativeColor = this.theme.allyColor(); // default: neutral/peace (yellow)
        if (owner.type() === PlayerType.Bot) {
          alternativeColor = this.theme.enemyColor(); // bots always red
        } else if (
          owner.smallID() === myPlayer.smallID() ||
          owner.isFriendly(myPlayer)
        ) {
          alternativeColor = this.theme.selfColor(); // self and allies (green)
        } else if (myPlayer.isAtWarWith(owner)) {
          alternativeColor = this.theme.enemyColor(); // at war (red)
        }
        this.paintTile(this.alternativeImageData, tile, alternativeColor, 255);
      }

      // Check defended cache
      let isDefended = false;
      if (this.defendedCache) {
        if (this.defendedCache[tile] === 0) {
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
        isDefended = this.game.hasUnitNearby(
          tile,
          this.game.config().defensePostRange(),
          UnitType.DefensePost,
          owner.id(),
        );
      }

      if (isDefended) {
        let borderColors = this.borderColorsCache.get(owner.id());
        if (!borderColors) {
          borderColors = this.theme.defendedBorderColors(owner);
          this.borderColorsCache.set(owner.id(), borderColors);
        }
        const x = this.game.x(tile);
        const y = this.game.y(tile);
        const lightTile =
          (x % 2 === 0 && y % 2 === 0) || (y % 2 === 1 && x % 2 === 1);
        const borderColor = lightTile ? borderColors.light : borderColors.dark;
        this.paintTile(this.imageData, tile, borderColor, 255);
      } else {
        const useBorderColor = playerIsFocused
          ? this.theme.focusedBorderColor()
          : this.theme.borderColor(owner);
        this.paintTile(this.imageData, tile, useBorderColor, 255);
      }
    } else {
      if (myPlayer) {
        // Diplomacy alternate view colors:
        // - Red (enemyColor) for bots and players at war
        // - Green (selfColor) for self and allies
        // - Yellow (allyColor) for neutral/peace
        let alternativeColor = this.theme.allyColor(); // default: neutral/peace (yellow)
        if (owner.type() === PlayerType.Bot) {
          alternativeColor = this.theme.enemyColor(); // bots always red
        } else if (
          owner.smallID() === myPlayer.smallID() ||
          owner.isFriendly(myPlayer)
        ) {
          alternativeColor = this.theme.selfColor(); // self and allies (green)
        } else if (myPlayer.isAtWarWith(owner)) {
          alternativeColor = this.theme.enemyColor(); // at war (red)
        }
        this.paintTile(
          this.alternativeImageData,
          tile,
          alternativeColor,
          isHighlighted ? 150 : 60,
        );
      }

      this.paintTile(
        this.imageData,
        tile,
        this.theme.territoryColor(owner),
        150,
      );
    }
  }

  paintTile(imageData: ImageData, tile: TileRef, color: Colord, alpha: number) {
    const offset = tile * 4;
    imageData.data[offset] = color.rgba.r;
    imageData.data[offset + 1] = color.rgba.g;
    imageData.data[offset + 2] = color.rgba.b;
    imageData.data[offset + 3] = alpha;
  }

  clearTile(tile: TileRef) {
    const offset = tile * 4;
    this.imageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
    this.alternativeImageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
  }

  enqueueTile(tile: TileRef) {
    this.tileToRenderQueue.add(tile);
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
