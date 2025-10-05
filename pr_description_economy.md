# PR Description: New Economy Research Upgrades

### Summary

This pull request introduces a new **Economy** tab to the Research panel and implements three distinct upgrades designed to provide players with new strategic pathways for managing their nation's growth, resilience, and financial power.

### Detailed Feature Breakdown

This PR combines several commits to deliver the following features:

#### 1. New Upgrade: Urban Planning

- **Effect:** Increases the player's maximum population capacity by 25%.
- **Strategic Use:** This upgrade is ideal for players who are geographically constrained or who wish to build a dense, powerful core territory without needing to constantly expand their borders.

#### 2. New Upgrade: Structure Insurance

- **Effect:** Provides a 33% gold refund for any self-built structure that is either destroyed by attacks or captured by an enemy.
- **Strategic Use:** Acts as a crucial economic safety net, mitigating the impact of losses and allowing players to recover more quickly after a devastating attack. The insurance applies retroactively to all existing structures upon purchase.

#### 3. New Upgrade: Automation

- **Effect:** A high-risk, high-reward upgrade with a dual effect:
  - **Benefit:** Doubles (2x) the gold income generated from internal land trade (cargo trucks).
  - **Drawback:** Slows the player's troop regeneration rate by 20%.
- **Strategic Use:** This upgrade is perfect for players aiming for an economic victory or for those in a secure position where they can sacrifice military recovery speed for a significant financial advantage.

#### 4. AI Integration

- **Balanced Progression:** To ensure bots remain competitive and the game difficulty scales appropriately, bots that purchase the "Roads" upgrade are now automatically granted all three new economy upgrades (Urban Planning, Structure Insurance, and Automation).

#### 5. Testing

- A new, robust test has been added to reliably verify the refund mechanism for the Structure Insurance upgrade, specifically for the scenario where a structure is lost due to conquest.

---

### Technical Implementation Details

- \*\*Configuration (`Game.ts`, `DefaultConfig.ts`):
  - The `UpgradeType` enum has been updated with `UrbanPlanning`, `StructureInsurance`, and `Automation`.
  - The logic for all three upgrades is implemented in `DefaultConfig.ts` by conditionally checking if a player `hasUpgrade()`:
    - **Urban Planning:** The `maxPopulation` function now returns a 25% higher value.
    - **Automation (Penalty):** The `populationIncreaseRate` function returns a 20% lower value.

- \*\*Structure Insurance (`UnitImpl.ts`, `PlayerImpl.ts`):
  - An `insuredBy` property was added to `UnitImpl` to track which player, if any, has insured a structure.
  - The core refund logic is triggered within the `delete()` and `setOwner()` methods of `UnitImpl`. This ensures that no matter how a unit is lost (direct attack, nuke, conquest), the refund is processed correctly.
  - A new `insure()` method on the `Unit` interface allows for retroactive insurance, which is called by the `PurchaseUpgradeExecution` to apply the benefit to all existing buildings when the upgrade is bought.
  - New message types and translation keys were added to notify players of insurance refunds.

- \*\*Automation Trade Bonus (`CargoTruckExecution.ts`):
  - The gold calculation for land-based trade (cargo trucks) was updated to check for the `Automation` upgrade and apply a 2x multiplier to the gold generated upon a successful delivery.

- \*\*AI Integration (`PurchaseUpgradeExecution.ts`):
  - The logic to grant economy upgrades to bots is centralized in `PurchaseUpgradeExecution.ts`. When a bot purchases `UpgradeType.Roads`, the execution now automatically grants the three new economy upgrades to that bot player.

- \*\*Testing (`StructureInsurance.test.ts`):
  - The original, flaky test for the conquest scenario was removed.
  - A new, more reliable test was written that directly simulates tile conquest and unit capture via the `PlayerExecution` tick. This avoids the complexity of a full `AttackExecution` and provides a more deterministic and focused test of the refund logic.

---

### New Configurable Settings

All balancing values for the new upgrades are defined in `src/core/configuration/DefaultConfig.ts` and can be easily modified.

- **Urban Planning:**
  - `urbanPlanningPopulationBonusNum()`: 5
  - `urbanPlanningPopulationBonusDen()`: 4
  - _(Result: 5/4 = 25% population bonus)_

- **Structure Insurance:**
  - `structureInsuranceRefundNum()`: 1
  - `structureInsuranceRefundDen()`: 3
  - _(Result: 1/3 = 33% refund)_

- **Automation:**
  - `automationTradeIncomeMultiplierNum()`: 2
  - `automationTradeIncomeMultiplierDen()`: 1
  - _(Result: 2/1 = 2x trade income)_
  - `automationTroopRegenMultiplierNum()`: 4
  - `automationTroopRegenMultiplierDen()`: 5
  - _(Result: 4/5 = 20% troop regeneration penalty)_
