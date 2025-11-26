import * as PIXI from "pixi.js";
import miniBigSmoke from "../../../resources/sprites/bigsmoke.png";
import miniExplosion from "../../../resources/sprites/miniExplosion.png";
import miniFire from "../../../resources/sprites/minifire.png";
import nuke from "../../../resources/sprites/nukeExplosion.png";
import SAMExplosion from "../../../resources/sprites/samExplosion.png";
import sinkingShip from "../../../resources/sprites/sinkingShip.png";
import miniSmoke from "../../../resources/sprites/smoke.png";
import miniSmokeAndFire from "../../../resources/sprites/smokeAndFire.png";
import unitExplosion from "../../../resources/sprites/unitExplosion.png";
import type { Theme } from "../../core/configuration/Config";
import type { PlayerView } from "../../core/game/GameView";
import { AnimatedSprite } from "./AnimatedSprite";
import { FxType } from "./fx/Fx";
import { colorizeCanvas } from "./SpriteLoader";

type AnimatedSpriteConfig = {
  url: string;
  frameWidth: number;
  frameCount: number;
  frameDuration: number; // ms per frame
  looping?: boolean;
  originX: number;
  originY: number;
};

const ANIMATED_SPRITE_CONFIG: Partial<Record<FxType, AnimatedSpriteConfig>> = {
  [FxType.MiniFire]: {
    url: miniFire,
    frameWidth: 7,
    frameCount: 6,
    frameDuration: 100,
    looping: true,
    originX: 3,
    originY: 11,
  },
  [FxType.MiniSmoke]: {
    url: miniSmoke,
    frameWidth: 11,
    frameCount: 4,
    frameDuration: 120,
    looping: true,
    originX: 2,
    originY: 10,
  },
  [FxType.MiniBigSmoke]: {
    url: miniBigSmoke,
    frameWidth: 24,
    frameCount: 5,
    frameDuration: 120,
    looping: true,
    originX: 9,
    originY: 14,
  },
  [FxType.MiniSmokeAndFire]: {
    url: miniSmokeAndFire,
    frameWidth: 24,
    frameCount: 5,
    frameDuration: 120,
    looping: true,
    originX: 9,
    originY: 14,
  },
  [FxType.MiniExplosion]: {
    url: miniExplosion,
    frameWidth: 13,
    frameCount: 4,
    frameDuration: 70,
    looping: false,
    originX: 6,
    originY: 6,
  },
  [FxType.UnitExplosion]: {
    url: unitExplosion,
    frameWidth: 19,
    frameCount: 4,
    frameDuration: 70,
    looping: false,
    originX: 9,
    originY: 9,
  },
  [FxType.SinkingShip]: {
    url: sinkingShip,
    frameWidth: 16,
    frameCount: 14,
    frameDuration: 90,
    looping: false,
    originX: 7,
    originY: 7,
  },
  [FxType.Nuke]: {
    url: nuke,
    frameWidth: 60,
    frameCount: 9,
    frameDuration: 70,
    looping: false,
    originX: 30,
    originY: 30,
  },
  [FxType.SAMExplosion]: {
    url: SAMExplosion,
    frameWidth: 48,
    frameCount: 9,
    frameDuration: 70,
    looping: false,
    originX: 23,
    originY: 19,
  },
};

export class AnimatedSpriteLoader {
  // Store base sprite sheets as ImageBitmap for faster drawImage
  private animatedSpriteImageMap: Map<FxType, CanvasImageSource> = new Map();
  // Do not color the same sprite twice
  private coloredAnimatedSpriteCache: Map<string, HTMLCanvasElement> =
    new Map();

  public async loadAllAnimatedSpriteImages(): Promise<void> {
    const entries = Object.entries(ANIMATED_SPRITE_CONFIG);

    await Promise.all(
      entries.map(async ([fxType, config]) => {
        const typedFxType = fxType as FxType;
        if (!config?.url) return;

        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = config.url;

          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = (e) => reject(e);
          });

          // Prefer ImageBitmap for better blit performance
          const bitmap = await createImageBitmap(img);
          this.animatedSpriteImageMap.set(typedFxType, bitmap);
        } catch (err) {
          console.error(`Failed to load sprite for ${typedFxType}:`, err);
        }
      }),
    );
  }

  private createRegularAnimatedSprite(
    fxType: FxType,
    scale: number = 1,
  ): AnimatedSprite | null {
    const config = ANIMATED_SPRITE_CONFIG[fxType];
    const image = this.animatedSpriteImageMap.get(fxType);
    if (!config || !image) return null;

    return new AnimatedSprite(
      image,
      config.frameWidth,
      config.frameCount,
      config.frameDuration,
      config.looping ?? true,
      config.originX,
      config.originY,
      scale,
    );
  }

  private getColoredAnimatedSprite(
    owner: PlayerView,
    fxType: FxType,
    theme: Theme,
  ): HTMLCanvasElement | null {
    const baseImage = this.animatedSpriteImageMap.get(fxType);
    const config = ANIMATED_SPRITE_CONFIG[fxType];
    if (!baseImage || !config) return null;
    const territoryColor = theme.territoryColor(owner);
    const borderColor = theme.borderColor(owner);
    const spawnHighlightColor = theme.spawnHighlightColor();
    const key = `${fxType}-${owner.id()}`;
    let coloredCanvas: HTMLCanvasElement;
    if (this.coloredAnimatedSpriteCache.has(key)) {
      coloredCanvas = this.coloredAnimatedSpriteCache.get(key)!;
    } else {
      coloredCanvas = colorizeCanvas(
        baseImage as CanvasImageSource & { width: number; height: number },
        territoryColor,
        borderColor,
        spawnHighlightColor,
      );

      this.coloredAnimatedSpriteCache.set(key, coloredCanvas);
    }
    return coloredCanvas;
  }

  private createColoredAnimatedSpriteForUnit(
    fxType: FxType,
    owner: PlayerView,
    theme: Theme,
    scale: number = 1,
  ): AnimatedSprite | null {
    const config = ANIMATED_SPRITE_CONFIG[fxType];
    const image = this.getColoredAnimatedSprite(owner, fxType, theme);
    if (!config || !image) return null;

    return new AnimatedSprite(
      image,
      config.frameWidth,
      config.frameCount,
      config.frameDuration,
      config.looping ?? true,
      config.originX,
      config.originY,
      scale,
    );
  }

  public createAnimatedSprite(
    fxType: FxType,
    owner?: PlayerView,
    theme?: Theme,
    scale: number = 1,
  ): AnimatedSprite | null {
    if (owner && theme) {
      return this.createColoredAnimatedSpriteForUnit(
        fxType,
        owner,
        theme,
        scale,
      );
    }
    return this.createRegularAnimatedSprite(fxType, scale);
  }

  public getPixiTextures(
    fxType: FxType,
    owner?: PlayerView,
    theme?: Theme,
  ): PIXI.Texture[] | null {
    const config = ANIMATED_SPRITE_CONFIG[fxType];
    if (!config) return null;

    let image: CanvasImageSource | null = null;
    if (owner && theme) {
      image = this.getColoredAnimatedSprite(owner, fxType, theme);
    } else {
      image = this.animatedSpriteImageMap.get(fxType) ?? null;
    }

    if (!image) return null;

    const base = PIXI.Texture.from(image as any);
    const textures: PIXI.Texture[] = [];
    for (let i = 0; i < config.frameCount; i++) {
      const rect = new PIXI.Rectangle(
        i * config.frameWidth,
        0,
        config.frameWidth,
        (image as any).height,
      );
      textures.push(new PIXI.Texture({ source: base.source, frame: rect }));
    }
    return textures;
  }

  public getConfig(fxType: FxType) {
    return ANIMATED_SPRITE_CONFIG[fxType];
  }
}
