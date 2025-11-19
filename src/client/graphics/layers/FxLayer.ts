import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "../fx/Fx";
import { doomsdayFxFactory, nukeFxFactory, ShockwaveFx } from "../fx/NukeFx";
import { SpriteFx } from "../fx/SpriteFx";
import { UnitExplosionFx } from "../fx/UnitExplosionFx";
import { Layer } from "./Layer";

export class FxLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  private lastRefresh: number = 0;
  // Target ~60 FPS for FX layer to reduce CPU (was 10ms ~= 100 FPS)
  private refreshRate: number = 10;
  // Adapt refresh rate under load to reduce CPU spikes
  private adaptiveRefresh: boolean = true;
  private theme: Theme;
  private animatedSpriteLoader: AnimatedSpriteLoader =
    new AnimatedSpriteLoader();

  private allFx: Fx[] = [];

  constructor(private game: GameView) {
    this.theme = this.game.config().theme();
  }

  shouldTransform(): boolean {
    return true;
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
        const { x, y, radius } = update;
        const bomberFx = nukeFxFactory(
          this.animatedSpriteLoader,
          x,
          y,
          radius,
          this.game,
          0.2,
        );
        for (const fx of bomberFx) {
          this.allFx.push(fx);
        }
      });

    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.DoomsdayExplosion]?.forEach((update) => {
        const { x, y, radius } = update;
        const doomFx = doomsdayFxFactory(
          this.animatedSpriteLoader,
          x,
          y,
          radius,
          this.game,
        );
        for (const fx of doomFx) {
          this.allFx.push(fx);
        }
      });
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
    }
  }

  onShellEvent(unit: UnitView) {
    if (!unit.isActive()) {
      if (unit.reachedTarget()) {
        const x = this.game.x(unit.lastTile());
        const y = this.game.y(unit.lastTile());
        const shipExplosion = new SpriteFx(
          this.animatedSpriteLoader,
          x,
          y,
          FxType.MiniExplosion,
        );
        this.allFx.push(shipExplosion);
      }
    }
  }

  onWarshipEvent(unit: UnitView) {
    if (!unit.isActive()) {
      const x = this.game.x(unit.lastTile());
      const y = this.game.y(unit.lastTile());
      const shipExplosion = new UnitExplosionFx(
        this.animatedSpriteLoader,
        x,
        y,
        this.game,
      );
      this.allFx.push(shipExplosion);
      const sinkingShip = new SpriteFx(
        this.animatedSpriteLoader,
        x,
        y,
        FxType.SinkingShip,
        undefined,
        unit.owner(),
        this.theme,
      );
      this.allFx.push(sinkingShip);
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
    const x = this.game.x(unit.lastTile());
    const y = this.game.y(unit.lastTile());
    const nukeFx = nukeFxFactory(
      this.animatedSpriteLoader,
      x,
      y,
      radius,
      this.game,
    );
    for (const fx of nukeFx) {
      this.allFx.push(fx);
    }
  }

  handleSAMInterception(unit: UnitView) {
    const x = this.game.x(unit.lastTile());
    const y = this.game.y(unit.lastTile());
    const explosion = new SpriteFx(
      this.animatedSpriteLoader,
      x,
      y,
      FxType.SAMExplosion,
    );
    this.allFx.push(explosion);
    const shockwave = new ShockwaveFx(x, y, 800, 40);
    this.allFx.push(shockwave);
  }

  async init() {
    this.redraw();
    try {
      this.animatedSpriteLoader.loadAllAnimatedSpriteImages();
      console.log("FX sprites loaded successfully");
    } catch (err) {
      console.error("Failed to load FX sprites:", err);
    }
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

  renderLayer(context: CanvasRenderingContext2D) {
    const now = Date.now();
    if (this.game.config().userSettings()?.fxLayer()) {
      if (now > this.lastRefresh + this.refreshRate) {
        const delta = now - this.lastRefresh;
        this.renderAllFx(context, delta);
        this.lastRefresh = now;
      }
      // If the offscreen canvas size matches the game size, use 3-arg drawImage (no scaling) for minor perf gain.
      // Otherwise, fall back to 5-arg drawImage to scale correctly.
      if (
        this.canvas.width === this.game.width() &&
        this.canvas.height === this.game.height()
      ) {
        context.drawImage(
          this.canvas,
          -this.game.width() / 2,
          -this.game.height() / 2,
        );
      } else {
        context.drawImage(
          this.canvas,
          -this.game.width() / 2,
          -this.game.height() / 2,
          this.game.width(),
          this.game.height(),
        );
      }
    }
  }

  renderAllFx(context: CanvasRenderingContext2D, delta: number) {
    if (this.allFx.length > 0) {
      const t0 = performance.now();
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.renderContextFx(delta);
      if (this.adaptiveRefresh) {
        const elapsed = performance.now() - t0;
        // If FX rendering takes longer than ~12ms, drop FX FPS a bit
        this.refreshRate =
          elapsed > 12 ? Math.min(33, Math.ceil(elapsed * 2)) : 16;
      }
    }
  }

  renderContextFx(duration: number) {
    for (let i = 0; i < this.allFx.length; ) {
      const fx = this.allFx[i];
      if (!fx.renderTick(duration, this.context)) {
        const last = this.allFx.length - 1;
        if (i !== last) this.allFx[i] = this.allFx[last];
        this.allFx.pop();
      } else {
        i++;
      }
    }
  }
}
