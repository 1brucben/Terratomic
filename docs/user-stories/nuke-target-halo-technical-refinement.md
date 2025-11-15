# Nuke Targeting Halo - Technical Refinement

**Date**: 2025-11-15  
**Branch**: `nuke-cursor-magic`  
**Based on User Story**: `nuke-target-halo.md`

---

## Overview

This document provides technical implementation details for the nuke targeting halo feature, refined based on the actual Terratomic codebase architecture. The feature adds visual feedback during nuke targeting and after impact through semi-transparent circular halos.

---

## Architecture Context

### Relevant System Components

#### 1. **Input Handling** (`src/client/InputHandler.ts`)

- **Current State**:
  - `pendingBuildUnitType` triggers crosshair cursor (lines 216-228)
  - CSS class `.crosshair-cursor` applied when nuke selected
  - MouseMoveEvent emitted on cursor movement (line 211)
  - Nuke selection via hotkeys (lines 358-372) or BuildMenu clicks

- **Key Properties**:
  ```typescript
  private _pendingBuildUnitType: UnitType | null = null;
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;
  ```

#### 2. **UI State** (`src/client/graphics/UIState.ts`)

```typescript
export interface UIState {
  attackRatio: number;
  investmentRate: number;
  pendingBuildUnitType: UnitType | null;
  multibuildEnabled: boolean;
}
```

#### 3. **Canvas Layer System**

- **UILayer** (`src/client/graphics/layers/UILayer.ts`):
  - Lines 86-109: Handles overlay rendering (health bars, selection boxes)
  - Uses offscreen canvas with world coordinates
  - Methods: `paintCell()`, `clearCell()`, `renderLayer()`
  - Transform-aware: `shouldTransform() → true`

- **FxLayer** (`src/client/graphics/fx/NukeFx.ts`):
  - Lines 9-32: `ShockwaveFx` class - draws growing circles for explosions
  - Uses `ctx.arc()` for circle rendering
  - Manages alpha/fade over time

#### 4. **Nuke Configuration** (`src/core/configuration/DefaultConfig.ts`)

```typescript
nukeMagnitudes(unitType: UnitType): NukeMagnitude {
  switch (unitType) {
    case UnitType.MIRVWarhead:
      return { inner: 12, outer: 18 };
    case UnitType.AtomBomb:
      return { inner: 12, outer: 30 };
    case UnitType.HydrogenBomb:
      return { inner: 80, outer: 100 };
  }
}
```

**Blast Radii** (in world tiles):

- Atomic Bomb: 30 tiles outer radius
- Hydrogen Bomb: 100 tiles outer radius
- MIRV Warhead: 18 tiles (excluded from halo feature)

#### 5. **Nuke Execution Flow** (`src/core/execution/NukeExecution.ts`)

- Lines 99-152: `tick()` method handles nuke lifecycle
- Lines 179-269: `detonate()` called when nuke reaches target
- Lines 123-138: Emits `NUKE_INBOUND` / `HYDROGEN_BOMB_INBOUND` messages

#### 6. **Game Updates System**

- `GameUpdateType.BomberExplosion` shows radius can be communicated (DefaultConfig.ts)
- Updates filtered by `GameRunner.filterUpdatesForClient()` for fog of war

---

## Implementation Plan

### Phase 1: Targeting Mode Halo (During Nuke Selection)

#### 1.1 Create Targeting Halo Layer

**New File**: `src/client/graphics/layers/NukeTargetingLayer.ts`

```typescript
import { Layer } from "./Layer";
import { GameView } from "../../../core/game/GameView";
import { UIState } from "../UIState";
import { UnitType } from "../../../core/game/Game";
import { TransformHandler } from "../TransformHandler";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { NukeImpactEvent } from "../../InputHandler";

export class NukeTargetingLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private theme: Theme;

  // Cursor position tracking (world coordinates)
  private cursorWorldX: number = 0;
  private cursorWorldY: number = 0;
  private isVisible: boolean = false;

  constructor(
    private game: GameView,
    private uiState: UIState,
    private transformHandler: TransformHandler,
    private eventBus: EventBus,
  ) {
    this.theme = game.config().theme();
  }

  shouldTransform(): boolean {
    return true; // Halo moves with map transform
  }

  init(): void {
    this.redraw();
  }

  redraw(): void {
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
  }

  tick(): void {
    // Intentionally empty - updates happen on mouse move
  }

  /**
   * Called by ClientGameRunner on MouseMoveEvent
   */
  updateCursorPosition(screenX: number, screenY: number): void {
    const worldCoord = this.transformHandler.screenToWorldCoordinates(
      screenX,
      screenY,
    );
    this.cursorWorldX = worldCoord.x;
    this.cursorWorldY = worldCoord.y;
    this.updateVisibility();
  }

  private updateVisibility(): void {
    const nukeType = this.uiState.pendingBuildUnitType;
    this.isVisible =
      nukeType === UnitType.AtomBomb || nukeType === UnitType.HydrogenBomb;
  }

  private getBlastRadius(): number {
    const nukeType = this.uiState.pendingBuildUnitType;
    if (!nukeType) return 0;

    const magnitude = this.game.config().nukeMagnitudes(nukeType);
    return magnitude.outer; // Use outer radius for halo
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    if (!this.isVisible) return;

    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const radius = this.getBlastRadius();
    const x = this.cursorWorldX;
    const y = this.cursorWorldY;

    // Draw semi-transparent white circle
    this.context.beginPath();
    this.context.arc(x, y, radius, 0, Math.PI * 2);
    this.context.strokeStyle = "rgba(255, 255, 255, 0.5)"; // 50% transparency
    this.context.lineWidth = 1.5; // Visible but not too thick
    this.context.stroke();

    // Optional: Add inner radius marker (subtle)
    const magnitude = this.game
      .config()
      .nukeMagnitudes(this.uiState.pendingBuildUnitType!);
    this.context.beginPath();
    this.context.arc(x, y, magnitude.inner, 0, Math.PI * 2);
    this.context.strokeStyle = "rgba(255, 255, 255, 0.25)"; // More subtle
    this.context.lineWidth = 1;
    this.context.stroke();

    // Draw to main canvas
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }
}
```

#### 1.2 Integrate with GameRenderer

**IMPORTANT**: Layer instantiation happens in `GameRenderer.ts` (lines 230-270), NOT `ClientGameRunner.ts`!

**File**: `src/client/graphics/GameRenderer.ts`

**Changes in `createRenderer()` function**:

1. Import NukeTargetingLayer
2. Instantiate after UILayer (line ~245)
3. Add to layers array in correct position

```typescript
// Add import at top
import { NukeTargetingLayer } from "./layers/NukeTargetingLayer";

// In createRenderer() function, after UILayer instantiation (around line 245):
const uiLayer = new UILayer(game, eventBus, transformHandler);
const nukeTargetingLayer = new NukeTargetingLayer(
  game,
  uiState,
  transformHandler,
  eventBus,
);

const layers: Layer[] = [
  new TerrainLayer(game, transformHandler),
  new TerritoryLayer(game, eventBus, transformHandler),
  new RoadLayer(game, transformHandler),
  new CargoTruckLayer(game, transformHandler),
  structureLayer,
  new UnitLayer(game, eventBus, transformHandler),
  new FxLayer(game, eventBus), // UPDATED: now takes eventBus
  new NameLayer(game, transformHandler, eventBus),
  uiLayer,
  nukeTargetingLayer, // ADD HERE - after UI, before HTML overlays
  eventsDisplay,
  chatDisplay,
  // ... rest of layers ...
];
```

#### 1.2b Wire MouseMoveEvent in ClientGameRunner

**File**: `src/client/ClientGameRunner.ts`

The `onMouseMove()` method (line ~564) already exists and is wired up (line 250). We need to access the renderer's layers:

```typescript
// In ClientGameRunner class (around line 564)
private onMouseMove(event: MouseMoveEvent) {
  // ... existing code ...

  // Update targeting halo position
  // Access via renderer's public layers array (need to add getter)
  const layers = this.renderer.getLayers();
  const nukeLayer = layers.find(l => l instanceof NukeTargetingLayer);
  if (nukeLayer) {
    (nukeLayer as NukeTargetingLayer).updateCursorPosition(event.x, event.y);
  }
}
```

**Add getter to GameRenderer class** (line ~285):

```typescript
export class GameRenderer {
  // ... existing code ...

  getLayers(): Layer[] {
    return this.layers;
  }
}
```

#### 1.3 Handle Mode Transitions

**File**: `src/client/InputHandler.ts`

Ensure halo disappears when:

- Right-click cancels build mode (lines 558-575)
- ESC key cancels
- Build completes (if not multi-build)

No changes needed - `pendingBuildUnitType` already tracked properly.

---

### Phase 2: Post-Impact Halo (1 Second After Detonation)

#### 2.1 Define Impact Halo Data Structure

**File**: `src/client/graphics/layers/NukeTargetingLayer.ts` (extend existing)

```typescript
interface ImpactHalo {
  worldX: number;
  worldY: number;
  radius: number;
  createdAt: number; // timestamp in ms
  duration: number; // 1000ms
}

export class NukeTargetingLayer implements Layer {
  // ... existing properties ...

  private impactHalos: ImpactHalo[] = [];
  private readonly IMPACT_HALO_DURATION = 1000; // 1 second

  /**
   * Called when a nuke detonates
   */
  addImpactHalo(worldX: number, worldY: number, nukeType: UnitType): void {
    const magnitude = this.game.config().nukeMagnitudes(nukeType);
    this.impactHalos.push({
      worldX,
      worldY,
      radius: magnitude.outer,
      createdAt: Date.now(),
      duration: this.IMPACT_HALO_DURATION,
    });
  }

  tick(): void {
    const now = Date.now();
    // Remove expired halos
    this.impactHalos = this.impactHalos.filter(
      (halo) => now - halo.createdAt < halo.duration,
    );
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Render targeting halo (existing code)
    if (this.isVisible) {
      // ... existing targeting halo drawing ...
    }

    // Render impact halos
    const now = Date.now();
    for (const halo of this.impactHalos) {
      const age = now - halo.createdAt;
      const progress = age / halo.duration;
      const alpha = 1 - progress; // Fade out over time

      this.context.beginPath();
      this.context.arc(halo.worldX, halo.worldY, halo.radius, 0, Math.PI * 2);
      this.context.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.6})`; // Max 60% opacity
      this.context.lineWidth = 1.5;
      this.context.stroke();
    }

    // Draw to main canvas
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }
}
```

#### 2.2 Hook into Nuke Detonation Events

**CRITICAL FIX**: FxLayer does NOT have EventBus access currently!

**File**: `src/client/graphics/layers/FxLayer.ts`

Current constructor (line 12-14):

```typescript
constructor(private game: GameView) {
  this.theme = this.game.config().theme();
}
```

Lines 59-72 already handle nuke explosions:

```typescript
onUnitEvent(unit: UnitView) {
  switch (unit.type()) {
    case UnitType.AtomBomb:
    case UnitType.MIRVWarhead:
      this.onNukeEvent(unit, 70);
      break;
    case UnitType.HydrogenBomb:
      this.onNukeEvent(unit, 160);
      break;
    // ...
  }
}

private onNukeEvent(unit: UnitView, radius: number) {
  if (!unit.isActive()) {
    if (!unit.reachedTarget()) {
      this.handleSAMInterception(unit);
    } else {
      // Kaboom - line 124
      this.handleNukeExplosion(unit, radius);
    }
  }
}
```

**Required Changes**:

1. **Update FxLayer constructor** to accept EventBus:

```typescript
constructor(private game: GameView, private eventBus: EventBus) {
  this.theme = this.game.config().theme();
}
```

2. **Update GameRenderer.ts** (line ~241):

```typescript
// Change from:
new FxLayer(game),
// To:
new FxLayer(game, eventBus),
```

3. **Emit event in onNukeEvent**:

```typescript
private onNukeEvent(unit: UnitView, radius: number) {
  if (!unit.isActive()) {
    if (!unit.reachedTarget()) {
      this.handleSAMInterception(unit);
    } else {
      // Kaboom
      this.handleNukeExplosion(unit, radius);

      // Emit event for halo layer
      this.eventBus.emit(new NukeImpactEvent(
        this.game.x(unit.lastTile()),
        this.game.y(unit.lastTile()),
        unit.type()
      ));
    }
  }
}
```

**New Event Class** (`src/client/InputHandler.ts` - add alongside existing events):

```typescript
export class NukeImpactEvent implements GameEvent {
  constructor(
    public readonly worldX: number,
    public readonly worldY: number,
    public readonly nukeType: UnitType,
  ) {}
}
```

**NukeTargetingLayer Subscription**:

```typescript
init(): void {
  this.redraw();
  this.eventBus.on(NukeImpactEvent, (event) => {
    this.addImpactHalo(event.worldX, event.worldY, event.nukeType);
  });
}
```

---

### Phase 3: Edge Cases & Polish

#### 3.1 Multiple Nukes

**Already handled**: `impactHalos` is an array, supports multiple simultaneous halos.

#### 3.2 Cancellation

**Already handled**: When `pendingBuildUnitType` becomes null, `isVisible` becomes false, halo disappears.

#### 3.3 Camera Movement

**Already handled**: Layer uses `shouldTransform() → true`, so halos move correctly with camera pan/zoom.

#### 3.4 Hotkey vs Menu Selection

**Already handled**: Both paths set `pendingBuildUnitType`, which triggers halo rendering.

#### 3.5 Performance

**Optimization considerations**:

- Impact halos: Max ~3-5 simultaneous (typical game scenarios)
- Rendering cost: Minimal (2 `arc()` calls per halo)
- Cleanup: Automatic via `tick()` expiration

---

## Testing Strategy

### Unit Tests

**File**: `tests/client/NukeTargetingLayer.test.ts`

```typescript
import { NukeTargetingLayer } from "../../src/client/graphics/layers/NukeTargetingLayer";
import { UnitType } from "../../src/core/game/Game";

describe("NukeTargetingLayer", () => {
  let layer: NukeTargetingLayer;
  let mockGame: any;
  let mockUIState: any;
  let mockTransformHandler: any;

  beforeEach(() => {
    mockGame = {
      width: () => 500,
      height: () => 500,
      config: () => ({
        theme: () => ({}),
        nukeMagnitudes: (type: UnitType) => {
          if (type === UnitType.AtomBomb) return { inner: 12, outer: 30 };
          if (type === UnitType.HydrogenBomb) return { inner: 80, outer: 100 };
          return { inner: 0, outer: 0 };
        },
      }),
    };
    mockUIState = { pendingBuildUnitType: null };
    mockTransformHandler = {
      screenToWorldCoordinates: (x: number, y: number) => ({ x, y }),
    };

    layer = new NukeTargetingLayer(mockGame, mockUIState, mockTransformHandler);
    layer.init();
  });

  test("halo visible when Atomic Bomb selected", () => {
    mockUIState.pendingBuildUnitType = UnitType.AtomBomb;
    layer.updateCursorPosition(100, 100);

    // Assert rendering happens (would need mock canvas)
    expect(layer["isVisible"]).toBe(true);
  });

  test("halo hidden when MIRV selected", () => {
    mockUIState.pendingBuildUnitType = UnitType.MIRV;
    layer.updateCursorPosition(100, 100);

    expect(layer["isVisible"]).toBe(false);
  });

  test("impact halo expires after 1 second", () => {
    jest.useFakeTimers();
    layer.addImpactHalo(200, 200, UnitType.HydrogenBomb);

    expect(layer["impactHalos"].length).toBe(1);

    jest.advanceTimersByTime(1100);
    layer.tick();

    expect(layer["impactHalos"].length).toBe(0);
  });

  test("multiple impact halos tracked independently", () => {
    layer.addImpactHalo(100, 100, UnitType.AtomBomb);
    layer.addImpactHalo(200, 200, UnitType.HydrogenBomb);

    expect(layer["impactHalos"].length).toBe(2);
  });
});
```

### Manual Testing Checklist

**Targeting Mode**:

- [ ] Select Atomic Bomb via hotkey (default: `5`) - halo appears
- [ ] Select Hydrogen Bomb via hotkey (default: `6`) - larger halo appears
- [ ] Select via BuildMenu click - halo appears
- [ ] Move cursor - halo follows smoothly
- [ ] Right-click - halo disappears
- [ ] ESC key - halo disappears
- [ ] Place nuke (single-build) - halo disappears after placement
- [ ] Multi-build mode - halo persists between placements

**Post-Impact**:

- [ ] Fire Atomic Bomb - halo appears at impact for 1 second
- [ ] Fire Hydrogen Bomb - larger halo appears at impact for 1 second
- [ ] Fire multiple nukes quickly - all halos render correctly
- [ ] Pan camera during halo display - halo stays at correct world position
- [ ] Zoom during halo display - halo scales correctly

**Edge Cases**:

- [ ] Switch from Atomic to Hydrogen while targeting - radius changes
- [ ] Launch nuke from hotkey vs menu - both trigger impact halo
- [ ] Nuke intercepted by SAM - no impact halo (only on successful detonation)

---

## Implementation Checklist

### Phase 0: Prerequisites

- [ ] **Update FxLayer**: Add EventBus to constructor signature
- [ ] **Update FxLayer instantiation** in GameRenderer.ts
- [ ] **Add getLayers() getter** to GameRenderer class
- [ ] **Create NukeImpactEvent** class in InputHandler.ts

### Phase 1: Targeting Mode

- [ ] Create `NukeTargetingLayer.ts` with basic structure
- [ ] Implement cursor tracking via `updateCursorPosition()`
- [ ] Add radius lookup from `nukeMagnitudes()`
- [ ] Render semi-transparent circle at cursor
- [ ] Integrate into `GameRenderer` layer stack (after UILayer)
- [ ] Wire up `MouseMoveEvent` in `ClientGameRunner.onMouseMove()`
- [ ] Test with both Atomic and Hydrogen bombs
- [ ] Verify cancellation behavior (right-click, ESC)

### Phase 2: Post-Impact

- [ ] Add `ImpactHalo` data structure to NukeTargetingLayer
- [ ] Implement `addImpactHalo()` method
- [ ] Add expiration logic in `tick()`
- [ ] Emit NukeImpactEvent from `FxLayer.onNukeEvent()`
- [ ] Subscribe to event in `NukeTargetingLayer.init()`
- [ ] Render impact halos with fade-out animation
- [ ] Test multiple simultaneous halos (5+)

### Phase 3: Polish

- [ ] Add inner radius indicator (optional, subtle at 25% alpha)
- [ ] Tune alpha values (targeting: 0.5, impact: 0.6 max)
- [ ] Verify performance with 10+ simultaneous halos
- [ ] Test camera movement during halo display
- [ ] Add unit tests
- [ ] Complete manual testing checklist
- [ ] Update user story with "Implemented" status

---

## Configuration & Customization

### Future Enhancements (Optional)

If user feedback requests customization:

**Config File Addition** (`src/core/configuration/Config.ts`):

```typescript
export interface Config {
  // ... existing ...
  nukeTargetingHaloEnabled(): boolean;
  nukeTargetingHaloAlpha(): number; // 0.0 - 1.0
  nukeImpactHaloDuration(): number; // milliseconds
}
```

**Default Values** (`src/core/configuration/DefaultConfig.ts`):

```typescript
nukeTargetingHaloEnabled(): boolean {
  return true;
}

nukeTargetingHaloAlpha(): number {
  return 0.5; // 50% opacity
}

nukeImpactHaloDuration(): number {
  return 1000; // 1 second
}
```

---

### Dependencies & Risks

### Dependencies

- **FxLayer modification required**: Must add EventBus parameter to constructor
- **GameRenderer modification**: FxLayer instantiation must be updated
- Uses existing Canvas 2D API (already in use across layers)
- Relies on stable `nukeMagnitudes()` config (unchanged since initial implementation)
- Depends on EventBus pattern (already extensively used)

### Risks & Mitigations

| Risk                                    | Impact | Likelihood | Mitigation                                             |
| --------------------------------------- | ------ | ---------- | ------------------------------------------------------ |
| Performance degradation with many halos | Low    | Low        | Array pruning in `tick()`, cap at 10 halos             |
| Halo misalignment with zoom             | Medium | Low        | Already mitigated via `shouldTransform()`              |
| Conflict with existing visual effects   | Low    | Low        | Layer ordering ensures proper overlap                  |
| Breaking FxLayer during refactor        | Medium | Low        | FxLayer only has 1 instantiation site, easy to fix     |
| Accessibility (color blindness)         | Low    | Medium     | White color works for most cases; future: configurable |
| Memory leak from event listeners        | Low    | Low        | EventBus pattern already proven stable                 |

---

## Acceptance Criteria Mapping

| AC# | User Story Requirement              | Technical Implementation                                                       |
| --- | ----------------------------------- | ------------------------------------------------------------------------------ |
| AC1 | Halo during Atomic Bomb targeting   | `NukeTargetingLayer` renders when `pendingBuildUnitType === UnitType.AtomBomb` |
| AC2 | Halo during Hydrogen Bomb targeting | Same layer, different radius via `nukeMagnitudes()`                            |
| AC3 | Post-impact halo (menu launch)      | `NukeImpactEvent` emitted in `FxLayer.onNukeEvent()`                           |
| AC4 | Post-impact halo (hotkey launch)    | Same event path, no distinction needed                                         |
| AC5 | Multiple nukes                      | `impactHalos` array supports N halos simultaneously                            |
| AC6 | Cancellation                        | `isVisible` tied to `pendingBuildUnitType`, auto-hides                         |

---

## Estimated Effort

- **Phase 1 (Targeting Mode)**: 4-6 hours
  - Layer creation: 2 hours
  - Integration: 1 hour
  - Testing: 1-2 hours
  - Bug fixes: 1 hour

- **Phase 2 (Post-Impact)**: 3-4 hours
  - Event system: 1 hour
  - Halo lifecycle: 1 hour
  - Testing: 1-2 hours

- **Phase 3 (Polish)**: 2-3 hours
  - Edge case handling: 1 hour
  - Performance validation: 1 hour
  - Documentation: 1 hour

**Total**: 9-13 hours (approximately 1.5-2 days of focused development)

---

## Next Steps

1. **Review**: Share this document with team for feedback
2. **Approval**: Confirm approach aligns with architecture vision
3. **Implementation**: Follow phases sequentially (targeting → impact → polish)
4. **Testing**: Complete both unit and manual test checklists
5. **PR**: Submit with reference to user story and this technical doc
6. **Deployment**: Merge to `v0.2.x` release branch after QA approval

---

## Critical Review Findings (2025-11-15)

### Issues Found and Corrected

#### 1. **FxLayer EventBus Dependency** ⚠️ CRITICAL

- **Original Error**: Assumed FxLayer had EventBus access
- **Reality**: FxLayer constructor only takes `GameView` (line 12-14)
- **Fix Required**: Add EventBus parameter to constructor and update instantiation
- **Impact**: Would cause compile error without this fix

#### 2. **Layer Instantiation Location** ⚠️ MODERATE

- **Original Error**: Suggested adding layer in `ClientGameRunner.ts`
- **Reality**: All layers instantiated in `GameRenderer.ts` `createRenderer()` function (lines 230-270)
- **Fix Applied**: Corrected documentation to show proper location
- **Impact**: Would cause confusion during implementation

#### 3. **Renderer Architecture** ℹ️ INFORMATIONAL

- **Rendering Pipeline**: Two-pass system (lines 348-366 in GameRenderer.ts)
  - Pass 1: Transform applied, render all layers with `shouldTransform() === true`
  - Pass 2: No transform, render all layers with `shouldTransform() === false`
- **Layer Ordering**: Matters within each pass, not globally
- **Targeting Layer**: Must return `shouldTransform() === true` to move with camera

#### 4. **UIState Type** ℹ️ INFORMATIONAL

- **Reality**: `UIState` is an interface, not a class (UIState.ts lines 3-9)
- **Current Properties**: `attackRatio`, `investmentRate`, `pendingBuildUnitType`, `multibuildEnabled`, `upgradeMode`
- **Implication**: No need to import for type checking, just use as type annotation

#### 5. **Performance Validation** ✅ CONFIRMED

- **Frame Budget**: Renderer warns if frame takes >50ms (line 377)
- **Layer Count**: Currently ~30 layers, adding 1 more is negligible
- **Canvas Operations**: `arc()` calls are highly optimized, 5-10 halos < 1ms
- **Tick Method**: Called once per game tick, not per render frame
- **Memory**: Impact halos auto-prune after 1 second, max ~10 objects in array

#### 6. **Event System** ✅ CONFIRMED

- **EventBus Pattern**: Constructor-based event identification (EventBus.ts)
- **Usage**: `eventBus.on(EventClass, callback)` and `eventBus.emit(new EventClass())`
- **Location**: All existing events in `InputHandler.ts` (lines 7-108)
- **Pattern Verified**: Correct in original specification

#### 7. **Nuke Detection Logic** ✅ CONFIRMED

- **FxLayer.onNukeEvent()**: Lines 118-127
- **Detonation Check**: `!unit.isActive() && unit.reachedTarget()`
- **SAM Interception**: `!unit.isActive() && !unit.reachedTarget()` (no halo needed)
- **Impact Location**: `unit.lastTile()` converted via `game.x()` and `game.y()`

### Verified Correct Elements

✅ Blast radius values (AtomBomb: 30, HydrogenBomb: 100)  
✅ Canvas 2D rendering approach (not PIXI - PIXI only for structures)  
✅ Layer interface and methods (init, tick, renderLayer, shouldTransform)  
✅ Transform system (TransformHandler, world/screen coordinate conversion)  
✅ Cursor tracking via MouseMoveEvent (already emitted, line 211 InputHandler.ts)  
✅ pendingBuildUnitType behavior (triggers crosshair cursor, lines 216-228)  
✅ Multi-halo support (array-based approach is correct)  
✅ Fade-out animation technique (time-based alpha interpolation)

### Architectural Notes

- **No Hot Module Replacement**: Changes to layers require full reload
- **No Lazy Loading**: All layers instantiated at game start
- **Single Canvas**: All 2D layers render to same canvas (no offscreen compositing for this layer needed)
- **No CSS Transforms**: All positioning via canvas coordinate transforms
- **Event Bus Lifetime**: Lives for entire game session, no cleanup needed for events

### Performance Budget

| Operation               | Cost (estimated) | Frequency  | Total/Frame      |
| ----------------------- | ---------------- | ---------- | ---------------- |
| Targeting halo render   | ~0.1ms           | Once/frame | 0.1ms            |
| Impact halo render (5x) | ~0.5ms           | Once/frame | 0.5ms            |
| Tick (array pruning)    | <0.01ms          | Once/tick  | <0.01ms          |
| MouseMove update        | <0.01ms          | 60x/sec    | 0.6ms/sec        |
| **Total overhead**      |                  |            | **~0.6ms/frame** |

**Conclusion**: <2% of 16.67ms frame budget (60 FPS), well within acceptable range.

---

## References

- User Story: `docs/user-stories/nuke-target-halo.md`
- Similar Implementation: `ShockwaveFx` in `src/client/graphics/fx/NukeFx.ts` (lines 9-32)
- Layer System: `src/client/graphics/layers/Layer.ts`
- Config Reference: `src/core/configuration/DefaultConfig.ts` (lines 1175-1185)
- Event System: `src/core/EventBus.ts`
- FxLayer: `src/client/graphics/layers/FxLayer.ts`
- GameRenderer: `src/client/graphics/GameRenderer.ts`
