/** @jest-environment jsdom */

jest.mock("../../src/client/Transport", () => ({
  SendResearchTreeSelectBatchIntentEvent: class {
    constructor(..._args: unknown[]) {}
  },
  SendResearchTreeSelectIntentEvent: class {
    constructor(..._args: unknown[]) {}
  },
}));

import { MobileResearchPanel } from "../../src/client/mobile/components/MobileResearchPanel";

describe("MobileResearchPanel lifecycle", () => {
  let sidebar: HTMLElement;
  let panel: MobileResearchPanel;

  const setDocumentHidden = (hidden: boolean): void => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    setDocumentHidden(false);

    sidebar = document.createElement("mobile-research-sidebar");
    panel = new MobileResearchPanel();
    sidebar.appendChild(panel);
    document.body.appendChild(sidebar);
  });

  afterEach(() => {
    panel.remove();
    sidebar.remove();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("does not request updates when document is hidden", () => {
    const updateSpy = jest.spyOn(panel, "requestUpdate");
    setDocumentHidden(true);

    jest.advanceTimersByTime(600);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("does not request updates when sidebar is not visible", () => {
    const updateSpy = jest.spyOn(panel, "requestUpdate");

    jest.advanceTimersByTime(600);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("requests updates when sidebar is visible and document is visible", () => {
    const updateSpy = jest.spyOn(panel, "requestUpdate");
    sidebar.setAttribute("visible", "");

    jest.advanceTimersByTime(600);

    expect(updateSpy).toHaveBeenCalled();
  });
});
