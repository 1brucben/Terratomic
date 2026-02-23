/** @jest-environment jsdom */

import { GestureDetector } from "../../src/client/mobile/gestures/GestureDetector";
import { HapticFeedback } from "../../src/client/mobile/utils/HapticFeedback";

type TouchLike = {
  clientX: number;
  clientY: number;
  radiusX?: number;
  radiusY?: number;
};

function touch(x: number, y: number): TouchLike {
  return { clientX: x, clientY: y, radiusX: 0, radiusY: 0 };
}

describe("GestureDetector", () => {
  let element: HTMLDivElement;
  let detector: GestureDetector;

  beforeEach(() => {
    element = document.createElement("div");
    document.body.appendChild(element);
    detector = new GestureDetector(element);
    jest.spyOn(HapticFeedback, "custom").mockImplementation(() => {});
  });

  afterEach(() => {
    detector.destroy();
    element.remove();
    jest.restoreAllMocks();
  });

  test("emits tap using touch-end position", () => {
    const tapCallback = jest.fn();
    detector.on("tap", tapCallback);

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000);
    (detector as any).onTouchStart({
      touches: [touch(10, 20)],
    } as unknown as TouchEvent);

    nowSpy.mockReturnValueOnce(1100);
    (detector as any).onTouchEnd({
      touches: [],
      changedTouches: [touch(14, 23)],
    } as unknown as TouchEvent);

    expect(tapCallback).toHaveBeenCalledTimes(1);
    expect(tapCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tap",
        position: { x: 14, y: 23 },
      }),
    );
    expect(HapticFeedback.custom).toHaveBeenCalledWith(10);
  });

  test("emits drag with incremental deltas", () => {
    const dragCallback = jest.fn();
    detector.on("drag", dragCallback);

    jest.spyOn(Date, "now").mockReturnValue(1000);

    (detector as any).onTouchStart({
      touches: [touch(100, 100)],
    } as unknown as TouchEvent);

    (detector as any).onTouchMove({
      touches: [touch(120, 110)],
      preventDefault: jest.fn(),
    } as unknown as TouchEvent);

    (detector as any).onTouchMove({
      touches: [touch(127, 116)],
      preventDefault: jest.fn(),
    } as unknown as TouchEvent);

    expect(dragCallback).toHaveBeenCalledTimes(2);
    expect(dragCallback).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ delta: { x: 20, y: 10 } }),
    );
    expect(dragCallback).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ delta: { x: 7, y: 6 } }),
    );
  });
});
