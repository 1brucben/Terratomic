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

// Store FX with world coordinates for repositioning on camera changes
interface FxInfo {
  fx: Fx;
  worldX: number;
  worldY: number;
}

export class FxLayer implements Layer {
  private renderer: PIXI.Renderer;
  private stage: PIXI.Container;
  private pixicanvas: HTMLCanvasElement;

  private lastRefresh: number = 0;
  // Target ~60 FPS for FX layer to reduce CPU (was 10ms ~= 100 FPS)
  private refreshRate: number = 10;
  // Adapt refresh rate under load to reduce CPU spikes
  private adaptiveRefresh: boolean = true;
  private theme: Theme;
  private animatedSpriteLoader: AnimatedSpriteLoader =
    new AnimatedSpriteLoader();

  private allFx: FxInfo[] = [];

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

  tick() {
    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => this.game.unit(unit.id))
      ?.forEach((unitView) => {
        if (unitView === undefined) return;
        this.onUnitEvent(unitView);
      });

    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.BomberExplosion]?.forEach((update) => {
        const bomberFx = nukeFxFactory(
          this.animatedSpriteLoader,
          0,
          0,
          update.radius,
          this.game,
          0.2,
        );
        this.addFx(bomberFx, update.x, update.y);
      });

    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.DoomsdayExplosion]?.forEach((update) => {
        const doomFx = doomsdayFxFactory(
          this.animatedSpriteLoader,
          0,
          0,
          update.radius,
          this.game,
        );
        this.addFx(doomFx, update.x, update.y);
      });
  }

  private addFx(fx: Fx | Fx[], worldX: number, worldY: number) {
    const list = Array.isArray(fx) ? fx : [fx];
    for (const f of list) {
      const info: FxInfo = { fx: f, worldX, worldY };
      this.allFx.push(info);
      this.stage.addChild(f.getDisplayObject());
      // Set initial screen position
      this.updateFxPosition(info);
    }
  }

  onUnitEvent(unit: UnitView) {
    switch (unit.type()) {
      case UnitType.AtomBomb:
      case UnitType.MIRVWarhead:
        this.onNukeEvent(unit, 70);
        break;
      case UnitType.HydrogenBomb:
        this.onNukeEvent(unit, 160);
        break;
      case UnitType.Warship:
        this.onWarshipEvent(unit);
        break;
      case UnitType.Shell:
        this.onShellEvent(unit);
        break;
      case UnitType.AABullet:
        this.onAABulletEvent(unit);
        break;
    }
  }

  onAABulletEvent(unit: UnitView) {
    if (!unit.isActive()) {
      if (unit.reachedTarget()) {
        // Small flash effect when bullet hits
        const worldX = this.game.x(unit.lastTile());
        const worldY = this.game.y(unit.lastTile());
        const flash = new SpriteFx(
          this.animatedSpriteLoader,
          0,
          0,
          FxType.MiniExplosion,
        );
        this.addFx(flash, worldX, worldY);
      }
    }
  }

  onShellEvent(unit: UnitView) {
    if (!unit.isActive()) {
      if (unit.reachedTarget()) {
        const worldX = this.game.x(unit.lastTile());
        const worldY = this.game.y(unit.lastTile());
        const shipExplosion = new SpriteFx(
          this.animatedSpriteLoader,
          0,
          0,
          FxType.MiniExplosion,
        );
        this.addFx(shipExplosion, worldX, worldY);
      }
    }
  }

  onWarshipEvent(unit: UnitView) {
    if (!unit.isActive()) {
      const worldX = this.game.x(unit.lastTile());
      const worldY = this.game.y(unit.lastTile());
      const shipExplosion = new UnitExplosionFx(
        this.animatedSpriteLoader,
        0,
        0,
        this.game,
      );
      this.addFx(shipExplosion, worldX, worldY);
      const sinkingShip = new SpriteFx(
        this.animatedSpriteLoader,
        0,
        0,
        FxType.SinkingShip,
        undefined,
        unit.owner(),
        this.theme,
      );
      this.addFx(sinkingShip, worldX, worldY);
    }
  }

  onNukeEvent(unit: UnitView, radius: number) {
    if (!unit.isActive()) {
      if (!unit.reachedTarget()) {
        this.handleSAMInterception(unit);
      } else {
        // Kaboom
        this.handleNukeExplosion(unit, radius);
      }
    }
  }

  handleNukeExplosion(unit: UnitView, radius: number) {
    const worldX = this.game.x(unit.lastTile());
    const worldY = this.game.y(unit.lastTile());
    const nukeFx = nukeFxFactory(
      this.animatedSpriteLoader,
      0,
      0,
      radius,
      this.game,
    );
    this.addFx(nukeFx, worldX, worldY);
  }

  handleSAMInterception(unit: UnitView) {
    const worldX = this.game.x(unit.lastTile());
    const worldY = this.game.y(unit.lastTile());
    const explosion = new SpriteFx(
      this.animatedSpriteLoader,
      0,
      0,
      FxType.SAMExplosion,
    );
    this.addFx(explosion, worldX, worldY);
    const shockwave = new ShockwaveFx(0, 0, 800, 40);
    this.addFx(shockwave, worldX, worldY);
  }

  redraw(): void {
    // No-op
  }

  private updateFxPosition(fxInfo: FxInfo) {
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(fxInfo.worldX, fxInfo.worldY),
    );
    const displayObject = fxInfo.fx.getDisplayObject();
    displayObject.x = screenPos.x;
    displayObject.y = screenPos.y;
    // Scale FX based on zoom level
    const scale = this.transformHandler.scale;
    displayObject.scale.set(scale);
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.renderer) return;

    const now = Date.now();
    if (this.game.config().userSettings()?.fxLayer()) {
      if (now > this.lastRefresh + this.refreshRate) {
        const delta = now - this.lastRefresh;
        this.updateFx(delta);
        this.lastRefresh = now;
      }

      // Update FX positions when camera changes (like StructureLayer)
      if (this.transformHandler.hasChanged()) {
        for (const fxInfo of this.allFx) {
          this.updateFxPosition(fxInfo);
        }
      }

      this.renderer.render(this.stage);

      context.drawImage(this.pixicanvas, 0, 0);
    }
  }

  updateFx(delta: number) {
    if (this.allFx.length > 0) {
      const t0 = performance.now();

      for (let i = this.allFx.length - 1; i >= 0; i--) {
        const fxInfo = this.allFx[i];
        if (!fxInfo.fx.update(delta)) {
          this.stage.removeChild(fxInfo.fx.getDisplayObject());
          this.allFx.splice(i, 1);
        }
      }

      if (this.adaptiveRefresh) {
        const elapsed = performance.now() - t0;
        this.refreshRate =
          elapsed > 12 ? Math.min(33, Math.ceil(elapsed * 2)) : 16;
      }
    }
  }
}
