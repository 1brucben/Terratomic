import * as PIXI from "pixi.js";
import { Theme } from "../../../core/configuration/Config";
import { PlayerView } from "../../../core/game/GameView";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "./Fx";

function fadeInOut(
  t: number,
  fadeIn: number = 0.3,
  fadeOut: number = 0.7,
): number {
  if (t < fadeIn) {
    const f = t / fadeIn; // Map to [0, 1]
    return f * f;
  } else if (t < fadeOut) {
    return 1;
  } else {
    const f = (t - fadeOut) / (1 - fadeOut); // Map to [0, 1]
    return 1 - f * f;
  }
}
/**
 * Fade in/out another FX
 */
export class FadeFx implements Fx {
  constructor(
    private fxToFade: SpriteFx,
    private fadeIn: number,
    private fadeOut: number,
  ) {}

  update(delta: number): boolean {
    const t = this.fxToFade.getElapsedTime() / this.fxToFade.getDuration();
    const alpha = fadeInOut(t, this.fadeIn, this.fadeOut);
    this.fxToFade.getDisplayObject().alpha = alpha;
    return this.fxToFade.update(delta);
  }

  getDisplayObject(): PIXI.Container {
    return this.fxToFade.getDisplayObject();
  }
}

/**
 * Animated sprite. Can be colored if provided an owner/theme
 */
export class SpriteFx implements Fx {
  protected sprite: PIXI.AnimatedSprite | null = null;
  protected container: PIXI.Container;
  protected elapsedTime = 0;
  protected duration = 1000;
  protected animationTime = 0;

  constructor(
    animatedSpriteLoader: AnimatedSpriteLoader,
    protected x: number,
    protected y: number,
    fxType: FxType,
    duration?: number,
    private owner?: PlayerView,
    private theme?: Theme,
    scale: number = 1,
  ) {
    this.container = new PIXI.Container();
    this.container.position.set(x, y);

    const textures = animatedSpriteLoader.getPixiTextures(fxType, owner, theme);
    const config = animatedSpriteLoader.getConfig(fxType);

    if (textures && config) {
      this.sprite = new PIXI.AnimatedSprite(textures);
      this.sprite.autoUpdate = false;
      this.sprite.loop = config.looping ?? true;

      // Anchor
      const texture = textures[0];
      this.sprite.anchor.set(
        config.originX / config.frameWidth,
        config.originY / texture.height,
      );

      this.sprite.scale.set(scale);
      // this.sprite.play(); // We manually update
      this.container.addChild(this.sprite);

      // Calculate duration if not provided
      if (duration) {
        this.duration = duration;
      } else {
        this.duration = config.frameCount * config.frameDuration;
        if (config.looping) {
          this.duration = Infinity;
        }
      }

      // Store frame duration for update
      (this.sprite as any).msPerFrame = config.frameDuration;
    } else {
      console.error("Could not load animated sprite", fxType);
    }
  }

  update(delta: number): boolean {
    if (!this.sprite) return false;

    this.elapsedTime += delta;
    if (this.duration !== Infinity && this.elapsedTime >= this.duration) {
      return false;
    }

    const msPerFrame = (this.sprite as any).msPerFrame || 100;
    this.animationTime += delta;

    const frameIndex = Math.floor(this.animationTime / msPerFrame);

    if (this.sprite.loop) {
      this.sprite.gotoAndStop(frameIndex % this.sprite.totalFrames);
    } else {
      if (frameIndex < this.sprite.totalFrames) {
        this.sprite.gotoAndStop(frameIndex);
      } else {
        // Animation finished, but we might wait for duration
        this.sprite.gotoAndStop(this.sprite.totalFrames - 1);
      }
    }

    return true;
  }

  getElapsedTime(): number {
    return this.elapsedTime;
  }

  getDuration(): number {
    return this.duration;
  }

  getDisplayObject(): PIXI.Container {
    return this.container;
  }
}
