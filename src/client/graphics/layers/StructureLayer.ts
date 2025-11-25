import { colord } from "colord";
import * as PIXI from "pixi.js";
import airfieldIcon from "../../../../proprietary/images/airfieldicon2.png";
import doomsdayDeviceIcon from "../../../../proprietary/images/doomsdayicon.png";
import researchLabIcon from "../../../../proprietary/images/researchlab.png";
import anchorIcon from "../../../../resources/images/AnchorIcon.png";
import academyIcon from "../../../../resources/images/buildings/academy_icon.png";
import hospitalIcon from "../../../../resources/images/buildings/hospital.png";
import cityIcon from "../../../../resources/images/CityIcon.png";
import factoryIcon from "../../../../resources/images/factoryicon.png";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import SAMMissileIcon from "../../../../resources/images/SamLauncherUnit.png";
// Use the standard shield icon from resources/images
import shieldIcon from "../../../../resources/images/ShieldIcon.png";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import {
  BOMBER_UPGRADE_COST_MULTIPLIER,
  computeUpgradeStepCost,
} from "../../../core/game/Costs";
import { Cell, PlayerID, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import {
  isUpgradeableStructure,
  maxStructureLevel,
} from "../../../core/game/Upgradeables";
import { ToggleBomberUpgradeModeEvent } from "../../events/ToggleBomberUpgradeModeEvent";
import { ToggleUpgradeModeEvent } from "../../events/ToggleUpgradeModeEvent";
import { UnitCooldownEndedEvent } from "../../events/UnitCooldownEndedEvent";
import { MouseMoveEvent, MouseUpEvent } from "../../InputHandler";
import {
  SendUpgradeBomberIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { renderNumber } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
class StructureRenderInfo {
  public isOnScreen: boolean = false;
  public isOnCooldown: boolean = false;
  public healthBarGraphics: PIXI.Graphics | null = null;
  public loadingBarGraphics: PIXI.Graphics | null = null;
  constructor(
    public unit: UnitView,
    public owner: PlayerID,
    public pixiSprite: PIXI.Sprite,
    public underConstruction: boolean,
  ) {}
}

const ICON_SIZE = 24; // legacy default; specific shapes use ICON_SIZES below
// Render structure textures at higher pixel density to stay crisp when scaled
const ICON_TEXTURE_QUALITY = 4; // 4x logical size -> sharper when zooming in
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
const reloadingColor = "rgba(155, 16, 16, 1)";

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
  [UnitType.ResearchLab]: "square",
  [UnitType.Academy]: "square",
  [UnitType.Factory]: "circle",
  [UnitType.DoomsdayDevice]: "square",
};

export class StructureLayer implements Layer {
  private pixicanvas: HTMLCanvasElement;
  private stage: PIXI.Container;
  private labelContainer: PIXI.Container; // UI overlay for hover labels
  private shouldRedraw: boolean = true;
  private textureCache: Map<string, PIXI.Texture> = new Map();
  private lastHighlight: Map<number, boolean> = new Map(); // per-unit highlight state to detect changes
  private theme: Theme;
  private renderer: PIXI.Renderer;
  private renders: StructureRenderInfo[] = [];
  private seenUnits: Set<UnitView> = new Set();

  // Interaction state
  private selectedStructureUnit: UnitView | null = null;
  private previouslySelected: UnitView | null = null;
  private hoveredStructure: UnitView | null = null;
  private upgradeMode: boolean = false; // When true, clicking own cities/ports sends upgrade intent
  private bomberUpgradeMode: boolean = false; // When true, clicking own airfields upgrades their bombers
  // Track affordability per structure type to refresh highlights correctly
  private lastAffordableForUpgrade: Map<UnitType, boolean> = new Map();
  // Client-side level tracking for structures (temporary)
  private structureLevels = new Map<
    number,
    { primary: number; secondary: number }
  >();

  // Icons registry
  private structures: Map<
    UnitType,
    { iconPath: string; image: HTMLImageElement | null }
  > = new Map([
    [UnitType.City, { iconPath: cityIcon, image: null }],
    [UnitType.Airfield, { iconPath: airfieldIcon, image: null }],
    [UnitType.Hospital, { iconPath: hospitalIcon, image: null }],
    [UnitType.ResearchLab, { iconPath: researchLabIcon, image: null }],
    [UnitType.Academy, { iconPath: academyIcon, image: null }],
    [UnitType.Factory, { iconPath: factoryIcon, image: null }],
    [UnitType.DefensePost, { iconPath: shieldIcon, image: null }],
    [UnitType.Port, { iconPath: anchorIcon, image: null }],
    [UnitType.MissileSilo, { iconPath: missileSiloIcon, image: null }],
    [UnitType.SAMLauncher, { iconPath: SAMMissileIcon, image: null }],
    [UnitType.DoomsdayDevice, { iconPath: doomsdayDeviceIcon, image: null }],
  ]);

  // Per-structure icon scale factor (1 = default size)
  private static readonly ICON_DRAW_SCALE: Partial<Record<UnitType, number>> = {
    [UnitType.City]: 1,
    [UnitType.Airfield]: 1.4,
    [UnitType.Hospital]: 1,
    [UnitType.ResearchLab]: 1.4,
    [UnitType.Academy]: 1,
    [UnitType.Factory]: 1,
    [UnitType.DefensePost]: 1,
    [UnitType.Port]: 1,
    [UnitType.MissileSilo]: 1,
    [UnitType.SAMLauncher]: 1,
    [UnitType.DoomsdayDevice]: 1.4,
  };

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
    this.eventBus.on(MouseMoveEvent, (e) => this.onMouseMove(e));
    this.eventBus.on(UnitCooldownEndedEvent, (e) => {
      if (e.unit.type() === UnitType.City) {
        const render = this.renders.find((r) => r.unit.id() === e.unit.id());
        if (render) {
          this.updateRenderState(render, e.unit);
        }
      }
    });
    this.eventBus.on(ToggleUpgradeModeEvent, (e) => {
      this.upgradeMode = e.enabled;
      // Rebuild textures for existing sprites so border tint updates immediately.
      for (const r of this.renders) {
        if (isUpgradeableStructure(r.unit.type())) {
          r.pixiSprite.texture = this.createTexture(r.unit);
        }
      }
      // Force redraw so highlight state applies instantly.
      this.shouldRedraw = true;
      this.updateHighlights();
      // Rebuild price labels when toggling upgrade mode
      this.updateLabels();
      if (this.renderer) this.renderer.render(this.stage);
    });
    this.eventBus.on(ToggleBomberUpgradeModeEvent, (e) => {
      this.bomberUpgradeMode = e.enabled;
      // Rebuild textures for airfields so border tint updates immediately.
      for (const r of this.renders) {
        if (r.unit.type() === UnitType.Airfield) {
          r.pixiSprite.texture = this.createTexture(r.unit);
        }
      }
      // Force redraw so highlight state applies instantly.
      this.shouldRedraw = true;
      this.updateHighlights();
      // Rebuild price labels when toggling bomber upgrade mode
      this.updateLabels();
      if (this.renderer) this.renderer.render(this.stage);
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
    // Create label overlay container rendered above sprites
    this.labelContainer = new PIXI.Container();
    this.stage.addChild(this.labelContainer);
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
            // Update health and loading bars
            this.updateHealthBar(render);
            this.updateLoadingBar(render);
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
          // Initialize bars
          this.updateHealthBar(render);
          this.updateLoadingBar(render);
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

    // Update all bars every tick (for smooth loading bar progress)
    for (const render of this.renders) {
      if (render.loadingBarGraphics) {
        this.updateLoadingBar(render);
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
      // Reposition labels on transform changes
      this.updateLabels();
    }

    this.updateHighlights();

    if (this.transformHandler.hasChanged() || this.shouldRedraw) {
      this.renderer.render(this.stage);
      this.shouldRedraw = false;
    }
    mainContext.drawImage(this.renderer.canvas, 0, 0);
  }

  private canAffordUpgrade(unit?: UnitView): boolean {
    const me = this.game.myPlayer();
    if (!me) return false;
    // Determine structure type (default to City if absent for safety)
    const unitType = unit?.type() ?? UnitType.City;
    return this.canAffordUpgradeForType(unitType);
  }

  private canAffordUpgradeForType(unitType: UnitType): boolean {
    const me = this.game.myPlayer();
    if (!me) return false;
    const cfg = this.game.config();
    const baseCost = cfg.unitInfo(unitType).cost(me as any);
    const multiplier = cfg.structureUpgradeCostMultiplier(unitType);
    const upgradeCost = computeUpgradeStepCost(baseCost, multiplier);
    return me.gold() >= upgradeCost;
  }

  // Compute raw upgrade cost for a given structure type for the current player
  private computeUpgradeCostForType(unitType: UnitType): bigint {
    const me = this.game.myPlayer();
    if (!me) return 0n;
    const cfg = this.game.config();
    const baseCost = cfg.unitInfo(unitType).cost(me as any);
    const multiplier = cfg.structureUpgradeCostMultiplier(unitType);
    return computeUpgradeStepCost(baseCost, multiplier);
  }

  // Compact gold formatter using k/m lowercase suffixes
  private formatGoldCompact(amount: bigint): string {
    // Special-case zero to preserve 'k' alignment in UI (show 0k)
    if (amount === 0n) return "0k";
    // Reuse renderNumber for thresholds, then lowercase the suffix
    const s = renderNumber(amount).replace("K", "k").replace("M", "m");
    return s;
  }

  private isUpgradeableStructure(unit: UnitView): boolean {
    if (!isUpgradeableStructure(unit.type())) return false;
    // Check if at max level
    const maxLevel = maxStructureLevel(unit.type());
    if (unit.level() >= maxLevel) return false;
    return true;
  }

  // Bomber upgrade cost: 20% of airfield cost × airfield level
  private computeBomberUpgradeCost(airfield: UnitView): bigint {
    const me = this.game.myPlayer();
    if (!me) return 0n;
    const cfg = this.game.config();
    const airfieldBaseCost = cfg.unitInfo(UnitType.Airfield).cost(me as any);
    const airfieldLevel = airfield.level?.() ?? 1;
    // BOMBER_UPGRADE_COST_MULTIPLIER of airfield cost × airfield level
    return (
      (airfieldBaseCost *
        BigInt(Math.round(BOMBER_UPGRADE_COST_MULTIPLIER * 100)) *
        BigInt(airfieldLevel)) /
      100n
    );
  }

  // Check if player can afford to upgrade bombers for this airfield
  private canAffordBomberUpgrade(airfield: UnitView): boolean {
    const me = this.game.myPlayer();
    if (!me) return false;
    if (airfield.type() !== UnitType.Airfield) return false;
    // Check if any bombers for this airfield can be upgraded
    if (!this.hasBombersToUpgrade(airfield)) return false;
    const upgradeCost = this.computeBomberUpgradeCost(airfield);
    return me.gold() >= upgradeCost;
  }

  // Check if the airfield has any bombers that can be upgraded (not at max level 3)
  private hasBombersToUpgrade(airfield: UnitView): boolean {
    const me = this.game.myPlayer();
    if (!me) return false;
    // Get bombers for this airfield
    const bombers = this.game
      .units(UnitType.Bomber)
      .filter(
        (b) =>
          b.owner() === me &&
          (b as any).data?.sourceAirfieldId === airfield.id(),
      );
    // For now, check if airfield has any bombers based on its level (number of bombers = level)
    // Since we can't easily get sourceAirfield from client view, check if airfield level > 0
    // and at least one bomber could be below max level
    const airfieldLevel = airfield.level?.() ?? 1;
    if (airfieldLevel === 0) return false;
    // We assume bombers can be upgraded if player has bombers
    // The actual check happens on the server
    return true;
  }

  // Check if airfield is eligible for bomber upgrade mode highlighting
  private isEligibleForBomberUpgrade(unit: UnitView): boolean {
    if (unit.type() !== UnitType.Airfield) return false;
    const me = this.game.myPlayer();
    if (!me || unit.owner() !== me) return false;
    return this.hasBombersToUpgrade(unit);
  }

  private updateHighlights() {
    // Build current affordability map for all upgradeable structure types
    const currentAffordable = new Map<UnitType, boolean>();
    for (const r of this.renders) {
      const t = r.unit.type();
      if (isUpgradeableStructure(t) && !currentAffordable.has(t)) {
        currentAffordable.set(t, this.canAffordUpgradeForType(t));
      }
    }

    if (!this.upgradeMode && !this.bomberUpgradeMode) {
      // When exiting upgrade mode, clear affordability cache and refresh upgradeable structures
      if (this.lastAffordableForUpgrade.size > 0) {
        for (const r of this.renders) {
          if (isUpgradeableStructure(r.unit.type())) {
            r.pixiSprite.texture = this.createTexture(r.unit);
          }
        }
        this.lastAffordableForUpgrade.clear();
        this.shouldRedraw = true;
      }
      // When exiting upgrade mode, ensure any previously highlighted sprites are refreshed
      if (this.lastHighlight.size > 0) {
        for (const r of this.renders) {
          const was = this.lastHighlight.get(r.unit.id());
          if (was) {
            r.pixiSprite.texture = this.createTexture(r.unit);
          }
        }
        this.lastHighlight.clear();
        this.shouldRedraw = true;
      }
      return;
    }

    // Handle bomber upgrade mode highlighting for airfields
    if (this.bomberUpgradeMode) {
      let anyChanged = false;
      for (const r of this.renders) {
        if (r.unit.type() !== UnitType.Airfield) continue;
        const should = this.shouldHighlightForBomberUpgrade(r.unit);
        const prev = this.lastHighlight.get(r.unit.id()) ?? false;
        if (prev !== should) {
          r.pixiSprite.texture = this.createTexture(r.unit);
          this.lastHighlight.set(r.unit.id(), should);
          anyChanged = true;
        }
      }
      if (anyChanged) {
        this.shouldRedraw = true;
      }
      // Still fall through to handle regular upgrade mode if both are somehow on
      if (!this.upgradeMode) return;
    }

    // Check if affordability changed for any structure type
    const changedTypes = new Set<UnitType>();
    for (const [type, affordable] of currentAffordable) {
      const lastAffordable = this.lastAffordableForUpgrade.get(type);
      if (lastAffordable !== affordable) {
        changedTypes.add(type);
        this.lastAffordableForUpgrade.set(type, affordable);
      }
    }

    // Refresh textures for structures whose affordability changed
    if (changedTypes.size > 0) {
      for (const r of this.renders) {
        if (changedTypes.has(r.unit.type())) {
          r.pixiSprite.texture = this.createTexture(r.unit);
        }
      }
      this.shouldRedraw = true;
    }

    // Per-unit sanity check: if highlight eligibility changed (e.g., level cap reached), refresh that unit
    let anyUnitChanged = false;
    for (const r of this.renders) {
      if (!isUpgradeableStructure(r.unit.type())) {
        continue;
      }
      const should = this.shouldHighlight(r.unit);
      const prev = this.lastHighlight.get(r.unit.id()) ?? false;
      if (prev !== should) {
        // Refresh just this sprite; cache key accounts for highlight state
        r.pixiSprite.texture = this.createTexture(r.unit);
        this.lastHighlight.set(r.unit.id(), should);
        anyUnitChanged = true;
      }
    }
    if (anyUnitChanged) {
      this.shouldRedraw = true;
    }
  }

  private updateRenderState(render: StructureRenderInfo, unit: UnitView) {
    const isConstruction = unit.type() === UnitType.Construction;
    const ownerChanged = render.owner !== unit.owner().id();
    const constructionStateChanged =
      render.underConstruction !== isConstruction;

    let cooldownChanged = false;
    if (unit.type() === UnitType.City) {
      const endsAt = unit.cooldownEndsAt?.call(unit) ?? undefined;
      const isOnCooldown =
        (endsAt !== undefined && this.game.ticks() < endsAt) ||
        (unit.ticksLeftInCooldown() ?? 0) > 0;
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

    // Initialize or bump structure levels (city level comes from server updates).
    if (!isConstruction) {
      this.ensureStructureLevels(unit);
      const record = this.structureLevels.get(unit.id());
      if (record) {
        // Sync primary level from server value.
        const prevLevel = record.primary;
        const serverLevel = unit.level();
        record.primary = serverLevel;
        // If the hovered structure's level changed, refresh the label immediately.
        if (this.hoveredStructure && this.hoveredStructure.id() === unit.id()) {
          this.updateLabels();
        }
        // If level changed and we're in upgrade mode, re-render texture so highlight state updates
        if (prevLevel !== serverLevel && this.upgradeMode) {
          // Refresh texture so highlight state updates based on new level
          const target = this.renders.find((r) => r.unit.id() === unit.id());
          if (target) {
            target.pixiSprite.texture = this.createTexture(unit);
            this.shouldRedraw = true;
            if (this.renderer) {
              // Force immediate redraw so highlight state disappears instantly
              this.renderer.render(this.stage);
            }
          }
        }
      }
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
      const endsAt = unit.cooldownEndsAt?.call(unit) ?? undefined;
      const isOnCooldown =
        (endsAt !== undefined && this.game.ticks() < endsAt) ||
        (unit.ticksLeftInCooldown() ?? 0) > 0;
      cacheKey += `-${isOnCooldown}`;
    }
    // Differentiate textures by upgrade highlight state so mixed eligibility among
    // units of the same type/owner doesn't lead to incorrect texture reuse.
    if (!isConstruction && isUpgradeableStructure(structureType as UnitType)) {
      const hl = this.shouldHighlight(unit) ? 1 : 0;
      cacheKey += `-hl${hl}`;
    }
    // Add bomber upgrade highlight state for airfields
    if (!isConstruction && structureType === UnitType.Airfield) {
      const bhl = this.shouldHighlightForBomberUpgrade(unit) ? 1 : 0;
      cacheKey += `-bhl${bhl}`;
    }
    if (this.textureCache.has(cacheKey)) {
      // If render requested invalidation (upgrade mode toggle), bypass cache by deleting
      // The caller sets render.invalidateTexture; we can't access it here, so rely on a global flag
      // Simpler: when upgradeMode toggles we clear relevant city cache entries elsewhere.
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

    if (unit.type() === UnitType.City) {
      const endsAt = unit.cooldownEndsAt?.call(unit) ?? undefined;
      const isOnCooldown =
        (endsAt !== undefined && this.game.ticks() < endsAt) ||
        (unit.ticksLeftInCooldown() ?? 0) > 0;
      if (isOnCooldown) {
        borderColor = reloadingColor;
      }
      // Border may be overridden below if upgrade highlight applies
    }

    // Apply reduced-strength highlight to both border and icon if upgrade-eligible
    let highlightEligibleIcon = false;
    let highlightTint = borderColor;
    if (
      !isConstruction &&
      isUpgradeableStructure(structureType as UnitType) &&
      this.shouldHighlight(unit)
    ) {
      // Blend neon green with the base border color to reduce intensity
      highlightTint = this.blendHexColors("#00FF8A", borderColor, 0.6);
      borderColor = highlightTint;
      highlightEligibleIcon = true;
    }
    // Apply highlight for bomber upgrade mode on airfields
    if (
      !isConstruction &&
      structureType === UnitType.Airfield &&
      this.shouldHighlightForBomberUpgrade(unit)
    ) {
      // Use the same neon green as regular upgrade mode
      highlightTint = this.blendHexColors("#00FF8A", borderColor, 0.6);
      borderColor = highlightTint;
      highlightEligibleIcon = true;
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
    const colored = this.getImageColored(
      structureInfo.image,
      highlightEligibleIcon ? highlightTint : borderColor,
    );
    const centerScaledTypes = new Set<UnitType>([
      UnitType.Airfield,
      UnitType.Hospital,
      UnitType.Academy,
      UnitType.ResearchLab,
      UnitType.Factory,
      UnitType.DoomsdayDevice,
    ]);
    if (centerScaledTypes.has(structureType as UnitType)) {
      const padded = 4;
      const maxW = ICON_DIM - padded * 2;
      const maxH = ICON_DIM - padded * 2;
      const iw = Math.max(1, colored.width);
      const ih = Math.max(1, colored.height);
      const baseScale = Math.min(maxW / iw, maxH / ih);
      const factor =
        StructureLayer.ICON_DRAW_SCALE[structureType as UnitType] ?? 1;
      // Allow slight oversize within canvas; clamp to canvas bounds
      const dw = Math.min(
        ICON_DIM,
        Math.max(1, Math.round(iw * baseScale * factor)),
      );
      const dh = Math.min(
        ICON_DIM,
        Math.max(1, Math.round(ih * baseScale * factor)),
      );
      const dx = Math.round((ICON_DIM - dw) / 2);
      const dy = Math.round((ICON_DIM - dh) / 2);
      ctx.drawImage(colored, dx, dy, dw, dh);
    } else {
      const [offX, offY] = SHAPE_OFFSETS[shape] ?? [4, 4];
      const factor =
        StructureLayer.ICON_DRAW_SCALE[structureType as UnitType] ?? 1;
      if (factor !== 1) {
        const iw = Math.max(1, colored.width);
        const ih = Math.max(1, colored.height);
        const dw = Math.min(ICON_DIM, Math.max(1, Math.round(iw * factor)));
        const dh = Math.min(ICON_DIM, Math.max(1, Math.round(ih * factor)));
        const dx = Math.round((ICON_DIM - dw) / 2);
        const dy = Math.round((ICON_DIM - dh) / 2);
        ctx.drawImage(colored, dx, dy, dw, dh);
      } else {
        ctx.drawImage(colored, offX, offY);
      }
    }

    const texture = PIXI.Texture.from(canvas);
    this.textureCache.set(cacheKey, texture);
    return texture;
  }

  private shouldHighlight(unit: UnitView): boolean {
    if (!this.upgradeMode) return false;
    const me = this.game.myPlayer();
    if (!me) return false;
    if (unit.type() === UnitType.Construction) return false;
    if (!this.isUpgradeableStructure(unit)) return false;
    return unit.owner().id() === me.id() && this.canAffordUpgrade(unit);
  }

  private shouldHighlightForBomberUpgrade(unit: UnitView): boolean {
    if (!this.bomberUpgradeMode) return false;
    const me = this.game.myPlayer();
    if (!me) return false;
    if (unit.type() !== UnitType.Airfield) return false;
    if (unit.owner().id() !== me.id()) return false;
    return (
      this.isEligibleForBomberUpgrade(unit) && this.canAffordBomberUpgrade(unit)
    );
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
    // Add sprite below label container so labels render on top
    this.stage.addChildAt(sprite, Math.max(0, this.stage.children.length - 1));
    // Ensure label container remains the topmost child after inserting sprites
    if (this.labelContainer && this.stage.children.length > 1) {
      this.stage.setChildIndex(
        this.labelContainer,
        this.stage.children.length - 1,
      );
    }
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

  // Blend two hex/rgb color strings by a factor t in [0,1]
  private blendHexColors(c1: string, c2: string, t: number): string {
    const a = colord(c1).toRgb();
    const b = colord(c2).toRgb();
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    const r = clamp(a.r * (1 - t) + b.r * t);
    const g = clamp(a.g * (1 - t) + b.g * t);
    const bch = clamp(a.b * (1 - t) + b.b * t);
    return colord({ r, g, b: bch }).toHex();
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
      // Update bars when position/scale changes
      this.updateHealthBar(render);
      this.updateLoadingBar(render);
    }
    if (render.isOnScreen !== onScreen) {
      render.isOnScreen = onScreen;
      render.pixiSprite.visible = onScreen;
      // Hide bars when off screen
      if (!onScreen) {
        if (render.healthBarGraphics) {
          render.healthBarGraphics.visible = false;
        }
        if (render.loadingBarGraphics) {
          render.loadingBarGraphics.visible = false;
        }
      }
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
      // In bomber upgrade mode: attempt to upgrade bombers for clicked airfield
      if (this.bomberUpgradeMode && clickedUnit.type() === UnitType.Airfield) {
        // Check if any bombers can be upgraded and player can afford it
        if (this.canAffordBomberUpgrade(clickedUnit)) {
          // Fire transport event to send intent
          this.eventBus.emit(
            new SendUpgradeBomberIntentEvent(clickedUnit.id()),
          );
        }
        return; // Do not change selection while upgrading
      }
      // In upgrade mode: attempt to upgrade upgradeable structures immediately
      if (this.upgradeMode && isUpgradeableStructure(clickedUnit.type())) {
        // Check if upgradeable (not at max level) and affordable
        if (
          this.isUpgradeableStructure(clickedUnit) &&
          this.canAffordUpgrade(clickedUnit)
        ) {
          // Fire transport event to send intent; rely on server update to change level
          this.eventBus.emit(
            new SendUpgradeStructureIntentEvent(
              clickedUnit.id(),
              clickedUnit.type(),
            ),
          );
        }
        return; // Do not change selection while upgrading
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

  private onMouseMove(event: MouseMoveEvent) {
    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      if (this.hoveredStructure) {
        this.hoveredStructure = null;
        // Clear labels immediately
        this.labelContainer.removeChildren();
        this.shouldRedraw = true;
        if (this.renderer) {
          // Render directly; any rare error (context lost, disposed mid-frame) should surface during development.
          this.renderer.render(this.stage);
        }
      }
      return;
    }
    const hovered = this.findStructureUnitAtCell(cell);
    const effectiveUnit =
      hovered && hovered.type() !== UnitType.Construction ? hovered : null;
    if (effectiveUnit !== this.hoveredStructure) {
      this.hoveredStructure = effectiveUnit;
      if (effectiveUnit) this.ensureStructureLevels(effectiveUnit);
      this.updateLabels(); // updateLabels already forces a render when a structure is hovered
    }
  }

  private ensureStructureLevels(unit: UnitView) {
    const id = unit.id();
    if (
      !this.structureLevels.has(id) &&
      unit.type() !== UnitType.Construction
    ) {
      // Initialize with server level (typically 1 unless upgraded before client joined)
      // For airfields, set secondary to bomber upgrade level
      const secondary =
        unit.type() === UnitType.Airfield ? unit.bomberLevel() : 0;
      this.structureLevels.set(id, { primary: unit.level(), secondary });
    } else if (this.structureLevels.has(id)) {
      // Keep in sync with authoritative server level each tick/render cycle
      const rec = this.structureLevels.get(id)!;
      rec.primary = unit.level();
      // For airfields, update secondary to bomber upgrade level
      if (unit.type() === UnitType.Airfield) {
        rec.secondary = unit.bomberLevel();
      }
    }
  }

  private relationshipColorHexStr(unit: UnitView): string {
    const my = this.game.myPlayer();
    let c = this.theme.enemyColor();
    if (my) {
      if (unit.owner() === my) c = this.theme.selfColor();
      else if (my.isFriendly(unit.owner())) c = this.theme.allyColor();
    }
    // Ensure single leading '#'
    const raw = c.toHex().replace(/^#/, "").toLowerCase();
    return `#${raw}`;
  }

  private updateLabels() {
    // Clear existing labels
    this.labelContainer.removeChildren();

    // 1) If hovering a structure, show its levels ABOVE (existing behavior)
    const unit = this.hoveredStructure;
    if (unit && unit.type() !== UnitType.Construction) {
      const levels = this.structureLevels.get(unit.id());
      if (levels) {
        const tile = unit.tile();
        const worldX = this.game.x(tile);
        const worldY = this.game.y(tile);
        const screenPos = this.transformHandler.worldToScreenCoordinates(
          new Cell(worldX, worldY),
        );
        const shape: BgShape =
          STRUCTURE_BG_SHAPES[unit.type() as UnitType] ?? "circle";
        const iconDim = ICON_SIZES[shape] ?? ICON_SIZE;
        // Use icon scale for positioning relative to icon size, but compute
        // label sizing using a complementary scale that ignores the texture
        // quality downscale applied to sprites so zoom behavior matches.
        const iconScale = this.iconScreenScale();
        const labelScale = iconScale * ICON_TEXTURE_QUALITY;

        const baseColorStr = this.relationshipColorHexStr(unit); // "#RRGGBB"
        const baseRaw = baseColorStr.replace(/^#/, "");
        const secondaryRaw = colord(`#${baseRaw}`)
          .desaturate(0.2)
          .lighten(0.35)
          .toHex()
          .replace(/^#/, "");
        const baseFill = parseInt(baseRaw, 16);
        const secondaryFill = parseInt(secondaryRaw, 16);
        // Shrink level indicator by 50%
        const fontSize = Math.round(iconDim * labelScale * 0.275);
        const stylePrimary = new PIXI.TextStyle({
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          fontSize,
          fontWeight: "600",
          fill: baseFill,
          align: "center",
        });
        const styleSecondary = new PIXI.TextStyle({
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          fontSize,
          fontWeight: "600",
          fill: secondaryFill,
          align: "center",
        });

        const tPrimary = new PIXI.Text(String(levels.primary), stylePrimary);
        const showSecondary = (levels.secondary ?? 0) > 0;
        const tSecondary = showSecondary
          ? new PIXI.Text(String(levels.secondary), styleSecondary)
          : null;
        const gap = Math.round(fontSize * 0.4);
        const paddingX = Math.round(fontSize * 0.5);
        const paddingY = Math.round(fontSize * 0.35);
        const contentWidth = showSecondary
          ? tPrimary.width + (tSecondary?.width ?? 0) + gap
          : tPrimary.width;
        const contentHeight = showSecondary
          ? Math.max(tPrimary.height, tSecondary!.height)
          : tPrimary.height;
        const pillWidth = contentWidth + paddingX * 2;
        const pillHeight = contentHeight + paddingY * 2;
        const bg = new PIXI.Graphics();
        const bgX = Math.round(screenPos.x - pillWidth / 2);
        const bgY = Math.round(
          screenPos.y -
            (iconDim * labelScale) / 2 -
            pillHeight -
            Math.round(1 * labelScale),
        );
        bg.roundRect(
          bgX,
          bgY,
          pillWidth,
          pillHeight,
          Math.min(14, fontSize),
        ).fill({
          color: 0x000000,
          alpha: 0.55,
        });
        this.labelContainer.addChild(bg);
        if (showSecondary && tSecondary) {
          tPrimary.x = bgX + paddingX;
          tPrimary.y = bgY + Math.round((pillHeight - tPrimary.height) / 2);
          tSecondary.x = tPrimary.x + tPrimary.width + gap;
          tSecondary.y = bgY + Math.round((pillHeight - tSecondary.height) / 2);
          this.labelContainer.addChild(tPrimary, tSecondary);
        } else {
          tPrimary.x = bgX + Math.round((pillWidth - tPrimary.width) / 2);
          tPrimary.y = bgY + Math.round((pillHeight - tPrimary.height) / 2);
          this.labelContainer.addChild(tPrimary);
        }
      }
    }

    // 2) In upgrade mode, show UPGRADE PRICE BELOW for all upgradeable structures owned by me
    if (this.upgradeMode) {
      const me = this.game.myPlayer();
      if (me) {
        // Style for price labels
        const priceFontSizeBase = 12;
        for (const r of this.renders) {
          const u = r.unit;
          if (!u.isActive()) continue;
          if (u.owner() !== me) continue;
          if (!this.isUpgradeableStructure(u)) continue;

          const tile = u.tile();
          const worldX = this.game.x(tile);
          const worldY = this.game.y(tile);
          const screenPos = this.transformHandler.worldToScreenCoordinates(
            new Cell(worldX, worldY),
          );
          const shape: BgShape =
            STRUCTURE_BG_SHAPES[u.type() as UnitType] ?? "circle";
          const iconDim = ICON_SIZES[shape] ?? ICON_SIZE;
          const iconScale = this.iconScreenScale();
          const labelScale = iconScale * ICON_TEXTURE_QUALITY;

          // Shrink cost indicator by 50%
          const fontSize = Math.round(iconDim * labelScale * 0.25);
          // Use green (self relationship color) only when affordable; otherwise white
          const baseColorStr = this.relationshipColorHexStr(u); // "#RRGGBB" (self => green)
          const baseRaw = baseColorStr.replace(/^#/, "");
          const baseFill = parseInt(baseRaw, 16);
          const affordable = this.canAffordUpgradeForType(u.type());
          const fillColor = affordable ? baseFill : 0xffffff;
          const style = new PIXI.TextStyle({
            fontFamily:
              "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            fontSize,
            fontWeight: "600",
            fill: fillColor,
            align: "center",
          });
          const priceText = this.formatGoldCompact(
            this.computeUpgradeCostForType(u.type()),
          );
          const t = new PIXI.Text(priceText, style);

          const paddingX = Math.round(fontSize * 0.5);
          const paddingY = Math.round(fontSize * 0.35);
          const pillWidth = t.width + paddingX * 2;
          const pillHeight = t.height + paddingY * 2;
          const bg = new PIXI.Graphics();
          // Nudge even closer to icon (further up)
          const gapBelow = Math.round(1 * labelScale);
          const bgX = Math.round(screenPos.x - pillWidth / 2);
          const bgY = Math.round(
            screenPos.y + (iconDim * labelScale) / 2 + gapBelow,
          );
          bg.roundRect(
            bgX,
            bgY,
            pillWidth,
            pillHeight,
            Math.min(14, fontSize),
          ).fill({
            color: 0x000000,
            alpha: 0.55,
          });
          this.labelContainer.addChild(bg);
          t.x = bgX + Math.round((pillWidth - t.width) / 2);
          t.y = bgY + Math.round((pillHeight - t.height) / 2);
          this.labelContainer.addChild(t);
        }
      }
    }

    // 3) In bomber upgrade mode, show UPGRADE PRICE BELOW for all eligible airfields owned by me
    if (this.bomberUpgradeMode) {
      const me = this.game.myPlayer();
      if (me) {
        for (const r of this.renders) {
          const u = r.unit;
          if (!u.isActive()) continue;
          if (u.owner() !== me) continue;
          if (u.type() !== UnitType.Airfield) continue;
          if (!this.isEligibleForBomberUpgrade(u)) continue;

          const tile = u.tile();
          const worldX = this.game.x(tile);
          const worldY = this.game.y(tile);
          const screenPos = this.transformHandler.worldToScreenCoordinates(
            new Cell(worldX, worldY),
          );
          const shape: BgShape =
            STRUCTURE_BG_SHAPES[u.type() as UnitType] ?? "circle";
          const iconDim = ICON_SIZES[shape] ?? ICON_SIZE;
          const iconScale = this.iconScreenScale();
          const labelScale = iconScale * ICON_TEXTURE_QUALITY;

          // Shrink cost indicator by 50%
          const fontSize = Math.round(iconDim * labelScale * 0.25);
          // Use orange/amber for bomber upgrades when affordable; otherwise white
          const affordable = this.canAffordBomberUpgrade(u);
          const fillColor = affordable ? 0xffa500 : 0xffffff;
          const style = new PIXI.TextStyle({
            fontFamily:
              "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            fontSize,
            fontWeight: "600",
            fill: fillColor,
            align: "center",
          });
          const priceText = this.formatGoldCompact(
            this.computeBomberUpgradeCost(u),
          );
          const t = new PIXI.Text(priceText, style);

          const paddingX = Math.round(fontSize * 0.5);
          const paddingY = Math.round(fontSize * 0.35);
          const pillWidth = t.width + paddingX * 2;
          const pillHeight = t.height + paddingY * 2;
          const bg = new PIXI.Graphics();
          // Nudge even closer to icon (further up)
          const gapBelow = Math.round(1 * labelScale);
          const bgX = Math.round(screenPos.x - pillWidth / 2);
          const bgY = Math.round(
            screenPos.y + (iconDim * labelScale) / 2 + gapBelow,
          );
          bg.roundRect(
            bgX,
            bgY,
            pillWidth,
            pillHeight,
            Math.min(14, fontSize),
          ).fill({
            color: 0x000000,
            alpha: 0.55,
          });
          this.labelContainer.addChild(bg);
          t.x = bgX + Math.round((pillWidth - t.width) / 2);
          t.y = bgY + Math.round((pillHeight - t.height) / 2);
          this.labelContainer.addChild(t);
        }
      }
    }

    // Request redraw after rebuilding labels
    this.shouldRedraw = true;
    if (this.renderer) {
      this.renderer.render(this.stage);
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
    // Clean up health and loading bars
    if (render.healthBarGraphics) {
      render.healthBarGraphics.destroy();
      render.healthBarGraphics = null;
    }
    if (render.loadingBarGraphics) {
      render.loadingBarGraphics.destroy();
      render.loadingBarGraphics = null;
    }
    this.renders = this.renders.filter((r) => r.unit !== render.unit);
    this.seenUnits.delete(render.unit);
  }

  private updateHealthBar(render: StructureRenderInfo) {
    const unit = render.unit;

    // Get max health from centralized calculation
    const maxHealth = unit.effectiveMaxHealth();
    if (!maxHealth) return; // No health for this unit type

    // Only show health bar if damaged and active
    if (!unit.isActive() || unit.health() >= maxHealth || unit.health() <= 0) {
      if (render.healthBarGraphics) {
        render.healthBarGraphics.destroy();
        render.healthBarGraphics = null;
        this.shouldRedraw = true;
      }
      return;
    }

    // Create or update health bar
    if (!render.healthBarGraphics) {
      render.healthBarGraphics = new PIXI.Graphics();
      this.stage.addChild(render.healthBarGraphics);
    }

    const graphics = render.healthBarGraphics;
    graphics.clear();

    // Get the structure's icon size and scale
    const unitType =
      unit.type() === UnitType.Construction
        ? unit.constructionType()
        : unit.type();
    const shape: BgShape =
      unitType !== undefined
        ? (STRUCTURE_BG_SHAPES[unitType as UnitType] ?? "circle")
        : "circle";
    const iconDim = ICON_SIZES[shape] ?? ICON_SIZE;
    const spriteScale = render.pixiSprite.scale.x; // Assumes uniform scaling
    const scaledIconSize = iconDim * spriteScale;

    // Bar dimensions scale with the icon (doubled size)
    const barWidth = scaledIconSize * 3; // 160% of icon width (doubled from 80%)
    const barHeight = scaledIconSize * 0.3; // ~16% of icon height (doubled from 8%), min 4px
    const gap = scaledIconSize * 1.8; // Gap scales with icon size (50% of icon size)
    const yOffset = -(scaledIconSize / 2 + barHeight + gap);

    // Position relative to sprite center
    graphics.x = render.pixiSprite.x;
    graphics.y = render.pixiSprite.y + yOffset;

    // Background (black border)
    graphics.beginFill(0x000000, 1);
    graphics.drawRect(-barWidth / 2 - 1, -1, barWidth + 2, barHeight + 2);
    graphics.endFill();

    // Health fill (color based on health percentage)
    const healthPercent = unit.health() / maxHealth;
    const colors = [0xe81919, 0xf07a19, 0xcae70f, 0x2cef12]; // red, orange, yellow, green
    const colorIndex = Math.min(
      colors.length - 1,
      Math.floor(healthPercent * colors.length),
    );
    const fillColor = colors[colorIndex];

    graphics.beginFill(fillColor, 1);
    graphics.drawRect(
      -barWidth / 2,
      0,
      Math.max(1, healthPercent * barWidth),
      barHeight,
    );
    graphics.endFill();

    graphics.visible = render.isOnScreen;
    this.shouldRedraw = true;
  }

  private updateLoadingBar(render: StructureRenderInfo) {
    const unit = render.unit;

    // Only show loading bar for structures on cooldown
    if (
      !unit.isActive() ||
      !unit.isCooldown() ||
      (unit.type() !== UnitType.MissileSilo &&
        unit.type() !== UnitType.SAMLauncher)
    ) {
      if (render.loadingBarGraphics) {
        render.loadingBarGraphics.destroy();
        render.loadingBarGraphics = null;
        this.shouldRedraw = true;
      }
      return;
    }

    // Create or update loading bar
    if (!render.loadingBarGraphics) {
      render.loadingBarGraphics = new PIXI.Graphics();
      this.stage.addChild(render.loadingBarGraphics);
    }

    const graphics = render.loadingBarGraphics;
    graphics.clear();

    // Get the structure's icon size and scale
    const unitType =
      unit.type() === UnitType.Construction
        ? unit.constructionType()
        : unit.type();
    const shape: BgShape =
      unitType !== undefined
        ? (STRUCTURE_BG_SHAPES[unitType as UnitType] ?? "circle")
        : "circle";
    const iconDim = ICON_SIZES[shape] ?? ICON_SIZE;
    const spriteScale = render.pixiSprite.scale.x; // Assumes uniform scaling
    const scaledIconSize = iconDim * spriteScale;

    // Bar dimensions scale with the icon (same as health bar)
    const barWidth = scaledIconSize * 3; // 300% of icon width
    const barHeight = scaledIconSize * 0.3; // 30% of icon height, min 4px
    const gap = scaledIconSize * 1.8;
    const yOffset = scaledIconSize / 2 + barHeight + gap; // Below the icon with scaled gap

    // Position relative to sprite center
    graphics.x = render.pixiSprite.x;
    graphics.y = render.pixiSprite.y + yOffset;

    // Calculate progress using cooldownEndsAt (authoritative field)
    const totalCooldown =
      unit.type() === UnitType.MissileSilo
        ? (unit.cooldownDuration() ?? this.game.config().SiloCooldown())
        : (unit.cooldownDuration() ?? this.game.config().SAMNukeCooldown());
    const endsAt = unit.cooldownEndsAt();
    const currentTick = this.game.ticks();

    // Progress from 0 (just started) to 1 (ready)
    const startTick = endsAt ? endsAt - totalCooldown : currentTick;
    const elapsed = currentTick - startTick;
    const progress = Math.min(1, Math.max(0, elapsed / totalCooldown));

    // Background (black border)
    graphics.beginFill(0x000000, 1);
    graphics.drawRect(-barWidth / 2 - 1, -1, barWidth + 2, barHeight + 2);
    graphics.endFill();

    // Progress fill (color based on progress)
    const colors = [0xe81919, 0xf07a19, 0xcae70f, 0x2cef12]; // red, orange, yellow, green
    const colorIndex = Math.min(
      colors.length - 1,
      Math.floor(progress * colors.length),
    );
    const fillColor = colors[colorIndex];

    graphics.beginFill(fillColor, 1);
    graphics.drawRect(
      -barWidth / 2,
      0,
      Math.max(1, progress * barWidth),
      barHeight,
    );
    graphics.endFill();

    graphics.visible = render.isOnScreen;
    this.shouldRedraw = true;
  }
}
