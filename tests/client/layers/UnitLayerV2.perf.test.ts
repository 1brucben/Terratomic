/**
 * @jest-environment jsdom
 */

/**
 * UnitLayerV2 Performance Benchmark
 * ==================================
 * Benchmarks the optimized UnitLayerV2 using the same shared harness and
 * identical scenarios as the baseline test, enabling direct comparison.
 */

// ── Polyfills for jsdom ──────────────────────────────────────────────────
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

if (typeof globalThis.createImageBitmap === "undefined") {
  (globalThis as any).createImageBitmap = async (img: any) => {
    return {
      width: img.width || 16,
      height: img.height || 16,
      close: () => {},
    };
  };
}

// ── Mocks (identical to baseline) ────────────────────────────────────────

jest.mock("pixi.js", () => {
  class MockContainer {
    children: any[] = [];
    x = 0;
    y = 0;
    rotation = 0;
    alpha = 1;
    visible = true;
    anchor = { set: () => {} };
    scale = { set: () => {}, x: 1, y: 1 };
    texture: any = null;
    addChild(child: any) {
      this.children.push(child);
      return child;
    }
    removeChild(child: any) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
    }
    destroy() {
      this.children = [];
    }
    getBounds() {
      return { x: this.x - 14, y: this.y - 14, width: 28, height: 28 };
    }
  }

  class MockSprite extends MockContainer {
    constructor(texture?: any) {
      super();
      this.texture = texture;
    }
  }

  class MockGraphics extends MockSprite {
    clear() {
      return this;
    }
    lineStyle() {
      return this;
    }
    beginFill() {
      return this;
    }
    endFill() {
      return this;
    }
    drawRect() {
      return this;
    }
    drawPolygon() {
      return this;
    }
    moveTo() {
      return this;
    }
    lineTo() {
      return this;
    }
  }

  class MockTexture {
    static EMPTY = new MockTexture();
    width = 28;
    height = 28;
    static from(_source: any) {
      return new MockTexture();
    }
  }

  class MockWebGLRenderer {
    canvas = { width: 800, height: 600 };
    view = { width: 800, height: 600 };
    async init(_opts: any) {}
    render(_stage: any) {}
    resize() {}
    destroy() {}
  }

  return {
    Container: MockContainer,
    Sprite: MockSprite,
    Graphics: MockGraphics,
    Texture: MockTexture,
    WebGLRenderer: MockWebGLRenderer,
  };
});

jest.mock("../../../../proprietary/images/bomberv3.png", () => "bomber.png", {
  virtual: true,
});
jest.mock(
  "../../../../proprietary/images/tradeship.png",
  () => "tradeship.png",
  { virtual: true },
);
jest.mock(
  "../../../../resources/images/BattleshipIconWhite.svg",
  () => "warship.svg",
  { virtual: true },
);
jest.mock(
  "../../../../resources/images/FighterJetIcon.svg",
  () => "fighter.svg",
  { virtual: true },
);
jest.mock("../../../../resources/images/submarine.svg", () => "submarine.svg", {
  virtual: true,
});

jest.mock("../../../src/client/graphics/SpriteLoader", () => {
  const fakeCanvas = () => ({
    width: 16,
    height: 16,
    getContext: () => ({
      drawImage: jest.fn(),
      getImageData: () => ({
        data: new Uint8ClampedArray(16 * 16 * 4),
        width: 16,
        height: 16,
      }),
      putImageData: jest.fn(),
      fillRect: jest.fn(),
      clearRect: jest.fn(),
      fillStyle: "",
      globalCompositeOperation: "",
    }),
  });
  return {
    getColoredSprite: () => fakeCanvas(),
    isSpriteReady: () => true,
    loadAllSprites: jest.fn().mockResolvedValue(undefined),
    colorizeCanvas: () => fakeCanvas(),
  };
});

jest.mock("../../../src/client/utilities/PerformanceMetrics", () => {
  const mockInstance = {
    enabled: false,
    incrementVisibleEntities: jest.fn(),
    recordUnitRenderTime: jest.fn(),
    recordUnitExecutionTime: jest.fn(),
    recordUnitQuery: jest.fn(),
    recordUnitVisible: jest.fn(),
  };
  return {
    PerformanceMetrics: {
      getInstance: () => mockInstance,
    },
  };
});

jest.mock("../../../src/client/utilities/ReplaySpeedMultiplier", () => ({
  defaultReplaySpeedMultiplier: 1,
}));

jest.mock("../../../src/client/InputHandler", () => ({
  AlternateViewEvent: "AlternateViewEvent",
  MouseUpEvent: "MouseUpEvent",
  UnitSelectionEvent: class {
    constructor(
      public unit: any,
      public isSelected: boolean,
    ) {}
  },
  ReplaySpeedChangeEvent: "ReplaySpeedChangeEvent",
}));

jest.mock("../../../src/client/Transport", () => ({
  ArtilleryOutOfRangeEvent: class {},
  MoveArtilleryIntentEvent: class {},
  MoveFighterJetIntentEvent: class {},
  MoveSubmarineIntentEvent: class {},
  MoveWarshipIntentEvent: class {},
}));

jest.mock("../../../src/core/game/UnitUpgrades", () => ({
  getArtilleryMaxDistance: () => 20,
}));

jest.mock("../../../src/core/utilities/Line", () => ({
  BezenhamLine: class {
    private done = false;
    constructor(
      private start: { x: number; y: number },
      private end: { x: number; y: number },
    ) {}
    increment() {
      if (this.done) return true;
      this.done = true;
      return { x: this.end.x, y: this.end.y };
    }
    size() {
      return 1;
    }
  },
}));

// ── Import and run ───────────────────────────────────────────────────────

import { UnitLayerV2 } from "../../../src/client/graphics/layers/UnitLayerV2";
import { runUnitBenchSuite } from "./unit-layer-bench-harness";

runUnitBenchSuite(
  "UnitLayerV2 (optimized)",
  (game, eventBus, transformHandler, uiState) =>
    new UnitLayerV2(game, eventBus, transformHandler, uiState),
);
