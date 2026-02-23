/**
 * @jest-environment jsdom
 */

/**
 * TerritoryLayer (Canvas2D) Performance Benchmark
 * =================================================
 * Uses the shared harness to benchmark the current Canvas2D-based
 * TerritoryLayer implementation. To benchmark an alternative
 * implementation (WebGL, Pixi, OffscreenCanvas, etc.), create a new
 * test file that imports the same harness and passes a different factory:
 *
 *   import { runTerritoryBenchSuite } from "./territory-layer-bench-harness";
 *   import { MyWebGLTerritoryLayer } from "...";
 *
 *   runTerritoryBenchSuite("WebGL TerritoryLayer", (game, eventBus, transform) =>
 *     new MyWebGLTerritoryLayer(game, eventBus, transform),
 *   );
 */

// jsdom doesn't provide ImageData — polyfill before any imports that need it
if (typeof globalThis.ImageData === "undefined") {
  (globalThis as any).ImageData = class ImageData {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    constructor(sw: number, sh: number);
    constructor(data: Uint8ClampedArray, sw: number, sh?: number);
    constructor(
      swOrData: number | Uint8ClampedArray,
      shOrSw: number,
      maybeH?: number,
    ) {
      if (swOrData instanceof Uint8ClampedArray) {
        this.data = swOrData;
        this.width = shOrSw;
        this.height = maybeH ?? swOrData.length / 4 / shOrSw;
      } else {
        this.width = swOrData;
        this.height = shOrSw;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}

import { TerritoryLayer } from "../../../src/client/graphics/layers/TerritoryLayer";
import { runTerritoryBenchSuite } from "./territory-layer-bench-harness";

runTerritoryBenchSuite(
  "Canvas2D TerritoryLayer",
  (game, eventBus, transformHandler) =>
    new TerritoryLayer(game, eventBus, transformHandler),
);
