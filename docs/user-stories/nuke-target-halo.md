# User Story – Nuke Targeting Halo

**As a** human player in any game mode where nukes are available  
**I want** a visual halo showing the blast radius when targeting or firing atomic and hydrogen bombs  
**So that** I can better understand and control which tiles will be affected by the nuclear strike.

## Background / Rationale

Currently, when selecting an Atomic Bomb or Hydrogen Bomb, the player only sees a normal targeting crosshair. The actual blast radius is not communicated visually, which can lead to misjudging which units or cities will be hit.

Adding a semi‑transparent halo that represents the true blast radius around the crosshair (while targeting) and around the impact tile (immediately after firing) will make nuclear targeting clearer and reduce misplays.

## Scope

- Applies to **human players** only.
- Applies in **all game modes** where nukes (Atomic Bomb and Hydrogen Bomb) are available.
- Weapons covered:
  - **Atomic Bomb**
  - **Hydrogen Bomb**
- Explicitly **excluded**:
  - MIRV and any other future nuclear types (unless specifically added later).

---

## Behavior Details

### Targeting mode (before firing)

**Trigger conditions:**

- Player has entered **bomb targeting mode** by:
  - Selecting an Atomic Bomb or Hydrogen Bomb from the **Build/Attack menu**, or
  - Using the corresponding **hotkey** that enters a targeting mode (if applicable).

**Halo behavior:**

- A **semi‑transparent halo** is shown, representing the **actual blast radius** of the selected bomb type.
- The halo is:
  - **Centered on the crosshair tile**.
  - Moves with the crosshair as the player moves the cursor.
  - **Always visible** while bomb targeting mode is active (regardless of whether the cursor is currently over a valid or invalid tile).
- The normal crosshair remains visible; the halo is a visual extension, not a replacement.

**Cancellation:**

- If the player cancels bomb targeting mode (e.g. right‑click, ESC, switching tools), the halo disappears immediately.

---

### After firing (post‑impact halo)

**Trigger conditions:**

- Player orders an **Atomic Bomb** or **Hydrogen Bomb** strike:
  - Either via **Build/Attack menu**, or
  - Via **hotkey** (point‑and‑click nuke).

**Halo behavior after firing:**

- As soon as the nuke is **committed** to a target tile:
  - A halo is displayed, **centered on the impact tile**, showing the same blast radius used for damage.
- The post‑impact halo:
  - Remains visible for **approximately 1 second**.
  - Continues to show even if the **camera moves** during that second.
  - Is independent of current tool: it stays for the remainder of the 1 second even if the player switches out of targeting mode.
- Multiple nukes:
  - If the player fires multiple nukes quickly, **each strike gets its own halo**.
  - Halos may **overlap visually** if blast areas intersect.
  - Each halo manages its own ~1 second lifetime; they **all remain visible until their individual timeouts** expire.

**End of life:**

- After ~1 second, each halo automatically disappears.
- There is no manual control to keep it longer; duration is fixed for now.

---

## Edge Cases & Clarifications

- The halo's size must exactly match the **rules-defined blast radius** for each bomb type.
- If a nuke command fails (e.g., invalid target, insufficient resources, targeting cancelled), the **post‑impact halo must not appear**.
- If targeting mode is active but the player opens another UI or tab:
  - **Targeting cancellation behavior** should follow existing rules; whenever targeting mode ends, the halo ends with it.
- Performance:
  - Implementation should reuse or pool rendering objects where possible; avoid per-frame allocations.
  - Behavior should be consistent for both client-rendered and spectator views if spectators are allowed to see target previews (if not, this story applies only to active players).

---

## Acceptance Criteria (Gherkin)

### AC1 – Halo during bomb targeting (menu selection)

```gherkin
Given I am a human player in a game mode where nukes are available
And I have selected an Atomic Bomb from the build/attack menu
When bomb targeting mode is active
Then I see a semi-transparent halo centered on the crosshair tile
And the halo's radius matches the Atomic Bomb blast radius
And the halo moves with the crosshair as I move the cursor
And the halo is always visible while bomb targeting mode is active.
```

### AC2 – Halo during bomb targeting (Hydrogen Bomb)

```gherkin
Given I am a human player in a game mode where nukes are available
And I have selected a Hydrogen Bomb from the build/attack menu
When bomb targeting mode is active
Then I see a semi-transparent halo centered on the crosshair tile
And the halo's radius matches the Hydrogen Bomb blast radius
And the halo moves with the crosshair as I move the cursor
And the halo is always visible while bomb targeting mode is active.
```

### AC3 – Post-impact halo for menu-fired nukes

```gherkin
Given I am a human player
And I am in bomb targeting mode for an Atomic Bomb or Hydrogen Bomb
When I confirm a valid target tile via the build/attack menu
Then a halo appears centered on the impact tile immediately
And the halo's radius matches the blast radius of the fired bomb
And the halo remains visible for approximately 1 second after firing
And the halo remains visible during that second even if I move the camera
And after approximately 1 second the halo disappears automatically.
```

### AC4 – Post-impact halo for hotkey-fired nukes

```gherkin
Given I am a human player
And I can launch an Atomic Bomb or Hydrogen Bomb via a hotkey
When I fire a nuke by pressing the hotkey and selecting a target tile
Then a halo appears centered on the impact tile immediately
And the halo's radius matches the blast radius of the fired bomb
And the halo remains visible for approximately 1 second after firing
And the halo remains visible during that second even if I move the camera
And after approximately 1 second the halo disappears automatically.
```

### AC5 – Multiple nukes in quick succession

```gherkin
Given I am a human player
When I fire multiple Atomic or Hydrogen bombs in quick succession at different tiles
Then each impact tile gets its own halo
And halos may overlap visually if their blast areas intersect
And each halo remains visible for approximately 1 second from its own impact time
And each halo disappears independently when its 1-second duration ends.
```

### AC6 – Cancelling targeting

```gherkin
Given I am in bomb targeting mode with an Atomic Bomb or Hydrogen Bomb
And I currently see the targeting halo around the crosshair
When I cancel targeting (for example by right-clicking or pressing Escape)
Then the targeting halo disappears immediately
And no post-impact halo is shown.
```
