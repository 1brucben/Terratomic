/**
 * FxLayerV2 — Optimised FX rendering layer
 * ==========================================
 *
 * Drop-in replacement for FxLayer with the following performance
 * improvements (preserves identical visual output):
 *
 *  1. Swap-and-pop removal — O(1) per dead FX vs O(n) splice
 *  2. Cached displayObject in FxInfo — removes per-frame virtual dispatch
 *  3. Reusable tmp Cell — avoids `new Cell()` per FX on camera change
 *  4. Direct for-loops in tick() — no .map().forEach() intermediate arrays
 *  5. Separate addFxSingle / addFxMultiple — no Array.isArray + wrapper
 *  6. ReadonlySet for FX-eligible unit types — O(1) lookup
 *  7. Cached scale per position-update batch — one read, not per-FX
 *  8. Inline worldToScreen math — avoids return-object allocation per FX
 *  9. Active count tracking — avoid repeated .length access
 * 10. Lazy renderer.render() — skip PIXI pass when scene is idle
 */

import * as PIXI from "pixi.js";
import { Theme } from "../../../core/configuration/Config";
import { Cell, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "../fx/Fx";
import { doomsdayFxFactory, nukeFxFactory, ShockwaveFx } from "../fx/NukeFx";
import { SpriteFx } from "../fx/SpriteFx";
import { UnitExplosionFx } from "../fx/UnitExplosionFx";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

// ── Opt 2: Cache the PIXI display object alongside the Fx ──────────────
interface FxInfo {
  fx: Fx;
  displayObject: PIXI.Container; // cached once at addFx time
  worldX: number;
  worldY: number;
}

// ── Opt 6: Unit types that trigger FX events ────────────────────────────
const NUKE_SMALL_TYPES: ReadonlySet<UnitType> = new Set([
  UnitType.AtomBomb,
  UnitType.MIRVWarhead,
]);

export class FxLayerV2 implements Layer {
  layerName = "FxLayer";
  private renderer: PIXI.Renderer;
  private stage: PIXI.Container;
  private pixicanvas: HTMLCanvasElement;

  private lastRefresh: number = 0;
  private refreshRate: number = 10;
  private adaptiveRefresh: boolean = true;
  private theme: Theme;
  private animatedSpriteLoader: AnimatedSpriteLoader =
    new AnimatedSpriteLoader();

  private allFx: FxInfo[] = [];

  // ── Opt 9: Track count separately to avoid repeated .length reads ─
  private activeCount: number = 0;

  // ── Opt 10: Track whether the scene is dirty (FX added / removed) ─
  private sceneDirty: boolean = false;

  // ── Opt 3: Reusable point for worldToScreenCoordinates ────────────
  private readonly _tmpCell: { x: number; y: number } = { x: 0, y: 0 };

  // ── Opt 8: Cache transform intermediates ──────────────────────────
  // Filled once per position-update batch in _cacheTransform()
  private _txScale: number = 1;
  private _txOffsetX: number = 0;
  private _txOffsetY: number = 0;
  private _txHalfW: number = 0;
  private _txHalfH: number = 0;
  private _txRectLeft: number = 0;
  private _txRectTop: number = 0;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {
    this.theme = this.game.config().theme();
  }

  shouldTransform(): boolean {
    return false;
  }

  async init() {
    this.renderer = new PIXI.WebGLRenderer();
    this.pixicanvas = document.createElement("canvas");
    this.pixicanvas.width = window.innerWidth;
    this.pixicanvas.height = window.innerHeight;

    this.pixicanvas.style.position = "fixed";
    this.pixicanvas.style.left = "0";
    this.pixicanvas.style.top = "0";
    this.pixicanvas.style.width = "100%";
    this.pixicanvas.style.height = "100%";
    this.pixicanvas.style.pointerEvents = "none";
    this.pixicanvas.style.zIndex = "35";
    document.body.appendChild(this.pixicanvas);

    this.stage = new PIXI.Container();

    await this.renderer.init({
      canvas: this.pixicanvas,
      width: this.pixicanvas.width,
      height: this.pixicanvas.height,
      backgroundAlpha: 0,
      clearBeforeRender: true,
    });

    window.addEventListener("resize", () => this.resizeCanvas());

    try {
      await this.animatedSpriteLoader.loadAllAnimatedSpriteImages();
      console.log("FX sprites loaded successfully");
    } catch (err) {
      console.error("Failed to load FX sprites:", err);
    }
  }

  resizeCanvas() {
    if (this.renderer) {
      this.pixicanvas.width = window.innerWidth;
      this.pixicanvas.height = window.innerHeight;
      this.renderer.resize(window.innerWidth, window.innerHeight);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // tick() — Opt 4: direct for-loops, no intermediate arrays
  // ═══════════════════════════════════════════════════════════════════════

  tick() {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    // ── Unit updates ──
    const unitUpdates = updates[GameUpdateType.Unit];
    if (unitUpdates) {
      for (let i = 0, len = unitUpdates.length; i < len; i++) {
        const unitView = this.game.unit(unitUpdates[i].id);
        if (unitView !== undefined) {
          this.onUnitEvent(unitView);
        }
      }
    }

    // ── Bomber explosions ──
    const bomberUpdates = updates[GameUpdateType.BomberExplosion];
    if (bomberUpdates) {
      for (let i = 0, len = bomberUpdates.length; i < len; i++) {
        const update = bomberUpdates[i];
        const bomberFx = nukeFxFactory(
          this.animatedSpriteLoader,
          0,
          0,
          update.radius,
          this.game,
          0.2,
        );
        this.addFxMultiple(bomberFx, update.x, update.y);
      }
    }

    // ── Doomsday explosions ──
    const doomUpdates = updates[GameUpdateType.DoomsdayExplosion];
    if (doomUpdates) {
      for (let i = 0, len = doomUpdates.length; i < len; i++) {
        const update = doomUpdates[i];
        const doomFx = doomsdayFxFactory(
          this.animatedSpriteLoader,
          0,
          0,
          update.radius,
          this.game,
        );
        this.addFxMultiple(doomFx, update.x, update.y);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // addFx — Opt 5: separate single/multiple paths, no Array.isArray
  // ═══════════════════════════════════════════════════════════════════════

  private addFxSingle(fx: Fx, worldX: number, worldY: number) {
    const displayObject = fx.getDisplayObject();
    const info: FxInfo = { fx, displayObject, worldX, worldY };
    this.allFx.push(info);
    this.activeCount++;
    this.stage.addChild(displayObject);
    this.updateFxPositionInline(info);
    this.sceneDirty = true;
  }

  private addFxMultiple(fxList: Fx[], worldX: number, worldY: number) {
    for (let i = 0, len = fxList.length; i < len; i++) {
      this.addFxSingle(fxList[i], worldX, worldY);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Unit event routing — Opt 6: ReadonlySet lookup
  // ═══════════════════════════════════════════════════════════════════════

  private onUnitEvent(unit: UnitView) {
    const type = unit.type();

    if (NUKE_SMALL_TYPES.has(type)) {
      this.onNukeEvent(unit, 70);
    } else if (type === UnitType.HydrogenBomb) {
      this.onNukeEvent(unit, 160);
    } else if (type === UnitType.Warship) {
      this.onWarshipEvent(unit);
    } else if (type === UnitType.Shell) {
      this.onShellEvent(unit);
    } else if (type === UnitType.AABullet) {
      this.onAABulletEvent(unit);
    }
  }

  private onAABulletEvent(unit: UnitView) {
    if (!unit.isActive() && unit.reachedTarget()) {
      const worldX = this.game.x(unit.lastTile());
      const worldY = this.game.y(unit.lastTile());
      this.addFxSingle(
        new SpriteFx(this.animatedSpriteLoader, 0, 0, FxType.MiniExplosion),
        worldX,
        worldY,
      );
    }
  }

  private onShellEvent(unit: UnitView) {
    if (!unit.isActive() && unit.reachedTarget()) {
      const worldX = this.game.x(unit.lastTile());
      const worldY = this.game.y(unit.lastTile());
      this.addFxSingle(
        new SpriteFx(this.animatedSpriteLoader, 0, 0, FxType.MiniExplosion),
        worldX,
        worldY,
      );
    }
  }

  private onWarshipEvent(unit: UnitView) {
    if (!unit.isActive()) {
      const worldX = this.game.x(unit.lastTile());
      const worldY = this.game.y(unit.lastTile());
      this.addFxSingle(
        new UnitExplosionFx(this.animatedSpriteLoader, 0, 0, this.game),
        worldX,
        worldY,
      );
      this.addFxSingle(
        new SpriteFx(
          this.animatedSpriteLoader,
          0,
          0,
          FxType.SinkingShip,
          undefined,
          unit.owner(),
          this.theme,
        ),
        worldX,
        worldY,
      );
    }
  }

  private onNukeEvent(unit: UnitView, radius: number) {
    if (!unit.isActive()) {
      if (!unit.reachedTarget()) {
        this.handleSAMInterception(unit);
      } else {
        this.handleNukeExplosion(unit, radius);
      }
    }
  }

  private handleNukeExplosion(unit: UnitView, radius: number) {
    const worldX = this.game.x(unit.lastTile());
    const worldY = this.game.y(unit.lastTile());
    this.addFxMultiple(
      nukeFxFactory(this.animatedSpriteLoader, 0, 0, radius, this.game),
      worldX,
      worldY,
    );
  }

  private handleSAMInterception(unit: UnitView) {
    const worldX = this.game.x(unit.lastTile());
    const worldY = this.game.y(unit.lastTile());
    this.addFxSingle(
      new SpriteFx(this.animatedSpriteLoader, 0, 0, FxType.SAMExplosion),
      worldX,
      worldY,
    );
    this.addFxSingle(new ShockwaveFx(0, 0, 800, 40), worldX, worldY);
  }

  redraw(): void {
    // No-op
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Position update — Opt 3 + 7 + 8: reuse tmp cell, cache scale,
  // inline worldToScreen math
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Snapshot the transform handler's constants once before a batch of
   * position updates. Avoids repeated property access per FX.
   */
  private _cacheTransform() {
    this._txScale = this.transformHandler.scale;
    // Access the internal offset/width via worldToScreenCoordinates on a
    // known point, then derive the linear transform coefficients.
    // We call once with (0,0) and once with (1,0) to get the two
    // unknowns:
    //   screenX = scale * worldX + bx
    //   screenY = scale * worldY + by

    const a = this.transformHandler.worldToScreenCoordinates(
      new Cell(0, 0) as Cell,
    );
    const b = this.transformHandler.worldToScreenCoordinates(
      new Cell(1, 0) as Cell,
    );
    const sx = b.x - a.x; // effective scale-x
    // For efficiency we pre-compute bx/by from a.
    this._txOffsetX = a.x; // bx = screen(0,0).x
    this._txOffsetY = a.y; // by = screen(0,0).y
    this._txHalfW = sx; // ~= scale * dpr + canvasRect corrections
    // We assume uniform scale (sx === sy)
  }

  /**
   * Inline position update — avoids Cell allocation + return-object.
   * Uses cached transform from `_cacheTransform()`.
   */
  private updateFxPositionFast(fxInfo: FxInfo) {
    const dObj = fxInfo.displayObject;
    dObj.x = this._txOffsetX + fxInfo.worldX * this._txHalfW;
    dObj.y = this._txOffsetY + fxInfo.worldY * this._txHalfW;
    dObj.scale.set(this._txScale);
  }

  /**
   * Fallback for single-FX position update (e.g. in addFxSingle).
   * Still avoids allocation via _tmpCell. (Opt 3)
   */
  private updateFxPositionInline(fxInfo: FxInfo) {
    this._tmpCell.x = fxInfo.worldX;
    this._tmpCell.y = fxInfo.worldY;
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      this._tmpCell as Cell,
    );
    const dObj = fxInfo.displayObject;
    dObj.x = screenPos.x;
    dObj.y = screenPos.y;
    dObj.scale.set(this.transformHandler.scale);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // renderLayer — Opt 1 + 9 + 10
  // ═══════════════════════════════════════════════════════════════════════

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.renderer) return;

    const now = Date.now();
    const fxEnabled = this.game.config().userSettings()?.fxLayer();

    if (fxEnabled) {
      if (now > this.lastRefresh + this.refreshRate) {
        const delta = now - this.lastRefresh;
        this.updateFx(delta);
        this.lastRefresh = now;
      }

      // ── Opt 7 + 8: Batch position update with cached transform ──
      if (this.transformHandler.hasChanged()) {
        this._cacheTransform();
        const arr = this.allFx;
        for (let i = 0, len = this.activeCount; i < len; i++) {
          this.updateFxPositionFast(arr[i]);
        }
      }

      // ── Opt 10: Only call renderer.render when scene has content ──
      if (this.activeCount > 0 || this.sceneDirty) {
        this.renderer.render(this.stage);
        this.sceneDirty = false;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // updateFx — Opt 1: Swap-and-pop removal
  // ═══════════════════════════════════════════════════════════════════════

  updateFx(delta: number) {
    const count = this.activeCount;
    if (count === 0) return;

    const t0 = performance.now();
    const arr = this.allFx;

    let i = 0;
    let len = count;

    while (i < len) {
      const fxInfo = arr[i];
      if (!fxInfo.fx.update(delta)) {
        // ── Opt 1: Swap dead FX with last element, pop ──
        this.stage.removeChild(fxInfo.displayObject); // Opt 2: cached ref
        len--;
        if (i < len) {
          arr[i] = arr[len]; // swap
        }
        arr.length = len; // pop (truncate)
        this.sceneDirty = true;
        // Don't increment i — re-check swapped element
      } else {
        i++;
      }
    }

    this.activeCount = len;

    if (this.adaptiveRefresh) {
      const elapsed = performance.now() - t0;
      this.refreshRate =
        elapsed > 12 ? Math.min(33, Math.ceil(elapsed * 2)) : 16;
    }
  }
}
