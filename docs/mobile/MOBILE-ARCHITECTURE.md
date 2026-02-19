# Mobile UI Architecture

> Last updated: 2026-02-19

Quick-reference architecture map for the mobile UI layer. All source lives under `src/client/mobile/`.

Related docs: [Feature Matrix](MOBILE-FEATURE-MATRIX.md) · [Gestures & Haptics](MOBILE-GESTURES-HAPTICS.md) · [Action Grid Catalog](MOBILE-ACTION-GRID-CATALOG.md) · [Responsive Scaling Plan](MOBILE-RESPONSIVE-SCALING-PLAN.md)

---

## Component Map

```
MobileUI (orchestrator, 873 lines)
├── MobileDetector              — device / orientation / safe-area detection
├── MobileTopBar                — fixed top status bar (population, gold, clock, settings)
├── MobileActionGrid            — bottom-sheet context-aware action tiles
├── MobileUIStyles              — injected global mobile CSS payload
├── MobileUIButtons             — factory for tab/zoom control buttons
├── MobileUIEventSetup          — centralized listener registration for UI controls
├── MobileUIStateSync           — game tick → topbar/tab/trade-indicator synchronization
├── MobileUIOverlayCoordinator  — overlay positioning + per-tick update orchestration
├── MobileUIInteractions        — attack/diplomacy/spawn/chat/emoji/donation handlers
├── MobileUIMapStack            — screen→tile conversion + stack upgrade targeting helpers
├── MobileUIStats               — trade-income parsing from tick updates
├── MobileUIActionUtils         — build-action parsing + bomber target utility
├── MobileUIEventBindings       — small shared event-binding helper wrappers
├── MobileViewportProfile       — viewport class/orientation profiling + responsive token generation
│
├── gestures/
│   └── GestureDetector         — touch state machine (tap, long-press, drag, pinch, edge-swipe)
│
├── overlays/
│   ├── MobileEconomyOverlay         — full-screen economy panel (investment sliders, troop/attack ratios)
│   ├── MobileIntelSidebar           — left-slide sidebar (Players leaderboard + Teams + Events tabs)
│   ├── MobilePlayerToast            — slide-down player info toast (long-press trigger)
│   ├── MobileAttackBar              — HUD bubbles for active attacks/boats/paratroopers/trade income
│   ├── MobileChatEmojiBar           — HUD bubbles for chat + emoji messages
│   ├── MobileAllianceNotifications  — alliance request + extension warning notifications
│   ├── MobileEventsDisplay          — events log (embedded in Intel sidebar Events tab)
│   ├── MobileResearchSidebar        — right-slide sidebar hosting MobileResearchPanel
│   ├── MobileResearchPriorityModal  — research category priority picker
│   ├── MobileResearchPriorityToast  — confirmation toast after priority selection
│   ├── MobileSettingsSidebar        — right-slide sidebar hosting MobileSettingsPanel
│   ├── MobileTechUnlockToast        — tech unlock notification toast
│   └── MobileWinModal               — mobile-first game-over / victory sheet
│
├── components/
│   ├── MobileResearchPanel    — full research tech tree with category tabs
│   └── MobileSettingsPanel    — settings toggles, replay controls, exit game
│
└── utils/
    ├── HapticFeedback         — navigator.vibrate() wrapper (TAP / LONG_PRESS / ERROR / SUCCESS / WARNING)
    ├── Icons                  — unit type → icon path mappings
    └── OverlayPositioning     — shared attack-bar anchoring helpers for toasts/modals
```

---

## Activation

Mobile UI activates when `MobileDetector.isMobile()` returns `true` (screen width, UA, touch capability). `MobileUI` is instantiated in `Main.ts` and stored on `window.__MOBILE_UI__`. `ClientGameRunner` wires it to the game canvas and renderer.

When active, `MobileUI` now computes a responsive viewport profile (`compact`/`regular`/`large` + `portrait`/`landscape`) and publishes mobile sizing tokens on `document.body` (for example ActionGrid tile/spacing/height caps). This keeps `430x932` as the no-regression reference profile while applying compact-landscape reductions to smaller viewports.

Key lifecycle calls:

| Method                         | Caller             | Purpose                                     |
| ------------------------------ | ------------------ | ------------------------------------------- |
| `setActive(true/false)`        | `Main.ts`          | Attach/detach components, toggle CSS class  |
| `initializeGestureDetection()` | `ClientGameRunner` | Bind gesture detector to canvas             |
| `setTransformHandler()`        | `ClientGameRunner` | Screen↔world coordinate conversion         |
| `updateGameState(game)`        | `ClientGameRunner` | Propagate live `GameView` to all components |

When active, `body.mobile-ui-enabled` hides all desktop HUD elements (radial menu, control panels, desktop top bar, etc.).

Winner/game-over flow on mobile is handled by `MobileWinModal`; desktop `WinModal` skips processing while mobile UI is active.

---

## EventBus Events (mobile → server)

| Event                              | Source                         |
| ---------------------------------- | ------------------------------ |
| `SendSpawnIntentEvent`             | Tap unowned land (spawn phase) |
| `BuildUnitIntentEvent`             | Action grid build tile         |
| `SendUpgradeStructureIntentEvent`  | Stack mode tap                 |
| `SendAttackIntentEvent`            | Ground attack action           |
| `SendBoatAttackIntentEvent`        | Naval assault action           |
| `SendParatrooperAttackIntentEvent` | Paratrooper action             |
| `SendBomberIntentEvent`            | Bomber run action              |
| `SendAllianceRequestIntentEvent`   | Propose alliance action        |
| `SendBreakAllianceIntentEvent`     | Break alliance action          |
| `SendPeaceRequestIntentEvent`      | Request peace action           |
| `SendDeclareWarIntentEvent`        | Declare war action             |
| `SendEmojiIntentEvent`             | Player toast → emoji table     |
| `SendDonateTroopsIntentEvent`      | Player toast donate troops     |
| `SendDonateGoldIntentEvent`        | Player toast donate gold       |
| `ToggleUpgradeModeEvent`           | Stack mode toggle              |
| `ZoomEvent`                        | Pinch gesture / zoom buttons   |
| `DragEvent`                        | Drag gesture (map pan)         |
| `CenterCameraEvent`                | Center zoom button             |

---

## Interaction Flows

### Tap → Action Grid → Intent

1. `GestureDetector` fires `tap` → `MobileUI.handleMapTap()` converts screen→tile
2. `MobileActionGrid.showForTile()` resolves tile category and renders actions
3. User taps an action tile → `MobileUI.handleActionSelected()` routes by prefix (`build:`, `attack:`, `diplomacy:`, `spawn`, `mode:`)
4. Intent event emitted on `EventBus` → `Transport` → server

### Sidebar Access

| Trigger                   | Opens                         |
| ------------------------- | ----------------------------- |
| Economy tab button        | MobileEconomyOverlay          |
| Intel tab button          | MobileIntelSidebar (left)     |
| Research tab button       | MobileResearchSidebar (right) |
| TopBar settings icon      | MobileSettingsSidebar (right) |
| Edge swipe from left      | MobileIntelSidebar            |
| Edge swipe from right     | MobileResearchSidebar         |
| Long-press on player tile | MobilePlayerToast             |
| Long-press on other tile  | MobileEconomyOverlay          |

### Stack Mode

Toggle in action grid enables upgrade-mode: subsequent taps upgrade the nearest stackable structure (City, Port, Factory, etc.) using sticky targeting.

---

## File Inventory

| File                                      | Lines |
| ----------------------------------------- | ----- |
| `MobileActionGrid.ts`                     | 1449  |
| `MobileUI.ts`                             | 878   |
| `MobileTopBar.ts`                         | 394   |
| `MobileDetector.ts`                       | 120   |
| `MobileUIStyles.ts`                       | 322   |
| `MobileUIInteractions.ts`                 | 286   |
| `MobileUIMapStack.ts`                     | 131   |
| `MobileUIEventSetup.ts`                   | 113   |
| `MobileUIStateSync.ts`                    | 112   |
| `MobileUIButtons.ts`                      | 99    |
| `MobileUIStats.ts`                        | 32    |
| `MobileUIActionUtils.ts`                  | 23    |
| `MobileUIEventBindings.ts`                | 19    |
| `MobileViewportProfile.ts`                | 232   |
| `gestures/GestureDetector.ts`             | 287   |
| `components/MobileResearchPanel.ts`       | 604   |
| `components/MobileSettingsPanel.ts`       | 486   |
| `overlays/MobileEconomyOverlay.ts`        | 729   |
| `overlays/MobileIntelSidebar.ts`          | 677   |
| `overlays/MobileAttackBar.ts`             | 556   |
| `overlays/MobileEventsDisplay.ts`         | 515   |
| `overlays/MobilePlayerToast.ts`           | 501   |
| `overlays/MobileAllianceNotifications.ts` | 430   |
| `overlays/MobileResearchPriorityModal.ts` | 326   |
| `overlays/MobileTechUnlockToast.ts`       | 246   |
| `overlays/MobileChatEmojiBar.ts`          | 225   |
| `overlays/MobileResearchPriorityToast.ts` | 209   |
| `overlays/MobileResearchSidebar.ts`       | 187   |
| `overlays/MobileSettingsSidebar.ts`       | 184   |
| `overlays/MobileWinModal.ts`              | 358   |
| `utils/HapticFeedback.ts`                 | 107   |
| `utils/Icons.ts`                          | 70    |
| `utils/OverlayPositioning.ts`             | 46    |
| `MobileUIOverlayCoordinator.ts`           | 48    |

---

## Lobby / Pre-game UI

The public lobby has its own responsive stylesheet separate from the in-game mobile UI layer:

| File                                      | Lines | Notes                                                     |
| ----------------------------------------- | ----- | --------------------------------------------------------- |
| `src/client/styles/mobile/main-lobby.css` | 2043  | Landscape + portrait responsive layout for the main lobby |

The file is imported via `src/client/styles.css` and applies media-query-driven layout adjustments for the lobby screen (game list, map previews, join flow). It is independent of `MobileUIStyles.ts` and only active on the lobby route — no in-game components depend on it.

Map names displayed in the lobby are resolved through `GameMapType` for correct i18n lookup (`src/client/PublicLobby.ts`).
