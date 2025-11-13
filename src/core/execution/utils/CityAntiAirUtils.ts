import { Game, Player, Unit, UnitType, UpgradeType } from "../../game/Game";
import { SAMMissileExecution } from "../SAMMissileExecution";

/**
 * Finds all enemy cities with the CityAntiAir upgrade within the nuke's blast radius.
 */
export function findEligibleCitiesForNuke(nuke: Unit, game: Game): Unit[] {
  const nukeOwner = nuke.owner();
  const blastRadius = game.config().nukeMagnitudes(nuke.type()).outer;

  return game
    .nearbyUnits(nuke.targetTile()!, blastRadius, UnitType.City, ({ unit }) => {
      const cityOwner = unit.owner();
      return (
        !nukeOwner.isFriendly(cityOwner as Player) &&
        cityOwner.hasUpgrade(UpgradeType.CityAntiAir)
      );
    })
    .map((result) => result.unit);
}

/**
 * Finds all enemy cities with the CityAntiAir upgrade within launch range of a bomber's target.
 */
export function findEligibleCitiesForBomber(bomber: Unit, game: Game): Unit[] {
  const bomberOwner = bomber.owner();
  const searchRadius = game.config().citySamLaunchRange();

  if (!bomber.targetTile()) {
    return [];
  }

  return game
    .nearbyUnits(
      bomber.targetTile()!,
      searchRadius,
      UnitType.City,
      ({ unit }) => {
        const cityOwner = unit.owner();
        return (
          !bomberOwner.isFriendly(cityOwner as Player) &&
          cityOwner.hasUpgrade(UpgradeType.CityAntiAir)
        );
      },
    )
    .map((result) => result.unit);
}

/**
 * Attempts to have a single city intercept an aircraft or nuke.
 */
export function attemptInterception(target: Unit, game: Game, city: Unit) {
  // Use per-unit cooldown state for cities, same as other units
  if (!city.isActive() || (city.ticksLeftInCooldown() ?? 0) > 0) {
    return;
  }

  target.setTargetedBySAM(true);
  const sam = new SAMMissileExecution(
    city.tile(),
    city.owner(),
    city,
    target,
    target.tile(),
  );
  game.addExecution(sam);
  // Start city SAM cooldown using standard unit cooldown API
  city.launch(game.config().citySamCooldown());
}
