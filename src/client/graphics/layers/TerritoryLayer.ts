import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import {
  Cell,
  ColoredTeams,
  PlayerType,
  Team,
  UnitType,
} from "../../../core/game/Game";
import { euclDistFN, TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { AlternateViewEvent, DragEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { BorderRenderer, NullBorderRenderer } from "./BorderRenderer";
import { Layer } from "./Layer";
import { WebGLBorderRenderer } from "./WebGLBorderRenderer";

export class TerritoryLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;
  private alternativeImageData: ImageData;
  private borderAnimTime = 0;

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

  private borderRenderer: BorderRenderer = new NullBorderRenderer();

  private alternativeView = false;
  private lastDragTime = 0;
  private nodrawDragDuration = 200;

  private refreshRate = 15; //refresh every 15ms
  private lastRefresh = 0;

  private lastFocusedPlayer: PlayerView | null = null;
  private lastMyPlayerSmallId: number | null = null;
  private webglSupported = true;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.lastMyPlayerSmallId = game.myPlayer()?.smallID() ?? null;
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
    if (this.game.inSpawnPhase()) {
      this.spawnHighlight();
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
          this.redrawBorder(territory);
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
            this.redrawBorder(territory);
          }
        }
      });
    }

    const focusedPlayer = this.game.focusedPlayer();
    if (focusedPlayer !== this.lastFocusedPlayer) {
      if (!this.borderRenderer.drawsOwnBorders()) {
        if (this.lastFocusedPlayer) {
          this.paintPlayerBorder(this.lastFocusedPlayer);
        }
        if (focusedPlayer) {
          this.paintPlayerBorder(focusedPlayer);
        }
      }
      this.lastFocusedPlayer = focusedPlayer;
    }

    const currentMyPlayer = this.game.myPlayer()?.smallID() ?? null;
    if (currentMyPlayer !== this.lastMyPlayerSmallId) {
      this.redraw();
    }
  }

  private spawnHighlight() {
    if (this.game.ticks() % 5 === 0) {
      return;
    }

    this.highlightContext.clearRect(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );

    this.drawFocusedPlayerHighlight();

    const humans = this.game
      .playerViews()
      .filter((p) => p.type() === PlayerType.Human);

    const focusedPlayer = this.game.focusedPlayer();
    const teamColors = Object.values(ColoredTeams);
    for (const human of humans) {
      if (human === focusedPlayer) {
        continue;
      }
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
      if (myPlayer !== null && myPlayer !== human && myPlayer.team() === null) {
        // In FFA games (when team === null), use default yellow spawn highlight color
        color = this.theme.spawnHighlightColor();
      } else if (myPlayer !== null && myPlayer !== human) {
        // In Team games, the spawn highlight color becomes that player's team color
        // Optionally, this could be broken down to teammate or enemy and simplified to green and red, respectively
        const team = human.team();
        if (team !== null && teamColors.includes(team)) {
          color = this.theme.teamColor(team);
        } else {
          if (myPlayer.isFriendly(human)) {
            color = this.theme.allyColor();
          } else {
            color = this.theme.spawnHighlightColor();
          }
        }
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

  private drawFocusedPlayerHighlight() {
    const focusedPlayer = this.game.focusedPlayer();

    if (!focusedPlayer) {
      return;
    }
    const center = focusedPlayer.nameLocation();
    if (!center) {
      return;
    }
    // Breathing border animation
    this.borderAnimTime += 0.5;
    const minRad = 8;
    const maxRad = 24;
    // Range: [minPadding..maxPadding]
    const radius =
      minRad + (maxRad - minRad) * (0.5 + 0.5 * Math.sin(this.borderAnimTime));

    const baseColor = this.theme.spawnHighlightColor();
    let teamColor: Colord = baseColor;

    const team: Team | null = focusedPlayer.team();
    if (team !== null && Object.values(ColoredTeams).includes(team)) {
      teamColor = this.theme.teamColor(team).alpha(0.5);
    }

    this.drawBreathingRing(
      center.x,
      center.y,
      minRad,
      maxRad,
      radius,
      baseColor, // Always draw white static semi-transparent ring
      teamColor, // Pass the breathing ring color. White for FFA, Duos, Trios, Quads. Transparent team color for TEAM games.
    );
  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
      this.borderRenderer.setAlternativeView(this.alternativeView);
    });
    this.eventBus.on(DragEvent, (e) => {
      // TODO: consider re-enabling this on mobile or low end devices for smoother dragging.
      // this.lastDragTime = Date.now();
    });
    this.redraw();
  }

  redraw() {
    console.log("redrew territory layer");
    this.lastMyPlayerSmallId = this.game.myPlayer()?.smallID() ?? null;
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
    this.alternativeImageData = this.context.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.initImageData();

    this.context.putImageData(
      this.alternativeView ? this.alternativeImageData : this.imageData,
      0,
      0,
    );

    this.configureBorderRenderer();

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

  private configureBorderRenderer() {
    const renderer = new WebGLBorderRenderer(this.game, this.theme);
    this.webglSupported = renderer.isSupported();
    if (renderer.isActive()) {
      this.borderRenderer = renderer;
      this.borderRenderer.setAlternativeView(this.alternativeView);
    } else {
      this.borderRenderer = new NullBorderRenderer();
    }
  }

  redrawBorder(...players: PlayerView[]) {
    return Promise.all(
      players.map(async (player) => {
        const tiles = await player.borderTiles();
        tiles.borderTiles.forEach((tile: TileRef) => {
          this.paintTerritory(tile, true);
        });
      }),
    );
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

    this.borderRenderer.render(context);
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
        this.paintTerritory(neighbor, true); //this is a misuse of the _Border parameter, making it a maybe stale border
      }
    }
  }

  paintTerritory(tile: TileRef, _maybeStaleBorder: boolean = false) {
    const hasOwner = this.game.hasOwner(tile);
    const owner = hasOwner ? (this.game.owner(tile) as PlayerView) : null;
    const isBorderTile = this.game.isBorder(tile);
    const hasFallout = this.game.hasFallout(tile);
    let isDefended = false;
    const rendererHandlesBorders = this.borderRenderer.drawsOwnBorders();

    if (!owner) {
      if (hasFallout) {
        this.paintTile(this.imageData, tile, this.theme.falloutColor(), 150);
        this.paintTile(
          this.alternativeImageData,
          tile,
          this.theme.falloutColor(),
          150,
        );
      } else {
        this.clearTile(tile);
      }
    } else {
      const myPlayer = this.game.myPlayer();

      if (isBorderTile) {
        isDefended = this.game.hasUnitNearby(
          tile,
          this.game.config().defensePostRange(),
          UnitType.DefensePost,
          owner.id(),
        );

        if (myPlayer) {
          const alternativeColor = this.alternateViewColor(owner);
          this.paintTile(
            this.alternativeImageData,
            tile,
            alternativeColor,
            255,
          );
        }

        if (rendererHandlesBorders) {
          this.paintTile(
            this.imageData,
            tile,
            this.theme.territoryColor(owner),
            150,
          );
        } else {
          if (isDefended) {
            const borderColors = this.theme.defendedBorderColors(owner);
            const x = this.game.x(tile);
            const y = this.game.y(tile);
            const lightTile =
              (x % 2 === 0 && y % 2 === 0) || (y % 2 === 1 && x % 2 === 1);
            const borderColor = lightTile
              ? borderColors.light
              : borderColors.dark;
            this.paintTile(this.imageData, tile, borderColor, 255);
          } else {
            const playerIsFocused = this.game.focusedPlayer() === owner;
            const useBorderColor = playerIsFocused
              ? this.theme.focusedBorderColor()
              : this.theme.borderColor(owner);
            this.paintTile(this.imageData, tile, useBorderColor, 255);
          }
        }
      } else {
        this.paintTile(
          this.imageData,
          tile,
          this.theme.territoryColor(owner),
          150,
        );
        if (myPlayer) {
          const alternativeColor = this.alternateViewColor(owner);
          this.paintTile(this.alternativeImageData, tile, alternativeColor, 60);
        }
      }
    }

    if (rendererHandlesBorders) {
      if (_maybeStaleBorder && !isBorderTile) {
        this.borderRenderer.clearTile(tile);
      } else {
        this.borderRenderer.updateBorder(
          tile,
          owner,
          isBorderTile,
          isDefended,
          hasFallout,
        );
      }
    }
  }

  alternateViewColor(other: PlayerView): Colord {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return this.theme.enemyColor();
    }
    // Diplomacy alternate view colors:
    // - Red (enemyColor) for bots and players at war
    // - Green (selfColor) for self and allies
    // - Yellow (allyColor) for neutral/peace
    let alternativeColor = this.theme.allyColor(); // default: neutral/peace (yellow)
    if (other.type() === PlayerType.Bot) {
      alternativeColor = this.theme.enemyColor(); // bots always red
    } else if (
      other.smallID() === myPlayer.smallID() ||
      other.isFriendly(myPlayer)
    ) {
      alternativeColor = this.theme.selfColor(); // self and allies (green)
    } else if (myPlayer.isAtWarWith(other)) {
      alternativeColor = this.theme.enemyColor(); // at war (red)
    }
    return alternativeColor;
  }

  paintAlternateViewTile(tile: TileRef, other: PlayerView) {
    const color = this.alternateViewColor(other);
    this.paintTile(this.alternativeImageData, tile, color, 255);
  }

  paintTile(imageData: ImageData, tile: TileRef, color: Colord, alpha: number) {
    const offset = tile * 4;
    imageData.data[offset] = color.rgba.r;
    imageData.data[offset + 1] = color.rgba.g;
    imageData.data[offset + 2] = color.rgba.b;
    imageData.data[offset + 3] = alpha;
  }

  clearTile(tile: TileRef) {
    this.borderRenderer.clearTile(tile);
    const offset = tile * 4;
    this.imageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
    this.alternativeImageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
  }

  clearAlternativeTile(tile: TileRef) {
    const offset = tile * 4;
    this.alternativeImageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
  }

  enqueueTile(tile: TileRef) {
    this.tileToRenderQueue.push({
      tile: tile,
      lastUpdate: this.game.ticks() + this.random.nextFloat(0, 0.5),
    });
  }

  async enqueuePlayerBorder(player: PlayerView) {
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

  private drawBreathingRing(
    cx: number,
    cy: number,
    minRad: number,
    maxRad: number,
    radius: number,
    transparentColor: Colord,
    breathingColor: Colord,
  ) {
    const ctx = this.highlightContext;
    if (!ctx) return;

    // Draw a semi-transparent ring around the starting location
    ctx.beginPath();
    // Transparency matches the highlight color provided
    const transparent = transparentColor.alpha(0);
    const radGrad = ctx.createRadialGradient(cx, cy, minRad, cx, cy, maxRad);

    // Pixels with radius < minRad are transparent
    radGrad.addColorStop(0, transparent.toRgbString());
    // The ring then starts with solid highlight color
    radGrad.addColorStop(0.01, transparentColor.toRgbString());
    radGrad.addColorStop(0.1, transparentColor.toRgbString());
    // The outer edge of the ring is transparent
    radGrad.addColorStop(1, transparent.toRgbString());

    // Draw an arc at the max radius and fill with the created radial gradient
    ctx.arc(cx, cy, maxRad, 0, Math.PI * 2);
    ctx.fillStyle = radGrad;
    ctx.closePath();
    ctx.fill();

    const breatheInner = breathingColor.alpha(0);
    // Draw a solid ring around the starting location with outer radius = the breathing radius
    ctx.beginPath();
    const radGrad2 = ctx.createRadialGradient(cx, cy, minRad, cx, cy, radius);
    // Pixels with radius < minRad are transparent
    radGrad2.addColorStop(0, breatheInner.toRgbString());
    // The ring then starts with solid highlight color
    radGrad2.addColorStop(0.01, breathingColor.toRgbString());
    // The ring is solid throughout
    radGrad2.addColorStop(1, breathingColor.toRgbString());

    // Draw an arc at the current breathing radius and fill with the created "gradient"
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = radGrad2;
    ctx.fill();
  }
}
