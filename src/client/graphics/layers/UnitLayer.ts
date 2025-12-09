import type { Colord } from "colord";
import { colord } from "colord";
import type { EventBus } from "../../../core/EventBus";
import type { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import type { TileRef } from "../../../core/game/GameMap";
import type { GameView, UnitView } from "../../../core/game/GameView";
import { BezenhamLine } from "../../../core/utilities/Line";
import {
  AlternateViewEvent,
  MouseUpEvent,
  ReplaySpeedChangeEvent,
  UnitSelectionEvent,
} from "../../InputHandler";
import {
  MoveFighterJetIntentEvent,
  MoveSubmarineIntentEvent,
  MoveWarshipIntentEvent,
} from "../../Transport";
import { PerformanceMetrics } from "../../utilities/PerformanceMetrics";
import type { ReplaySpeedMultiplier } from "../../utilities/ReplaySpeedMultiplier";
import { defaultReplaySpeedMultiplier } from "../../utilities/ReplaySpeedMultiplier";
import type { TransformHandler } from "../TransformHandler";
import type { UIState } from "../UIState";
import type { Layer } from "./Layer";

import { GameUpdateType } from "../../../core/game/GameUpdates";
import {
  getColoredSprite,
  isSpriteReady,
  loadAllSprites,
} from "../SpriteLoader";

enum Relationship {
  Self,
  Ally,
  Enemy,
}

// Unit types that should be rendered by UnitLayer.
// This excludes structures, constructions, and other types handled by specific layers.
const UNIT_LAYER_TYPES = new Set<UnitType>([
  UnitType.TransportShip,
  UnitType.Paratrooper,
  UnitType.Submarine,
  UnitType.Warship,
  UnitType.Shell,
  UnitType.SAMMissile,
  UnitType.TradeShip,
  UnitType.CargoPlane,
  UnitType.MIRVWarhead,
  UnitType.Bomber,
  UnitType.FighterJet,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
]);

export class UnitLayer implements Layer {
  layerName = "UnitLayer";
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private transportShipTrailCanvas: HTMLCanvasElement;
  private unitTrailContext: CanvasRenderingContext2D;
  private interpolationCanvas: HTMLCanvasElement;
  private interpolationContext: CanvasRenderingContext2D;

  private unitToTrail = new Map<UnitView, TileRef[]>();

  private unitToLastAngle = new Map<UnitView, number>();

  private theme: Theme;

  private alternateView = false;

  private oldShellTile = new Map<UnitView, TileRef>();

  private transformHandler: TransformHandler;

  // Selected unit property as suggested in the review comment
  private selectedUnit: UnitView | null = null;

  // Configuration for unit selection
  private readonly WARSHIP_SELECTION_RADIUS = 10; // Radius in game cells for warship selection hit zone
  private readonly SUBMARINE_SELECTION_RADIUS = 10;
  private readonly FIGHTER_JET_SELECTION_RADIUS = 10;

  // Indicates we're in the base-canvas draw pass (used to suppress double-draw)
  private drawingBasePass = false;

  // Unit types that should be interpolated between ticks
  private readonly interpolatedUnitTypes: UnitType[] = [
    UnitType.SAMMissile,
    UnitType.AtomBomb,
    UnitType.HydrogenBomb,
    UnitType.MIRV,
    UnitType.MIRVWarhead,
    UnitType.Shell,
    // AABullet is rendered by AABulletLayer using PIXI
    UnitType.Warship,
    UnitType.TransportShip,
    UnitType.TradeShip,
    UnitType.Submarine,
    UnitType.Bomber,
    UnitType.FighterJet,
    UnitType.CargoPlane,
  ];

  private baseTickIntervalMs = 100;
  private tickIntervalMs = 100;
  private replaySpeedMultiplier: ReplaySpeedMultiplier =
    defaultReplaySpeedMultiplier;
  private lastTickTimestamp = 0;

  // Cache sprite sizes per UnitType to avoid repeated lookups when clearing
  private spriteSizeCache = new Map<UnitType, number>();

  private renderedGhosts = new Map<number, TileRef>();
  private renderedUnits = new Map<number, UnitView>();

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    transformHandler: TransformHandler,
    private uiState: UIState,
  ) {
    this.theme = game.config().theme();
    this.transformHandler = transformHandler;
    this.baseTickIntervalMs = this.game
      .config()
      .serverConfig()
      .turnIntervalMs();
    this.updateTickInterval();
    this.lastTickTimestamp = this.now();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    this.lastTickTimestamp = this.now();
    const configuredInterval = this.game
      .config()
      .serverConfig()
      .turnIntervalMs();
    if (configuredInterval !== this.baseTickIntervalMs) {
      this.baseTickIntervalMs = configuredInterval;
      this.updateTickInterval();
    }
    const unitIds = this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => unit.id);

    this.updateUnitsSprites(unitIds ?? []);

    // Sweep for zombies (units that are inactive but weren't in the update list)
    // This fixes the issue where visible entities count > total entities
    const zombieIds: number[] = [];
    for (const [id, unit] of this.renderedUnits) {
      if (!unit.isActive()) {
        zombieIds.push(id);
      }
    }
    if (zombieIds.length > 0) {
      this.updateUnitsSprites(zombieIds);
    }

    this.updateGhosts();
  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => this.onAlternativeViewEvent(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(UnitSelectionEvent, (e) => this.onUnitSelectionChange(e));
    this.eventBus.on(ReplaySpeedChangeEvent, (e) =>
      this.onReplaySpeedChange(e.replaySpeedMultiplier),
    );
    this.redraw();

    loadAllSprites();
  }

  /**
   * Find player-owned warships near the given cell within a configurable radius
   * @param cell The cell to check
   * @returns Array of player's warships in range, sorted by distance (closest first)
   */
  private findWarshipsNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      // The cell coordinate were invalid (user probably clicked outside the map), therefore no warships can be found
      return [];
    }
    const clickRef = this.game.ref(cell.x, cell.y);

    // Only select warships owned by the player
    return this.game
      .units(UnitType.Warship)
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === this.game.myPlayer() && // Only allow selecting own warships
          this.game.manhattanDist(unit.tile(), clickRef) <=
            this.WARSHIP_SELECTION_RADIUS,
      )
      .sort((a, b) => {
        // Sort by distance (closest first)
        const distA = this.game.manhattanDist(a.tile(), clickRef);
        const distB = this.game.manhattanDist(b.tile(), clickRef);
        return distA - distB;
      });
  }

  private findSubmarinesNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return [];
    }
    const clickRef = this.game.ref(cell.x, cell.y);

    return this.game
      .units(UnitType.Submarine) // <-- Change this line
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === this.game.myPlayer() &&
          this.game.manhattanDist(unit.tile(), clickRef) <=
            this.SUBMARINE_SELECTION_RADIUS, // <-- Change this line
      )
      .sort((a, b) => {
        const distA = this.game.manhattanDist(a.tile(), clickRef);
        const distB = this.game.manhattanDist(b.tile(), clickRef);
        return distA - distB;
      });
  }

  private findFighterJetsNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return [];
    }
    const clickRef = this.game.ref(cell.x, cell.y);

    return this.game
      .units(UnitType.FighterJet)
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === this.game.myPlayer() &&
          this.game.manhattanDist(unit.tile(), clickRef) <=
            this.FIGHTER_JET_SELECTION_RADIUS,
      )
      .sort((a, b) => {
        const distA = this.game.manhattanDist(a.tile(), clickRef);
        const distB = this.game.manhattanDist(b.tile(), clickRef);
        return distA - distB;
      });
  }

  private onMouseUp(event: MouseUpEvent) {
    // Convert screen coordinates to world coordinates
    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );

    // Find warships near this cell, sorted by distance
    const nearbyWarships = this.findWarshipsNearCell(cell);
    const nearbySubmarines = this.findSubmarinesNearCell(cell);
    const nearbyFighterJets = this.findFighterJetsNearCell(cell);

    // unit upgrade mode removed: proceed with selection/move logic only

    if (this.selectedUnit) {
      const clickRef = this.game.ref(cell.x, cell.y);
      if (this.selectedUnit.type() === UnitType.FighterJet) {
        this.eventBus.emit(
          new MoveFighterJetIntentEvent(this.selectedUnit.id(), clickRef),
        );
      } else if (
        this.selectedUnit.type() === UnitType.Warship &&
        this.game.isOcean(clickRef)
      ) {
        this.eventBus.emit(
          new MoveWarshipIntentEvent(this.selectedUnit.id(), clickRef),
        );
      } else if (
        this.selectedUnit.type() === UnitType.Submarine &&
        this.game.isOcean(clickRef)
      ) {
        this.eventBus.emit(
          new MoveSubmarineIntentEvent(this.selectedUnit.id(), clickRef),
        );
      }
      // Mark click as consumed whenever a unit was selected, so other handlers don't also treat it as an attack
      event.consumed = true;
      // Deselect
      this.eventBus.emit(new UnitSelectionEvent(this.selectedUnit, false));
      return;
    } else if (nearbyWarships.length > 0) {
      // Toggle selection of the closest warship
      const clickedUnit = nearbyWarships[0];
      this.eventBus.emit(new UnitSelectionEvent(clickedUnit, true));
    } else if (nearbySubmarines.length > 0) {
      // Toggle selection of the closest submarine
      const clickedUnit = nearbySubmarines[0];
      this.eventBus.emit(new UnitSelectionEvent(clickedUnit, true));
    } else if (nearbyFighterJets.length > 0) {
      const clickedUnit = nearbyFighterJets[0];
      this.eventBus.emit(new UnitSelectionEvent(clickedUnit, true));
    }
  }

  /**
   * Handle unit selection changes
   */
  private onUnitSelectionChange(event: UnitSelectionEvent) {
    if (event.isSelected) {
      this.selectedUnit = event.unit;
    } else if (this.selectedUnit === event.unit) {
      this.selectedUnit = null;
    }
  }

  /**
   * Handle unit deactivation or destruction
   * If the selected unit is removed from the game, deselect it
   */
  private handleUnitDeactivation(unit: UnitView) {
    if (this.selectedUnit === unit && !unit.isActive()) {
      this.eventBus.emit(new UnitSelectionEvent(unit, false));
    }
    this.unitToLastAngle.delete(unit);
  }

  renderLayer(context: CanvasRenderingContext2D) {
    this.updateInterpolatedUnits();
    PerformanceMetrics.getInstance().incrementVisibleEntities(
      this.renderedUnits.size,
    );
    context.drawImage(
      this.transportShipTrailCanvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    if (this.interpolationCanvas) {
      context.drawImage(
        this.interpolationCanvas,
        -this.game.width() / 2,
        -this.game.height() / 2,
        this.game.width(),
        this.game.height(),
      );
    }
  }

  onAlternativeViewEvent(event: AlternateViewEvent) {
    this.alternateView = event.alternateView;
    this.redraw();
  }

  redraw() {
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.transportShipTrailCanvas = document.createElement("canvas");
    const trailContext = this.transportShipTrailCanvas.getContext("2d");
    if (trailContext === null) throw new Error("2d context not supported");
    this.unitTrailContext = trailContext;
    this.interpolationCanvas = document.createElement("canvas");
    const interpolationContext = this.interpolationCanvas.getContext("2d");
    if (interpolationContext === null)
      throw new Error("2d context not supported");
    this.interpolationContext = interpolationContext;
    this.interpolationContext.imageSmoothingEnabled = false;

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.transportShipTrailCanvas.width = this.game.width();
    this.transportShipTrailCanvas.height = this.game.height();
    this.interpolationCanvas.width = this.game.width();
    this.interpolationCanvas.height = this.game.height();

    this.renderedUnits.clear();
    const units = this.game.units();
    units.forEach((u) => {
      if (UNIT_LAYER_TYPES.has(u.type())) {
        this.renderedUnits.set(u.id(), u);
      }
    });
    this.updateUnitsSprites(units.map((unit) => unit.id()));

    // After redrawing units, render submarine ghosts (last known positions)
    this.renderedGhosts.clear();
    const ghosts = (this.game as any).submarineGhosts?.call(this.game) ?? [];
    for (const ghost of ghosts as Array<{
      id: number;
      pos: number;
      expiresAt: number;
      ownerID: number;
    }>) {
      this.drawGhost(ghost);
      this.renderedGhosts.set(ghost.id, ghost.pos);
    }

    this.unitToTrail.forEach((trail, unit) => {
      for (const t of trail) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          this.relationship(unit),
          this.theme.territoryColor(unit.owner()),
          150,
          this.unitTrailContext,
        );
      }
    });
  }

  private updateUnitsSprites(unitIds: number[]) {
    const unitsToUpdate: UnitView[] = [];
    const unitsToRemove: UnitView[] = [];

    if (unitIds) {
      for (const id of unitIds) {
        const unit = this.game.unit(id);
        if (unit) {
          if (UNIT_LAYER_TYPES.has(unit.type())) {
            unitsToUpdate.push(unit);
            this.renderedUnits.set(id, unit);
          }
        } else {
          const removed = this.renderedUnits.get(id);
          if (removed) {
            unitsToRemove.push(removed);
            this.renderedUnits.delete(id);
          }
        }
      }
    }

    const allUnitsToClear = [...unitsToUpdate, ...unitsToRemove];

    if (allUnitsToClear.length > 0) {
      const oldAngleByUnit = new Map<UnitView, number | null>();
      for (const u of allUnitsToClear) {
        oldAngleByUnit.set(u, this.unitToLastAngle.get(u) ?? null);
      }

      // Precompute angles once per unit to avoid duplicate work across passes
      const angleByUnit = new Map<UnitView, number | null>();
      for (const u of unitsToUpdate) {
        // Only aircraft currently use angles; others will return null quickly
        angleByUnit.set(u, this.getUnitAngle(u));
      }

      // the clearing and drawing of unit sprites need to be done in 2 passes
      // otherwise the sprite of a unit can be drawn on top of another unit
      this.clearUnitsCells(allUnitsToClear, oldAngleByUnit);
      this.drawUnitsCells(unitsToUpdate, angleByUnit);

      // Handle deactivation for removed units
      for (const u of unitsToRemove) {
        this.handleUnitDeactivation(u);
      }
    }
  }

  private clearUnitsCells(
    unitViews: UnitView[],
    angleByUnit: Map<UnitView, number | null>,
  ) {
    unitViews
      .filter((unitView) => isSpriteReady(unitView.type()))
      .forEach((unitView) => {
        // Compute the same geometry used during draw to clear sprite + dot overlays
        const spriteSize = this.getSpriteSize(unitView);
        const sizeMult = this.effectiveSizeMultiplier(unitView);
        const newWidth = spriteSize * sizeMult;
        const newHeight = spriteSize * sizeMult;

        // Badge overlay parameters: badge sits 1px outside top-right
        const level = (unitView as any).level ? (unitView as any).level() : 1;
        const badgeSize = Math.max(2, Math.min(3, Math.round(newWidth * 0.18)));
        const offset = 1;
        const overlayTop = badgeSize + offset; // extend upwards to cover outside badge
        const extraRight = badgeSize + offset; // full right-side extension beyond sprite

        const padding = 2; // small safety margin around computed bounds
        const maxHalfWidth = newWidth / 2 + extraRight;
        const lastX = this.game.x(unitView.lastTile());
        const lastY = this.game.y(unitView.lastTile());
        const angle = angleByUnit.get(unitView) ?? null;
        if (angle !== null) {
          this.context.save();
          this.context.translate(lastX, lastY);
          this.context.rotate(angle);
          this.context.translate(-lastX, -lastY);
        }

        // Clear an axis-aligned box in the rotated space that covers the sprite and the dots above
        const left = lastX - maxHalfWidth - padding;
        const top = lastY - newHeight / 2 - overlayTop - padding;
        const width = maxHalfWidth * 2 + padding * 2;
        const height = newHeight + overlayTop + padding * 2;
        this.context.clearRect(left, top, width, height);

        if (angle !== null) {
          this.context.restore();
        }
      });
  }

  private drawUnitsCells(
    unitViews: UnitView[],
    angleByUnit: Map<UnitView, number | null>,
  ) {
    // Suppress base-canvas sprites for units that are also drawn via interpolation overlay
    this.drawingBasePass = true;
    try {
      unitViews.forEach((unitView) => this.onUnitEvent(unitView, angleByUnit));
    } finally {
      this.drawingBasePass = false;
    }
  }

  private interpolatePosition(unit: UnitView, alpha: number) {
    const startTile = unit.lastTile();
    const endTile = unit.tile();

    const startX = this.game.x(startTile);
    const startY = this.game.y(startTile);
    const endX = this.game.x(endTile);
    const endY = this.game.y(endTile);

    return {
      x: startX + (endX - startX) * alpha,
      y: startY + (endY - startY) * alpha,
    };
  }

  private updateInterpolatedUnits() {
    if (!this.interpolationContext || !this.interpolationCanvas) {
      return;
    }

    this.interpolationContext.clearRect(
      0,
      0,
      this.interpolationCanvas.width,
      this.interpolationCanvas.height,
    );

    const alpha = this.computeTickAlpha();
    const units = this.game.units(...this.interpolatedUnitTypes);

    for (const unit of units) {
      if (!unit.isActive()) {
        continue;
      }

      // Hide bombers at their airfield
      if (unit.type() === UnitType.Bomber) {
        const airfieldAtSamePos = this.game
          .units(UnitType.Airfield)
          .find(
            (a) =>
              a.owner() === unit.owner() &&
              a.tile() === unit.tile() &&
              a.isActive(),
          );
        if (airfieldAtSamePos) {
          continue; // Skip rendering this bomber
        }
      }

      // Respect submarine visibility rules from onUnitEvent
      if (
        unit.type() === UnitType.Submarine &&
        unit.owner() !== this.game.myPlayer()
      ) {
        // Server handles visibility filtering.
      }

      // Skip AABullets - they're rendered by AABulletLayer
      if (unit.type() === UnitType.AABullet) {
        continue;
      }

      const position = this.interpolatePosition(unit, alpha);

      switch (unit.type()) {
        case UnitType.Shell:
          this.renderShell(unit, position);
          continue;
        case UnitType.MIRVWarhead:
          this.renderWarhead(unit, position);
          continue;
        default:
          if (!isSpriteReady(unit.type())) {
            continue;
          }
          this.drawSpriteAtPosition(
            unit,
            position,
            this.getInterpolatedSpriteColor(unit),
            this.interpolationContext,
            true,
          );
      }
    }
  }

  private getInterpolatedSpriteColor(unit: UnitView): Colord | undefined {
    if (unit.targetUnitId()) {
      if (
        unit.type() === UnitType.Warship ||
        unit.type() === UnitType.FighterJet
      ) {
        return colord("rgb(200,0,0)");
      }
    }
    return undefined;
  }

  private renderShell(unit: UnitView, position: { x: number; y: number }) {
    const rel = this.relationship(unit);
    const color = this.theme.borderColor(unit.owner());
    this.drawInterpolatedSquare(position, rel, color, 1, 1);
    this.drawInterpolatedSquare(position, rel, color, 2, 0.4);

    const last = {
      x: this.game.x(unit.lastTile()),
      y: this.game.y(unit.lastTile()),
    };
    if (last.x !== position.x || last.y !== position.y) {
      this.drawInterpolatedSegment(last, position, rel, color, 0.7);
    }
  }

  private renderWarhead(unit: UnitView, position: { x: number; y: number }) {
    const rel = this.relationship(unit);
    const color = this.theme.borderColor(unit.owner());
    this.drawInterpolatedSquare(position, rel, color, 1, 1);
    this.drawInterpolatedSquare(position, rel, color, 2, 0.35);

    const last = {
      x: this.game.x(unit.lastTile()),
      y: this.game.y(unit.lastTile()),
    };
    if (last.x !== position.x || last.y !== position.y) {
      this.drawInterpolatedSegment(last, position, rel, color, 0.5);
    }
  }

  private drawInterpolatedSquare(
    position: { x: number; y: number },
    relationship: Relationship,
    color: Colord,
    size: number,
    alpha: number,
  ) {
    if (!this.interpolationContext) {
      return;
    }
    const ctx = this.interpolationContext;
    ctx.fillStyle = this.resolveInterpolatedColor(relationship, color, alpha);
    ctx.fillRect(position.x - size / 2, position.y - size / 2, size, size);
  }

  private drawInterpolatedSegment(
    start: { x: number; y: number },
    end: { x: number; y: number },
    relationship: Relationship,
    color: Colord,
    alpha: number,
  ) {
    if (!this.interpolationContext) {
      return;
    }
    const ctx = this.interpolationContext;
    ctx.strokeStyle = this.resolveInterpolatedColor(relationship, color, alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  private resolveInterpolatedColor(
    relationship: Relationship,
    color: Colord,
    alpha: number,
  ): string {
    if (this.alternateView) {
      return this.getAlternateViewColor(relationship)
        .alpha(alpha)
        .toRgbString();
    }
    return color.alpha(alpha).toRgbString();
  }

  private getAlternateViewColor(relationship: Relationship): Colord {
    switch (relationship) {
      case Relationship.Self:
        return this.theme.selfColor();
      case Relationship.Ally:
        return this.theme.allyColor();
      case Relationship.Enemy:
      default:
        return this.theme.enemyColor();
    }
  }

  private relationship(unit: UnitView): Relationship {
    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) {
      return Relationship.Enemy;
    }
    if (myPlayer === unit.owner()) {
      return Relationship.Self;
    }
    if (myPlayer.isFriendly(unit.owner())) {
      return Relationship.Ally;
    }
    return Relationship.Enemy;
  }

  onUnitEvent(unit: UnitView, angleByUnit?: Map<UnitView, number | null>) {
    // Check if unit was deactivated
    if (!unit.isActive()) {
      this.handleUnitDeactivation(unit);
    }

    // Hide bombers at their airfield
    if (unit.type() === UnitType.Bomber) {
      const airfieldAtSamePos = this.game
        .units(UnitType.Airfield)
        .find(
          (a) =>
            a.owner() === unit.owner() &&
            a.tile() === unit.tile() &&
            a.isActive(),
        );
      if (airfieldAtSamePos) {
        return; // Skip rendering this bomber
      }
    }

    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() !== this.game.myPlayer()
    ) {
      // Server handles visibility filtering (including linger time).
      // If we receive an update for an enemy sub, it should be visible.
      // We trust the server's judgment here to avoid client-side lag when linger is active.
    }

    // START: Custom rendering for owner's submarine visibility
    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() === this.game.myPlayer()
    ) {
      const isAttacking = unit.isAttacking();
      const isDetected = unit.isDetectedByNavalUnit();
      const isOnCooldown = unit.isCooldown();
      const isVisibleToEnemies = isAttacking || isDetected || isOnCooldown;
      if (!isVisibleToEnemies) {
        this.drawSprite(unit, undefined, 0.75);
        return;
      }
    }
    // END: Custom rendering

    switch (unit.type()) {
      case UnitType.TransportShip:
      case UnitType.Paratrooper:
        this.handleBoatEvent(unit);
        break;
      case UnitType.Submarine:
      case UnitType.Warship:
        this.handleWarShipEvent(unit, angleByUnit);
        break;
      case UnitType.Shell:
        this.handleShellEvent(unit);
        break;
      // AABullet is handled by AABulletLayer
      case UnitType.SAMMissile:
        this.handleMissileEvent(unit);
        break;
      case UnitType.TradeShip:
        this.handleTradeShipEvent(unit, angleByUnit);
        break;
      case UnitType.CargoPlane:
        this.handleCargoPlaneEvent(unit, angleByUnit);
        break;
      case UnitType.MIRVWarhead:
        this.handleMIRVWarhead(unit);
        break;
      case UnitType.Bomber:
        this.handleBomberEvent(unit, angleByUnit);
        break;
      case UnitType.FighterJet:
        this.handleFighterJetEvent(unit, angleByUnit);
        break;
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        this.handleNuke(unit);
        break;
    }
  }

  private handleWarShipEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    if (unit.targetUnitId()) {
      this.drawSprite(unit, colord({ r: 200, b: 0, g: 0 }), angleByUnit);
    } else {
      this.drawSprite(unit, undefined, angleByUnit);
    }
  }

  private handleShellEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    // Clear current and previous positions
    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));
    const oldTile = this.oldShellTile.get(unit);
    if (oldTile !== undefined) {
      this.clearCell(this.game.x(oldTile), this.game.y(oldTile));
    }

    this.oldShellTile.set(unit, unit.lastTile());
    if (!unit.isActive()) {
      return;
    }

    // Paint current and previous positions
    this.paintCell(
      this.game.x(unit.tile()),
      this.game.y(unit.tile()),
      rel,
      this.theme.borderColor(unit.owner()),
      255,
    );
    this.paintCell(
      this.game.x(unit.lastTile()),
      this.game.y(unit.lastTile()),
      rel,
      this.theme.borderColor(unit.owner()),
      255,
    );
  }

  // interception missle from SAM
  private handleMissileEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    this.drawSprite(unit, undefined, angleByUnit);
  }

  private drawTrail(trail: number[], color: Colord, rel: Relationship) {
    // Paint new trail
    for (const t of trail) {
      this.paintCell(
        this.game.x(t),
        this.game.y(t),
        rel,
        color,
        150,
        this.unitTrailContext,
      );
    }
  }

  private clearTrail(unit: UnitView) {
    const trail = this.unitToTrail.get(unit) ?? [];
    const rel = this.relationship(unit);
    for (const t of trail) {
      this.clearCell(this.game.x(t), this.game.y(t), this.unitTrailContext);
    }
    this.unitToTrail.delete(unit);

    // Repaint overlapping trails
    const trailSet = new Set(trail);
    for (const [other, trail] of this.unitToTrail) {
      for (const t of trail) {
        if (trailSet.has(t)) {
          this.paintCell(
            this.game.x(t),
            this.game.y(t),
            rel,
            this.theme.territoryColor(other.owner()),
            150,
            this.unitTrailContext,
          );
        }
      }
    }
  }

  private handleNuke(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    const rel = this.relationship(unit);

    if (!this.unitToTrail.has(unit)) {
      this.unitToTrail.set(unit, []);
    }

    let newTrailSize = 1;
    const trail = this.unitToTrail.get(unit) ?? [];
    // It can move faster than 1 pixel, draw a line for the trail or else it will be dotted
    if (trail.length >= 1) {
      const cur = {
        x: this.game.x(unit.lastTile()),
        y: this.game.y(unit.lastTile()),
      };
      const prev = {
        x: this.game.x(trail[trail.length - 1]),
        y: this.game.y(trail[trail.length - 1]),
      };
      const line = new BezenhamLine(prev, cur);
      let point = line.increment();
      while (point !== true) {
        trail.push(this.game.ref(point.x, point.y));
        point = line.increment();
      }
      newTrailSize = line.size();
    } else {
      trail.push(unit.lastTile());
    }

    this.drawTrail(
      trail.slice(-newTrailSize),
      this.theme.territoryColor(unit.owner()),
      rel,
    );
    this.drawSprite(unit, undefined, angleByUnit);
    if (!unit.isActive()) {
      this.clearTrail(unit);
    }
  }

  private handleMIRVWarhead(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    const rel = this.relationship(unit);

    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));

    if (unit.isActive()) {
      // Paint area
      this.paintCell(
        this.game.x(unit.tile()),
        this.game.y(unit.tile()),
        rel,
        this.theme.borderColor(unit.owner()),
        255,
      );
    }
  }

  private handleTradeShipEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    this.drawSprite(unit, undefined, angleByUnit);
  }

  private handleCargoPlaneEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    this.drawSprite(unit, undefined, angleByUnit);
  }

  private handleBomberEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    this.drawSprite(unit, undefined, angleByUnit);
  }

  private handleFighterJetEvent(
    unit: UnitView,
    angleByUnit?: Map<UnitView, number | null>,
  ) {
    if (unit.targetUnitId()) {
      this.drawSprite(unit, colord({ r: 200, b: 0, g: 0 }), angleByUnit);
    } else {
      this.drawSprite(unit, undefined, angleByUnit);
    }
  }

  private handleBoatEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    if (!this.unitToTrail.has(unit)) {
      this.unitToTrail.set(unit, []);
    }
    const trail = this.unitToTrail.get(unit) ?? [];
    trail.push(unit.lastTile());

    // Paint trail
    this.drawTrail(
      trail.slice(-1),
      this.theme.territoryColor(unit.owner()),
      rel,
    );
    this.drawSprite(unit);

    if (!unit.isActive()) {
      this.clearTrail(unit);
    }
  }

  paintCell(
    x: number,
    y: number,
    relationship: Relationship,
    color: Colord,
    alpha: number,
    context: CanvasRenderingContext2D = this.context,
  ) {
    this.clearCell(x, y, context);
    if (this.alternateView) {
      switch (relationship) {
        case Relationship.Self:
          context.fillStyle = this.theme.selfColor().toRgbString();
          break;
        case Relationship.Ally:
          context.fillStyle = this.theme.allyColor().toRgbString();
          break;
        case Relationship.Enemy:
          context.fillStyle = this.theme.enemyColor().toRgbString();
          break;
      }
    } else {
      context.fillStyle = color.alpha(alpha / 255).toRgbString();
    }
    context.fillRect(x, y, 1, 1);
  }

  clearCell(
    x: number,
    y: number,
    context: CanvasRenderingContext2D = this.context,
  ) {
    context.clearRect(x, y, 1, 1);
  }

  drawSprite(
    unit: UnitView,
    customTerritoryColor?: Colord,
    sizeMultiplier?: number,
  );
  drawSprite(
    unit: UnitView,
    customTerritoryColor?: Colord,
    angleByUnit?: Map<UnitView, number | null>,
    sizeMultiplier?: number,
  );
  drawSprite(
    unit: UnitView,
    customTerritoryColor?: Colord,
    angleByUnitOrSizeMultiplier?: Map<UnitView, number | null> | number,
    sizeMultiplier: number = 1.0,
  ) {
    let angleByUnit: Map<UnitView, number | null> | undefined;
    let sizeMult = sizeMultiplier;

    if (typeof angleByUnitOrSizeMultiplier === "number") {
      sizeMult = angleByUnitOrSizeMultiplier;
    } else {
      angleByUnit = angleByUnitOrSizeMultiplier;
    }

    // If we're in the base pass and this unit type is interpolated, skip drawing the sprite
    // to avoid double images (the interpolation overlay will render it smoothly).
    if (
      this.drawingBasePass &&
      this.interpolatedUnitTypes.includes(unit.type())
    ) {
      return;
    }

    const x = this.game.x(unit.tile());
    const y = this.game.y(unit.tile());

    let alternateViewColor: Colord | null = null;

    if (this.alternateView) {
      let rel = this.relationship(unit);
      const destinationId = unit.targetUnitId();
      if (
        (unit.type() === UnitType.TradeShip ||
          unit.type() === UnitType.CargoPlane) &&
        destinationId !== undefined
      ) {
        const target = this.game.unit(destinationId)?.owner();
        const myPlayer = this.game.myPlayer();
        if (myPlayer !== null && target !== undefined) {
          if (myPlayer === target) {
            rel = Relationship.Self;
          } else if (myPlayer.isFriendly(target)) {
            rel = Relationship.Ally;
          }
        }
      }
      switch (rel) {
        case Relationship.Self:
          alternateViewColor = this.theme.selfColor();
          break;
        case Relationship.Ally:
          alternateViewColor = this.theme.allyColor();
          break;
        case Relationship.Enemy:
          alternateViewColor = this.theme.enemyColor();
          break;
      }
    }

    const sprite = getColoredSprite(
      unit,
      this.theme,
      alternateViewColor ?? customTerritoryColor,
      alternateViewColor ?? undefined,
    );

    if (unit.isActive()) {
      const targetable = unit.targetable();
      if (!targetable) {
        this.context.save();
        this.context.globalAlpha = 0.5;
      }

      const angle = angleByUnit?.get(unit) ?? this.getUnitAngle(unit);
      const cx = Math.round(x);
      const cy = Math.round(y);
      const newWidth = sprite.width * sizeMult;
      const newHeight = sprite.width * sizeMult; // Keep aspect ratio square

      if (angle !== null) {
        this.context.save();
        this.context.translate(cx, cy);
        this.context.rotate(angle);
        this.context.translate(-cx, -cy);
      }

      this.context.drawImage(
        sprite,
        cx - newWidth / 2,
        cy - newHeight / 2,
        newWidth,
        newHeight,
      );

      // Draw a tiny top-right corner badge offset 1px outside the sprite
      // Only for Warships, FighterJets, Submarines, and Bombers
      const type = unit.type();
      if (
        type === UnitType.Warship ||
        type === UnitType.FighterJet ||
        type === UnitType.Submarine ||
        type === UnitType.Bomber
      ) {
        const level = unit.level ? unit.level() : 1;
        // Tier color mapping: 1→bronze, 2→silver, 3→gold, 4+→platinum
        const tierColor =
          level >= 4
            ? "#E5E4E2" /* platinum */
            : level === 3
              ? "#FFD700" /* gold */
              : level === 2
                ? "#C0C0C0" /* silver */
                : "#CD7F32"; /* bronze */
        // Badge size: crisp 2–3 px depending on sprite size
        const badgeSize = Math.max(2, Math.min(3, Math.round(newWidth * 0.18)));
        // Offset 1px to the right and 1px above the sprite's top-right corner
        const offset = 1;
        const badgeLeft = Math.round(cx + newWidth / 2 + offset);
        const badgeTop = Math.round(cy - newHeight / 2 - badgeSize - offset);
        this.context.fillStyle = tierColor;
        this.context.fillRect(badgeLeft, badgeTop, badgeSize, badgeSize);
      }

      if (angle !== null) {
        this.context.restore();
      }

      if (!targetable) {
        this.context.restore();
      }
    }
  }

  private drawSpriteAtPosition(
    unit: UnitView,
    position: { x: number; y: number },
    customTerritoryColor?: Colord,
    context: CanvasRenderingContext2D = this.context,
    snapToPixel = true,
  ) {
    let alternateViewColor: Colord | null = null;

    if (this.alternateView) {
      let rel = this.relationship(unit);
      const destinationId = unit.targetUnitId();
      if (
        (unit.type() === UnitType.TradeShip ||
          unit.type() === UnitType.CargoPlane) &&
        destinationId !== undefined
      ) {
        const target = this.game.unit(destinationId)?.owner();
        const myPlayer = this.game.myPlayer();
        if (myPlayer !== null && target !== undefined) {
          if (myPlayer === target) {
            rel = Relationship.Self;
          } else if (myPlayer.isFriendly(target)) {
            rel = Relationship.Ally;
          }
        }
      }
      switch (rel) {
        case Relationship.Self:
          alternateViewColor = this.theme.selfColor();
          break;
        case Relationship.Ally:
          alternateViewColor = this.theme.allyColor();
          break;
        case Relationship.Enemy:
          alternateViewColor = this.theme.enemyColor();
          break;
      }
    }

    const sprite = getColoredSprite(
      unit,
      this.theme,
      alternateViewColor ?? customTerritoryColor,
      alternateViewColor ?? undefined,
    );

    if (unit.isActive()) {
      const targetable = unit.targetable();
      if (!targetable) {
        context.save();
        context.globalAlpha = 0.5;
      }

      const offsetX = snapToPixel
        ? Math.round(position.x - sprite.width / 2)
        : position.x - sprite.width / 2;
      const offsetY = snapToPixel
        ? Math.round(position.y - sprite.width / 2)
        : position.y - sprite.width / 2;

      // Apply rotation on interpolation overlay for aircraft
      const isAircraft =
        unit.type() === UnitType.Bomber ||
        unit.type() === UnitType.FighterJet ||
        unit.type() === UnitType.CargoPlane;
      let rotated = false;
      if (isAircraft) {
        const angle = this.getUnitAngle(unit);
        if (angle !== null) {
          const cx = offsetX + sprite.width / 2;
          const cy = offsetY + sprite.width / 2;
          context.save();
          context.translate(cx, cy);
          context.rotate(angle);
          context.translate(-cx, -cy);
          rotated = true;
        }
      }

      context.drawImage(sprite, offsetX, offsetY, sprite.width, sprite.width);

      // Draw the same tiny badge on interpolation overlay for select unit types
      const type = unit.type();
      if (
        type === UnitType.Warship ||
        type === UnitType.FighterJet ||
        type === UnitType.Submarine ||
        type === UnitType.Bomber
      ) {
        const level = (unit as any).level ? (unit as any).level() : 1;
        const tierColor =
          level >= 4
            ? "#E5E4E2" /* platinum */
            : level === 3
              ? "#FFD700" /* gold */
              : level === 2
                ? "#C0C0C0" /* silver */
                : "#CD7F32"; /* bronze */
        const badgeSize = Math.max(
          2,
          Math.min(3, Math.round(sprite.width * 0.18)),
        );
        const offset = 1;
        const cx = offsetX + sprite.width / 2;
        const cy = offsetY + sprite.width / 2;
        const badgeLeft = Math.round(cx + sprite.width / 2 + offset);
        const badgeTop = Math.round(cy - sprite.width / 2 - badgeSize - offset);
        context.fillStyle = tierColor;
        context.fillRect(badgeLeft, badgeTop, badgeSize, badgeSize);
      }

      if (rotated) {
        context.restore();
      }

      if (!targetable) {
        context.restore();
      }
    }
  }

  private getUnitAngle(unit: UnitView): number | null {
    const lastTile = unit.lastTile();
    const currentTile = unit.tile();

    if (
      lastTile &&
      currentTile &&
      (unit.type() === UnitType.Bomber ||
        unit.type() === UnitType.FighterJet ||
        unit.type() === UnitType.CargoPlane)
    ) {
      const lastPos = { x: this.game.x(lastTile), y: this.game.y(lastTile) };
      const currentPos = {
        x: this.game.x(currentTile),
        y: this.game.y(currentTile),
      };
      const dx = currentPos.x - lastPos.x;
      const dy = currentPos.y - lastPos.y;

      const lastAngle = this.unitToLastAngle.get(unit);

      if (dx === 0 && dy === 0) {
        return lastAngle ?? null;
      }

      let angle = Math.atan2(dy, dx);

      if (unit.type() === UnitType.FighterJet) {
        angle += Math.PI / 2;
      }

      if (lastAngle !== undefined) {
        // Determines how quickly the unit realigns its orientation.
        // A smaller value results in a longer period of realignment.
        const smoothingFactor = 0.25;
        let angleDiff = angle - lastAngle;

        // Normalize the angle difference to be between -PI and PI
        while (angleDiff > Math.PI) {
          angleDiff -= 2 * Math.PI;
        }
        while (angleDiff < -Math.PI) {
          angleDiff += 2 * Math.PI;
        }

        angle = lastAngle + angleDiff * smoothingFactor;
      }

      this.unitToLastAngle.set(unit, angle);
      return angle;
    }
    return null;
  }

  // Get square sprite size for a unit type, cached
  private getSpriteSize(unit: UnitView): number {
    const t = unit.type();
    const existing = this.spriteSizeCache.get(t);
    if (existing !== undefined) return existing;
    // Use a single colored sprite to get width; colorization does not affect size
    const canvas = getColoredSprite(unit, this.theme);
    const size = canvas.width;
    this.spriteSizeCache.set(t, size);
    return size;
  }

  // Mirror draw-time size multiplier decisions for clearing
  private effectiveSizeMultiplier(unit: UnitView): number {
    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() === this.game.myPlayer()
    ) {
      const isAttacking = ((unit as any).isAttacking?.() ?? false) as boolean;
      const isDetected = ((unit as any).isDetectedByNavalUnit?.() ??
        false) as boolean;
      const isOnCooldown = ((unit as any).isCooldown?.() ?? false) as boolean;
      const isVisibleToEnemies = isAttacking || isDetected || isOnCooldown;
      if (!isVisibleToEnemies) {
        return 0.75;
      }
    }
    return 1.0;
  }

  private computeTickAlpha(): number {
    const elapsed = Math.min(
      this.now() - this.lastTickTimestamp,
      this.tickIntervalMs,
    );
    if (this.tickIntervalMs === 0) {
      return 1;
    }
    return Math.max(0, elapsed / this.tickIntervalMs);
  }

  private onReplaySpeedChange(multiplier: ReplaySpeedMultiplier) {
    this.replaySpeedMultiplier = multiplier;
    this.updateTickInterval();
    this.lastTickTimestamp = this.now();
  }

  private updateTickInterval() {
    const baseInterval = this.baseTickIntervalMs;
    if (baseInterval <= 0) {
      this.tickIntervalMs = 0;
      return;
    }
    this.tickIntervalMs = baseInterval * this.replaySpeedMultiplier;
  }

  private now(): number {
    if (typeof performance !== "undefined" && performance.now) {
      return performance.now();
    }
    return Date.now();
  }

  private updateGhosts() {
    const ghosts = (this.game as any).submarineGhosts?.call(this.game) ?? [];
    const currentGhostIds = new Set<number>();

    for (const ghost of ghosts as Array<{
      id: number;
      pos: number;
      expiresAt: number;
      ownerID: number;
    }>) {
      currentGhostIds.add(ghost.id);
      if (!this.renderedGhosts.has(ghost.id)) {
        this.drawGhost(ghost);
        this.renderedGhosts.set(ghost.id, ghost.pos);
      }
    }

    for (const [id, pos] of this.renderedGhosts) {
      if (!currentGhostIds.has(id)) {
        this.clearGhost({ pos, ownerID: 0 }); // ownerID not needed for clearing
        this.renderedGhosts.delete(id);
        // If a unit is currently at this position, redraw it so it doesn't disappear
        const unitAtPos = this.game.units().find((u) => u.tile() === pos);
        if (unitAtPos) {
          this.drawSprite(unitAtPos);
        }
      }
    }
  }

  private clearGhost(ghost: { pos: number; ownerID: number }) {
    // Create a dummy unit to get the sprite size
    // We need a valid owner for getColoredSprite, but for size it doesn't matter much
    // as long as it returns a sprite.
    const dummyUnit = {
      tile: () => ghost.pos,
      type: () => UnitType.Submarine,
      owner: () =>
        this.game.playerBySmallID(ghost.ownerID) || this.game.players()[0],
      targetable: () => true,
      isActive: () => true,
      lastTile: () => ghost.pos,
    } as unknown as UnitView;

    const spriteSize = this.getSpriteSize(dummyUnit);
    const newWidth = spriteSize; // Ghosts are drawn at 1.0 scale
    const newHeight = spriteSize;

    // Badge overlay parameters: badge sits 1px outside top-right
    // Ghosts default to level 1 (bronze) badge
    const badgeSize = Math.max(2, Math.min(3, Math.round(newWidth * 0.18)));
    const offset = 1;
    const overlayTop = badgeSize + offset; // extend upwards to cover outside badge
    const extraRight = badgeSize + offset; // full right-side extension beyond sprite

    const padding = 2; // small safety margin around computed bounds
    const maxHalfWidth = newWidth / 2 + extraRight;

    const cx = Math.round(this.game.x(ghost.pos));
    const cy = Math.round(this.game.y(ghost.pos));

    const left = cx - maxHalfWidth - padding;
    const top = cy - newHeight / 2 - overlayTop - padding;
    const width = maxHalfWidth * 2 + padding * 2;
    const height = newHeight + overlayTop + padding * 2;

    this.context.clearRect(left, top, width, height);
  }

  private drawGhost(ghost: { id: number; pos: number; ownerID: number }) {
    this.context.save();
    this.context.globalAlpha = 0.3;
    const dummyUnit = {
      tile: () => ghost.pos,
      type: () => UnitType.Submarine,
      owner: () => this.game.playerBySmallID(ghost.ownerID),
      targetable: () => true,
      isActive: () => true,
      lastTile: () => ghost.pos,
    } as unknown as UnitView;
    this.drawSprite(dummyUnit as UnitView);
    this.context.restore();
  }
}
