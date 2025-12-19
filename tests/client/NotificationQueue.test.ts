import { NotificationQueue } from "../../src/client/NotificationQueue";

describe("NotificationQueue", () => {
  let queue: NotificationQueue;
  let shownNotifications: any[];
  let completeCallCount: number;

  beforeEach(() => {
    // Create a fresh instance for each test
    queue = new NotificationQueue();
    shownNotifications = [];
    completeCallCount = 0;

    queue.onShow((notification) => {
      shownNotifications.push(notification);
    });

    queue.onComplete(() => {
      completeCallCount++;
    });
  });

  describe("enqueue and display", () => {
    it("should show notification immediately when queue is empty", () => {
      queue.enqueue("tech", { name: "Test Tech" });

      expect(shownNotifications).toHaveLength(1);
      expect(shownNotifications[0]).toEqual({
        type: "tech",
        payload: { name: "Test Tech" },
      });
    });

    it("should queue multiple notifications", () => {
      queue.enqueue("tech", { name: "Tech 1" });
      queue.enqueue("tutorial", { id: "tip_1" });
      queue.enqueue("tech", { name: "Tech 2" });

      // First one shows immediately
      expect(shownNotifications).toHaveLength(1);
      expect(shownNotifications[0].payload.name).toBe("Tech 1");
    });

    it("should show notifications in FIFO order", () => {
      queue.enqueue("tech", { name: "Tech 1" });
      queue.enqueue("tutorial", { id: "tip_1" });
      queue.enqueue("tech", { name: "Tech 2" });

      // Complete first
      queue.complete();
      expect(shownNotifications).toHaveLength(2);
      expect(shownNotifications[1].type).toBe("tutorial");
      expect(shownNotifications[1].payload.id).toBe("tip_1");

      // Complete second
      queue.complete();
      expect(shownNotifications).toHaveLength(3);
      expect(shownNotifications[2].payload.name).toBe("Tech 2");
    });
  });

  describe("complete", () => {
    it("should trigger onComplete callback", () => {
      queue.enqueue("tech", { name: "Test" });
      queue.complete();

      expect(completeCallCount).toBe(1);
    });

    it("should show next notification after complete", () => {
      queue.enqueue("tech", { name: "First" });
      queue.enqueue("tech", { name: "Second" });

      expect(shownNotifications).toHaveLength(1);

      queue.complete();

      expect(shownNotifications).toHaveLength(2);
      expect(shownNotifications[1].payload.name).toBe("Second");
    });

    it("should handle complete when queue is empty", () => {
      queue.enqueue("tech", { name: "Only One" });
      queue.complete();

      expect(shownNotifications).toHaveLength(1);
      expect(completeCallCount).toBe(1);

      // Complete again with empty queue
      queue.complete();
      expect(completeCallCount).toBe(2);
      expect(shownNotifications).toHaveLength(1); // No new notifications
    });
  });

  describe("clear", () => {
    it("should clear all pending notifications", () => {
      queue.enqueue("tech", { name: "First" });
      queue.enqueue("tech", { name: "Second" });
      queue.enqueue("tech", { name: "Third" });

      expect(queue.getQueueLength()).toBe(2); // First is already showing

      queue.clear();

      expect(queue.getQueueLength()).toBe(0);

      // Complete current, should not show next
      queue.complete();
      expect(shownNotifications).toHaveLength(1); // Only the first one
    });
  });

  describe("isActive", () => {
    it("should return false when no notifications", () => {
      expect(queue.isActive()).toBe(false);
    });

    it("should return true when displaying a notification", () => {
      queue.enqueue("tech", { name: "Test" });
      expect(queue.isActive()).toBe(true);
    });

    it("should return false after completing last notification", () => {
      queue.enqueue("tech", { name: "Test" });
      expect(queue.isActive()).toBe(true);

      queue.complete();
      expect(queue.isActive()).toBe(false);
    });
  });

  describe("getQueueLength", () => {
    it("should return 0 for empty queue", () => {
      expect(queue.getQueueLength()).toBe(0);
    });

    it("should not count currently displaying item", () => {
      queue.enqueue("tech", { name: "First" });
      expect(queue.getQueueLength()).toBe(0); // First is showing, not queued

      queue.enqueue("tech", { name: "Second" });
      expect(queue.getQueueLength()).toBe(1);

      queue.enqueue("tech", { name: "Third" });
      expect(queue.getQueueLength()).toBe(2);
    });

    it("should decrease as items are completed", () => {
      queue.enqueue("tech", { name: "1" });
      queue.enqueue("tech", { name: "2" });
      queue.enqueue("tech", { name: "3" });

      expect(queue.getQueueLength()).toBe(2);

      queue.complete();
      expect(queue.getQueueLength()).toBe(1);

      queue.complete();
      expect(queue.getQueueLength()).toBe(0);
    });
  });

  describe("mixed notification types", () => {
    it("should handle tech and tutorial notifications together", () => {
      queue.enqueue("tech", { name: "Advanced Infantry" });
      queue.enqueue("tutorial", { id: "attack_basics", title: "Combat" });
      queue.enqueue("tech", { name: "Submarines" });
      queue.enqueue("tutorial", { id: "unit_submarine", title: "Subs" });

      expect(shownNotifications).toHaveLength(1);
      expect(shownNotifications[0].type).toBe("tech");

      queue.complete();
      expect(shownNotifications[1].type).toBe("tutorial");
      expect(shownNotifications[1].payload.id).toBe("attack_basics");

      queue.complete();
      expect(shownNotifications[2].type).toBe("tech");

      queue.complete();
      expect(shownNotifications[3].type).toBe("tutorial");
      expect(shownNotifications[3].payload.id).toBe("unit_submarine");
    });
  });
});
