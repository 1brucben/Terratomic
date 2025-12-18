import {
  ARTILLERY_UPGRADES,
  BOMBER_UPGRADES,
  FIGHTER_UPGRADES,
  SUBMARINE_UPGRADES,
  WARSHIP_UPGRADES,
} from "../core/game/UnitUpgrades";
import { RESEARCH_TECH_IDS } from "../core/tech/TechIds";

export function getDetailedTechTooltip(techId: string): string {
  switch (techId) {
    // --- SEA ---
    case RESEARCH_TECH_IDS.SEA_MISSILE_NAVY: {
      const w2 = WARSHIP_UPGRADES[1];
      const s1 = SUBMARINE_UPGRADES[0];
      return `Unlocks:\n• Gen 2 Warships (+25% health to ${w2.maxHealth}, +35% min damage to ${w2.damageMin}, +21.5% max damage to ${w2.damageMax})\n• Gen 1 Submarines (${s1.maxHealth} health, ${s1.damageMin}-${s1.damageMax} damage, stealth)`;
    }
    case RESEARCH_TECH_IDS.SEA_ADVANCED_FLEET: {
      const w3 = WARSHIP_UPGRADES[2];
      const s2 = SUBMARINE_UPGRADES[1];
      return `Unlocks:\n• Gen 3 Warships (+20% health to ${w3.maxHealth}, +25.9% min damage to ${w3.damageMin}, +17.7% max damage to ${w3.damageMax})\n• Gen 2 Submarines (+25% health to ${s2.maxHealth}, +35% min damage to ${s2.damageMin}, +21.5% max damage to ${s2.damageMax})`;
    }
    case RESEARCH_TECH_IDS.SEA_NUCLEAR_SUBMARINES: {
      const s3 = SUBMARINE_UPGRADES[2];
      return `Unlocks:\n• Gen 3 Submarines (+20% health to ${s3.maxHealth}, +25.9% min damage to ${s3.damageMin}, +17.7% max damage to ${s3.damageMax})\n• Ship Anti-Air: Warships engage and destroy aircraft within range`;
    }
    case RESEARCH_TECH_IDS.SEA_TBD_LEVEL4:
      return `Unlocks:\n• Nuclear Subs: Enables submarines to launch nuclear weapons while submerged and undetected (second-strike capability)`;

    // --- LAND ---
    case RESEARCH_TECH_IDS.LAND_ROADS_HOSPITALS:
      return `Unlocks:\n• Roads: Increases unit movement speed, generates passive trade income per connected tile\n• Trade Routes: Trade ships establish international commerce routes for continuous gold income`;
    case RESEARCH_TECH_IDS.LAND_MILITARY_ACADEMY: {
      const a1 = ARTILLERY_UPGRADES[0];
      return `Unlocks:\n• City Anti-Air: Cities automatically engage enemy aircraft with AA batteries\n• Improved SAM: +35% range to 94.5 pixels, improved accuracy vs bombers/fighters/missiles\n• Artillery Level 1 (${a1.maxHealth} health, ${a1.damageMin}-${a1.damageMax} damage, 60 tile range): Land-based heavy artillery spawns from Factories`;
    }
    case RESEARCH_TECH_IDS.LAND_SAM_SYSTEMS: {
      const a2 = ARTILLERY_UPGRADES[1];
      return `Unlocks:\n• Advanced SAM: +82.25% range to 127.6 pixels (exceeds H-bomb radius), max interception success\n• Hospitals: Increases city population growth rate (faster troop production & economy)\n• Artillery Level 2 (+20% health to ${a2.maxHealth}, damage ${a2.damageMin}-${a2.damageMax}, 75 tile range)`;
    }
    case RESEARCH_TECH_IDS.LAND_DOOMSDAY_DEVICE: {
      const a3 = ARTILLERY_UPGRADES[2];
      return `Unlocks:\n• Military Academy: Unlocks Academy structure; each connected Academy increases enemy troop casualties you inflict in land battles (+10% with one, ~+15% with two, up to +20% cap; applies on attack and defense)\n• Artillery Level 3 (+16.7% health to ${a3.maxHealth}, damage ${a3.damageMin}-${a3.damageMax}, 90 tile range)`;
    }

    // --- AIR ---
    case RESEARCH_TECH_IDS.AIR_PARATROOPERS: {
      const f1 = FIGHTER_UPGRADES[0];
      return `Unlocks:\n• Gen 1 Fighters (${f1.maxHealth} health, ${f1.damageMin}-${f1.damageMax} damage, engages aircraft)\n• Paratroopers: Airborne infantry deployed behind enemy lines for rapid expansion`;
    }
    case RESEARCH_TECH_IDS.AIR_ADVANCED_JETS: {
      const f2 = FIGHTER_UPGRADES[1];
      const b2 = BOMBER_UPGRADES[1];
      return `Unlocks:\n• Gen 2 Fighters (+33.3% health to ${f2.maxHealth}, +50% min damage to ${f2.damageMin}, +30.8% max damage to ${f2.damageMax})\n• Heavy Bombers (+20% health to ${b2.maxHealth}, +20% damage to ${b2.damageMin}, +40% range to ${b2.targetRange}, +50% speed to 3)`;
    }
    case RESEARCH_TECH_IDS.AIR_NAVAL_STRIKE: {
      const f3 = FIGHTER_UPGRADES[2];
      return `Unlocks:\n• Gen 3 Fighters (+25% health to ${f3.maxHealth}, +33.3% min damage to ${f3.damageMin}, +23.5% max damage to ${f3.damageMax})\n• Naval Strike: Fighters can attack warships, transport ships, and trade ships`;
    }
    case RESEARCH_TECH_IDS.AIR_TBD_LEVEL4: {
      const f4 = FIGHTER_UPGRADES[3];
      const b3 = BOMBER_UPGRADES[2];
      return `Unlocks:\n• Gen 4 Fighters (+20% health to ${f4.maxHealth}, +25% min damage to ${f4.damageMin}, +19% max damage to ${f4.damageMax})\n• Supersonic Bombers (+16.7% health to ${b3.maxHealth}, +16.7% damage to ${b3.damageMin}, +28.6% range to ${b3.targetRange}, +33.3% speed to 4)`;
    }

    // --- NUCLEAR ---
    case RESEARCH_TECH_IDS.NUCLEAR_FISSION:
      return `Unlocks:\n• Atom Bomb: Basic fission weapon with large blast radius (inner: 12px, outer: 30px)\n• Missile Silo: Required launch facility for deploying nuclear weapons`;
    case RESEARCH_TECH_IDS.THERMONUCLEAR_STAGING:
      return `Unlocks:\n• Hydrogen Bomb: High-yield fusion weapon with massive blast radius (inner: 80px, outer: 100px) - devastates multi-tile areas`;
    case RESEARCH_TECH_IDS.MIRV_TECHNOLOGY:
      return `Unlocks:\n• MIRV: Multiple Independent Reentry Vehicles - deploys multiple warheads per missile, significantly harder for SAMs to intercept (50% hit chance vs 100% for atom bombs)`;
    case RESEARCH_TECH_IDS.NUCLEAR_TBD_LEVEL4:
      return `Unlocks:\n• Doomsday Device: Auto-triggers when any of your tiles are hit by a nuke; consumes the device and unleashes a global fallout wave that instantly deletes bombers/fighters/warships/trade ships, damages other structures by 80% of current health, relinquishes land, and spreads fallout across the world`;

    default:
      return "No detailed information available.";
  }
}
