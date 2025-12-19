/**
 * @jest-environment jsdom
 */

import { TutorialManager } from "../../src/client/TutorialManager";

// Mock UserSettings
jest.mock("../../src/core/game/UserSettings", () => {
  return {
    UserSettings: jest.fn().mockImplementation(() => {
      let enabled = true;
      return {
        tutorialEnabled: jest.fn(() => enabled),
        set: jest.fn((key: string, value: boolean) => {
          if (key === "settings.tutorialEnabled") {
            enabled = value;
          }
        }),
        getTutorialState: jest.fn(() => ({})),
        resetTutorialProgress: jest.fn(),
      };
    }),
  };
});

// Mock translateText
jest.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => {
    const translations: Record<string, string> = {
      "tutorial.spawn_welcome.title": "Welcome to Terratomic!",
      "tutorial.spawn_welcome.description":
        "Click anywhere on the map to spawn.",
      "tutorial.first_city.title": "Build Your First City",
      "tutorial.first_city.description": "Cities increase your population cap.",
      "tutorial.first_factory.title": "Build Your First Factory",
      "tutorial.first_factory.description": "Factories boost gold generation.",
    };
    return translations[key] || key;
  },
}));

describe("TutorialManager", () => {
  let manager: TutorialManager;
  let dispatchedEvents: CustomEvent[];

  beforeEach(() => {
    manager = new TutorialManager();
    dispatchedEvents = [];

    // Mock window.dispatchEvent
    jest.spyOn(window, "dispatchEvent").mockImplementation((event) => {
      dispatchedEvents.push(event as CustomEvent);
      return true;
    });

    // Reset time
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe("showTip", () => {
    it("should dispatch event when tutorials are enabled", () => {
      manager.showTip("spawn_welcome");

      expect(dispatchedEvents).toHaveLength(1);
      expect(dispatchedEvents[0].type).toBe("show-tutorial-tip");
      expect(dispatchedEvents[0].detail).toEqual({
        id: "spawn_welcome",
        title: "Welcome to Terratomic!",
        description: "Click anywhere on the map to spawn.",
      });
    });

    it("should not show tip when tutorials are disabled", () => {
      manager.setEnabled(false);
      manager.showTip("spawn_welcome");

      expect(dispatchedEvents).toHaveLength(0);
    });

    it("should show tip when forced even if disabled", () => {
      manager.setEnabled(false);
      manager.showTip("spawn_welcome", true);

      expect(dispatchedEvents).toHaveLength(1);
    });

    it("should not show same tip twice in one session", () => {
      manager.showTip("spawn_welcome");
      manager.showTip("spawn_welcome");

      expect(dispatchedEvents).toHaveLength(1);
    });

    it("should show different tips in sequence", () => {
      manager.showTip("spawn_welcome");
      jest.advanceTimersByTime(3000); // Wait for rate limit
      manager.showTip("first_city");

      expect(dispatchedEvents).toHaveLength(2);
      expect(dispatchedEvents[0].detail.id).toBe("spawn_welcome");
      expect(dispatchedEvents[1].detail.id).toBe("first_city");
    });
  });

  describe("rate limiting", () => {
    it("should enforce minimum interval between tips", () => {
      manager.showTip("spawn_welcome");
      manager.showTip("first_city");

      // Second tip should be queued, not shown immediately
      expect(dispatchedEvents).toHaveLength(1);

      // Advance time by minimum interval
      jest.advanceTimersByTime(3000);

      expect(dispatchedEvents).toHaveLength(2);
    });

    it("should not rate limit forced tips", () => {
      manager.showTip("spawn_welcome", true);
      manager.showTip("first_city", true);

      expect(dispatchedEvents).toHaveLength(2);
    });

    it("should queue multiple tips and show them sequentially", () => {
      manager.showTip("spawn_welcome");
      manager.showTip("first_city");
      manager.showTip("first_factory");

      expect(dispatchedEvents).toHaveLength(1);

      jest.advanceTimersByTime(3000);
      expect(dispatchedEvents).toHaveLength(2);

      jest.advanceTimersByTime(3000);
      expect(dispatchedEvents).toHaveLength(3);
    });
  });

  describe("hasSeen", () => {
    it("should return false for unseen tips", () => {
      expect(manager.hasSeen("spawn_welcome")).toBe(false);
    });

    it("should return true for tips shown this session", () => {
      manager.showTip("spawn_welcome");
      expect(manager.hasSeen("spawn_welcome")).toBe(true);
    });

    it("should return false after resetAll", () => {
      manager.showTip("spawn_welcome");
      expect(manager.hasSeen("spawn_welcome")).toBe(true);

      manager.resetAll();
      expect(manager.hasSeen("spawn_welcome")).toBe(false);
    });
  });

  describe("markSeen", () => {
    it("should mark tip as seen without showing it", () => {
      manager.markSeen("spawn_welcome");

      expect(manager.hasSeen("spawn_welcome")).toBe(true);
      expect(dispatchedEvents).toHaveLength(0);
    });

    it("should prevent showing marked tips", () => {
      manager.markSeen("spawn_welcome");
      manager.showTip("spawn_welcome");

      expect(dispatchedEvents).toHaveLength(0);
    });
  });

  describe("resetAll", () => {
    it("should clear all session state", () => {
      manager.showTip("spawn_welcome");
      jest.advanceTimersByTime(3000);
      manager.showTip("first_city");
      jest.advanceTimersByTime(3000);

      expect(manager.hasSeen("spawn_welcome")).toBe(true);
      expect(manager.hasSeen("first_city")).toBe(true);

      manager.resetAll();

      expect(manager.hasSeen("spawn_welcome")).toBe(false);
      expect(manager.hasSeen("first_city")).toBe(false);
    });
  });

  describe("isEnabled / setEnabled", () => {
    it("should be enabled by default", () => {
      expect(manager.isEnabled()).toBe(true);
    });

    it("should disable tutorials", () => {
      manager.setEnabled(false);
      expect(manager.isEnabled()).toBe(false);
    });

    it("should enable tutorials", () => {
      manager.setEnabled(false);
      manager.setEnabled(true);
      expect(manager.isEnabled()).toBe(true);
    });
  });

  describe("getAllTipIds", () => {
    it("should return all 41 tutorial tip IDs", () => {
      const ids = manager.getAllTipIds();
      expect(ids).toHaveLength(41);
      expect(ids).toContain("spawn_welcome");
      expect(ids).toContain("game_started");
      expect(ids).toContain("victory_close");
    });
  });

  describe("getCompletionPercentage", () => {
    it("should return 0% when no tips seen", () => {
      expect(manager.getCompletionPercentage()).toBe(0);
    });

    it("should calculate percentage correctly", () => {
      const allIds = manager.getAllTipIds();
      const totalTips = allIds.length;

      // Show only 1 tip (rate limiting prevents multiple)
      manager.showTip(allIds[0]);

      const expected = Math.round((1 / totalTips) * 100);
      expect(manager.getCompletionPercentage()).toBe(expected);
    });

    it("should return 100% when all tips seen", () => {
      const allIds = manager.getAllTipIds();
      allIds.forEach((id) => manager.markSeen(id));

      expect(manager.getCompletionPercentage()).toBe(100);
    });
  });

  describe("missing translations", () => {
    it("should not show tip when title translation is missing", () => {
      manager.showTip("nonexistent_tip");

      expect(dispatchedEvents).toHaveLength(0);
    });
  });
});
