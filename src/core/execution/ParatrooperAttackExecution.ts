import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerType,
  Unit,
  UnitType,
  UpgradeType,
} from "../game/Game";

import { TileRef } from "../game/GameMap";
import { StraightPathFinder } from "../pathfinding/PathFinding";
import { AttackExecution } from "./AttackExecution";
import {
  attemptInterception,
  findEligibleCitiesForBomber,
} from "./utils/CityAntiAirUtils";

export class ParatrooperAttackExecution implements Execution {
  private paratrooperUnitID: number | null = null;
  private pathFinder: StraightPathFinder | null = null;
  private currentPathIndex: number = 0;
  private troops: number;
  private dst: TileRef;
  private targetPlayerID: string | null;
  private attacker: Player;
  private mg: Game; // Add this line
  private eligibleCities: Unit[] = [];

  constructor(
    attacker: Player,
    targetPlayerID: string | null,
    troops: number,
    dst: TileRef,
  ) {
    this.attacker = attacker;
    this.targetPlayerID = targetPlayerID;
    this.troops = troops;
    this.dst = dst;
  }

  isActive(): boolean {
    return this.paratrooperUnitID !== null;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(game: Game, ticks: number): void {
    this.mg = game;

    if (!this.attacker.hasUpgrade(UpgradeType.AirUpgrade1)) {
      return;
    }

    const target = this.targetPlayerID
      ? game.player(this.targetPlayerID)
      : game.terraNullius();
    const isPeaceTimerActive =
      game.peaceTimerEndsAtTick !== null &&
      game.ticks() < game.peaceTimerEndsAtTick;

    if (isPeaceTimerActive && target.isPlayer()) {
      const attackerType = this.attacker.type();
      const defenderType = target.type();

      if (
        (attackerType === PlayerType.Human ||
          attackerType === PlayerType.FakeHuman) &&
        (defenderType === PlayerType.Human ||
          defenderType === PlayerType.FakeHuman)
      ) {
        return;
      }
    }

    const airfields = this.attacker.units(UnitType.Airfield);
    if (airfields.length === 0) {
      console.warn("No airfields available to launch paratrooper attack.");
      return;
    }

    // Find the closest airfield to the destination
    let closestAirfield: TileRef | null = null;
    let minDistance = Infinity;

    for (const airfield of airfields) {
      const airfieldTile = airfield.tile();
      const distance = game.manhattanDist(airfieldTile, this.dst);
      if (distance < minDistance) {
        minDistance = distance;
        closestAirfield = airfieldTile;
      }
    }

    if (closestAirfield === null) {
      console.warn(
        "Could not find a suitable airfield for paratrooper attack.",
      );
      return;
    }

    if (minDistance > game.config().paratrooperMaxRange()) {
      console.warn("Destination is out of range for paratrooper attack.");
      return;
    }

    if (this.troops <= 0 || this.troops > this.attacker.troops()) {
      console.warn("Invalid number of troops for paratrooper attack.");
      return;
    }

    const troopCost = Math.floor(
      this.troops * game.config().paratrooperTroopCostPercentage(),
    );

    this.troops -= troopCost;

    if (this.troops <= 0) {
      console.warn(
        "Not enough troops to send after deducting paratrooper cost.",
      );
      return;
    }

    if (
      this.attacker.units(UnitType.Paratrooper).length >=
      game.config().paratrooperMaxNumber()
    ) {
      game.displayMessage(
        "Maximum number of active paratrooper units reached.",
        MessageType.WARN,
        this.attacker.id(),
      );
      return;
    }

    // Spawn the paratrooper unit
    const paratrooper = this.attacker.buildUnit(
      UnitType.Paratrooper,
      closestAirfield,
      { troops: this.troops, targetTile: this.dst },
    );
    this.paratrooperUnitID = paratrooper.id();
    this.eligibleCities = findEligibleCitiesForBomber(paratrooper, game);

    // Initialize pathfinder
    this.pathFinder = new StraightPathFinder(this.mg.map());

    game.displayMessage(
      `Incoming Paratrooper Attack from ${this.attacker.displayName()}`,
      MessageType.PARATROOPER_INBOUND,
      this.targetPlayerID,
    );

    game.stats().paratrooperAttack(this.attacker, this.troops);
  }

  tick(ticks: number): void {
    const game = this.mg;
    if (this.paratrooperUnitID === null) {
      return;
    }

    const paratrooper = game
      .units(UnitType.Paratrooper)
      .find((u) => u.id() === this.paratrooperUnitID);

    if (!paratrooper || !paratrooper.isActive()) {
      this.paratrooperUnitID = null; // Unit was destroyed or became inactive
      return;
    }

    const readyInterceptors = this.eligibleCities.filter(
      (city) =>
        (city.ticksLeftInCooldown() ?? 0) <= 0 &&
        game.euclideanDistSquared(paratrooper.tile(), city.tile()) <=
          game.config().citySamLaunchRange() *
            game.config().citySamLaunchRange(),
    );

    if (readyInterceptors.length > 0) {
      readyInterceptors.sort(
        (a, b) =>
          game.euclideanDistSquared(paratrooper.tile(), a.tile()) -
          game.euclideanDistSquared(paratrooper.tile(), b.tile()),
      );

      const closestInterceptor = readyInterceptors[0];
      attemptInterception(paratrooper, game, closestInterceptor);
    }

    if (this.pathFinder === null) {
      // This should not happen if init was successful
      this.paratrooperUnitID = null;
      return;
    }

    const speed = game.config().paratrooperSpeed();
    let currentTile = paratrooper.tile();
    for (let i = 0; i < speed; i++) {
      const nextTileResult = this.pathFinder.nextTile(currentTile, this.dst, 1);
      if (nextTileResult === true) {
        // Paratrooper reached destination
        const targetOwner = game.owner(this.dst);
        if (targetOwner === this.attacker) {
          // Landed on own territory, add troops to tile
          this.attacker.addTroops(paratrooper.troops());
        } else {
          // Initiate AttackExecution
          const attackExecution = new AttackExecution(
            paratrooper.troops(),
            this.attacker,
            targetOwner.id(),
            this.dst,
            false, // Do not remove troops from attacker, as they are from the paratrooper
          );
          game.addExecution(attackExecution);
        }
        paratrooper.delete(false);

        return;
      } else {
        currentTile = nextTileResult;
        paratrooper.move(currentTile);
      }
    }
  }
}
