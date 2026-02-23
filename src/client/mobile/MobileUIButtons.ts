export type MobileUIButtons = {
  economyTab: HTMLButtonElement;
  intelTab: HTMLButtonElement;
  researchTab: HTMLButtonElement;
  zoomInButton: HTMLButtonElement;
  zoomCenterButton: HTMLButtonElement;
  zoomOutButton: HTMLButtonElement;
};

function createButton(
  className: string,
  svg: string,
  ariaLabel: string,
  hiddenByDefault: boolean = true,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = className;
  if (hiddenByDefault) {
    button.style.display = "none";
  }
  button.innerHTML = svg;
  button.setAttribute("aria-label", ariaLabel);
  return button;
}

export function createMobileUIButtons(): MobileUIButtons {
  const economyTab = createButton(
    "mobile-economy-tab",
    `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    `,
    "Open economy panel",
  );

  const intelTab = createButton(
    "mobile-intel-tab",
    `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="2" />
        <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
      </svg>
    `,
    "Open intel panel",
  );

  const researchTab = createButton(
    "mobile-research-tab",
    `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
        <path d="M8.5 2h7" />
        <path d="M7 16h10" />
      </svg>
    `,
    "Open research panel",
  );
  researchTab.dataset.progress = "0%";

  const zoomInButton = createButton(
    "mobile-zoom-in",
    `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    `,
    "Zoom in",
    false,
  );

  const zoomCenterButton = createButton(
    "mobile-zoom-center",
    `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="22" y1="12" x2="18" y2="12" />
        <line x1="6" y1="12" x2="2" y2="12" />
        <line x1="12" y1="6" x2="12" y2="2" />
        <line x1="12" y1="22" x2="12" y2="18" />
      </svg>
    `,
    "Center on territory",
    false,
  );

  const zoomOutButton = createButton(
    "mobile-zoom-out",
    `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    `,
    "Zoom out",
    false,
  );

  return {
    economyTab,
    intelTab,
    researchTab,
    zoomInButton,
    zoomCenterButton,
    zoomOutButton,
  };
}
