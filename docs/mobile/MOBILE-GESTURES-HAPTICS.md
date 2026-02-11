# Mobile Gestures & Haptics

> Last updated: 2026-02-15

Current gesture detection and haptic feedback behavior, sourced from code.

Related docs: [Architecture](MOBILE-ARCHITECTURE.md) · [Feature Matrix](MOBILE-FEATURE-MATRIX.md) · [Action Grid Catalog](MOBILE-ACTION-GRID-CATALOG.md) · [QA Matrix](MOBILE-GESTURE-HAPTIC-QA-MATRIX.md)

---

## Responsive Note (Scaling Implementation)

- Gesture and haptic semantics are unchanged by the responsive scaling rollout.
- ActionGrid visual size/density now adapts by viewport profile (compact/regular/large + portrait/landscape).
- Profile-to-token mapping is defined in `src/client/mobile/MobileViewportProfile.ts` and applied at runtime by `MobileUI`.
- Tablet support in the mobile path now includes iPad desktop-style user-agent detection in `MobileDetector`.

---

## Gesture Detection

Source: `src/client/mobile/gestures/GestureDetector.ts` (287 lines)

| Gesture          | Detection                                             | Fires              | Action in MobileUI                                    |
| ---------------- | ----------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| Tap              | Single touch, `<200ms`, movement `<10px`              | `tap`              | Tile selection → ActionGrid or spawn                  |
| Long press       | Hold `600ms`, movement `<10px` (cancelled on drag)    | `long-press`       | Player toast (player tile) or economy overlay (other) |
| Drag             | Movement `>10px`, incremental delta                   | `drag(dx, dy)`     | Map pan via `DragEvent`                               |
| Pinch            | 2+ fingers, scale from initial distance               | `pinch(scale)`     | Map zoom via `ZoomEvent`                              |
| Edge swipe left  | Start `<20px` from left edge, `>50px` right, `<150ms` | `edge-swipe-left`  | Toggle Intel sidebar                                  |
| Edge swipe right | Start `<20px` from right edge, `>50px` left, `<150ms` | `edge-swipe-right` | Toggle Research sidebar                               |

### Gesture Configuration

| Constant                  | Value    |
| ------------------------- | -------- |
| `LONG_PRESS_DURATION`     | 600ms    |
| `MOVEMENT_THRESHOLD`      | 10px     |
| `EDGE_THRESHOLD`          | 20px     |
| `PALM_RADIUS_THRESHOLD`   | 30px     |
| `EDGE_SWIPE_MIN_VELOCITY` | 150 px/s |

Palm rejection filters touches with `radiusX` or `radiusY` > 30px (iOS contact-area data).

---

## Haptic Feedback

Source: `src/client/mobile/utils/HapticFeedback.ts` (107 lines)

Centralized `navigator.vibrate()` wrapper with enable/disable toggle.

### Patterns

| Pattern      | Duration | Semantic                             |
| ------------ | -------- | ------------------------------------ |
| `TAP`        | 10ms     | Button taps, toggles, menu opens     |
| `LONG_PRESS` | 50ms     | Long-press trigger confirmation      |
| `SUCCESS`    | 15ms     | Build/attack/diplomacy confirmations |
| `WARNING`    | 30ms     | Warnings, confirmations              |
| `ERROR`      | 100ms    | Invalid actions, locked tiles        |

Also supports `custom(duration)` and `pattern(number[])` for special cases.

### Current Haptic Usage by Area

| Area                         | Trigger                         | Pattern         |
| ---------------------------- | ------------------------------- | --------------- |
| GestureDetector              | Tap                             | custom(10)      |
| GestureDetector              | Long press                      | custom(50)      |
| GestureDetector              | Edge swipe                      | custom(25)      |
| ActionGrid                   | Valid tile tap                  | `TAP`           |
| ActionGrid                   | Disabled/locked tile tap        | `ERROR`         |
| ActionGrid                   | Backdrop close                  | `TAP`           |
| MobileUI build actions       | Successful build                | `SUCCESS`       |
| MobileUI attack actions      | Successful attack intent        | `SUCCESS`       |
| MobileUI diplomacy actions   | Alliance/peace/war confirmation | `SUCCESS`       |
| MobileUI diplomacy actions   | Chat/emoji/view-player opens    | `TAP`           |
| MobileUI stack mode          | Stack toggle / miss             | `TAP`/`ERROR`   |
| MobileUI map tap             | Stack upgrade success           | `SUCCESS`       |
| TopBar                       | Settings/stats tap              | `TAP`           |
| EconomyOverlay               | Lock toggles                    | `TAP`           |
| Intel/Settings/Research bars | Open/tab/player-select          | `TAP`           |
| Settings panel               | Save replay                     | `SUCCESS`       |
| Player toast                 | Confirm actions                 | `SUCCESS`       |
| Player toast                 | Dismiss/light actions           | `TAP`           |
| Alliance notifications       | Accept/reject                   | `SUCCESS`/`TAP` |
| Chat/emoji bubble bar        | Focus sender bubble             | `TAP`           |
| Attack bar                   | Focus incoming attack bubble    | `TAP`           |
| Attack bar                   | Cancel outgoing attack bubble   | `TAP`           |
| Mobile win modal             | Keep/save/download/discord      | `TAP`           |
| Mobile win modal             | Exit / copy replay              | `SUCCESS`       |
| Lobby flows                  | No haptic                       | —               |
