import * as PIXI from "pixi.js";
import anchorIcon from "../../../../resources/images/AnchorIcon.png";
import academyIcon from "../../../../resources/images/buildings/academy_icon.png";
import airfieldIcon from "../../../../resources/images/buildings/airfield.png";
import hospitalIcon from "../../../../resources/images/buildings/hospital.png";
import cityIcon from "../../../../resources/images/CityIcon.png";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import SAMMissileIcon from "../../../../resources/images/SamLauncherUnit.png";
// Use the standard shield icon from resources/images
import shieldIcon from "../../../../resources/images/ShieldIcon.png";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerID, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { UnitCooldownEndedEvent } from "../../events/UnitCooldownEndedEvent";
import { MouseUpEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
class StructureRenderInfo {
  public isOnScreen: boolean = false;
  public isOnCooldown: boolean = false;
  constructor(
    public unit: UnitView,
    public owner: PlayerID,
    public pixiSprite: PIXI.Sprite,
    public underConstruction: boolean,
  ) {}
}

const ICON_SIZE = 24; // legacy default; specific shapes use ICON_SIZES below
// Render structure textures at higher pixel density to stay crisp when scaled
const ICON_TEXTURE_QUALITY = 2; // 2x logical size -> sharper when zooming in
const ICON_SIZES: Record<BgShape, number> = {
  circle: 28,
  octagon: 28,
  pentagon: 30,
  square: 28,
  triangle: 28,
};
// Icon scale behavior vs map zoom:
// - Up to ICON_GROW_ZOOM_THRESHOLD, icons behave as before: they shrink with zoom-out and cap at 1x when zoomed in
// - Beyond ICON_GROW_ZOOM_THRESHOLD, icons grow with the map zoom (proportionally)
const ICON_GROW_ZOOM_THRESHOLD = 2;
const UNDER_CONSTRUCTION_FILL = "rgb(198, 198, 198)";
const UNDER_CONSTRUCTION_BORDER = "rgb(128, 127, 127)";
const reloadingColor = "red";

// Background shape per structure type
type BgShape = "circle" | "square" | "triangle" | "pentagon" | "octagon";
const STRUCTURE_BG_SHAPES: Partial<Record<UnitType, BgShape>> = {
  [UnitType.City]: "circle",
  [UnitType.Port]: "pentagon",
  [UnitType.DefensePost]: "octagon",
  [UnitType.MissileSilo]: "triangle",
  [UnitType.SAMLauncher]: "square",
  [UnitType.Airfield]: "square",
  [UnitType.Hospital]: "square",
  [UnitType.Academy]: "square",
};

export class StructureLayer implements Layer {
  private pixicanvas: HTMLCanvasElement;
  private stage: PIXI.Container;
  private shouldRedraw: boolean = true;
  private textureCache: Map<string, PIXI.Texture> = new Map();
  private theme: Theme;
  private renderer: PIXI.Renderer;
  private renders: StructureRenderInfo[] = [];
  private seenUnits: Set<UnitView> = new Set();

  // Interaction state
  private selectedStructureUnit: UnitView | null = null;
  private previouslySelected: UnitView | null = null;

  // Icons registry
  private structures: Map<
    UnitType,
    { iconPath: string; image: HTMLImageElement | null }
  > = new Map([
    [UnitType.City, { iconPath: cityIcon, image: null }],
    [UnitType.Airfield, { iconPath: airfieldIcon, image: null }],
    [UnitType.Hospital, { iconPath: hospitalIcon, image: null }],
    [UnitType.Academy, { iconPath: academyIcon, image: null }],
    [UnitType.DefensePost, { iconPath: shieldIcon, image: null }],
    [UnitType.Port, { iconPath: anchorIcon, image: null }],
    [UnitType.MissileSilo, { iconPath: missileSiloIcon, image: null }],
    [UnitType.SAMLauncher, { iconPath: SAMMissileIcon, image: null }],
  ]);

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.structures.forEach((u, unitType) => this.loadIcon(u, unitType));
  }

  private loadIcon(
    unitInfo: {
      iconPath: string;
      image: HTMLImageElement | null;
    },
    unitType: UnitType,
  ) {
    const image = new Image();
    image.src = unitInfo.iconPath;
    image.onload = () => {
      unitInfo.image = image;
    };
    image.onerror = () => {
      console.error(
        `Failed to load icon for ${unitType}: ${unitInfo.iconPath}`,
      );
    };
  }

  shouldTransform(): boolean {
    // We manually handle transforms when positioning sprites
    return false;
  }

  async init() {
    window.addEventListener("resize", () => this.resizeCanvas());
    await this.setupRenderer();
    this.redraw();
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(UnitCooldownEndedEvent, (e) => {
      if (e.unit.type() === UnitType.City) {
        const render = this.renders.find((r) => r.unit.id() === e.unit.id());
        if (render) {
          this.updateRenderState(render, e.unit);
        }
      }
    });
  }

  async setupRenderer() {
    this.renderer = new PIXI.WebGLRenderer();
    this.pixicanvas = document.createElement("canvas");
    this.pixicanvas.width = window.innerWidth;
    this.pixicanvas.height = window.innerHeight;
    this.stage = new PIXI.Container();
    this.stage.position.set(0, 0);
    this.stage.width = this.pixicanvas.width;
    this.stage.height = this.pixicanvas.height;
    await this.renderer.init({
      canvas: this.pixicanvas,
      resolution: 1,
      width: this.pixicanvas.width,
      height: this.pixicanvas.height,
      clearBeforeRender: true,
      backgroundAlpha: 0,
      backgroundColor: 0x00000000,
    });
  }

  resizeCanvas() {
    if (this.renderer.view) {
      this.pixicanvas.width = window.innerWidth;
      this.pixicanvas.height = window.innerHeight;
      this.renderer.resize(innerWidth, innerHeight, 1);
      this.shouldRedraw = true;
    }
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];
    for (const u of unitUpdates) {
      const unitView = this.game.unit(u.id);
      if (unitView === undefined) continue;

      if (unitView.isActive()) {
        if (this.seenUnits.has(unitView)) {
          const render = this.renders.find(
            (r) => r.unit.id() === unitView.id(),
          );
          if (render) {
            this.updateRenderState(render, unitView);
          }
        } else if (
          this.structures.has(unitView.type()) ||
          unitView.type() === UnitType.Construction
        ) {
          this.seenUnits.add(unitView);
          const render = new StructureRenderInfo(
            unitView,
            unitView.owner().id(),
            this.createPixiSprite(unitView),
            unitView.type() === UnitType.Construction,
          );
          this.renders.push(render);
          this.computeNewLocation(render);
          this.shouldRedraw = true;
        }
      }

      if (!unitView.isActive() && this.seenUnits.has(unitView)) {
        const render = this.renders.find((r) => r.unit.id() === unitView.id());
        if (render) {
          this.deleteStructure(render);
        }
        this.shouldRedraw = true;
      }
    }
  }

  redraw() {
    this.resizeCanvas();
  }

  renderLayer(mainContext: CanvasRenderingContext2D) {
    if (!this.renderer) return;

    if (this.transformHandler.hasChanged()) {
      for (const render of this.renders) {
        this.computeNewLocation(render);
      }
    }

    if (this.transformHandler.hasChanged() || this.shouldRedraw) {
      this.renderer.render(this.stage);
      this.shouldRedraw = false;
    }
    mainContext.drawImage(this.renderer.canvas, 0, 0);
  }

  private updateRenderState(render: StructureRenderInfo, unit: UnitView) {
    const isConstruction = unit.type() === UnitType.Construction;
    const ownerChanged = render.owner !== unit.owner().id();
    const constructionStateChanged =
      render.underConstruction !== isConstruction;

    let cooldownChanged = false;
    if (unit.type() === UnitType.City) {
      const isOnCooldown = this.game.isCitySamOnCooldown(unit.id());
      if (isOnCooldown !== render.isOnCooldown) {
        cooldownChanged = true;
        render.isOnCooldown = isOnCooldown;
      }
    }

    if (ownerChanged || constructionStateChanged || cooldownChanged) {
      render.owner = unit.owner().id();
      render.underConstruction = isConstruction;
      render.pixiSprite?.destroy();
      render.pixiSprite = this.createPixiSprite(unit);
      this.shouldRedraw = true;
    }
  }

  private createTexture(unit: UnitView): PIXI.Texture {
    const isConstruction = unit.type() === UnitType.Construction;
    const structureType = isConstruction
      ? (unit.constructionType() ?? unit.type())
      : unit.type();
    let cacheKey = isConstruction
      ? `construction-${structureType}`
      : `${unit.owner().id()}-${structureType}`;
    if (unit.type() === UnitType.City) {
      cacheKey += `-${this.game.isCitySamOnCooldown(unit.id())}`;
    }
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)!;
    }

    const shape: BgShape =
      STRUCTURE_BG_SHAPES[structureType as UnitType] ?? "circle";
    const ICON_DIM = ICON_SIZES[shape] ?? ICON_SIZE;

    const canvas = document.createElement("canvas");
    const CANVAS_PX = Math.max(1, Math.round(ICON_DIM * ICON_TEXTURE_QUALITY));
    canvas.width = CANVAS_PX;
    canvas.height = CANVAS_PX;
    const ctx = canvas.getContext("2d")!;
    // Draw in logical units (ICON_DIM) but render at higher pixel density
    ctx.scale(ICON_TEXTURE_QUALITY, ICON_TEXTURE_QUALITY);

    // Fill and border colors
    let borderColor: string;
    if (isConstruction) {
      ctx.fillStyle = UNDER_CONSTRUCTION_FILL;
      borderColor = UNDER_CONSTRUCTION_BORDER;
    } else {
      ctx.fillStyle = "#c9dbff"; // semi-transparent white applied via globalAlpha
      const border = this.theme.borderColor(unit.owner());
      borderColor = border.darken(0.17).toRgbString();
    }

    if (
      unit.type() === UnitType.City &&
      this.game.isCitySamOnCooldown(unit.id())
    ) {
      borderColor = reloadingColor;
    }

    // Draw background shape
    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(ICON_DIM / 2, ICON_DIM / 2, ICON_DIM / 2 - 1, 0, Math.PI * 2);
    } else if (shape === "square") {
      const pad = 1;
      ctx.rect(pad, pad, ICON_DIM - pad * 2, ICON_DIM - pad * 2);
    } else if (shape === "triangle") {
      const s = ICON_DIM;
      const half = s / 2;
      ctx.moveTo(half, 1);
      ctx.lineTo(s - 1, s - 1);
      ctx.lineTo(1, s - 1);
      ctx.closePath();
    } else if (shape === "pentagon") {
      const r = ICON_DIM / 2 - 1;
      const cx = ICON_DIM / 2;
      const cy = ICON_DIM / 2;
      const step = (Math.PI * 2) / 5;
      for (let i = 0; i < 5; i++) {
        const angle = step * i - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else if (shape === "octagon") {
      const r = ICON_DIM / 2 - 1;
      const cx = ICON_DIM / 2;
      const cy = ICON_DIM / 2;
      const step = (Math.PI * 2) / 8;
      for (let i = 0; i < 8; i++) {
        const angle = step * i - Math.PI / 8;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    // Apply alpha to interior fill
    const prevAlpha = ctx.globalAlpha;
    if (!isConstruction) {
      ctx.globalAlpha = 1;
    }
    ctx.fill();
    ctx.globalAlpha = prevAlpha;

    // Stroke border on top
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1; // logical pixel; turns into crisp 2px at 2x quality
    ctx.stroke();

    const structureInfo = this.structures.get(structureType);
    if (!structureInfo?.image) {
      console.warn(`Image not loaded for unit type: ${structureType}`);
      return PIXI.Texture.from(canvas);
    }

    // Draw icon: center+scale for a subset of unit types; otherwise use fixed offsets
    const SHAPE_OFFSETS: Record<BgShape, [number, number]> = {
      triangle: [6, 11],
      square: [5, 5],
      octagon: [6, 6],
      pentagon: [7, 7],
      circle: [6, 6],
    };
    const colored = this.getImageColored(structureInfo.image, borderColor);
    const centerScaledTypes = new Set<UnitType>([
      UnitType.Airfield,
      UnitType.Hospital,
      UnitType.Academy,
    ]);
    if (centerScaledTypes.has(structureType as UnitType)) {
      const padded = 4;
      const maxW = ICON_DIM - padded * 2;
      const maxH = ICON_DIM - padded * 2;
      const iw = Math.max(1, colored.width);
      const ih = Math.max(1, colored.height);
      const scale = Math.min(maxW / iw, maxH / ih);
      const dw = Math.max(1, Math.round(iw * scale));
      const dh = Math.max(1, Math.round(ih * scale));
      const dx = Math.round((ICON_DIM - dw) / 2);
      const dy = Math.round((ICON_DIM - dh) / 2);
      ctx.drawImage(colored, dx, dy, dw, dh);
    } else {
      const [offX, offY] = SHAPE_OFFSETS[shape] ?? [4, 4];
      ctx.drawImage(colored, offX, offY);
    }

    const texture = PIXI.Texture.from(canvas);
    this.textureCache.set(cacheKey, texture);
    return texture;
  }

  private createPixiSprite(unit: UnitView): PIXI.Sprite {
    const sprite = new PIXI.Sprite(this.createTexture(unit));
    sprite.anchor.set(0.5, 0.5);
    const tile = unit.tile();
    const worldX = this.game.x(tile);
    const worldY = this.game.y(tile);
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(worldX, worldY),
    );
    sprite.x = screenPos.x;
    sprite.y = screenPos.y;
    sprite.scale.set(this.iconScreenScale());
    this.stage.addChild(sprite);
    return sprite;
  }

  private iconScreenScale(): number {
    const s = this.transformHandler.scale;
    if (s <= ICON_GROW_ZOOM_THRESHOLD) {
      // Original behavior: shrink with zoom-out, cap at 1x for zoom-in up to threshold
      return Math.min(1, s) / ICON_TEXTURE_QUALITY;
    }
    // Beyond threshold: grow proportionally with map zoom (continuous at threshold)
    return s / ICON_GROW_ZOOM_THRESHOLD / ICON_TEXTURE_QUALITY;
  }

  private getImageColored(
    image: HTMLImageElement,
    color: string,
  ): HTMLCanvasElement {
    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = image.width;
    imageCanvas.height = image.height;
    const ctx = imageCanvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(image, 0, 0);
    return imageCanvas;
  }

  private computeNewLocation(render: StructureRenderInfo) {
    const tile = render.unit.tile();
    const worldX = this.game.x(tile);
    const worldY = this.game.y(tile);
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(worldX, worldY),
    );
    screenPos.x = Math.round(screenPos.x);
    screenPos.y = Math.round(screenPos.y);

    // Margin reflects the current icon's shape size scaled on screen
    const unitType =
      render.unit.type() === UnitType.Construction
        ? render.unit.constructionType()
        : render.unit.type();
    const shape: BgShape =
      unitType !== undefined
        ? (STRUCTURE_BG_SHAPES[unitType as UnitType] ?? "circle")
        : "circle";
    const iconDim = ICON_SIZES[shape] ?? ICON_SIZE;
    const margin = iconDim * this.iconScreenScale();
    const onScreen =
      screenPos.x + margin > 0 &&
      screenPos.x - margin < this.pixicanvas.width &&
      screenPos.y + margin > 0 &&
      screenPos.y - margin < this.pixicanvas.height;

    if (onScreen) {
      render.pixiSprite.x = screenPos.x;
      render.pixiSprite.y = screenPos.y;
      render.pixiSprite.scale.set(this.iconScreenScale());
    }
    if (render.isOnScreen !== onScreen) {
      render.isOnScreen = onScreen;
      render.pixiSprite.visible = onScreen;
    }
  }

  private isUnitTypeSupported(unitType: UnitType): boolean {
    return this.structures.has(unitType);
  }

  private findStructureUnitAtCell(
    cell: { x: number; y: number },
    maxDistance: number = 10,
  ): UnitView | null {
    const targetRef = this.game.ref(cell.x, cell.y);
    const allUnitTypes = Object.values(UnitType);
    const nearby = this.game.nearbyUnits(targetRef, maxDistance, allUnitTypes);
    for (const { unit } of nearby) {
      if (unit.isActive() && this.isUnitTypeSupported(unit.type())) {
        return unit;
      }
    }
    return null;
  }

  private onMouseUp(event: MouseUpEvent) {
    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const clickedUnit = this.findStructureUnitAtCell(cell);
    this.previouslySelected = this.selectedStructureUnit;

    if (clickedUnit) {
      if (clickedUnit.owner() !== this.game.myPlayer()) {
        return;
      }
      const wasSelected = this.previouslySelected === clickedUnit;
      if (wasSelected) {
        this.selectedStructureUnit = null;
      } else {
        this.selectedStructureUnit = clickedUnit;
      }
    } else {
      this.selectedStructureUnit = null;
    }
  }

  public unSelectStructureUnit() {
    if (this.selectedStructureUnit) {
      this.previouslySelected = this.selectedStructureUnit;
      this.selectedStructureUnit = null;
    }
  }

  private deleteStructure(render: StructureRenderInfo) {
    render.pixiSprite?.destroy();
    this.renders = this.renders.filter((r) => r.unit !== render.unit);
    this.seenUnits.delete(render.unit);
  }
}
