import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

export class NukeTargetingLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  // Cursor position tracking (world coordinates)
  private cursorWorldX: number = 0;
  private cursorWorldY: number = 0;
  private isVisible: boolean = false;

  // Track active nukes (updated in tick, not renderLayer)
  private activeNukes: Map<
    number,
    { targetX: number; targetY: number; nukeType: UnitType }
  > = new Map();

  constructor(
    private game: GameView,
    private uiState: UIState,
    private transformHandler: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return true; // Halo moves with map transform
  }

  init(): void {
    this.redraw();
  }

  redraw(): void {
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.context.imageSmoothingEnabled = false;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
  }

  tick(): void {
    // Update active nukes map (only on game updates, not every render frame)
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    const unitUpdates = updates[GameUpdateType.Unit];
    if (!unitUpdates) return;

    // Process only updated units, not all units
    for (const update of unitUpdates) {
      const unit = this.game.unit(update.id);

      // If unit no longer exists or is not an active nuke, remove from tracking
      if (!unit) {
        this.activeNukes.delete(update.id);
        continue;
      }

      const isNuke =
        unit.type() === UnitType.AtomBomb ||
        unit.type() === UnitType.HydrogenBomb;

      if (isNuke && unit.isActive()) {
        const targetTile = unit.targetTile();
        if (targetTile) {
          this.activeNukes.set(unit.id(), {
            targetX: this.game.x(targetTile),
            targetY: this.game.y(targetTile),
            nukeType: unit.type(),
          });
        }
      } else {
        // Remove inactive or non-nuke units
        this.activeNukes.delete(unit.id());
      }
    }
  }

  /**
   * Called by ClientGameRunner on MouseMoveEvent
   */
  updateCursorPosition(screenX: number, screenY: number): void {
    const worldCoord = this.transformHandler.screenToWorldCoordinates(
      screenX,
      screenY,
    );
    this.cursorWorldX = worldCoord.x;
    this.cursorWorldY = worldCoord.y;
    this.updateVisibility();
  }

  private updateVisibility(): void {
    const nukeType = this.uiState.pendingBuildUnitType;
    this.isVisible =
      nukeType === UnitType.AtomBomb || nukeType === UnitType.HydrogenBomb;
  }

  private getBlastRadius(): { outer: number; inner: number } {
    const nukeType = this.uiState.pendingBuildUnitType;
    if (!nukeType) return { outer: 0, inner: 0 };

    const magnitude = this.game.config().nukeMagnitudes(nukeType);
    return { outer: magnitude.outer, inner: magnitude.inner };
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    // Handle canvas resize (same pattern as FxLayer)
    if (
      this.canvas.width !== this.game.width() ||
      this.canvas.height !== this.game.height()
    ) {
      this.redraw();
    }

    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Render targeting halo (follows cursor)
    if (this.isVisible) {
      const { outer, inner } = this.getBlastRadius();
      const x = this.cursorWorldX;
      const y = this.cursorWorldY;

      // Draw outer radius (dotted)
      this.context.beginPath();
      this.context.setLineDash([5, 5]); // Dotted pattern
      this.context.arc(x, y, outer, 0, Math.PI * 2);
      this.context.strokeStyle = "rgba(255, 255, 255, 0.5)"; // 50% transparency
      this.context.lineWidth = 1.5;
      this.context.stroke();
      this.context.setLineDash([]); // Reset to solid

      // Draw inner radius (more subtle)
      this.context.beginPath();
      this.context.arc(x, y, inner, 0, Math.PI * 2);
      this.context.strokeStyle = "rgba(255, 255, 255, 0.25)"; // 25% transparency
      this.context.lineWidth = 1;
      this.context.stroke();
    }

    // Render flight-phase halos (from cached map, no filtering needed)
    for (const [_, nukeData] of this.activeNukes) {
      const magnitude = this.game.config().nukeMagnitudes(nukeData.nukeType);

      // Draw outer radius - red, constant opacity (dotted)
      this.context.beginPath();
      this.context.setLineDash([5, 5]); // Dotted pattern
      this.context.arc(
        nukeData.targetX,
        nukeData.targetY,
        magnitude.outer,
        0,
        Math.PI * 2,
      );
      this.context.strokeStyle = "rgba(255, 50, 50, 0.7)"; // Red with 70% opacity
      this.context.lineWidth = 2;
      this.context.stroke();
      this.context.setLineDash([]); // Reset to solid

      // Draw inner radius - brighter red, constant opacity
      this.context.beginPath();
      this.context.arc(
        nukeData.targetX,
        nukeData.targetY,
        magnitude.inner,
        0,
        Math.PI * 2,
      );
      this.context.strokeStyle = "rgba(255, 80, 80, 0.5)"; // Lighter red with 50% opacity
      this.context.lineWidth = 1.5;
      this.context.stroke();
    }

    // Draw to main canvas
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }
}
