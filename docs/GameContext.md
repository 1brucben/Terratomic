# **Terratomic – Gameplay Overview (v4)**

## **1. Game Concept**

_Terratomic_ is a real-time world domination strategy game where players control nations and compete to conquer 90% of the world map.

Each player starts with a small territory and population. Population is divided between **workers** (who generate gold) and **troops** (who expand and attack). Players expand into neutral territory (_terra nullius_) or invade others, build strategic structures, form alliances, and wield devastating weapons — including nuclear and MIRV missiles.

---

## **2. Game Objective**

The main goal is to **control 90% of the map** through territorial expansion and warfare.  
Victory is achieved by:

- Expanding into unclaimed and enemy territories.
- Managing economy and troop ratios.
- Constructing key structures and researching advanced technology.
- Surviving conflicts through defense and strategy.

---

## **3. Core Gameplay Loop**

1. **Start Phase** – Begin with a few tiles and a small population. Adjust your **worker/troop ratio**.
2. **Expansion Phase** – Use troops to expand into neutral land.
3. **Conflict Phase** – Attack rivals and manage defensive buildings.
4. **Development Phase** – Construct infrastructure and research upgrades.
5. **Domination Phase** – Capture enemy structures, deploy advanced weapons, and control 90% of the map.

---

## **4. Resources and Sliders**

| **Resource / Control**  | **Purpose**                                              |
| ----------------------- | -------------------------------------------------------- |
| **Population**          | Divided between workers (economy) and troops (military). |
| **Workers**             | Generate gold per second.                                |
| **Troops**              | Used for attacking and expanding.                        |
| **Gold**                | Used for construction, upgrades, and units.              |
| **Attack Ratio Slider** | Sets the percentage of total troops used in each attack. |
| **Troop/Worker Slider** | Determines how many citizens become soldiers or workers. |

---

## **5. Combat and Expansion**

### **Expansion**

- Expand into _terra nullius_ (neutral land) to increase territory and potential population.
- Expansion costs fewer troops than attacking other nations.

### **Attacking**

- Click on a neighboring tile to attack it.
- Higher troop density increases attack effectiveness.
- Use the **Attack Ratio Slider** to commit a chosen percentage of troops.

### **Conquest**

- When you conquer land, all **structures** on it become yours immediately.

### **Naval and Air Warfare**

- Warships, submarines, planes, and missiles add long-range strategic depth.
- Missiles can devastate large areas but can be intercepted.

---

## **6. Buildings**

| **Structure**        | **Cost** | **Function**                                        |
| -------------------- | -------- | --------------------------------------------------- |
| **City**             | 250K     | Increases maximum population cap.                   |
| **Port**             | 250K     | Enables naval trade and warship construction.       |
| **Airfield**         | 800K     | Spawns bombers automatically; allows jet purchases. |
| **Hospital**         | 1.5M     | Reduces casualties in combat.                       |
| **Military Academy** | 1.5M     | Increases attack performance.                       |
| **Missile Silo**     | 1.0M     | Launches atomic, hydrogen, and MIRV missiles.       |
| **SAM Launcher**     | 1.5M     | Shoots down missiles and aircraft.                  |
| **Defense Post**     | 100K     | Slows enemy advance in a local radius.              |

---

## **7. Alliances and Teams**

### **Free-for-All Mode**

- Players can form **temporary alliances** lasting **10 minutes**.
- Betraying an ally causes a **temporary defense penalty**, weakening your territory.

### **Team Mode**

- 2–7 teams.
- Players in the same team are permanently allied and cannot attack each other.
- The team that controls 90% of the map collectively wins.

---

## **8. Visibility**

There is **no fog of war** — all players can see the entire map at all times.

---

## **9. AI Systems**

### **Normal Bots**

- Simple AI opponents for early-game expansion.
- Do not build structures.
- Provide an easy source of land and gold.

### **Nation Bots (Fake Humans)**

- Advanced AI with full strategic capability.
- They build structures, adjust ratios, and attack intelligently.
- Use varying strategies: aggressive, defensive, or opportunistic.

---

## **10. Special Weapons**

| **Weapon**                           | **Launched From** | **Effect**                                   |
| ------------------------------------ | ----------------- | -------------------------------------------- |
| **Atomic Bomb**                      | Missile Silo      | High-damage, moderate range.                 |
| **Hydrogen Bomb**                    | Missile Silo      | Very high damage, large radius.              |
| **MIRV**                             | Missile Silo      | Multiple warheads striking multiple targets. |
| **Nuclear Submarine (with upgrade)** | Submarine         | Can launch atomic bombs.                     |

---

## **11. Research & Technology**

Research is divided into **four categories**: **Land**, **Water**, **Air**, and **Economy**.  
Each unlocks advanced strategic abilities and modifies gameplay dynamics.

### **Land Upgrades**

| **Upgrade**                     | **Description**                                                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Roads Upgrade**               | Builds road networks between cities, ports, airfields, hospitals, and military academies. Roads enable internal trade using cargo trucks, generating gold over time. However, they also create vulnerabilities — attacks prioritize roads as invasion paths. |
| **International Trade Upgrade** | Allows construction of roads to allied territories, creating international trade routes. Both players gain gold from trade, but these shared roads also increase border vulnerability.                                                                       |
| **Scorched Earth Upgrade**      | Destroys your own road network. Useful as a defensive measure when under invasion to deny enemies the benefits of your infrastructure.                                                                                                                       |

---

### **Water Upgrades**

| **Upgrade**                   | **Description**                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Submarine Upgrade**         | Unlocks submarines, which are invisible except when attacking or for 3 seconds every 15 seconds. They can attack and destroy ships. |
| **Warship Anti-Air Upgrade**  | Allows warships to shoot down aircraft (excluding nukes).                                                                           |
| **Nuclear Submarine Upgrade** | Converts submarines into mobile missile silos capable of launching atomic bombs.                                                    |

---

### **Air Upgrades**

| **Upgrade**                   | **Description**                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Paratroopers Upgrade**      | Enables launching paratrooper attacks to target any land region, even if landlocked. Useful for bypassing frontlines.                                                       |
| **City Anti-Air Upgrade**     | Grants cities limited SAM defense, protecting them from atomic bombs, hydrogen bombs, bombers, and paratroopers. Does **not** stop MIRV missiles. Has a 30-second cooldown. |
| **Fighter Anti-Ship Upgrade** | Allows fighter jets to target ships and submarines (when visible).                                                                                                          |

---

### **Economy Upgrades**

| **Upgrade**             | **Description**                                                     |
| ----------------------- | ------------------------------------------------------------------- |
| **Urban Planning**      | Increases maximum population capacity by 25%.                       |
| **Structure Insurance** | Refunds 33% of a building's cost upon destruction or conquest.      |
| **Automation**          | Doubles internal trade income, but slows troop regeneration by 20%. |

---

## **12. AI Agent Reference Model**

### **State Representation**

- Population, worker ratio, troop count, and gold.
- Owned land, buildings, and research upgrades.
- Active alliances and their remaining duration.
- Nearby enemy strength and troop density.

### **Action Space**

- Adjust sliders (population and attack ratio).
- Expand or attack.
- Build or destroy structures.
- Form or betray alliances.
- Launch special weapons or paratrooper attacks.
- Trigger research upgrades.

### **Reward System**

- **Positive Rewards:** expansion, structure capture, successful attacks, research upgrades.
- **Negative Rewards:** losing land, broken alliances (defense penalty), failed attacks.
- **Win Condition:** reach 90% map control (solo or team victory).

---

## **13. Summary**

_Terratomic_ combines fast-paced expansion mechanics with deep strategic systems.  
Players must balance economy, military, infrastructure, and diplomacy while adapting to threats and opportunities.  
The addition of **research**, **alliances**, and **AI opponents** ensures every match evolves uniquely — from early expansion to late-game nuclear brinkmanship.
