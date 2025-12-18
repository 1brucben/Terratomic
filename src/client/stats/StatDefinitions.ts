import { UnitType } from "../../core/game/Game";
import { GameView, PlayerView } from "../../core/game/GameView";
import { getTechNodes, type Category } from "../../core/tech/ResearchTree";

export const AVAILABLE_STATS = [
  "Gold",
  "Industrial Production",
  "Population",
  "Workers",
  "Troops",
  "Productivity %",
  "Productivity Growth %",
  "Investment – Production %",
  "Investment – Production Amount/s",
  "Investment – Roads %",
  "Investment – Roads Amount/s",
  "Investment – Research %",
  "Investment – Research Amount/s",
  "Road Quality %",
  "Road Completion %",
  // Structures (match PlayerInfoOverlay ordering)
  "City",
  "Hospital",
  "Academy",
  "Research Lab",
  "Factory",
  "Port",
  "Cruiser",
  "Missile Silo",
  "SAM Launcher",
  "Air Field",
  "Fighter Jet",
  "Defense Post",
  // Tech overview
  "Researched Techs",
  "Research Level",
  // Tech by category (researched/total; sort by researched)
  "Land Techs",
  "Sea Techs",
  "Air Techs",
  "Nuclear Techs",
  "Economy Techs",
];

export interface StatValue {
  sortValue: number;
  sortText?: string;
  displayPrimary: string;
  displaySecondary?: string;
}

export function computeStatValue(
  game: GameView | null,
  label: string,
  p: PlayerView,
): StatValue {
  const gross = game?.config().grossGoldAdditionRate(p) ?? 0;
  const perSecond = 10;
  const inv = p.investmentRate?.() ?? (p as any).data?.investmentRate ?? 0;
  const roadRate =
    (p as any).roadInvestmentRate?.() ??
    p.roadInvestmentRate?.() ??
    (p as any).data?.roadInvestmentRate ??
    0;
  const researchRate =
    (p as any).researchInvestmentRate?.() ??
    p.researchInvestmentRate?.() ??
    (p as any).data?.researchInvestmentRate ??
    0;
  const prodAmt = gross * inv * perSecond;
  const roadAmt = gross * roadRate * perSecond;
  const researchAmt = gross * researchRate * perSecond;
  const ip =
    (p as any).industrialProduction?.() ??
    (p as any).industrialProduction ??
    (p as any).data?.industrialProduction ??
    0;
  switch (label) {
    case "Gold":
      return {
        sortValue: Number(p.gold?.() ?? 0),
        displayPrimary: String(p.gold?.() ?? 0),
      };
    case "Industrial Production":
      return { sortValue: Number(ip ?? 0), displayPrimary: String(ip ?? 0) };
    case "Population":
      return {
        sortValue: p.population(),
        displayPrimary: String(p.population()),
      };
    case "Workers":
      return { sortValue: p.workers(), displayPrimary: String(p.workers()) };
    case "Troops":
      return { sortValue: p.troops(), displayPrimary: String(p.troops()) };
    case "Productivity %": {
      const val = (p.productivity?.() ?? 0) * 100;
      return { sortValue: val, displayPrimary: `${val.toFixed(1)}%` };
    }
    case "Productivity Growth %": {
      const val = (p.productivityGrowthPerMinute?.() ?? 0) * 100;
      return { sortValue: val, displayPrimary: `${val.toFixed(1)}%` };
    }
    case "Investment – Production %": {
      const val = (inv ?? 0) * 100;
      return { sortValue: val, displayPrimary: `${val.toFixed(0)}%` };
    }
    case "Investment – Production Amount/s":
      return { sortValue: prodAmt, displayPrimary: prodAmt.toFixed(2) };
    case "Investment – Roads %": {
      const val = (roadRate ?? 0) * 100;
      return { sortValue: val, displayPrimary: `${val.toFixed(0)}%` };
    }
    case "Investment – Roads Amount/s":
      return { sortValue: roadAmt, displayPrimary: roadAmt.toFixed(2) };
    case "Investment – Research %": {
      const val = (researchRate ?? 0) * 100;
      return { sortValue: val, displayPrimary: `${val.toFixed(0)}%` };
    }
    case "Investment – Research Amount/s":
      return {
        sortValue: researchAmt,
        displayPrimary: researchAmt.toFixed(2),
      };
    case "Road Quality %": {
      const val = (p.roadNetworkQuality?.() ??
        (p as any).data?.roadNetworkQuality ??
        100) as number;
      return { sortValue: val, displayPrimary: `${Math.round(val)}%` };
    }
    case "Road Completion %": {
      const val = (p.roadNetworkCompletion?.() ??
        (p as any).data?.roadNetworkCompletion ??
        100) as number;
      return { sortValue: val, displayPrimary: `${Math.round(val)}%` };
    }
    // Structures (upgradeOwned use unitsOwned, others use units().length)
    case "City":
    case "Hospital":
    case "Academy":
    case "Research Lab":
    case "Factory":
    case "Port": {
      const map: Record<string, UnitType> = {
        City: UnitType.City,
        Hospital: UnitType.Hospital,
        Academy: UnitType.Academy,
        "Research Lab": UnitType.ResearchLab,
        Factory: UnitType.Factory,
        Port: UnitType.Port,
      };
      const t = map[label];
      const count = p.unitsOwned(t);
      return { sortValue: count, displayPrimary: String(count) };
    }
    case "Cruiser":
    case "Missile Silo":
    case "SAM Launcher":
    case "Air Field":
    case "Fighter Jet":
    case "Defense Post": {
      const map: Record<string, UnitType> = {
        Cruiser: UnitType.Warship,
        "Missile Silo": UnitType.MissileSilo,
        "SAM Launcher": UnitType.SAMLauncher,
        "Air Field": UnitType.Airfield,
        "Fighter Jet": UnitType.FighterJet,
        "Defense Post": UnitType.DefensePost,
      };
      const t = map[label];
      const count = p.units(t).length;
      return { sortValue: count, displayPrimary: String(count) };
    }
    // Tech overview
    case "Researched Techs": {
      const n = (p as any).data?.researchTreeTechs?.length ?? 0;
      return { sortValue: n, displayPrimary: String(n) };
    }
    case "Research Level": {
      const lvl = Number(p.researchTechLevel()) || 0;
      return { sortValue: lvl, displayPrimary: String(lvl) };
    }

    // Tech by category (researched/total; sort by researched)
    case "Land Techs":
    case "Sea Techs":
    case "Air Techs":
    case "Nuclear Techs": {
      const labelToCat: Record<string, Category> = {
        "Land Techs": "Land",
        "Sea Techs": "Sea",
        "Air Techs": "Air",
        "Nuclear Techs": "Nuclear",
      };
      const cat = labelToCat[label];
      const nodes = getTechNodes();
      const total = nodes.filter((n) => n.category === cat).length;
      let researched = 0;
      for (const n of nodes) {
        if (n.category === cat && p.hasResearchedTech(n.id)) researched++;
      }
      return {
        sortValue: researched,
        displayPrimary: `${researched}/${total}`,
      };
    }
  }
  return { sortValue: 0, displayPrimary: "—" };
}
