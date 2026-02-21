import {
  getMobileResponsiveTokens,
  getMobileViewportProfile,
} from "../../src/client/mobile/MobileViewportProfile";

describe("MobileViewportProfile", () => {
  test("classifies baseline viewport and preserves reference flag", () => {
    const portrait = getMobileViewportProfile(430, 932);
    const landscape = getMobileViewportProfile(932, 430);

    expect(portrait.sizeClass).toBe("regular");
    expect(landscape.sizeClass).toBe("regular");
    expect(portrait.isReferenceBaseline).toBe(true);
    expect(landscape.isReferenceBaseline).toBe(true);
  });

  test("classifies compact landscape for smaller phones", () => {
    const profile = getMobileViewportProfile(740, 360);

    expect(profile.orientation).toBe("landscape");
    expect(profile.sizeClass).toBe("compact");
    expect(profile.isReferenceBaseline).toBe(false);
  });

  test("uses baseline tokens for reference viewport", () => {
    const profile = getMobileViewportProfile(430, 932);
    const tokens = getMobileResponsiveTokens(profile);

    expect(tokens["--m-grid-max-h"]).toBe("52dvh");
    expect(tokens["--m-grid-column-min"]).toBe("58px");
    expect(tokens["--m-panel-top-offset"]).toBe(
      "calc(44px + env(safe-area-inset-top, 0px))",
    );
  });

  test("keeps baseline landscape panel overlap unchanged", () => {
    const profile = getMobileViewportProfile(932, 430);
    const tokens = getMobileResponsiveTokens(profile);

    expect(profile.isReferenceBaseline).toBe(true);
    expect(profile.orientation).toBe("landscape");
    expect(tokens["--m-panel-top-offset"]).toBe("0px");
  });

  test("applies compact landscape tokens for small viewport", () => {
    const profile = getMobileViewportProfile(740, 360);
    const tokens = getMobileResponsiveTokens(profile);

    expect(tokens["--m-grid-max-h"]).toBe("30dvh");
    expect(tokens["--m-grid-column-min"]).toBe("46px");
    expect(tokens["--m-grid-tile-min-h"]).toBe("42px");
  });

  test("applies larger tablet tokens for large portrait viewport", () => {
    const profile = getMobileViewportProfile(834, 1194);
    const tokens = getMobileResponsiveTokens(profile);

    expect(profile.sizeClass).toBe("extra-large");
    expect(tokens["--m-grid-column-min"]).toBe("85px");
    expect(tokens["--m-grid-icon-size"]).toBe("38px");
    expect(tokens["--m-grid-font-size"]).toBe("14px");
  });

  test("applies larger tablet tokens for large landscape viewport", () => {
    const profile = getMobileViewportProfile(1194, 834);
    const tokens = getMobileResponsiveTokens(profile);

    expect(profile.sizeClass).toBe("extra-large");
    expect(profile.orientation).toBe("landscape");
    expect(tokens["--m-grid-max-h"]).toBe("50dvh");
    expect(tokens["--m-grid-tile-min-h"]).toBe("82px");
    expect(tokens["--m-panel-top-offset"]).toBe(
      "calc(44px + env(safe-area-inset-top, 0px))",
    );
  });

  test("keeps compact portrait panel overlap unchanged", () => {
    const profile = getMobileViewportProfile(360, 740);
    const tokens = getMobileResponsiveTokens(profile);

    expect(profile.sizeClass).toBe("compact");
    expect(profile.orientation).toBe("portrait");
    expect(tokens["--m-grid-max-h"]).toBe("50dvh");
    expect(tokens["--m-grid-column-min"]).toBe("57px");
    expect(tokens["--m-grid-tile-min-h"]).toBe("54px");
    expect(tokens["--m-panel-top-offset"]).toBe("0px");
  });

  test('applies extra-large tokens for iPad Pro 12.9" portrait', () => {
    const profile = getMobileViewportProfile(1024, 1366);
    const tokens = getMobileResponsiveTokens(profile);

    expect(profile.sizeClass).toBe("extra-large");
    expect(profile.orientation).toBe("portrait");
    expect(tokens["--m-grid-column-min"]).toBe("85px");
    expect(tokens["--m-grid-tile-min-h"]).toBe("82px");
    expect(tokens["--m-grid-icon-size"]).toBe("38px");
    expect(tokens["--m-grid-font-size"]).toBe("14px");
    expect(tokens["--m-grid-padding"]).toBe("24px");
    expect(tokens["--m-grid-gap"]).toBe("12px");
  });

  test('applies extra-large tokens for iPad Pro 12.9" landscape', () => {
    const profile = getMobileViewportProfile(1366, 1024);
    const tokens = getMobileResponsiveTokens(profile);

    expect(profile.sizeClass).toBe("extra-large");
    expect(profile.orientation).toBe("landscape");
    expect(tokens["--m-grid-column-min"]).toBe("85px");
    expect(tokens["--m-grid-tile-min-h"]).toBe("82px");
    expect(tokens["--m-grid-icon-size"]).toBe("38px");
    expect(tokens["--m-grid-font-size"]).toBe("14px");
    expect(tokens["--m-grid-max-h"]).toBe("50dvh");
  });
});
