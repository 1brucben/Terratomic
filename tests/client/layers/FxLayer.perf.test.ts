/**
 * FxLayer Performance Benchmark
 * ==============================
 * Baseline benchmark for the Canvas2D+PIXI FxLayer.
 * Uses the fx-layer-bench-harness factory pattern so results can be
 * compared against alternative implementations.
 *
 * @jest-environment jsdom
 */

import {
  installCanvasMock,
  mockAnimatedSpriteLoaderModule,
  PIXI_MOCK_MODULE,
  runFxBenchSuite,
} from "./fx-layer-bench-harness";

// ── Must mock pixi.js and AnimatedSpriteLoader BEFORE importing FxLayer ──
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

// Mock SpriteLoader.colorizeCanvas (used by AnimatedSpriteLoader)
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

// ── Install mocks ──
beforeAll(() => {
  // Stub window.addEventListener for resize handler
  jest.spyOn(window, "addEventListener").mockImplementation(() => {});

  // Stub createImageBitmap (used by AnimatedSpriteLoader.loadAllAnimatedSpriteImages)
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

// ── Run the benchmark suite ──
describe("FxLayer (baseline)", () => {
  runFxBenchSuite(
    "FxLayer (baseline)",
    (game, transformHandler) => new FxLayer(game, transformHandler),
  );
});
