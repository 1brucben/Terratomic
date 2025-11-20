import { Colord } from "colord";
import * as PIXI from "pixi.js";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { PlayerType, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { AlternateViewEvent, MouseOverEvent } from "../../InputHandler";
import { fragmentShader, vertexShader } from "../shaders/TerritoryShader";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class TerritoryLayer implements Layer {
  // Underlying pixel buffers
  private ownerData: ImageData;
  private ownerBuffer: Uint32Array; // R=ID_LO, G=ID_HI, B=FLAGS
  private ownerTexture: PIXI.Texture;

  private colorData: ImageData;
  private colorBuffer: Uint32Array; // View for easier writing
  private colorTexture: PIXI.Texture;
  private maxPlayers = 256;

  // Highlight overlay (spawn phase, hover highlights)
  private highlightCanvas: HTMLCanvasElement;
  private highlightContext: CanvasRenderingContext2D;

  // PIXI objects
  private renderer: PIXI.Renderer;
  private stage: PIXI.Container;
  private territorySprite: PIXI.Sprite;
  private highlightSprite: PIXI.Sprite;
  private territoryFilter: PIXI.Filter;

  private tileToRenderQueue: Set<TileRef> = new Set();
  private tilesToPaint: Set<TileRef> = new Set();
  private random = new PseudoRandom(123);
  private theme: Theme;

  private highlightedTerritory: PlayerView | null = null;

  private alternativeView = false;
  private lastMousePosition: { x: number; y: number } | null = null;

  private refreshRate = 15;
  private lastRefresh = 0;

  private lastFocusedPlayer: PlayerView | null = null;
  private lastMyWars: Set<string> | null = null;
  private wasInSpawnPhase: boolean = false;

  private dirtyMinX: number = Infinity;
  private dirtyMinY: number = Infinity;
  private dirtyMaxX: number = -Infinity;
  private dirtyMaxY: number = -Infinity;
  private territoryDirty: boolean = false;
  private colorDirty: boolean = false;

  private defensePostOffsets: { x: number; y: number }[] | null = null;
  private spawnHighlightOffsets: { x: number; y: number }[] | null = null;

  private defendedCache: Uint8Array | null = null;

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
      // View mode uniform will be updated in renderLayer
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
    // Cleanup existing textures
    this.ownerTexture?.destroy(true);
    this.colorTexture?.destroy(true);
    if (this.highlightSprite?.texture) {
      this.highlightSprite.texture.destroy(true);
    }

    // Initialize Owner Buffer
    this.ownerData = new ImageData(this.game.width(), this.game.height());
    this.ownerBuffer = new Uint32Array(this.ownerData.data.buffer);

    // Initialize Color Buffer
    // 4 rows: 0=Territory, 1=Border, 2=DefendedBorder, 3=AltTerritory
    this.colorData = new ImageData(this.maxPlayers, 4);
    this.colorBuffer = new Uint32Array(this.colorData.data.buffer);

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
    this.defendedCache = new Uint8Array(size);

    // Create Textures
    const ownerSource = new PIXI.ImageSource({
      resource: this.ownerData as any,
      width: this.game.width(),
      height: this.game.height(),
      scaleMode: "nearest",
    });
    this.ownerTexture = new PIXI.Texture({ source: ownerSource });

    const colorSource = new PIXI.ImageSource({
      resource: this.colorData as any,
      width: this.maxPlayers,
      height: 4,
      scaleMode: "nearest",
    });
    this.colorTexture = new PIXI.Texture({ source: colorSource });

    // Create Filter with custom shaders
    this.territoryFilter = new PIXI.Filter({
      glProgram: PIXI.GlProgram.from({
        vertex: vertexShader,
        fragment: fragmentShader,
      }),
      resources: {
        uOwnerTexture: this.ownerTexture.source,
        uColorTexture: this.colorTexture.source,
      },
    });

    // Set uniforms after creation
    (this.territoryFilter as any).uniforms = {
      uMapSize: new Float32Array([this.game.width(), this.game.height()]),
      uMaxPlayers: this.maxPlayers,
      uViewMode: this.alternativeView ? 1.0 : 0.0,
    };

    console.log(
      "[TerritoryLayer] Filter created with uniforms:",
      (this.territoryFilter as any).uniforms,
    );
    console.log(
      "[TerritoryLayer] Color texture dimensions:",
      this.colorTexture.source.width,
      "x",
      this.colorTexture.source.height,
    );
    console.log(
      "[TerritoryLayer] Color buffer length:",
      this.colorBuffer.length,
      "ImageData size:",
      this.colorData.width,
      "x",
      this.colorData.height,
    );

    // Create a white texture for the filter to process
    const whiteCanvas = document.createElement("canvas");
    whiteCanvas.width = this.game.width();
    whiteCanvas.height = this.game.height();
    const whiteCtx = whiteCanvas.getContext("2d")!;
    whiteCtx.fillStyle = "white";
    whiteCtx.fillRect(0, 0, whiteCanvas.width, whiteCanvas.height);
    const whiteTexture = PIXI.Texture.from(whiteCanvas);

    if (this.territorySprite) {
      this.territorySprite.texture = whiteTexture;
      this.territorySprite.filters = [this.territoryFilter];
      this.territorySprite.x = 0;
      this.territorySprite.y = 0;
      this.territorySprite.scale.set(1.0, 1.0);
      // Don't set width/height - let it use texture's natural size
    } else {
      this.territorySprite = new PIXI.Sprite(whiteTexture);
      this.territorySprite.filters = [this.territoryFilter];
      this.territorySprite.x = 0;
      this.territorySprite.y = 0;
      this.territorySprite.scale.set(1.0, 1.0);
      // Don't manually set width/height - sprite will match texture size
      // Add at index 0 to ensure it's behind other layers
      this.stage.addChildAt(this.territorySprite, 0);
      console.log(
        "[TerritoryLayer] Territory sprite created and added to stage",
      );
    }

    console.log(
      "[TerritoryLayer] Sprite visible:",
      this.territorySprite.visible,
      "alpha:",
      this.territorySprite.alpha,
      "filters:",
      this.territorySprite.filters,
    );
    const highlightTexture = PIXI.Texture.from(this.highlightCanvas);
    if (this.highlightSprite) {
      this.highlightSprite.texture = highlightTexture;
    } else {
      this.highlightSprite = new PIXI.Sprite(highlightTexture);
      this.highlightSprite.x = 0;
      this.highlightSprite.y = 0;
      this.stage.addChild(this.highlightSprite);
    }
    // Only show highlight overlay during spawn phase
    if (this.highlightSprite) {
      this.highlightSprite.visible = this.game.inSpawnPhase();
    }

    this.updateAllColors();

    // Draw initial territory tiles
    this.game.forEachTile((t) => {
      this.paintTerritory(t);
    });

    this.ownerTexture.source.update();
    this.colorTexture.source.update();

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
    // Also update colors if needed (e.g. war status changed)
    this.updateAllColors();
  }

  updateAllColors() {
    const players = this.game.playerViews();
    const myPlayer = this.game.myPlayer();

    if (players.length > 50) {
      console.warn(
        "[updateAllColors] Too many players!",
        players.length,
        "- limiting to 50",
      );
      players.splice(50);
    }

    for (const p of players) {
      const id = p.smallID();
      if (id >= this.maxPlayers) continue;

      // Row 0: Territory Color
      const tColor = this.theme.territoryColor(p);
      this.setColor(id, 0, tColor, 150);

      // Row 1: Border Color
      const bColor = this.theme.borderColor(p);
      this.setColor(id, 1, bColor, 255);

      // Row 2: Defended Border Color
      const dbColors = this.theme.defendedBorderColors(p);
      this.setColor(id, 2, dbColors.dark, 255);

      // Row 3: Alt View Color
      let altColor = this.theme.allyColor();
      if (p.type() === PlayerType.Bot) {
        altColor = this.theme.enemyColor();
      } else if (
        myPlayer &&
        (p.smallID() === myPlayer.smallID() || p.isFriendly(myPlayer))
      ) {
        altColor = this.theme.selfColor();
      } else if (myPlayer && myPlayer.isAtWarWith(p)) {
        altColor = this.theme.enemyColor();
      }
      this.setColor(id, 3, altColor, 150);
    }
    this.colorDirty = true;
  }

  setColor(id: number, row: number, color: Colord, alpha: number) {
    const idx = row * this.maxPlayers + id;
    // ImageData stores bytes as RGBA, so we pack in that order
    // In little-endian 32-bit: AABBGGRR becomes RR GG BB AA in memory
    this.colorBuffer[idx] =
      (alpha << 24) | (color.rgba.b << 16) | (color.rgba.g << 8) | color.rgba.r;

    // Debug: log first color set
    if (id === 1 && row === 0) {
      const packed = this.colorBuffer[idx];
      const bytes = [
        packed & 0xff,
        (packed >> 8) & 0xff,
        (packed >> 16) & 0xff,
        (packed >> 24) & 0xff,
      ];
      console.log(
        "[setColor] Player 1 territory color:",
        color.toRgbString(),
        "RGBA:",
        color.rgba.r,
        color.rgba.g,
        color.rgba.b,
        alpha,
        "Packed:",
        packed.toString(16),
        "Bytes in memory:",
        bytes,
      );
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.renderer || !this.stage || !this.territorySprite) return;

    const now = Date.now();
    if (now > this.lastRefresh + this.refreshRate) {
      this.lastRefresh = now;
      this.renderTerritory();
    }

    if (this.territoryDirty) {
      const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
      const vx0 = Math.max(0, topLeft.x);
      const vy0 = Math.max(0, topLeft.y);
      const vx1 = Math.min(this.game.width() - 1, bottomRight.x);
      const vy1 = Math.min(this.game.height() - 1, bottomRight.y);

      // Intersect dirty rect with viewport
      const x = Math.max(vx0, this.dirtyMinX);
      const y = Math.max(vy0, this.dirtyMinY);
      const maxX = Math.min(vx1, this.dirtyMaxX);
      const maxY = Math.min(vy1, this.dirtyMaxY);

      const w = maxX - x + 1;
      const h = maxY - y + 1;

      if (w > 0 && h > 0) {
        this.updateTexturePart(x, y, w, h);
      }

      this.dirtyMinX = Infinity;
      this.dirtyMinY = Infinity;
      this.dirtyMaxX = -Infinity;
      this.dirtyMaxY = -Infinity;
      this.territoryDirty = false;
    }

    if (this.colorDirty) {
      this.colorTexture.source.update();
      this.colorDirty = false;
    }

    if (this.territoryFilter) {
      const uniforms = (this.territoryFilter as any).uniforms;
      if (uniforms) {
        uniforms.uViewMode = this.alternativeView ? 1.0 : 0.0;
      }
    }

    if (this.game.inSpawnPhase() && this.highlightSprite) {
      this.highlightSprite.texture.source.update();
    }

    this.renderer.render(this.stage);

    if (this.transformHandler.scale < 1) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
    } else {
      context.imageSmoothingEnabled = false;
    }

    // Debug: log actual vs expected sizes
    if (
      this.renderer.canvas.width !== this.game.width() ||
      this.renderer.canvas.height !== this.game.height()
    ) {
      console.warn(
        "[TerritoryLayer] Size mismatch! Canvas:",
        this.renderer.canvas.width,
        "x",
        this.renderer.canvas.height,
        "Expected:",
        this.game.width(),
        "x",
        this.game.height(),
      );
    }

    context.drawImage(
      this.renderer.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  private updateTexturePart(x: number, y: number, w: number, h: number) {
    const renderer = this.renderer as any;
    const gl = renderer.gl;
    const source = this.ownerTexture.source;

    if (!gl) {
      source.update();
      return;
    }

    let glTexture = null;
    if (renderer.texture && renderer.texture.getGlTexture) {
      glTexture = renderer.texture.getGlTexture(source);
    }

    if (!glTexture) {
      source.update();
      return;
    }

    // Create a buffer for the sub-rect
    const subBuffer = new Uint32Array(w * h);
    for (let row = 0; row < h; row++) {
      const srcIdx = (y + row) * this.game.width() + x;
      const dstIdx = row * w;
      subBuffer.set(this.ownerBuffer.subarray(srcIdx, srcIdx + w), dstIdx);
    }

    renderer.texture.bind(source, 0);

    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      x,
      y,
      w,
      h,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(subBuffer.buffer),
    );
  }

  renderTerritory() {
    if (this.tileToRenderQueue.size === 0) return;

    // If we have players but color buffer is empty, update colors
    if (this.game.playerViews().length > 0 && this.colorBuffer[0] === 0) {
      this.updateAllColors();
    }

    this.tilesToPaint.clear();
    for (const tile of this.tileToRenderQueue) {
      this.tilesToPaint.add(tile);
      // Neighbors are handled by shader, but we might need to update them if their border status changes?
      // Actually, if a tile changes owner, its neighbors' border status changes.
      // The shader calculates border status dynamically based on neighbors.
      // So if I update tile X, the shader for tile X+1 will see the new owner of X and update its border.
      // So I only need to update the changed tile in the texture!
      // Wait, if I update tile X, tile X+1 needs to be re-rendered.
      // But the shader runs for every pixel.
      // So if I update the texture at X, and then render the whole screen (or the dirty rect),
      // the pixels at X+1 will read the new X and draw correctly.
      // So I just need to ensure the dirty rect covers neighbors?
      // No, the dirty rect is for *texture update*.
      // The *rendering* happens for the whole screen (or viewport).
      // PIXI renders the whole sprite.
      // So yes, updating just the changed tile in the texture is enough.
    }
    this.tileToRenderQueue.clear();

    for (const tile of this.tilesToPaint) {
      this.paintTerritory(tile);
    }
  }

  paintTerritory(tile: TileRef, isBorder: boolean = false) {
    if (!this.game.hasOwner(tile)) {
      if (this.game.hasFallout(tile)) {
        // ID 0, Flag Fallout (4)
        this.ownerBuffer[tile] = (255 << 24) | (4 << 16);
      } else {
        this.ownerBuffer[tile] = 0;
      }
    } else {
      const owner = this.game.owner(tile) as PlayerView;
      const id = owner.smallID();

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
      }

      const isHighlighted =
        this.highlightedTerritory &&
        this.highlightedTerritory.id() === owner.id();

      let flags = 0;
      if (isDefended) flags |= 1;
      if (isHighlighted) flags |= 2;

      const r = id & 0xff;
      const g = (id >> 8) & 0xff;
      const b = flags;
      const a = 255;

      this.ownerBuffer[tile] = (a << 24) | (b << 16) | (g << 8) | r;
    }

    const dx = this.game.x(tile);
    const dy = this.game.y(tile);
    if (dx < this.dirtyMinX) this.dirtyMinX = dx;
    if (dy < this.dirtyMinY) this.dirtyMinY = dy;
    if (dx > this.dirtyMaxX) this.dirtyMaxX = dx;
    if (dy > this.dirtyMaxY) this.dirtyMaxY = dy;
    this.territoryDirty = true;
  }

  paintTile(
    imageData32: Uint32Array,
    tile: TileRef,
    color: Colord,
    alpha: number,
  ) {
    // Deprecated
  }

  clearTile(tile: TileRef) {
    // Deprecated
  }

  enqueueTile(tile: TileRef) {
    this.tileToRenderQueue.add(tile);
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

    // Ensure renderer canvas is exactly the game dimensions
    this.renderer.canvas.width = this.game.width();
    this.renderer.canvas.height = this.game.height();

    console.log(
      "[TerritoryLayer] Renderer size:",
      this.renderer.canvas.width,
      "x",
      this.renderer.canvas.height,
    );
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
