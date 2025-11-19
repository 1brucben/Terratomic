import * as PIXI from "pixi.js";
import { GameView } from "../../../core/game/GameView";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "./Fx";
import { FadeFx, SpriteFx } from "./SpriteFx";

/**
 * Shockwave effect: draw a growing 1px white circle
 */
export class ShockwaveFx implements Fx {
  private lifeTime: number = 0;
  private graphics: PIXI.Graphics;
  private container: PIXI.Container;

  constructor(
    private x: number,
    private y: number,
    private duration: number,
    private maxRadius: number,
  ) {
    this.container = new PIXI.Container();
    this.container.position.set(x, y);
    this.graphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);
  }

  update(delta: number): boolean {
    this.lifeTime += delta;
    if (this.lifeTime >= this.duration) {
      return false;
    }
    const t = this.lifeTime / this.duration;
    const radius = t * this.maxRadius;

    this.graphics.clear();
    this.graphics.circle(0, 0, radius);
    this.graphics.stroke({ width: 0.5, color: 0xffffff, alpha: 1 - t });

    return true;
  }

  getDisplayObject(): PIXI.Container {
    return this.container;
  }
}

/**
 * Spawn @p number of @p type animation within a perimeter
 */
function addSpriteInCircle(
  animatedSpriteLoader: AnimatedSpriteLoader,
  x: number,
  y: number,
  radius: number,
  num: number,
  type: FxType,
  result: Fx[],
  game: GameView,
  scale: number = 1,
) {
  const count = Math.max(0, Math.floor(num));
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * (radius / 2);
    const spawnX = Math.floor(x + Math.cos(angle) * distance);
    const spawnY = Math.floor(y + Math.sin(angle) * distance);
    if (
      game.isValidCoord(spawnX, spawnY) &&
      game.isLand(game.ref(spawnX, spawnY))
    ) {
      const sprite = new FadeFx(
        new SpriteFx(
          animatedSpriteLoader,
          spawnX,
          spawnY,
          type,
          6000,
          undefined,
          undefined,
          scale,
        ),
        0.1,
        0.8,
      );
      result.push(sprite as Fx);
    }
  }
}

/**
 * Explosion effect:
 * - explosion animation
 * - shockwave
 * - ruins and desolation fx
 */
export function nukeFxFactory(
  animatedSpriteLoader: AnimatedSpriteLoader,
  x: number,
  y: number,
  radius: number,
  game: GameView,
  scale: number = 1,
): Fx[] {
  const nukeFx: Fx[] = [];
  // Explosion animation
  nukeFx.push(
    new SpriteFx(
      animatedSpriteLoader,
      x,
      y,
      FxType.Nuke,
      undefined,
      undefined,
      undefined,
      scale,
    ),
  );
  // Shockwave animation
  nukeFx.push(new ShockwaveFx(x, y, 1500, radius * 1.5));
  // Ruins and desolation sprites
  const debrisPlan: Array<{
    type: FxType;
    radiusFactor: number;
    density: number;
  }> = [
    { type: FxType.MiniFire, radiusFactor: 1.0, density: 1 / 25 },
    { type: FxType.MiniSmoke, radiusFactor: 1.0, density: 1 / 28 },
    { type: FxType.MiniBigSmoke, radiusFactor: 0.9, density: 1 / 70 },
    { type: FxType.MiniSmokeAndFire, radiusFactor: 0.9, density: 1 / 70 },
  ];

  for (const { type, radiusFactor, density } of debrisPlan) {
    addSpriteInCircle(
      animatedSpriteLoader,
      x,
      y,
      radius * radiusFactor,
      radius * density,
      type,
      nukeFx,
      game,
      scale,
    );
  }
  return nukeFx;
}

/**
 * Slower, larger, more lingering FX for Doomsday device trigger.
 * - Larger shockwave (longer duration)
 * - Higher density lingering smoke/fire with longer fade
 */
export function doomsdayFxFactory(
  animatedSpriteLoader: AnimatedSpriteLoader,
  x: number,
  y: number,
  radius: number,
  game: GameView,
  scale: number = 1.2,
): Fx[] {
  const fx: Fx[] = [];
  // Central sustained explosion sprite (scaled up)
  fx.push(
    new SpriteFx(
      animatedSpriteLoader,
      x,
      y,
      FxType.Nuke,
      undefined,
      undefined,
      undefined,
      scale,
    ),
  );
  // Slower shockwave (duration 6000ms, larger reach)
  fx.push(new ShockwaveFx(x, y, 6000, radius * 2));
  // Lingering debris plan (higher density, longer fade via FadeFx wrapper)
  const debrisPlan: Array<{
    type: FxType;
    radiusFactor: number;
    density: number;
    fadeIn: number;
    fadeOut: number;
  }> = [
    {
      type: FxType.MiniFire,
      radiusFactor: 1.3,
      density: 1 / 18,
      fadeIn: 0.2,
      fadeOut: 1.5,
    },
    {
      type: FxType.MiniSmoke,
      radiusFactor: 1.4,
      density: 1 / 20,
      fadeIn: 0.2,
      fadeOut: 1.8,
    },
    {
      type: FxType.MiniBigSmoke,
      radiusFactor: 1.2,
      density: 1 / 50,
      fadeIn: 0.2,
      fadeOut: 2.0,
    },
    {
      type: FxType.MiniSmokeAndFire,
      radiusFactor: 1.1,
      density: 1 / 55,
      fadeIn: 0.2,
      fadeOut: 2.2,
    },
  ];
  for (const { type, radiusFactor, density, fadeIn, fadeOut } of debrisPlan) {
    const count = Math.max(0, Math.floor(radius * density));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const distance = Math.random() * (radius * radiusFactor);
      const sx = Math.floor(x + Math.cos(angle) * distance * 0.5);
      const sy = Math.floor(y + Math.sin(angle) * distance * 0.5);
      if (game.isValidCoord(sx, sy) && game.isLand(game.ref(sx, sy))) {
        fx.push(
          new FadeFx(
            new SpriteFx(animatedSpriteLoader, sx, sy, type),
            fadeIn,
            fadeOut,
          ) as Fx,
        );
      }
    }
  }
  return fx;
}
