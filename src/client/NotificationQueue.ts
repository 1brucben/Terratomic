/**
 * Unified notification queue to prevent overlap between tech unlocks and tutorial tips.
 * Both TechUnlockNotification and TutorialToast use this queue to coordinate display timing.
 */

export type NotificationType = "tech" | "tutorial";

export interface QueuedNotification {
  type: NotificationType;
  payload: any;
}

class NotificationQueue {
  private queue: QueuedNotification[] = [];
  private isDisplaying = false;
  private onShowCallbacks: ((notification: QueuedNotification) => void)[] = [];
  private onCompleteCallback: (() => void) | null = null;

  /**
   * Register callback to show notifications
   */
  onShow(callback: (notification: QueuedNotification) => void): void {
    this.onShowCallbacks.push(callback);
  }

  /**
   * Register callback when display is complete
   */
  onComplete(callback: () => void): void {
    this.onCompleteCallback = callback;
  }

  /**
   * Add a notification to the queue
   */
  enqueue(type: NotificationType, payload: any): void {
    this.queue.push({ type, payload });
    if (!this.isDisplaying) {
      this.showNext();
    }
  }

  /**
   * Start showing the next notification
   */
  private showNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.isDisplaying = false;
      return;
    }

    this.isDisplaying = true;
    // Notify all registered callbacks
    for (const callback of this.onShowCallbacks) {
      callback(next);
    }
  }

  /**
   * Mark current notification as complete and show next
   */
  complete(): void {
    if (this.onCompleteCallback) {
      this.onCompleteCallback();
    }
    this.showNext();
  }

  /**
   * Clear all pending notifications
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Check if currently displaying a notification
   */
  isActive(): boolean {
    return this.isDisplaying;
  }

  /**
   * Get queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}

// Export both the class and singleton instance
export { NotificationQueue };
export const notificationQueue = new NotificationQueue();
