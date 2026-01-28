import { Theme } from "../../../core/configuration/Config";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class TerrainLayer implements Layer {
  layerName = "TerrainLayer";
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;
  private theme: Theme;
  private lastDetailedWaterEnabled = true;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
    private uiState: { detailedWaterEnabled: boolean },
  ) {}
  shouldTransform(): boolean {
    return true;
  }
  tick() {
    if (
      this.game.config().theme() !== this.theme ||
      this.uiState.detailedWaterEnabled !== this.lastDetailedWaterEnabled
    ) {
      this.lastDetailedWaterEnabled = this.uiState.detailedWaterEnabled;
      this.redraw();
    }
  }

  init() {
    console.log("redrew terrain layer");
    this.redraw();
  }

  redraw(): void {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;

    this.imageData = this.context.createImageData(
      this.canvas.width,
      this.canvas.height,
    );

    this.initImageData();
    this.context.putImageData(this.imageData, 0, 0);
  }

  initImageData() {
    this.theme = this.game.config().theme();
    // Pre-calculate flat water color (approximate lightest water from theme)
    // We can pick a sample water tile or just define it.
    // Let's assume a nice flat blue based on the theme or just use the theme's base water color but lighter?
    // Actually, asking the theme for a shallow water tile (mag 0) is a good way if we can simulate it.
    // Or just use a fixed color that looks good.
    // Let's use the theme's default water color but ensure it's uniform.
    // Actually user said "lightest colors we have".
    // Let's just use `colord({ r: 45, g: 52, b: 104 })` as estimated from PastelThemeDark or similar.
    // Better: let the theme handle it? No.
    // Let's just check if it is water.

    this.game.forEachTile((tile) => {
      let terrainColor = this.theme.terrainColor(this.game, tile);

      if (!this.uiState.detailedWaterEnabled && this.game.isWater(tile)) {
        // Override with a flat color. Let's pick a color that represents "lightest water".
        // Typically low magnitude = shallow = lighter?
        // In PastelThemeDark: mag<10 -> lighter. 0 is lightest.
        // Let's try to find a color by asking for a dummy tile? No.
        // Let's just use a hardcoded safe flat color or the base water color.
        // Base water in PastelThemeDark is {r:36, g:43, b:95}.
        // Lightest adds 9 to each channel. {r:45, g:52, b:104}.
        terrainColor = this.theme.terrainColor(this.game, tile); // Keep original if not determining flat color effectively
        // Wait, we want to OVERRIDE it.
        // Let's match the "lightest" calculation from the theme manually for now to be safe.
        // Or just use one specific color for ALL water.
        // Let's use {r: 50, g: 60, b: 110} to be safe and light.
        // Actually, let's use the `water` color from theme but make it uniform.
        // Usually `terrainColor` returns varied colors.
        // We'll just define a constant for "Flat Water".
        // Re-reading: "water renders as just the lightest colors we have".

        // Let's use the color for Mag 0 water if possible.
        // Simplified: If it's water, set color to a constant.
        // We can extract `this.theme.water` if it was public, but it's not.
        // Hack: check if it's water, if so use a specific light blue.
        // {r: 45, g: 52, b: 104} seems correct based on code.

        if (this.game.terrainType(tile) !== 5) {
          // 5 is Barrier, usually handled separately. Ocean/Lake/etc.
          // Manually constructing Colord might be needed if we don't import it.
          // TerrainLayer imports Theme but not Colord directly? It does import Colord? No, type only?
          // It doesn't import colord function.
          // But `terrainColor` returns a Colord object.
          // We can just use the color of tile 0 if it's water? No.

          // Check if we can just clamp the magnitude?
          // No, `terrainColor` calls `gm.magnitude()`.

          // Best bet: Use the color returned by a known "light" water tile logic or hardcode.
          // Let's hardcode a nice flat blue.
          // {r: 45, g: 52, b: 104} (Lightest deep water) or maybe the cosmetic water #0000A0?
          // User said "lightest colors we have".
          // Let's stick with {r: 45, g: 52, b: 104} equivalent?
          // Actually, `terrainColor` returns an object with `rgba`.
          // We can just set r/g/b directly.
          const r = 45;
          const g = 52;
          const b = 104;
          terrainColor = { rgba: { r, g, b, a: 1 } } as any;
        }
      }

      // Update: we need to handle this correctly.
      // If we don't have colord imported, construct a fake object with rgba property since that's what we use.

      const index = this.game.y(tile) * this.game.width() + this.game.x(tile);
      const offset = index * 4;
      this.imageData.data[offset] = terrainColor.rgba.r;
      this.imageData.data[offset + 1] = terrainColor.rgba.g;
      this.imageData.data[offset + 2] = terrainColor.rgba.b;
      this.imageData.data[offset + 3] = (terrainColor.rgba.a * 255) | 0;
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.transformHandler.scale < 1) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
    } else {
      context.imageSmoothingEnabled = false;
    }
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }
}
