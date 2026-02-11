# Mobile Gesture + Haptic QA Matrix

> Last updated: 2026-02-15

Manual verification matrix for mobile touch interactions and haptic feedback parity.

Related docs: [Gestures & Haptics](MOBILE-GESTURES-HAPTICS.md) · [Architecture](MOBILE-ARCHITECTURE.md) · [Feature Matrix](MOBILE-FEATURE-MATRIX.md)

---

## Test Devices

| Device        | OS Version | Browser | Tester | Date | Result     |
| ------------- | ---------- | ------- | ------ | ---- | ---------- |
| Android phone |            | Chrome  |        |      | ⏳ Pending |
| iPhone        |            | Safari  |        |      | ⏳ Pending |
| iPad mini     |            | Safari  |        |      | ⏳ Pending |
| iPad Air/Pro  |            | Safari  |        |      | ⏳ Pending |

---

## Responsive Viewport Matrix

| Profile                      | Expected Behavior                                                                  | Android | iOS | Notes |
| ---------------------------- | ---------------------------------------------------------------------------------- | ------- | --- | ----- |
| Baseline `430x932` portrait  | No regression from prior accepted sizing                                           | ⏳      | ⏳  |       |
| Baseline `430x932` landscape | No regression from prior accepted sizing                                           | ⏳      | ⏳  |       |
| Compact phone landscape      | ActionGrid appears in compact mode; map remains comfortably usable                 | ⏳      | ⏳  |       |
| Regular phone landscape      | ActionGrid medium compaction; no oversized coverage                                | ⏳      | ⏳  |       |
| iPad mini                    | Mobile UI path active; ActionGrid readable and not tiny                            | ⏳      | ⏳  |       |
| iPad Air/Pro                 | Mobile UI path active (not desktop fallback); ActionGrid readable with tablet bump | ⏳      | ⏳  |       |

---

## Gesture Matrix

| Area       | Gesture               | Expected Behavior                                                       | Android | iOS | Notes |
| ---------- | --------------------- | ----------------------------------------------------------------------- | ------- | --- | ----- |
| Map canvas | Tap                   | Select tile / open action grid / spawn in spawn-phase                   | ⏳      | ⏳  |       |
| Map canvas | Long press            | Player tile opens `MobilePlayerToast`; other tiles open economy overlay | ⏳      | ⏳  |       |
| Map canvas | Drag                  | Pans map smoothly with no stuck touch state                             | ⏳      | ⏳  |       |
| Map canvas | Pinch                 | Zooms in/out around gesture center                                      | ⏳      | ⏳  |       |
| Edge left  | Swipe from left edge  | Toggles Intel sidebar                                                   | ⏳      | ⏳  |       |
| Edge right | Swipe from right edge | Toggles Research sidebar                                                | ⏳      | ⏳  |       |

---

## Haptic Matrix

| Area                      | Interaction                             | Expected Haptic                 | Android | iOS | Notes |
| ------------------------- | --------------------------------------- | ------------------------------- | ------- | --- | ----- |
| Gesture detector          | Tap                                     | light (`custom(10)`)            | ⏳      | ⏳  |       |
| Gesture detector          | Long press                              | medium (`custom(50)`)           | ⏳      | ⏳  |       |
| Gesture detector          | Edge swipe                              | light (`custom(25)`)            | ⏳      | ⏳  |       |
| Action grid               | Enabled action tile                     | `TAP`                           | ⏳      | ⏳  |       |
| Action grid               | Disabled tile                           | `ERROR`                         | ⏳      | ⏳  |       |
| Stack mode                | Toggle on/off                           | `TAP`                           | ⏳      | ⏳  |       |
| Stack mode                | Missed upgrade target                   | `ERROR`                         | ⏳      | ⏳  |       |
| Attack bar                | Focus incoming attack bubble            | `TAP`                           | ⏳      | ⏳  |       |
| Attack bar                | Cancel outgoing/boat/paratrooper bubble | `TAP`                           | ⏳      | ⏳  |       |
| Chat/emoji bar            | Tap bubble to focus sender              | `TAP`                           | ⏳      | ⏳  |       |
| Alliance notifications    | Accept / Renew                          | `SUCCESS`                       | ⏳      | ⏳  |       |
| Alliance notifications    | Reject / Dismiss                        | `TAP`                           | ⏳      | ⏳  |       |
| Player toast              | Chat/emoji open                         | `TAP`                           | ⏳      | ⏳  |       |
| Player toast              | Donate confirm actions                  | `SUCCESS`                       | ⏳      | ⏳  |       |
| Win modal (mobile layout) | Keep / Save / Copy / Download / Discord | `TAP` or `SUCCESS` on exit/copy | ⏳      | ⏳  |       |

---

## Win Modal Mobile Verification

| Check       | Expected                                                               | Android | iOS | Notes |
| ----------- | ---------------------------------------------------------------------- | ------- | --- | ----- |
| Layout mode | Modal uses mobile layout when `body.mobile-ui-enabled` is active       | ⏳      | ⏳  |       |
| Placement   | Anchored near bottom with safe-area padding, not centered desktop card | ⏳      | ⏳  |       |
| Buttons     | 44px+ touch targets, stacked vertically                                | ⏳      | ⏳  |       |
| Actions     | Exit/Keep/Replay/Discord actions are all tappable and stable           | ⏳      | ⏳  |       |

---

## Regression Spot Checks

| Area          | Check                                                                            | Android | iOS | Notes |
| ------------- | -------------------------------------------------------------------------------- | ------- | --- | ----- |
| Top overlays  | Attack bar + chat/emoji bar do not overlap incorrectly after orientation changes | ⏳      | ⏳  |       |
| Sidebars      | Intel/Research/Settings open and close with no scroll lock leaks                 | ⏳      | ⏳  |       |
| Performance   | No obvious frame hitching during rapid gesture input                             | ⏳      | ⏳  |       |
| Accessibility | Tap targets are reachable and not clipped by safe areas                          | ⏳      | ⏳  |       |

---

## Pass Criteria

- All gesture checks pass on Android Chrome and iOS Safari.
- Haptic checks pass wherever browser/hardware supports vibration APIs.
- Any non-parity behavior is documented with repro steps and severity.
