import * as PIXI from "pixi.js";
import { GameView } from "../../../core/game/GameView";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "./Fx";
import { SpriteFx } from "./SpriteFx";
import { Timeline } from "./Timeline";

/**
 * Explosion Effect: a few timed explosions
 */
export class UnitExplosionFx implements Fx {
  private timeline = new Timeline();
  private explosions: Fx[] = [];
  private container: PIXI.Container;

  constructor(
    animatedSpriteLoader: AnimatedSpriteLoader,
    private x: number,
    private y: number,
    game: GameView,
  ) {
    this.container = new PIXI.Container();
    const config = [
      { dx: 0, dy: 0, delay: 0, type: FxType.UnitExplosion },
      { dx: 4, dy: -6, delay: 80, type: FxType.UnitExplosion },
      { dx: -6, dy: 4, delay: 160, type: FxType.UnitExplosion },
    ];
    for (const { dx, dy, delay, type } of config) {
      this.timeline.add(delay, () => {
        if (game.isValidCoord(x + dx, y + dy)) {
          const fx = new SpriteFx(animatedSpriteLoader, x + dx, y + dy, type);
          this.explosions.push(fx);
          this.container.addChild(fx.getDisplayObject());
        }
      });
    }
  }

  update(delta: number): boolean {
    this.timeline.update(delta);
    let allDone = true;

    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const fx = this.explosions[i];
      if (!fx.update(delta)) {
        this.container.removeChild(fx.getDisplayObject());
        this.explosions.splice(i, 1);
      } else {
        allDone = false;
      }
    }

    return !allDone || !this.timeline.isComplete();
  }

  getDisplayObject(): PIXI.Container {
    return this.container;
  }
}
