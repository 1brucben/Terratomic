import { colord, Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, UnitView } from "../../../core/game/GameView";
import { BezenhamLine } from "../../../core/utilities/Line";
import {
  AlternateViewEvent,
  MouseUpEvent,
  UnitSelectionEvent,
} from "../../InputHandler";
import {
  MoveFighterJetIntentEvent,
  MoveSubmarineIntentEvent, // <-- Add this
  MoveWarshipIntentEvent,
} from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

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

export class UnitLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private transportShipTrailCanvas: HTMLCanvasElement;
  private unitTrailContext: CanvasRenderingContext2D;

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

  // Cache sprite sizes per UnitType to avoid repeated lookups when clearing
  private spriteSizeCache = new Map<UnitType, number>();

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.transformHandler = transformHandler;
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    const unitIds = this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => unit.id);

    this.updateUnitsSprites(unitIds ?? []);
  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => this.onAlternativeViewEvent(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(UnitSelectionEvent, (e) => this.onUnitSelectionChange(e));
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

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.transportShipTrailCanvas.width = this.game.width();
    this.transportShipTrailCanvas.height = this.game.height();

    this.updateUnitsSprites(this.game.units().map((unit) => unit.id()));

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
    const unitsToUpdate = unitIds
      ?.map((id) => this.game.unit(id))
      .filter((unit) => unit !== undefined) as UnitView[] | undefined;

    if (unitsToUpdate && unitsToUpdate.length > 0) {
      // Precompute angles once per unit to avoid duplicate work across passes
      const angleByUnit = new Map<UnitView, number | null>();
      for (const u of unitsToUpdate) {
        // Only aircraft currently use angles; others will return null quickly
        angleByUnit.set(u, this.getUnitAngle(u));
      }

      // the clearing and drawing of unit sprites need to be done in 2 passes
      // otherwise the sprite of a unit can be drawn on top of another unit
      this.clearUnitsCells(unitsToUpdate, angleByUnit);
      this.drawUnitsCells(unitsToUpdate, angleByUnit);
    }
  }

  private clearUnitsCells(
    unitViews: UnitView[],
    angleByUnit: Map<UnitView, number | null>,
  ) {
    unitViews
      .filter((unitView) => isSpriteReady(unitView.type()))
      .forEach((unitView) => {
        // Use cached sprite size to limit clear area to near sprite bounds
        const spriteSize = this.getSpriteSize(unitView);
        const padding = 2; // small safety margin
        const clearsize = spriteSize + padding;
        const lastX = this.game.x(unitView.lastTile());
        const lastY = this.game.y(unitView.lastTile());
        const angle = angleByUnit.get(unitView) ?? null;
        if (angle !== null) {
          this.context.save();
          this.context.translate(lastX, lastY);
          this.context.rotate(angle);
          this.context.translate(-lastX, -lastY);
        }
        this.context.clearRect(
          lastX - clearsize / 2,
          lastY - clearsize / 2,
          clearsize,
          clearsize,
        );
        if (angle !== null) {
          this.context.restore();
        }
      });
  }

  private drawUnitsCells(
    unitViews: UnitView[],
    angleByUnit: Map<UnitView, number | null>,
  ) {
    // Pass-through for now; angleByUnit helps avoid recomputation in drawSprite via an overload
    unitViews.forEach((unitView) => this.onUnitEvent(unitView, angleByUnit));
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

    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() !== this.game.myPlayer()
    ) {
      const isPeriodicallyVisible = this.game.isUnitPeriodicallyVisible(
        unit.id(),
      );
      const isAttacking = unit.isAttacking();
      const isDetected = unit.isDetectedByNavalUnit();

      if (
        !isPeriodicallyVisible &&
        !isAttacking &&
        !isDetected &&
        !unit.isCooldown()
      ) {
        return; // Don't render the submarine
      }
    }

    // START: Custom rendering for owner's submarine visibility
    if (
      unit.type() === UnitType.Submarine &&
      unit.owner() === this.game.myPlayer()
    ) {
      const isPeriodicallyVisible = this.game.isUnitPeriodicallyVisible(
        unit.id(),
      );
      const isAttacking = unit.isAttacking();
      const isDetected = unit.isDetectedByNavalUnit();
      const isOnCooldown = unit.isCooldown();

      const isVisibleToEnemies =
        isPeriodicallyVisible || isAttacking || isDetected || isOnCooldown;

      if (!isVisibleToEnemies) {
        // If hidden, draw it smaller and return early
        this.drawSprite(unit, undefined, 0.75);
        return;
      }
    }
    // END: Custom rendering

    switch (unit.type()) {
      case UnitType.TransportShip:
        this.handleBoatEvent(unit);
        break;
      case UnitType.Submarine:
      case UnitType.Warship:
        this.handleWarShipEvent(unit, angleByUnit);
        break;
      case UnitType.Shell:
        this.handleShellEvent(unit);
        break;
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
        this.context.globalAlpha = 0.4;
      }

      const angle = angleByUnit?.get(unit) ?? this.getUnitAngle(unit);
      if (angle !== null) {
        this.context.save();
        this.context.translate(x, y);
        this.context.rotate(angle);
        this.context.translate(-x, -y);
      }

      const newWidth = sprite.width * sizeMult;
      const newHeight = sprite.width * sizeMult; // Keep aspect ratio square

      this.context.drawImage(
        sprite,
        Math.round(x - newWidth / 2),
        Math.round(y - newHeight / 2),
        newWidth,
        newHeight,
      );

      if (angle !== null) {
        this.context.restore();
      }

      if (!targetable) {
        this.context.restore();
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
}
