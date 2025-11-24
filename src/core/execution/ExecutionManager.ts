import { Execution, Game, UnitType } from "../game/Game";
import { isUpgradeableStructure } from "../game/Upgradeables";
import { PseudoRandom } from "../PseudoRandom";
import { ClientID, GameID, Intent, Turn } from "../Schemas";
import { simpleHash } from "../Util";
import { AllianceExtensionExecution } from "./alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "./alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "./alliance/AllianceRequestReplyExecution";
import { BreakAllianceExecution } from "./alliance/BreakAllianceExecution";
import { AttackExecution } from "./AttackExecution";
import { BoatRetreatExecution } from "./BoatRetreatExecution";
import { BomberTargetExecution } from "./BomberTargetExecution";
import { BotSpawner } from "./BotSpawner";
import { ConstructionExecution } from "./ConstructionExecution";
import { DeclareWarExecution } from "./DeclareWarExecution";
import { DonateGoldExecution } from "./DonateGoldExecution";
import { DonateTroopsExecution } from "./DonateTroopExecution";
import { EmbargoExecution } from "./EmbargoExecution";
import { EmojiExecution } from "./EmojiExecution";
import { FakeHumanExecution } from "./FakeHumanExecution";
import { MarkDisconnectedExecution } from "./MarkDisconnectedExecution";
import { MoveFighterJetExecution } from "./MoveFighterJetExecution";
import { MoveSubmarineExecution } from "./MoveSubmarineExecution";
import { MoveWarshipExecution } from "./MoveWarshipExecution";
import { NoOpExecution } from "./NoOpExecution";
import { ParatrooperAttackExecution } from "./ParatrooperAttackExecution";
import { ParatrooperRetreatExecution } from "./ParatrooperRetreatExecution";
import { PeaceRequestExecution } from "./PeaceRequestExecution";
import { PurchaseUpgradeExecution } from "./PurchaseUpgradeExecution";
import { QuickChatExecution } from "./QuickChatExecution";
import { ResearchTreeSelectExecution } from "./ResearchTreeSelectExecution";
import { RetreatExecution } from "./RetreatExecution";
import { SetAutoBombingExecution } from "./SetAutoBombingExecution";
import { SetInvestmentRateExecution } from "./SetInvestmentRateExecution";
import { SetResearchInvestmentExecution } from "./SetResearchInvestmentExecution";
import { SetRoadInvestmentExecution } from "./SetRoadInvestmentExecution";
import { SetTargetTroopRatioExecution } from "./SetTargetTroopRatioExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TargetPlayerExecution } from "./TargetPlayerExecution";
import { TransportShipExecution } from "./TransportShipExecution";
import { UpgradeBomberExecution } from "./UpgradeBomberExecution";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";

export class Executor {
  // private random = new PseudoRandom(999)
  private random: PseudoRandom;

  constructor(
    private mg: Game,
    private gameID: GameID,
    private clientID: ClientID,
  ) {
    // Add one to avoid id collisions with bots.
    this.random = new PseudoRandom(simpleHash(gameID) + 1);
  }

  createExecs(turn: Turn): Execution[] {
    return turn.intents.map((i) => this.createExec(i));
  }

  createExec(intent: Intent): Execution {
    const player = this.mg.playerByClientID(intent.clientID);
    if (!player) {
      console.warn(`player with clientID ${intent.clientID} not found`);
      return new NoOpExecution();
    }

    // create execution
    switch (intent.type) {
      case "attack": {
        return new AttackExecution(
          intent.troops,
          player,
          intent.targetID,
          null,
        );
      }
      case "cancel_attack":
        return new RetreatExecution(player, intent.attackID);
      case "cancel_boat":
        return new BoatRetreatExecution(player, intent.unitID);
      case "cancel_paratrooper":
        return new ParatrooperRetreatExecution(player, intent.unitID);
      case "move_warship":
        return new MoveWarshipExecution(player, intent.unitId, intent.tile);
      case "move_submarine":
        return new MoveSubmarineExecution(player, intent.unitId, intent.tile);
      case "move_fighter_jet":
        return new MoveFighterJetExecution(player, intent.unitId, intent.tile);
      case "bomber_intent":
        return new BomberTargetExecution(
          player,
          intent.targetID,
          intent.structures,
          intent.preferClosest,
        );

      case "spawn":
        return new SpawnExecution(player.info(), intent.tile);
      case "boat":
        const src = intent.src ?? null;
        return new TransportShipExecution(
          player,
          intent.targetID,
          intent.dst,
          intent.troops,
          src,
        );
      case "paratrooper_attack":
        return new ParatrooperAttackExecution(
          player,
          intent.targetID,
          intent.troops,
          intent.dst,
        );
      case "allianceRequest":
        return new AllianceRequestExecution(player, intent.recipient);
      case "allianceRequestReply":
        return new AllianceRequestReplyExecution(
          intent.requestor,
          player,
          intent.accept,
        );
      case "breakAlliance":
        return new BreakAllianceExecution(player, intent.recipient);
      case "peaceRequest":
        return new PeaceRequestExecution(player, intent.recipient);
      case "declareWar":
        return new DeclareWarExecution(player, intent.recipient);
      case "targetPlayer":
        return new TargetPlayerExecution(player, intent.target);
      case "emoji":
        return new EmojiExecution(player, intent.recipient, intent.emoji);
      case "donate_troops":
        return new DonateTroopsExecution(
          player,
          intent.recipient,
          intent.troops,
        );
      case "donate_gold":
        return new DonateGoldExecution(player, intent.recipient, intent.gold);
      case "troop_ratio":
        return new SetTargetTroopRatioExecution(player, intent.ratio);
      case "investment_rate":
        return new SetInvestmentRateExecution(player, intent.rate);
      case "road_investment_rate":
        return new SetRoadInvestmentExecution(player, intent.rate);
      case "research_investment_rate":
        return new SetResearchInvestmentExecution(player, intent.rate);
      case "embargo":
        return new EmbargoExecution(player, intent.targetID, intent.action);
      case "build_unit":
        return new ConstructionExecution(
          player,
          intent.unit,
          intent.tile,
          intent.targetLevel,
          intent.bomberLevel,
        );
      case "purchase_upgrade":
        return new PurchaseUpgradeExecution(player, intent.upgrade);
      case "upgrade_structure": {
        const unit = player.units().find((u) => u.id() === intent.unitId);
        if (!unit || unit.owner() !== player) return new NoOpExecution();
        // Check if this is an upgradeable structure type
        if (
          !isUpgradeableStructure(intent.unitType) ||
          unit.type() !== intent.unitType
        ) {
          return new NoOpExecution();
        }
        return new UpgradeStructureExecution(player, unit);
      }
      case "research_tree_select":
        return new ResearchTreeSelectExecution(player, intent.techId);

      case "quick_chat":
        return new QuickChatExecution(
          player,
          intent.recipient,
          intent.quickChatKey,
          intent.target,
        );
      case "allianceExtension": {
        const from = player;
        const to =
          this.mg.players().find((p) => p.id() === intent.recipient) ?? null;

        if (
          from === null ||
          to === null ||
          !from.isPlayer?.() ||
          !to.isPlayer?.()
        ) {
          return new NoOpExecution();
        }

        return new AllianceExtensionExecution(from, to);
      }
      case "mark_disconnected":
        return new MarkDisconnectedExecution(player, intent.isDisconnected);
      case "set_auto_bombing":
        return new SetAutoBombingExecution(player, intent.enabled);
      case "upgrade_bomber": {
        const airfield = player
          .units(UnitType.Airfield)
          .find((u) => u.id() === intent.airfieldId);
        if (!airfield) return new NoOpExecution();
        return new UpgradeBomberExecution(player, airfield);
      }
      default:
        throw new Error(`intent type ${intent} not found`);
    }
  }

  spawnBots(numBots: number): Execution[] {
    return new BotSpawner(this.mg, this.gameID).spawnBots(numBots);
  }

  fakeHumanExecutions(): Execution[] {
    const execs: Execution[] = [];
    for (const nation of this.mg.nations()) {
      execs.push(new FakeHumanExecution(this.gameID, nation));
    }
    return execs;
  }
}
