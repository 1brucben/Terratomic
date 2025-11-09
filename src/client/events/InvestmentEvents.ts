export const INVESTMENT_SYNC_EVENT = "investment-sync";
export const INVESTMENT_SYNC_REQUEST_EVENT = "investment-sync-request";
export const INVESTMENT_REQUEST_EVENT = "investment-request-change";

export type InvestmentSlider = "prod" | "road" | "research";

export type InvestmentSyncDetail = {
  prod: number;
  road: number;
  research: number;
  lockProd: boolean;
  lockRoad: boolean;
  lockResearch: boolean;
  roadEnabled: boolean;
};

export type InvestmentRequestDetail =
  | {
      type: "set";
      slider: InvestmentSlider;
      value: number;
    }
  | {
      type: "toggle-lock";
      slider: InvestmentSlider;
    };
