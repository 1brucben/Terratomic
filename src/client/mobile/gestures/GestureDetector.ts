/**
 * Gesture detection system for mobile touch interactions
 * Detects taps, long-presses, drags, pinches, and edge swipes
 */

import { HapticFeedback } from "../utils/HapticFeedback";

export type GestureType =
  | "tap"
  | "long-press"
  | "drag"
  | "pinch"
  | "edge-swipe-left"
  | "edge-swipe-right";

export interface Gesture {
  type: GestureType;
  position: { x: number; y: number };
  delta?: { x: number; y: number }; // For drag/pinch
  scale?: number; // For pinch zoom
}

export type GestureCallback = (gesture: Gesture) => void;

export class GestureDetector {
  private touchStartTime: number = 0;
  private touchStartPos: { x: number; y: number } | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: Map<GestureType, GestureCallback[]> = new Map();
  private initialPinchDistance: number = 0;
  private lastPinchScale: number = 1;
  private isPinching: boolean = false;
  private isDragging: boolean = false;
  private lastTouchPos: { x: number; y: number } | null = null;

  // Bound event handler references for proper cleanup
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;
  private boundTouchCancel: (e: TouchEvent) => void;

  // Configuration
  private readonly LONG_PRESS_DURATION = 600; // ms
  private readonly MOVEMENT_THRESHOLD = 10; // px
  private readonly EDGE_THRESHOLD = 20; // px from screen edge
  private readonly PALM_RADIUS_THRESHOLD = 30; // px
  private readonly EDGE_SWIPE_MIN_VELOCITY = 150; // px/s

  constructor(private element: HTMLElement) {
    // Bind event handlers once and store references
    this.boundTouchStart = this.onTouchStart.bind(this);
    this.boundTouchMove = this.onTouchMove.bind(this);
    this.boundTouchEnd = this.onTouchEnd.bind(this);
    this.boundTouchCancel = this.onTouchCancel.bind(this);

    this.attachListeners();
  }

  private attachListeners(): void {
    this.element.addEventListener("touchstart", this.boundTouchStart, {
      passive: false,
    });
    this.element.addEventListener("touchmove", this.boundTouchMove, {
      passive: false,
    });
    this.element.addEventListener("touchend", this.boundTouchEnd, {
      passive: false,
    });
    this.element.addEventListener("touchcancel", this.boundTouchCancel, {
      passive: false,
    });
  }

  private onTouchStart(e: TouchEvent): void {
    // Filter out palm touches
    const validTouches = Array.from(e.touches).filter(
      (t) => !this.isPalmTouch(t),
    );
    if (validTouches.length === 0) return;

    const touch = validTouches[0];
    this.touchStartTime = Date.now();
    this.touchStartPos = { x: touch.clientX, y: touch.clientY };
    this.lastTouchPos = { x: touch.clientX, y: touch.clientY };

    // Handle pinch gesture (2+ fingers)
    if (validTouches.length >= 2) {
      this.isPinching = true;
      this.initialPinchDistance = this.getDistance(
        validTouches[0],
        validTouches[1],
      );
      this.lastPinchScale = 1;
      this.clearLongPressTimer();
      return;
    }

    // Check for edge swipe
    if (this.isEdgeTouch(touch)) {
      // Don't start long-press timer for edge touches
      return;
    }

    // Start long-press timer
    this.longPressTimer = setTimeout(() => {
      if (this.touchStartPos && !this.isDragging) {
        this.emit({
          type: "long-press",
          position: this.touchStartPos,
        });
        this.triggerHaptic(50); // Medium vibration
      }
    }, this.LONG_PRESS_DURATION);
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.touchStartPos || !this.lastTouchPos) return;

    const validTouches = Array.from(e.touches).filter(
      (t) => !this.isPalmTouch(t),
    );
    if (validTouches.length === 0) return;

    const touch = validTouches[0];
    const deltaXFromStart = touch.clientX - this.touchStartPos.x;
    const deltaYFromStart = touch.clientY - this.touchStartPos.y;
    const distance = Math.sqrt(
      deltaXFromStart * deltaXFromStart + deltaYFromStart * deltaYFromStart,
    );

    // Cancel long-press if moved too much
    if (distance > this.MOVEMENT_THRESHOLD) {
      this.clearLongPressTimer();
      this.isDragging = true;
    }

    // Handle pinch gesture
    if (this.isPinching && validTouches.length >= 2) {
      const currentDistance = this.getDistance(
        validTouches[0],
        validTouches[1],
      );
      const scale = currentDistance / this.initialPinchDistance;

      // Only emit if scale changed significantly from last scale
      // This gives us incremental zoom instead of cumulative
      this.emit({
        type: "pinch",
        position: { x: touch.clientX, y: touch.clientY },
        scale,
      });

      this.lastPinchScale = scale;
      e.preventDefault();
      return;
    }

    // Handle drag gesture - use incremental delta from last position
    if (this.isDragging && !this.isPinching) {
      const incrementalDeltaX = touch.clientX - this.lastTouchPos.x;
      const incrementalDeltaY = touch.clientY - this.lastTouchPos.y;

      this.emit({
        type: "drag",
        position: { x: touch.clientX, y: touch.clientY },
        delta: { x: incrementalDeltaX, y: incrementalDeltaY },
      });

      // Update last position for next move event
      this.lastTouchPos = { x: touch.clientX, y: touch.clientY };
      e.preventDefault();
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    if (!this.touchStartPos) return;

    this.clearLongPressTimer();

    // Reset pinch state if no more touches
    if (e.touches.length === 0) {
      this.isPinching = false;
      this.lastPinchScale = 1;
    }

    // Don't emit tap if we were dragging or pinching
    if (this.isDragging || this.isPinching) {
      this.isDragging = false;
      this.touchStartPos = null;
      this.lastTouchPos = null;
      return;
    }

    const changedTouch = e.changedTouches[0];
    const duration = Date.now() - this.touchStartTime;
    const deltaX = changedTouch.clientX - this.touchStartPos.x;
    const deltaY = changedTouch.clientY - this.touchStartPos.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Check for edge swipe
    if (duration < 150) {
      const velocity = Math.abs(deltaX) / (duration / 1000);

      if (velocity >= this.EDGE_SWIPE_MIN_VELOCITY) {
        if (this.touchStartPos.x < this.EDGE_THRESHOLD && deltaX > 50) {
          this.emit({
            type: "edge-swipe-left",
            position: this.touchStartPos,
            delta: { x: deltaX, y: deltaY },
          });
          this.triggerHaptic(25);
          this.touchStartPos = null;
          return;
        } else if (
          this.touchStartPos.x > window.innerWidth - this.EDGE_THRESHOLD &&
          deltaX < -50
        ) {
          this.emit({
            type: "edge-swipe-right",
            position: this.touchStartPos,
            delta: { x: deltaX, y: deltaY },
          });
          this.triggerHaptic(25);
          this.touchStartPos = null;
          return;
        }
      }
    }

    // Only emit tap if touch was quick and didn't move much
    if (duration < 200 && distance < this.MOVEMENT_THRESHOLD) {
      const tapPosition = {
        x: changedTouch.clientX,
        y: changedTouch.clientY,
      };
      this.emit({
        type: "tap",
        position: tapPosition,
      });
      this.triggerHaptic(10); // Light vibration
    }

    this.touchStartPos = null;
    this.lastTouchPos = null;
    this.isDragging = false;
  }

  private onTouchCancel(): void {
    this.clearLongPressTimer();
    this.touchStartPos = null;
    this.isDragging = false;
    this.isPinching = false;
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private isPalmTouch(touch: Touch): boolean {
    // iOS provides touch.radiusX/radiusY for contact area
    // Large area (>30px radius) likely = palm
    const radiusX = (touch as any).radiusX ?? 0;
    const radiusY = (touch as any).radiusY ?? 0;
    return (
      radiusX > this.PALM_RADIUS_THRESHOLD ||
      radiusY > this.PALM_RADIUS_THRESHOLD
    );
  }

  private isEdgeTouch(touch: Touch): boolean {
    return (
      touch.clientX < this.EDGE_THRESHOLD ||
      touch.clientX > window.innerWidth - this.EDGE_THRESHOLD
    );
  }

  private getDistance(touch1: Touch, touch2: Touch): number {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private emit(gesture: Gesture): void {
    const callbacks = this.callbacks.get(gesture.type);
    if (callbacks) {
      callbacks.forEach((callback) => callback(gesture));
    }
  }

  private triggerHaptic(duration: number): void {
    HapticFeedback.custom(duration);
  }

  /**
   * Register a callback for a specific gesture type
   */
  on(gestureType: GestureType, callback: GestureCallback): void {
    if (!this.callbacks.has(gestureType)) {
      this.callbacks.set(gestureType, []);
    }
    this.callbacks.get(gestureType)!.push(callback);
  }

  /**
   * Unregister a callback for a specific gesture type
   */
  off(gestureType: GestureType, callback: GestureCallback): void {
    const callbacks = this.callbacks.get(gestureType);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this.element.removeEventListener("touchstart", this.boundTouchStart);
    this.element.removeEventListener("touchmove", this.boundTouchMove);
    this.element.removeEventListener("touchend", this.boundTouchEnd);
    this.element.removeEventListener("touchcancel", this.boundTouchCancel);
    this.callbacks.clear();
    this.clearLongPressTimer();
  }
}
