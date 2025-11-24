import { EventBus, GameEvent } from "../core/EventBus";
import { TileRef } from "../core/game/GameMap";
import { UnitView } from "../core/game/GameView";
import { UserSettings } from "../core/game/UserSettings";
import { ReplaySpeedMultiplier } from "./utilities/ReplaySpeedMultiplier";

export class MouseUpEvent implements GameEvent {
  // Whether this click has been handled by another listener and should not be processed again.
  public consumed: boolean = false;
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class MouseOverEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

/**
 * Event emitted when a unit is selected or deselected
 */
export class UnitSelectionEvent implements GameEvent {
  constructor(
    public readonly unit: UnitView | null,
    public readonly isSelected: boolean,
  ) {}
}

export class MouseDownEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class MouseMoveEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ContextMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ZoomEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly delta: number,
  ) {}
}

export class DragEvent implements GameEvent {
  constructor(
    public readonly deltaX: number,
    public readonly deltaY: number,
  ) {}
}

export class AlternateViewEvent implements GameEvent {
  constructor(public readonly alternateView: boolean) {}
}

export class CloseViewEvent implements GameEvent {}

export class RefreshGraphicsEvent implements GameEvent {}

export class ToggleStructureEvent implements GameEvent {
  constructor(public readonly structureType: UnitType | null) {}
}

export class ShowBuildMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ShowBuildMenuInControlPanelEvent implements GameEvent {
  constructor(public readonly tile: TileRef) {}
}
export class ShowEmojiMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class DoBoatAttackEvent implements GameEvent {}

export class DoGroundAttackEvent implements GameEvent {}

export class AttackRatioEvent implements GameEvent {
  constructor(public readonly attackRatio: number) {}
}

export class ReplaySpeedChangeEvent implements GameEvent {
  constructor(public readonly replaySpeedMultiplier: ReplaySpeedMultiplier) {}
}

export class CenterCameraEvent implements GameEvent {
  constructor() {}
}

import { UnitType } from "../core/game/Game";
import { GameView } from "../core/game/GameView";
import { ToggleBomberUpgradeModeEvent } from "./events/ToggleBomberUpgradeModeEvent";
import { ToggleUpgradeModeEvent } from "./events/ToggleUpgradeModeEvent";
import { TransformHandler } from "./graphics/TransformHandler";
import { UIState } from "./graphics/UIState";
import { BuildUnitIntentEvent } from "./Transport";

// Post-impact nuke halo event (world tile coordinates)
export class NukeImpactEvent implements GameEvent {
  constructor(
    public readonly worldX: number,
    public readonly worldY: number,
    public readonly nukeType: UnitType,
    public readonly unitId?: number,
  ) {}
}

export class InputHandler {
  private _pendingBuildUnitType: UnitType | null = null;
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;

  private lastPointerDownX: number = 0;
  private lastPointerDownY: number = 0;
  private suppressNextContextMenu = false;

  private pointers: Map<number, PointerEvent> = new Map();

  private lastPinchDistance: number = 0;

  private pointerDown: boolean = false;

  private alternateView = false;

  private moveInterval: NodeJS.Timeout | null = null;
  private activeKeys = new Set<string>();
  private keybinds: Record<string, string> = {};

  private readonly PAN_SPEED = 5;
  private readonly ZOOM_SPEED = 10;

  private userSettings: UserSettings = new UserSettings();

  private _initialized = false;
  constructor(
    private canvas: HTMLCanvasElement,
    private eventBus: EventBus,
    public uiState: UIState,
    public game: GameView,
    public transformHandler: TransformHandler,
  ) {}

  initialize() {
    if (this._initialized) return;
    this._initialized = true;

    this.keybinds = {
      toggleView: "Space",
      centerCamera: "KeyC",
      moveUp: "KeyW",
      moveDown: "KeyS",
      moveLeft: "KeyA",
      moveRight: "KeyD",
      zoomOut: "KeyQ",
      zoomIn: "KeyE",
      attackRatioDown: "Digit1",
      attackRatioUp: "Digit2",
      boatAttack: "KeyB",
      groundAttack: "KeyG",
      buildAtomBomb: "Digit5",
      buildHydrogenBomb: "Digit6",
      buildMIRV: "Digit7",
      buildFighterJet: "Digit8",
      buildWarship: "Digit9",
      buildCity: "KeyY",
      buildPort: "KeyU",
      buildAirfield: "KeyI",
      buildHospital: "KeyO",
      buildAcademy: "KeyP",
      buildResearchLab: "KeyL",
      buildFactory: "KeyF",
      buildMissileSilo: "KeyH",
      buildSAMLauncher: "KeyJ",
      buildDefensePost: "KeyK",
      modifierKey: "ControlLeft",
      altKey: "AltLeft",
      ...JSON.parse(localStorage.getItem("settings.keybinds") ?? "{}"),
    };

    // Mac users might have different keybinds
    const isMac = /Mac/.test(navigator.userAgent);
    if (isMac) {
      this.keybinds.modifierKey = "MetaLeft"; // Use Command key on Mac
    }

    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        this.onScroll(e);
        this.onShiftScroll(e);
        e.preventDefault();
      },
      { passive: false },
    );
    window.addEventListener("pointermove", this.onPointerMove.bind(this));
    this.canvas.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    window.addEventListener("mousemove", (e) => {
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      if (e.movementX || e.movementY) {
        this.eventBus.emit(new MouseMoveEvent(e.clientX, e.clientY));
      }
    });
    this.pointers.clear();

    // Listen for changes in pendingBuildUnitType to update cursor
    Object.defineProperty(this.uiState, "pendingBuildUnitType", {
      set: (value) => {
        this._pendingBuildUnitType = value;
        if (value) {
          this.canvas.classList.add("crosshair-cursor");
        } else {
          this.canvas.classList.remove("crosshair-cursor");
        }
      },
      get: () => this._pendingBuildUnitType,
    });
    this._pendingBuildUnitType = null; // Initialize the backing field

    this.moveInterval = setInterval(() => {
      let deltaX = 0;
      let deltaY = 0;

      if (
        this.activeKeys.has(this.keybinds.moveUp) ||
        this.activeKeys.has("ArrowUp")
      )
        deltaY += this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveDown) ||
        this.activeKeys.has("ArrowDown")
      )
        deltaY -= this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveLeft) ||
        this.activeKeys.has("ArrowLeft")
      )
        deltaX += this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveRight) ||
        this.activeKeys.has("ArrowRight")
      )
        deltaX -= this.PAN_SPEED;

      if (deltaX || deltaY) {
        this.eventBus.emit(new DragEvent(deltaX, deltaY));
      }

      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;

      if (
        this.activeKeys.has(this.keybinds.zoomOut) ||
        this.activeKeys.has("Minus")
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, this.ZOOM_SPEED));
      }
      if (
        this.activeKeys.has(this.keybinds.zoomIn) ||
        this.activeKeys.has("Equal")
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, -this.ZOOM_SPEED));
      }
    }, 16);

    window.addEventListener("keydown", (e) => {
      if (e.code === this.keybinds.toggleView) {
        e.preventDefault();
        if (!this.alternateView) {
          this.alternateView = true;
          this.eventBus.emit(new AlternateViewEvent(true));
        }
      }

      if (e.code === "Escape") {
        e.preventDefault();
        this.eventBus.emit(new CloseViewEvent());
      }

      if (
        [
          this.keybinds.moveUp,
          this.keybinds.moveDown,
          this.keybinds.moveLeft,
          this.keybinds.moveRight,
          this.keybinds.zoomOut,
          this.keybinds.zoomIn,
          "ArrowUp",
          "ArrowLeft",
          "ArrowDown",
          "ArrowRight",
          "Minus",
          "Equal",
          this.keybinds.attackRatioDown,
          this.keybinds.attackRatioUp,
          this.keybinds.centerCamera,
          "ControlLeft",
          "ControlRight",
        ].includes(e.code)
      ) {
        this.activeKeys.add(e.code);
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === this.keybinds.toggleView) {
        e.preventDefault();
        this.alternateView = false;
        this.eventBus.emit(new AlternateViewEvent(false));
      }

      if (e.key.toLowerCase() === "r" && e.altKey && !e.ctrlKey) {
        e.preventDefault();
        this.eventBus.emit(new RefreshGraphicsEvent());
      }

      if (e.code === this.keybinds.boatAttack) {
        e.preventDefault();
        this.eventBus.emit(new DoBoatAttackEvent());
      }

      if (e.code === this.keybinds.groundAttack) {
        e.preventDefault();
        this.eventBus.emit(new DoGroundAttackEvent());
      }

      if (e.code === this.keybinds.attackRatioDown) {
        e.preventDefault();
        this.eventBus.emit(new AttackRatioEvent(-10));
      }

      if (e.code === this.keybinds.attackRatioUp) {
        e.preventDefault();
        this.eventBus.emit(new AttackRatioEvent(10));
      }

      if (e.code === this.keybinds.centerCamera) {
        e.preventDefault();
        this.eventBus.emit(new CenterCameraEvent());
      }

      this.handleBuildHotkey(e.code);

      this.activeKeys.delete(e.code);
    });
  }

  private handleBuildHotkey(code: string) {
    const buildHotkeys: Record<string, UnitType> = {
      [this.keybinds.buildAtomBomb]: UnitType.AtomBomb,
      [this.keybinds.buildHydrogenBomb]: UnitType.HydrogenBomb,
      [this.keybinds.buildMIRV]: UnitType.MIRV,
      [this.keybinds.buildFighterJet]: UnitType.FighterJet,
      [this.keybinds.buildWarship]: UnitType.Warship,
      [this.keybinds.buildCity]: UnitType.City,
      [this.keybinds.buildPort]: UnitType.Port,
      [this.keybinds.buildAirfield]: UnitType.Airfield,
      [this.keybinds.buildHospital]: UnitType.Hospital,
      [this.keybinds.buildAcademy]: UnitType.Academy,
      [this.keybinds.buildResearchLab]: UnitType.ResearchLab,
      [this.keybinds.buildFactory]: UnitType.Factory,
      [this.keybinds.buildMissileSilo]: UnitType.MissileSilo,
      [this.keybinds.buildSAMLauncher]: UnitType.SAMLauncher,
      [this.keybinds.buildDefensePost]: UnitType.DefensePost,
    };

    const unitType = buildHotkeys[code];
    if (unitType) {
      // Any build action should disable upgrade mode and unhighlight its button
      if (this.uiState.upgradeMode) {
        this.uiState.upgradeMode = false;
        this.eventBus.emit(new ToggleUpgradeModeEvent(false));
      }
      // Disable bomber upgrade mode on build action
      if (this.uiState.bomberUpgradeMode) {
        this.uiState.bomberUpgradeMode = false;
        this.eventBus.emit(new ToggleBomberUpgradeModeEvent(false));
      }
      const cell = this.transformHandler.screenToWorldCoordinates(
        this.lastPointerX,
        this.lastPointerY,
      );

      if (this.game.isValidCoord(cell.x, cell.y)) {
        const tile = this.game.ref(cell.x, cell.y);
        this.eventBus.emit(new BuildUnitIntentEvent(unitType, tile));
      }
    }
  }

  private onPointerDown(event: PointerEvent) {
    if (event.button > 0) {
      return;
    }

    this.pointerDown = true;
    this.pointers.set(event.pointerId, event);

    if (this.pointers.size === 1) {
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;

      this.lastPointerDownX = event.clientX;
      this.lastPointerDownY = event.clientY;

      this.eventBus.emit(new MouseDownEvent(event.clientX, event.clientY));
    } else if (this.pointers.size === 2) {
      this.lastPinchDistance = this.getPinchDistance();
    }
  }

  onPointerUp(event: PointerEvent) {
    // Ignore non-primary buttons and non-primary pointers
    if (
      event.button > 0 ||
      (typeof event.isPrimary === "boolean" && !event.isPrimary)
    ) {
      return;
    }

    // Always end the drag interaction on any pointer up.
    // This prevents the "sticky drag" issue.
    this.pointerDown = false;
    this.pointers.clear();

    // But, only process a "click" action if the event happened on the canvas.
    // This prevents "leaky clicks" through UI elements.
    const path = event.composedPath?.() ?? [];
    const cameFromCanvas =
      event.target === this.canvas ||
      (path.length > 0 && path.includes(this.canvas));
    if (!cameFromCanvas) return;

    // Normalize coordinates
    const upX = event.clientX;
    const upY = event.clientY;

    // ---------- RESTORED SAFEGUARD (drag vs click) ----------
    // Treat as click only if the pointer barely moved since pointerdown.
    const dist =
      Math.abs(upX - this.lastPointerDownX) +
      Math.abs(upY - this.lastPointerDownY);

    // If moved too much, consider it a drag/pan; do NOT fire click/place actions.
    if (dist >= 10) {
      return;
    }
    // --------------------------------------------------------

    // If we reach here, it's a "click" interaction.

    // Pending build: place unit on click (still respects the drag-vs-click guard above)
    if (this.uiState.pendingBuildUnitType) {
      const cell = this.transformHandler.screenToWorldCoordinates(upX, upY);

      // If coordinates are invalid, just deselect build state (when not multi-build) and return
      if (!this.game.isValidCoord(cell.x, cell.y)) {
        if (!this.uiState.multibuildEnabled) {
          this.uiState.pendingBuildUnitType = null;
        }
        return;
      }

      const tile = this.game.ref(cell.x, cell.y);
      // Placing a structure should also ensure upgrade mode is disabled
      if (this.uiState.upgradeMode) {
        this.uiState.upgradeMode = false;
        this.eventBus.emit(new ToggleUpgradeModeEvent(false));
      }
      // Disable bomber upgrade mode on build action
      if (this.uiState.bomberUpgradeMode) {
        this.uiState.bomberUpgradeMode = false;
        this.eventBus.emit(new ToggleBomberUpgradeModeEvent(false));
      }
      this.eventBus.emit(
        new BuildUnitIntentEvent(this.uiState.pendingBuildUnitType, tile),
      );

      if (!this.uiState.multibuildEnabled) {
        this.uiState.pendingBuildUnitType = null;
      }
      return;
    }

    // No build pending → normal “click up” behavior
    if (this.isModifierKeyPressed(event)) {
      this.eventBus.emit(new ShowBuildMenuEvent(upX, upY));
      return;
    }
    if (this.isAltKeyPressed(event)) {
      this.eventBus.emit(new ShowEmojiMenuEvent(upX, upY));
      return;
    }

    // Touch parity with the old behavior: short tap opens context menu.
    if (event.pointerType === "touch") {
      this.eventBus.emit(new ContextMenuEvent(upX, upY));
      event.preventDefault();
      return;
    }

    // Respect the old setting: left click either selects (MouseUp) or opens menu.
    if (!this.userSettings.leftClickOpensMenu() || event.shiftKey) {
      this.eventBus.emit(new MouseUpEvent(upX, upY));
    } else {
      this.eventBus.emit(new ContextMenuEvent(upX, upY));
    }
  }

  private onScroll(event: WheelEvent) {
    if (!event.shiftKey) {
      const realCtrl =
        this.activeKeys.has("ControlLeft") ||
        this.activeKeys.has("ControlRight");
      const ratio = event.ctrlKey && !realCtrl ? 10 : 1; // Compensate pinch-zoom low sensitivity
      this.eventBus.emit(new ZoomEvent(event.x, event.y, event.deltaY * ratio));
    }
  }

  private onShiftScroll(event: WheelEvent) {
    if (event.shiftKey) {
      const scrollValue = event.deltaY === 0 ? event.deltaX : event.deltaY;
      const ratio = scrollValue > 0 ? -10 : 10;
      this.eventBus.emit(new AttackRatioEvent(ratio));
    }
  }

  private onPointerMove(event: PointerEvent) {
    if (event.button > 0) {
      return;
    }

    this.pointers.set(event.pointerId, event);

    if (!this.pointerDown) {
      this.eventBus.emit(new MouseOverEvent(event.clientX, event.clientY));
      return;
    }

    if (this.pointers.size === 1) {
      const deltaX = event.clientX - this.lastPointerX;
      const deltaY = event.clientY - this.lastPointerY;

      this.eventBus.emit(new DragEvent(deltaX, deltaY));

      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
    } else if (this.pointers.size === 2) {
      const currentPinchDistance = this.getPinchDistance();
      const pinchDelta = currentPinchDistance - this.lastPinchDistance;

      if (Math.abs(pinchDelta) > 1) {
        const zoomCenter = this.getPinchCenter();
        this.eventBus.emit(
          new ZoomEvent(zoomCenter.x, zoomCenter.y, -pinchDelta * 2),
        );
        this.lastPinchDistance = currentPinchDistance;
      }
    }
  }

  private onContextMenu(event: MouseEvent) {
    // If the previous right-click just cancelled build mode, ignore the second, immediate contextmenu.
    if (this.suppressNextContextMenu) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      return;
    }

    if (this.uiState.pendingBuildUnitType) {
      // Cancel build state and suppress any immediate follow-up contextmenu
      this.uiState.pendingBuildUnitType = null;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      this.suppressNextContextMenu = true;

      // Clear suppression on the next frame (and as fallbacks on pointerup/next task)
      const clear = () => {
        this.suppressNextContextMenu = false;
      };
      requestAnimationFrame(clear);
      window.addEventListener("pointerup", clear, { once: true });
      setTimeout(clear, 0);

      return;
    }

    // Not in build state → open radial menu
    event.preventDefault();
    this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
  }

  private getPinchDistance(): number {
    const pointerEvents = Array.from(this.pointers.values());
    const dx = pointerEvents[0].clientX - pointerEvents[1].clientX;
    const dy = pointerEvents[0].clientY - pointerEvents[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private getPinchCenter(): { x: number; y: number } {
    const pointerEvents = Array.from(this.pointers.values());
    return {
      x: (pointerEvents[0].clientX + pointerEvents[1].clientX) / 2,
      y: (pointerEvents[0].clientY + pointerEvents[1].clientY) / 2,
    };
  }

  destroy() {
    if (this.moveInterval !== null) {
      clearInterval(this.moveInterval);
      this.moveInterval = null;
    }
    this.activeKeys.clear();
  }

  isModifierKeyPressed(event: PointerEvent): boolean {
    return (
      (this.keybinds.modifierKey === "AltLeft" && event.altKey) ||
      (this.keybinds.modifierKey === "ControlLeft" && event.ctrlKey) ||
      (this.keybinds.modifierKey === "ShiftLeft" && event.shiftKey) ||
      (this.keybinds.modifierKey === "MetaLeft" && event.metaKey)
    );
  }

  isAltKeyPressed(event: PointerEvent): boolean {
    return (
      (this.keybinds.altKey === "AltLeft" && event.altKey) ||
      (this.keybinds.altKey === "ControlLeft" && event.ctrlKey) ||
      (this.keybinds.altKey === "ShiftLeft" && event.shiftKey) ||
      (this.keybinds.altKey === "MetaLeft" && event.metaKey)
    );
  }
}
