# Mobile Feature Matrix

> Last updated: 2026-02-19

Desktop → mobile parity overview. All source under `src/client/mobile/`.

Related docs: [Architecture](MOBILE-ARCHITECTURE.md) · [Gestures & Haptics](MOBILE-GESTURES-HAPTICS.md) · [Action Grid Catalog](MOBILE-ACTION-GRID-CATALOG.md) · [QA Matrix](MOBILE-GESTURE-HAPTIC-QA-MATRIX.md)

---

## Responsive Scaling Implementation Status

Implemented responsive behavior (ActionGrid-first scope):

- **Baseline lock:** iPhone 14 Pro Max emulation `430x932` remains no-regression reference (portrait + landscape).
- **Compact landscape phones:** ActionGrid uses tighter token set (tile/icon/text sizing + max-height reduction) to preserve map visibility.
- **Regular landscape phones:** ActionGrid applies medium compaction to avoid oversized grid coverage.
- **Large tablet profiles:** ActionGrid receives a tablet readability bump (slightly larger tiles/icons/text vs phone compact profiles).
- **Tablet activation:** iPad Air/Pro class devices now enter mobile UI path reliably (including iPadOS desktop-style UA cases).

Primary implementation files:

- `src/client/mobile/MobileViewportProfile.ts`
- `src/client/mobile/MobileUI.ts`
- `src/client/mobile/MobileActionGrid.ts`
- `src/client/mobile/MobileDetector.ts`

---

## Desktop → Mobile Feature Parity

Note: `MobileUI` now acts primarily as an orchestrator; most action routing, event setup, and game-tick sync policies are delegated to helper modules (`MobileUIInteractions`, `MobileUIEventSetup`, `MobileUIStateSync`, etc.).

| Desktop Feature             | Mobile Equivalent                                                                 | Trigger                                        | Status        |
| --------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- | ------------- |
| Radial/Context Menu         | `MobileActionGrid` (bottom sheet)                                                 | Tap any tile                                   | ✅ Working    |
| Responsive ActionGrid Scale | Token-driven profile scaling                                                      | Auto from viewport class + orientation         | ✅ Working    |
| Ground Attack               | ActionGrid `attack:ground`                                                        | Tap enemy tile → "Ground Attack"               | ✅ Working    |
| Boat / Naval Assault        | ActionGrid `attack:naval`                                                         | Tap enemy tile → "Naval Assault"               | ✅ Working    |
| Paratroopers                | ActionGrid `attack:airstrike`                                                     | Tap enemy tile → "Paratroopers"                | ✅ Working    |
| Bomber Run                  | ActionGrid `attack:bomber`                                                        | Tap enemy tile → "Bomber Run"                  | ✅ Working    |
| Alliance Request            | ActionGrid `diplomacy:propose-ally`                                               | Tap enemy tile → "Propose Alliance"            | ✅ Working    |
| Break Alliance              | ActionGrid `diplomacy:break-alliance`                                             | Tap allied tile → "Break Alliance"             | ✅ Working    |
| Request Peace               | ActionGrid `diplomacy:request-peace`                                              | Tap enemy-at-war tile → "Request Peace"        | ✅ Working    |
| Declare War                 | ActionGrid `attack:declare-war`                                                   | Tap enemy tile → "Declare War"                 | ✅ Working    |
| Spawn                       | Direct tap (spawn phase)                                                          | Tap unclaimed land                             | ✅ Working    |
| Build Structures            | ActionGrid `build:*` tiles                                                        | Tap own tile → grid shows buildable structures | ✅ Working    |
| Build Nukes                 | ActionGrid `attack:nuke-*`                                                        | Tap enemy tile (requires silo + research)      | ✅ Working    |
| Build Naval Units           | ActionGrid `build:Warship`, `build:Submarine`                                     | Tap own water tile (requires Port)             | ✅ Working    |
| Build Fighter Jet           | ActionGrid `build:FighterJet`                                                     | Tap own tile (requires Airfield + Jet Engines) | ✅ Working    |
| Build Artillery             | ActionGrid `build:Artillery`                                                      | Tap own tile (requires Factory + research)     | ✅ Working    |
| Stack/Upgrade Structures    | ActionGrid stack mode toggle                                                      | Toggle in grid, tap structures to upgrade      | ✅ Working    |
| Troop/Worker Ratio          | `MobileEconomyOverlay` slider                                                     | Economy overlay or long-press map              | ✅ Working    |
| Attack Ratio                | `MobileEconomyOverlay` slider                                                     | Economy overlay                                | ✅ Working    |
| Investment Sliders          | `MobileEconomyOverlay`                                                            | Economy overlay (production/road/research)     | ✅ Working    |
| Population & Gold           | `MobileTopBar`                                                                    | Always visible at top                          | ✅ Working    |
| Game Clock                  | `MobileTopBar`                                                                    | Always visible (counts after spawn phase)      | ✅ Working    |
| Leaderboard                 | `MobileIntelSidebar` (Players tab)                                                | Intel tab button or edge swipe left            | ✅ Working    |
| Team Leaderboard            | `MobileIntelSidebar` (Teams tab)                                                  | Intel sidebar → Teams tab                      | ✅ Working    |
| Player Info                 | `MobilePlayerToast`                                                               | Long-press any player-owned tile               | ✅ Working    |
| Events Log                  | `MobileEventsDisplay` (in Intel sidebar)                                          | Intel sidebar → Events tab                     | ✅ Working    |
| Chat                        | Opens desktop `chat-modal`                                                        | Player toast → chat button                     | ✅ Working    |
| Emoji                       | Opens desktop `emoji-table`                                                       | Player toast → emoji button or ActionGrid      | ✅ Working    |
| Donate Troops               | Player toast → donate troops                                                      | Long-press player tile → donate button         | ✅ Working    |
| Donate Gold                 | Player toast → donate gold                                                        | Long-press player tile → donate button         | ✅ Working    |
| Trade Income Indicator      | `MobileAttackBar` (trade bubble)                                                  | Auto-shown on trade income ticks               | ✅ Working    |
| Attack Notifications        | `MobileAttackBar` (attack bubbles)                                                | Auto-shown on active attacks                   | ✅ Working    |
| Chat/Emoji Bubbles          | `MobileChatEmojiBar`                                                              | Auto-shown on incoming chat/emoji              | ✅ Working    |
| Alliance Notifications      | `MobileAllianceNotifications`                                                     | Auto-shown on alliance requests/warnings       | ✅ Working    |
| Tech Unlock Notification    | `MobileTechUnlockToast`                                                           | Auto-shown on tech unlock                      | ✅ Working    |
| Research Toggle             | `MobileResearchSidebar`                                                           | Research tab button or edge swipe right        | ✅ Working    |
| Research Priority Selection | `MobileResearchPriorityModal`                                                     | Research panel interaction                     | ✅ Working    |
| Options / Settings          | `MobileSettingsSidebar`                                                           | TopBar settings icon                           | ✅ Working    |
| Zoom In/Out                 | Zoom +/- buttons (left side) · step: `MOBILE_BUTTON_ZOOM_DELTA = 200`             | Tap zoom buttons                               | ✅ Working    |
| Center Camera               | Center button (left side)                                                         | Tap center button                              | ✅ Working    |
| Pan / Zoom (touch)          | `GestureDetector` drag + pinch · sensitivity: `MOBILE_PINCH_ZOOM_MULTIPLIER = 50` | Touch drag / pinch                             | ✅ Working    |
| Replay Panel                | `MobileSettingsPanel` (replay controls)                                           | Settings sidebar                               | ✅ Working    |
| Win / Game Over Modal       | `MobileWinModal`                                                                  | Auto-shown on death/win updates                | ✅ Working    |
| Alternate View (Space)      | —                                                                                 | —                                              | ❌ Not ported |
| Multi-Build Mode            | —                                                                                 | —                                              | ❌ Not ported |

---

## HUD Layout (top → bottom)

| Layer           | Z-Index | Component                                |
| --------------- | ------- | ---------------------------------------- |
| Top bar         | 1650    | `MobileTopBar`                           |
| Attack bar      | 1760    | `MobileAttackBar`                        |
| Chat/emoji bar  | 1758    | `MobileChatEmojiBar`                     |
| Alliance notes  | 1500    | `MobileAllianceNotifications`            |
| Tab buttons     | 1700    | Economy / Intel / Research tabs          |
| Zoom buttons    | 1700    | +/−/center (left side)                   |
| Action grid     | 2000    | `MobileActionGrid` (bottom)              |
| Player toast    | 2500    | `MobilePlayerToast`                      |
| Sidebars        | 3000    | Intel / Research / Settings              |
| Economy overlay | 1800    | `MobileEconomyOverlay`                   |
| Tech toasts     | 4050+   | `MobileTechUnlockToast` / priority modal |

---

## Tab Buttons (right side)

Three fixed buttons appear during gameplay (hidden during spawn phase):

| Button   | Position | Color  | Opens                   |
| -------- | -------- | ------ | ----------------------- |
| Economy  | Top      | Gold   | `MobileEconomyOverlay`  |
| Research | Middle   | Purple | `MobileResearchSidebar` |
| Intel    | Bottom   | Blue   | `MobileIntelSidebar`    |

---

## Mobile Lobby UI

The main lobby has a dedicated responsive stylesheet (`src/client/styles/mobile/main-lobby.css`, 2043 lines) providing landscape and portrait layouts independent of the in-game mobile UI layer.

| Feature                | Implementation                                 | Status     |
| ---------------------- | ---------------------------------------------- | ---------- |
| Portrait lobby layout  | `main-lobby.css` portrait media query block    | ✅ Working |
| Landscape lobby layout | `main-lobby.css` landscape media query block   | ✅ Working |
| Map name i18n in lobby | Resolved via `GameMapType` in `PublicLobby.ts` | ✅ Fixed   |
