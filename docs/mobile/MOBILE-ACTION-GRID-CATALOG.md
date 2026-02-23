# Mobile Action Grid Catalog

> Last updated: 2026-02-22

Complete action inventory for `MobileActionGrid`, sourced directly from code.

Related docs: [Architecture](MOBILE-ARCHITECTURE.md) · [Feature Matrix](MOBILE-FEATURE-MATRIX.md) · [Gestures & Haptics](MOBILE-GESTURES-HAPTICS.md)

---

## Category Resolution

`MobileActionGrid.determineTileCategory()` maps each tile tap to one of these categories:

| Category                  | Condition                                                      |
| ------------------------- | -------------------------------------------------------------- |
| `spawn-phase`             | Game in spawn phase                                            |
| `own-land`                | Own tile, land (includes shore — shore uses same land actions) |
| `own-shore`               | Own tile, shoreline (delegates to own-land actions)            |
| `own-water`               | Own tile, water                                                |
| `enemy-can-attack`        | Enemy/player tile, `canAttack` is true                         |
| `enemy-can-boat-attack`   | Enemy/player land tile, reachable by transport ship only       |
| `enemy-no-attack`         | Enemy/player tile, no ground or boat attack possible           |
| `neutral-can-attack`      | Neutral tile, ocean (ship building) or land with `canAttack`   |
| `neutral-can-boat-attack` | Neutral land tile, reachable by transport ship only            |

Own-land/own-shore/own-water also append a **Stack Mode toggle** at the end of the actions list.

All categories (except spawn-phase) also prepend **Unit Selection actions** when a selectable unit (Warship, Submarine, Fighter Jet, Artillery) is within 40px screen distance of the tap position.

---

## Actions by Category

### Spawn Phase

| Action     | ID      | Priority | Condition         |
| ---------- | ------- | -------- | ----------------- |
| Spawn Here | `spawn` | high     | Unowned land tile |

---

### Unit Selection (All Categories)

When tapping near a player-owned selectable unit (within 40px screen distance), a "Select [Unit]" action is prepended to the grid. This works on **all** tile categories — own, enemy, or neutral — because units can be on any tile (e.g. ships on unowned ocean, jets over enemy land).

| Action             | ID                            | Priority | Condition                          |
| ------------------ | ----------------------------- | -------- | ---------------------------------- |
| Select Warship     | `unit:select:Warship:<id>`    | high     | Own Warship within 40px of tap     |
| Select Submarine   | `unit:select:Submarine:<id>`  | high     | Own Submarine within 40px of tap   |
| Select Fighter Jet | `unit:select:FighterJet:<id>` | high     | Own Fighter Jet within 40px of tap |
| Select Artillery   | `unit:select:Artillery:<id>`  | high     | Own Artillery within 40px of tap   |

After selecting a unit, the action grid closes and a **floating banner** appears ("📍 [Unit] selected — tap to redirect ✕"). Tapping any valid tile immediately emits the corresponding `Move*IntentEvent`. Artillery has an additional range check. Tapping ✕ cancels selection.

---

### Own Land / Own Shore

All unlocked land structures. Disabled (greyed) if gold insufficient. Research-locked structures hidden until prerequisite unlocked.

| Action          | ID                     | Priority | Requirement                    |
| --------------- | ---------------------- | -------- | ------------------------------ |
| Port            | `build:Port`           | high     | Nearby ocean shore (≤10 tiles) |
| City            | `build:City`           | high     | —                              |
| Factory         | `build:Factory`        | high     | —                              |
| Defense Post    | `build:DefensePost`    | normal   | —                              |
| Airfield        | `build:Airfield`       | high     | —                              |
| Hospital        | `build:Hospital`       | normal   | `HospitalResearch`             |
| Missile Silo    | `build:MissileSilo`    | normal   | `NuclearFission`               |
| Research Lab    | `build:ResearchLab`    | normal   | —                              |
| Academy         | `build:Academy`        | normal   | —                              |
| SAM Launcher    | `build:SAMLauncher`    | normal   | —                              |
| Doomsday Device | `build:DoomsdayDevice` | normal   | `DoomsdayDeviceResearch`       |
| Artillery       | `build:Artillery`      | normal   | Factory + `ArtilleryResearch`  |
| Fighter Jet     | `build:FighterJet`     | normal   | Airfield + `JetEngines`        |
| Stack Mode      | `mode:stack-toggle`    | —        | Always (last item)             |

Port only appears when a BFS within 10 tiles finds an owned ocean-shore tile.

---

### Own Water

| Action      | ID                  | Priority | Requirement                |
| ----------- | ------------------- | -------- | -------------------------- |
| Port        | `build:Port`        | high     | Nearby ocean shore (≤10)   |
| Warship     | `build:Warship`     | high     | Owns a Port                |
| Submarine   | `build:Submarine`   | high     | Port + `SubmarineResearch` |
| Fighter Jet | `build:FighterJet`  | normal   | Airfield + `JetEngines`    |
| Stack Mode  | `mode:stack-toggle` | —        | Always (last item)         |

---

### Enemy — Can Ground Attack

| Action           | ID                         | Priority | Requirement                         |
| ---------------- | -------------------------- | -------- | ----------------------------------- |
| Ground Attack    | `attack:ground`            | high     | Troops > 0                          |
| Paratroopers     | `attack:airstrike`         | normal   | Airfield + `JetEngines`             |
| Bomber Run       | `attack:bomber`            | normal   | Airfield + at war                   |
| Fighter Jet      | `build:FighterJet`         | normal   | Airfield + `JetEngines`             |
| Request Peace    | `diplomacy:request-peace`  | normal   | At war with target                  |
| Break Alliance   | `diplomacy:break-alliance` | normal   | Allied with target                  |
| Propose Alliance | `diplomacy:propose-ally`   | normal   | Neutral relationship                |
| Declare War      | `attack:declare-war`       | normal   | Not at war                          |
| Atom Bomb        | `attack:nuke-atom`         | normal   | Silo + `NuclearFission` + 5K gold   |
| H-Bomb           | `attack:nuke-hbomb`        | normal   | Silo + `ThermonuclearStaging` + 15K |
| MIRV             | `attack:nuke-mirv`         | normal   | Silo + `MIRVTechnology` + 50K       |

---

### Enemy — Can Boat Attack

| Action           | ID                         | Priority | Requirement                         |
| ---------------- | -------------------------- | -------- | ----------------------------------- |
| Naval Assault    | `attack:naval`             | high     | Troops > 0                          |
| Paratroopers     | `attack:airstrike`         | normal   | Airfield + `JetEngines`             |
| Bomber Run       | `attack:bomber`            | normal   | Airfield + at war                   |
| Request Peace    | `diplomacy:request-peace`  | normal   | At war with target                  |
| Break Alliance   | `diplomacy:break-alliance` | normal   | Allied with target                  |
| Propose Alliance | `diplomacy:propose-ally`   | normal   | Neutral relationship                |
| Declare War      | `attack:declare-war`       | normal   | Not at war                          |
| Atom Bomb        | `attack:nuke-atom`         | normal   | Silo + `NuclearFission` + 5K gold   |
| H-Bomb           | `attack:nuke-hbomb`        | normal   | Silo + `ThermonuclearStaging` + 15K |
| MIRV             | `attack:nuke-mirv`         | normal   | Silo + `MIRVTechnology` + 50K       |

---

### Enemy — No Attack Possible

Diplomacy + air + nukes only. Peace and alliance are promoted to high priority.

| Action           | ID                         | Priority | Requirement                         |
| ---------------- | -------------------------- | -------- | ----------------------------------- |
| Paratroopers     | `attack:airstrike`         | **high** | Airfield + `JetEngines`             |
| Bomber Run       | `attack:bomber`            | **high** | Airfield + at war                   |
| Request Peace    | `diplomacy:request-peace`  | **high** | At war with target                  |
| Propose Alliance | `diplomacy:propose-ally`   | **high** | Neutral relationship                |
| Break Alliance   | `diplomacy:break-alliance` | normal   | Allied with target                  |
| Declare War      | `attack:declare-war`       | normal   | Not at war                          |
| Atom Bomb        | `attack:nuke-atom`         | normal   | Silo + `NuclearFission` + 5K gold   |
| H-Bomb           | `attack:nuke-hbomb`        | normal   | Silo + `ThermonuclearStaging` + 15K |
| MIRV             | `attack:nuke-mirv`         | normal   | Silo + `MIRVTechnology` + 50K       |

---

### Neutral — Can Attack (Land)

| Action | ID              | Priority | Requirement |
| ------ | --------------- | -------- | ----------- |
| Attack | `attack:ground` | high     | Troops > 0  |

---

### Neutral — Can Attack (Ocean)

| Action      | ID                 | Priority | Requirement                |
| ----------- | ------------------ | -------- | -------------------------- |
| Port        | `build:Port`       | high     | Nearby ocean shore (≤10)   |
| Warship     | `build:Warship`    | high     | Owns a Port                |
| Submarine   | `build:Submarine`  | high     | Port + `SubmarineResearch` |
| Fighter Jet | `build:FighterJet` | normal   | Airfield + `JetEngines`    |

---

### Neutral — Boat Attack

| Action        | ID             | Priority | Requirement |
| ------------- | -------------- | -------- | ----------- |
| Naval Assault | `attack:naval` | high     | Troops > 0  |

---

## Grid Layout

- Bottom-anchored sheet, max 60vh, auto-fill grid with 65px min column width
- High-priority items sorted first
- Top row items auto-expand to fill incomplete rows (percentage-based column spans)
- Disabled tiles: greyed + reason text
- Locked tiles: hidden (research-locked structures not shown until prerequisite met)
- Nukes: only shown when silo + research + gold requirements are all met
- Diplomacy: exactly one of peace/alliance/break-alliance shown based on current relationship; declare-war shown when not at war
- 300ms debounce prevents accidental backdrop closure
- Haptic: `TAP` on valid action, `ERROR` on disabled/locked

---

## Stack Mode

When stack mode is toggled ON:

- Action grid collapses to a single full-width "Stack ON" toggle button
- Map taps upgrade the nearest stackable structure within hit radius (28px screen, 72px sticky)
- Stackable types: City, Port, Airfield, Hospital, Academy, ResearchLab, Factory, MissileSilo, SAMLauncher
- Sticky targeting remembers the last upgraded structure for easier repeated taps
