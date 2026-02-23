/** @jest-environment jsdom */

import { MobileDetector } from "../../src/client/mobile/MobileDetector";

describe("MobileDetector", () => {
  const originalUserAgent = navigator.userAgent;
  const originalMaxTouchPoints = navigator.maxTouchPoints;

  function setUserAgent(userAgent: string): void {
    Object.defineProperty(window.navigator, "userAgent", {
      value: userAgent,
      configurable: true,
    });
  }

  function setMaxTouchPoints(value: number): void {
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      value,
      configurable: true,
    });
  }

  function setViewport(width: number, height: number): void {
    Object.defineProperty(window, "innerWidth", {
      value: width,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: height,
      configurable: true,
    });
  }

  beforeEach(() => {
    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: true,
      media: "(pointer: coarse)",
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  });

  afterEach(() => {
    setUserAgent(originalUserAgent);
    setMaxTouchPoints(originalMaxTouchPoints);
    jest.restoreAllMocks();
  });

  test("detects iPad desktop-mode UA as mobile UI", () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    );
    setMaxTouchPoints(5);
    setViewport(1180, 820);

    expect(MobileDetector.isMobile()).toBe(true);
  });

  test("detects Android tablet viewport with touch profile as mobile UI", () => {
    setUserAgent(
      "Mozilla/5.0 (Linux; Android 14; SM-X610) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    );
    setMaxTouchPoints(10);
    setViewport(1180, 820);

    expect(MobileDetector.isMobile()).toBe(true);
  });

  test("keeps desktop browser as desktop UI", () => {
    setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    );
    setMaxTouchPoints(0);
    setViewport(1366, 768);

    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: false,
      media: "(pointer: coarse)",
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    expect(MobileDetector.isMobile()).toBe(false);
  });
});
