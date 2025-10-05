# Plan: Fix Unit Rendering Layer Issue

## 1. Problem Description

A visual bug has been identified where air units (e.g., Fighter Jets) are sometimes rendered underneath sea units (e.g., Warships) when they occupy the same screen space. This breaks the visual immersion and makes it difficult to track air units during naval engagements.

## 2. Root Cause Analysis

The investigation concluded that all moving units, regardless of their type (air, sea, or ground), are rendered within a single `UnitLayer`. This layer processes and draws units in the order they are received from the game's update loop, without any explicit sorting. As a result, if a warship is processed after a fighter jet at the same location, it will be drawn on top, causing the visual glitch.

- **File Confirmed:** `src/client/graphics/layers/UnitLayer.ts` handles rendering for both `FighterJet` and `Warship`.
- **Core Issue:** Lack of z-axis or layer-based sorting within the `UnitLayer`'s render pass.

## 3. Proposed Solution

The solution is to introduce sorting logic into the `drawUnitsCells` method within `src/client/graphics/layers/UnitLayer.ts`. This will ensure units are always drawn in a consistent, logical order based on their domain (Air > Sea > Ground).

**File to Modify:** `src/client/graphics/layers/UnitLayer.ts`

**Method to Modify:** `drawUnitsCells`

**Proposed Code Change:**

'''typescript
private drawUnitsCells(unitViews: UnitView[]) {
// Define a clear rendering order for different unit types
const layerOrder = {
// Air units are highest
[UnitType.FighterJet]: 3,
[UnitType.Bomber]: 3,
[UnitType.CargoPlane]: 3,
// Sea units are in the middle
[UnitType.Warship]: 2,
[UnitType.TransportShip]: 2,
[UnitType.TradeShip]: 2,
[UnitType.Submarine]: 2,
// Ground-based projectiles are lowest
[UnitType.Shell]: 1,
};

// Create a sorted copy of the units array based on the layer order
const sortedUnits = [...unitViews].sort((a, b) => {
const aLayer = layerOrder[a.type()] ?? 0; // Default to layer 0 if not specified
const bLayer = layerOrder[b.type()] ?? 0;
return aLayer - bLayer;
});

// Iterate over the sorted array to draw the units
sortedUnits.forEach((unitView) => this.onUnitEvent(unitView));
}
'''

## 4. Potential Risks and Mitigations

1.  **Performance Impact:**
    - **Risk:** Sorting the unit array on every update adds a small computational overhead, which could potentially impact frame rates with a very large number of on-screen units.
    - **Mitigation:** The performance impact is expected to be minimal. Post-implementation, performance should be monitored in a high-unit scenario to confirm there is no significant regression.

2.  **Z-Fighting:**
    - **Risk:** The proposed change does not specify a sorting order for units on the same layer (e.g., two overlapping fighter jets). This could lead to them flickering.
    - **Mitigation:** This is a minor visual artifact. If it becomes a noticeable issue, the sorting logic can be enhanced to use a secondary criterion (like unit ID) as a tie-breaker.

3.  **Future Maintenance:**
    - **Risk:** When new units are added to the game, the `layerOrder` map must be updated. If it is not, new units may render at the default lowest layer.
    - **Mitigation:** This is a documentation and process issue. A comment will be added to the `layerOrder` object to remind developers to update it when adding new unit types.

## 5. Implementation Steps

1.  Create a new branch for this fix (e.g., `fix/unit-rendering-order`).
2.  Navigate to `src/client/graphics/layers/UnitLayer.ts`.
3.  Replace the existing `drawUnitsCells` method with the updated version from Section 3.
4.  Run the linter and type checker to ensure the changes are clean.
5.  Commit the changes with a descriptive message.

## 6. Verification Steps

1.  Launch the game in a development environment.
2.  Create a scenario where fighter jets and warships are grouped together and moving.
3.  **Confirm:** Fighter jets consistently render on top of warships, regardless of their direction or the order they were created.
4.  **Confirm:** Other units (bombers, transport ships, etc.) also render in a logical order.
5.  **Confirm:** There is no noticeable performance degradation during this test.
