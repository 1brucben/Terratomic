import * as PIXI from "pixi.js";

export interface Fx {
  update(delta: number): boolean;
  getDisplayObject(): PIXI.Container;
}

export enum FxType {
  MiniFire = "MiniFire",
  MiniSmoke = "MiniSmoke",
  MiniBigSmoke = "MiniBigSmoke",
  MiniSmokeAndFire = "MiniSmokeAndFire",
  MiniExplosion = "MiniExplosion",
  UnitExplosion = "UnitExplosion",
  SinkingShip = "SinkingShip",
  Nuke = "Nuke",
  SAMExplosion = "SAMExplosion",
}
