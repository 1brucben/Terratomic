import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Colord } from "colord";
import * as PIXI from "pixi.js";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { PlayerType, UnitType } from "../../../core/game/Game";
import { euclDistFN, TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { AlternateViewEvent, MouseOverEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class TerritoryLayer implements Layer {
  // Underlying pixel buffers (still CPU composed for per-tile updates)
  private canvas: HTMLCanvasElement; // territory base
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;
  private alternativeImageData: ImageData;

  // Highlight overlay (spawn phase, hover highlights)
  private highlightCanvas: HTMLCanvasElement;
  private highlightContext: CanvasRenderingContext2D;

  // PIXI objects
  private renderer: PIXI.Renderer; // dedicated per-layer renderer similar to StructureLayer
  private stage: PIXI.Container; // root container
  private territorySprite: PIXI.Sprite; // sprite showing territory texture
  private highlightSprite: PIXI.Sprite; // sprite showing highlight texture

  private tileToRenderQueue: PriorityQueue<{
    tile: TileRef;
    lastUpdate: number;
  }> = new PriorityQueue((a, b) => {
    return a.lastUpdate - b.lastUpdate;
  });
  private random = new PseudoRandom(123);
  private theme: Theme;

  private highlightedTerritory: PlayerView | null = null;

  private alternativeView = false;
  private lastMousePosition: { x: number; y: number } | null = null;

  private refreshRate = 50; //refresh every 15ms
  private lastRefresh = 0;

  private lastFocusedPlayer: PlayerView | null = null;
  // Track my active wars to redraw only affected territories on change
  private lastMyWars: Set<string> | null = null;
  // Track spawn phase transitions to manage highlight overlay lifecycle
  private wasInSpawnPhase: boolean = false;
  // Dirty rectangle tracking for territory updates
  private dirtyMinX: number = Infinity;
  private dirtyMinY: number = Infinity;
  private dirtyMaxX: number = -Infinity;
  private dirtyMaxY: number = -Infinity;
  private territoryDirty: boolean = false;
  private altViewDirty: boolean = false;

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
    // Handle spawn-phase enter/exit to keep highlight overlay correct
    const inSpawn = this.game.inSpawnPhase();
    if (inSpawn !== this.wasInSpawnPhase) {
      if (!inSpawn) {
        // Exiting spawn phase: clear overlay and hide sprite
        if (this.highlightContext && this.highlightCanvas) {
          this.highlightContext.clearRect(
            0,
            0,
            this.game.width(),
            this.game.height(),
          );
        }
        if (this.highlightSprite) {
          this.highlightSprite.visible = false;
          this.highlightSprite.texture?.baseTexture.update();
        }
      } else {
        // Entering spawn phase: ensure overlay starts clean and is visible
        if (this.highlightContext && this.highlightCanvas) {
          this.highlightContext.clearRect(
            0,
            0,
            this.game.width(),
            this.game.height(),
          );
        }
        if (this.highlightSprite) {
          this.highlightSprite.visible = true;
          this.highlightSprite.texture?.baseTexture.update();
        }
      }
      this.wasInSpawnPhase = inSpawn;
    }

    this.game.recentlyUpdatedTiles().forEach((t) => this.enqueueTile(t));
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
    this.eventBus.on(MouseOverEvent, (e) => this.onMouseOver(e));
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
      this.altViewDirty = true; // force viewport redraw on toggle
    });
    // Drag throttling removed; canvas updates are refresh-rate gated.
    // Initialize spawn-phase state
    this.wasInSpawnPhase = this.game.inSpawnPhase();
    // Defer redraw until PIXI renderer is initialized
    void this.setupRenderer().then(() => this.redraw());
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
    // Reinitialize CPU canvases & image data buffers
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

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

    this.highlightCanvas = document.createElement("canvas");
    const highlightContext = this.highlightCanvas.getContext("2d", {
      alpha: true,
    });
    if (highlightContext === null) throw new Error("2d context not supported");
    this.highlightContext = highlightContext;
    this.highlightCanvas.width = this.game.width();
    this.highlightCanvas.height = this.game.height();

    // (Re)build PIXI sprites backed by these canvases
    const territoryTexture = PIXI.Texture.from(this.canvas);
    if (this.territorySprite) {
      this.territorySprite.texture = territoryTexture;
    } else {
      this.territorySprite = new PIXI.Sprite(territoryTexture);
      // Keep sprite at (0,0); transform is applied when compositing into main context
      this.territorySprite.x = 0;
      this.territorySprite.y = 0;
      this.stage.addChild(this.territorySprite);
    }
    const highlightTexture = PIXI.Texture.from(this.highlightCanvas);
    if (this.highlightSprite) {
      this.highlightSprite.texture = highlightTexture;
    } else {
      this.highlightSprite = new PIXI.Sprite(highlightTexture);
      // Keep sprite at (0,0); transform is applied when compositing
      this.highlightSprite.x = 0;
      this.highlightSprite.y = 0;
      this.stage.addChild(this.highlightSprite);
    }
    // Only show highlight overlay during spawn phase
    if (this.highlightSprite) {
      this.highlightSprite.visible = this.game.inSpawnPhase();
    }

    // Draw initial territory tiles
    this.game.forEachTile((t) => {
      this.paintTerritory(t);
    });
    this.renderer.render(this.stage);
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
      const offset = tile * 4;
      this.imageData.data[offset + 3] = 0;
      this.alternativeImageData.data[offset + 3] = 0;
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.renderer || !this.stage || !this.territorySprite) return;

    const now = Date.now();
    if (now > this.lastRefresh + this.refreshRate) {
      this.lastRefresh = now;
      this.renderTerritory();
    }

    let didUpdateTerritory = false;
    if (this.territoryDirty || this.altViewDirty) {
      const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
      let vx0 = Math.max(0, topLeft.x);
      let vy0 = Math.max(0, topLeft.y);
      let vx1 = Math.min(this.game.width() - 1, bottomRight.x);
      let vy1 = Math.min(this.game.height() - 1, bottomRight.y);
      if (!this.altViewDirty) {
        vx0 = Math.max(vx0, this.dirtyMinX);
        vy0 = Math.max(vy0, this.dirtyMinY);
        vx1 = Math.min(vx1, this.dirtyMaxX);
        vy1 = Math.min(vy1, this.dirtyMaxY);
      }
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
        this.territorySprite.texture.baseTexture.update();
        didUpdateTerritory = true;
      }
      this.dirtyMinX = Infinity;
      this.dirtyMinY = Infinity;
      this.dirtyMaxX = -Infinity;
      this.dirtyMaxY = -Infinity;
      this.territoryDirty = false;
      this.altViewDirty = false;
    }

    if (this.game.inSpawnPhase() && this.highlightSprite) {
      this.highlightSprite.texture.baseTexture.update();
    }

    this.renderer.render(this.stage);

    if (this.transformHandler.scale < 1) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
    } else {
      context.imageSmoothingEnabled = false;
    }

    // Always composite after stage render to avoid flicker from skipped frames.
    context.drawImage(
      this.renderer.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  renderTerritory() {
    let numToRender = Math.floor(this.tileToRenderQueue.size());
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

    if (this.game.isBorder(tile)) {
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
      if (
        this.game.hasUnitNearby(
          tile,
          this.game.config().defensePostRange(),
          UnitType.DefensePost,
          owner.id(),
        )
      ) {
        const borderColors = this.theme.defendedBorderColors(owner);
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
    // Mark dirty bounds for minimal putImageData later
    const dx = this.game.x(tile);
    const dy = this.game.y(tile);
    if (dx < this.dirtyMinX) this.dirtyMinX = dx;
    if (dy < this.dirtyMinY) this.dirtyMinY = dy;
    if (dx > this.dirtyMaxX) this.dirtyMaxX = dx;
    if (dy > this.dirtyMaxY) this.dirtyMaxY = dy;
    this.territoryDirty = true;
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
    this.tileToRenderQueue.push({
      tile: tile,
      lastUpdate: this.game.ticks() + this.random.nextFloat(0, 0.5),
    });
  }

  paintHighlightTile(tile: TileRef, color: Colord, alpha: number) {
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    this.highlightContext.fillStyle = color.alpha(alpha / 255).toRgbString();
    this.highlightContext.fillRect(x, y, 1, 1);
  }

  private async setupRenderer() {
    this.renderer = new PIXI.WebGLRenderer();
    this.stage = new PIXI.Container();
    await this.renderer.init({
      // Offscreen canvas; final composite happens in renderLayer
      canvas: document.createElement("canvas"),
      width: this.game.width(),
      height: this.game.height(),
      resolution: 1,
      backgroundAlpha: 0,
      clearBeforeRender: true,
    });
  }
}
