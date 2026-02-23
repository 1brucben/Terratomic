/**
 * FxLayer V1 vs V2 Performance Comparison
 * =========================================
 * Runs the same 10 benchmark scenarios against both FxLayer (V1)
 * and FxLayerV2, printing side-by-side results.
 *
 * @jest-environment jsdom
 */

import {
  installCanvasMock,
  mockAnimatedSpriteLoaderModule,
  PIXI_MOCK_MODULE,
  runFxBenchSuite,
} from "./fx-layer-bench-harness";

// ── Must mock pixi.js and AnimatedSpriteLoader BEFORE importing layers ──
jest.mock("pixi.js", () => PIXI_MOCK_MODULE);
mockAnimatedSpriteLoaderModule();

// Mock the sprite image imports (webpack URLs → empty strings)
jest.mock("../../../resources/sprites/bigsmoke.png", () => "bigsmoke.png");
jest.mock(
  "../../../resources/sprites/miniExplosion.png",
  () => "miniExplosion.png",
);
jest.mock("../../../resources/sprites/minifire.png", () => "minifire.png");
jest.mock(
  "../../../resources/sprites/nukeExplosion.png",
  () => "nukeExplosion.png",
);
jest.mock(
  "../../../resources/sprites/samExplosion.png",
  () => "samExplosion.png",
);
jest.mock(
  "../../../resources/sprites/sinkingShip.png",
  () => "sinkingShip.png",
);
jest.mock("../../../resources/sprites/smoke.png", () => "smoke.png");
jest.mock(
  "../../../resources/sprites/smokeAndFire.png",
  () => "smokeAndFire.png",
);
jest.mock(
  "../../../resources/sprites/unitExplosion.png",
  () => "unitExplosion.png",
);

// Mock SpriteLoader.colorizeCanvas
jest.mock("../../../src/client/graphics/SpriteLoader", () => ({
  colorizeCanvas: () => {
    const c = {
      width: 64,
      height: 16,
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({
          data: new Uint8ClampedArray(64 * 16 * 4),
          width: 64,
          height: 16,
        }),
        putImageData: () => {},
        clearRect: () => {},
      }),
    };
    return c;
  },
  getColoredSprite: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FxLayer } = require("../../../src/client/graphics/layers/FxLayer");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FxLayerV2 } = require("../../../src/client/graphics/layers/FxLayerV2");

// ── Install mocks ──
beforeAll(() => {
  jest.spyOn(window, "addEventListener").mockImplementation(() => {});

  (globalThis as any).createImageBitmap = async () => ({
    width: 64,
    height: 16,
    close: () => {},
  });
});

beforeEach(() => {
  installCanvasMock();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Run both suites ──
describe("FxLayer V1 (baseline)", () => {
  runFxBenchSuite(
    "FxLayer V1",
    (game, transformHandler) => new FxLayer(game, transformHandler),
  );
});

describe("FxLayerV2 (optimised)", () => {
  runFxBenchSuite(
    "FxLayerV2",
    (game, transformHandler) => new FxLayerV2(game, transformHandler),
  );
});
