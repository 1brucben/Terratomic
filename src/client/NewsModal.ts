import { LitElement, css, html } from "lit";
import { customElement, query } from "lit/decorators.js";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";

@customElement("news-modal")
export class NewsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  static styles = css`
    :host {
      display: block;
    }

    .news-container {
      max-height: 60vh;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .news-content {
      color: #ddd;
      line-height: 1.5;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 8px;
      padding: 1rem;
    }

    .news-content a {
      color: #4a9eff !important;
      text-decoration: underline !important;
      transition: color 0.2s ease;
    }

    .news-content a:hover {
      color: #6fb3ff !important;
    }
  `;

  render() {
    return html`
      <o-modal>
        <div class="options-layout">
          <div class="flex justify-between items-center mb-4">
            <h1 class="text-2xl font-ocr text-tan">Release Notes</h1>
            <o-button title="Close" @click=${this.close}></o-button>
          </div>
          <div class="options-section">
            <div class="news-container">
              <div class="news-content">
                <h1>Terratomic v0.2.0: The Research & Development Update</h1>
                <p>
                  Version 0.2.0 introduces a complete overhaul of the research
                  system, organized into four distinct categories:
                  <strong>Land, Air, Water, and Economy</strong>. This update
                  adds deep strategic layers to the game, allowing players to
                  specialize their nation’s strengths and unlock powerful new
                  abilities.
                </p>

                <h2>⛰️ Land Upgrades</h2>
                <ul>
                  <li>
                    <strong>Roads:</strong> Unlocks your logistics network.
                    Roads are built automatically, connecting your cities and
                    strategic buildings. This enables
                    <strong>internal trade</strong> via Cargo Trucks that
                    generate passive income, and also makes your infrastructure
                    a strategic target, as invading armies will
                    <strong>prioritize attacking along roads</strong>.
                  </li>
                  <li>
                    <strong>International Trade:</strong> Allows your road
                    network to connect with an ally’s, establishing lucrative
                    international trade routes and generating shared profits via
                    Cargo Trucks.
                  </li>
                  <li>
                    <strong>Scorched Earth:</strong> A defensive last resort.
                    This action allows you to instantly destroy your entire road
                    network to deny its use to an invading enemy.
                  </li>
                </ul>

                <h2>✈️ Air Upgrades</h2>
                <ul>
                  <li>
                    <strong>Paratroopers:</strong> Launch airborne infantry
                    attacks from your Airfields. Paratroopers can be deployed to
                    any land tile on the map, allowing you to bypass enemy
                    fronts and strike at their heartland.
                  </li>
                  <li>
                    <strong>City Anti-Air:</strong> Provides your Cities with a
                    built-in, light SAM defense. Each upgraded city can
                    automatically shoot down one incoming nuke, bomber or
                    paratrooper before its defenses go on a 30-second cooldown.
                  </li>
                  <li>
                    <strong>Fighter Anti-Ship:</strong> Allows your Fighter Jets
                    to engage and destroy enemy naval units, including Warships,
                    Transports, and detected Submarines.
                  </li>
                </ul>

                <h2>🌊 Water Upgrades</h2>
                <ul>
                  <li>
                    <strong>Submarine Research:</strong> Unlocks the
                    <strong>Submarine</strong>, a new stealth unit. It is
                    invisible by default and is designed to hunt and destroy all
                    other naval units.
                  </li>
                  <li>
                    <strong>Warship Anti-Air:</strong> Equips your Warships with
                    their own anti-air missile systems, allowing them to
                    automatically defend themselves against nearby enemy
                    aircraft. (Note: This system does not intercept nuclear
                    missiles).
                  </li>
                  <li>
                    <strong>Nuclear Submarine:</strong> Allows your entire
                    submarine fleet to act as mobile launch platforms for Atomic
                    Bombs, adding a new layer of nuclear deterrence to your
                    naval strategy.
                  </li>
                </ul>

                <h2>💰 Economy Upgrades</h2>
                <ul>
                  <li>
                    <strong>Urban Planning:</strong> Increases your nation’s
                    maximum population capacity by 25%.
                  </li>
                  <li>
                    <strong>Structure Insurance:</strong> Provides a 33% gold
                    refund for any of your buildings that are destroyed by the
                    enemy or lost during conquest.
                  </li>
                  <li>
                    <strong>Automation:</strong> Doubles the gold income from
                    your road-based trade network (Cargo Trucks), but at the
                    cost of a 20% reduction in your troop regeneration rate.
                  </li>
                </ul>

                <h2>⚖️ General Balance Changes</h2>
                <ul>
                  <li>
                    <strong>Cluster Surrendering Removed:</strong> The mechanic
                    where fully encircled enemy territories would automatically
                    be captured has been removed to better balance with the new
                    Paratrooper feature, which allows for non-contiguous
                    attacks.
                  </li>
                </ul>

                <h2>🤖 AI & UI Improvements</h2>
                <ul>
                  <li>
                    <strong>Upgraded AI:</strong> The nation bot AI has been
                    significantly updated to intelligently use all the new
                    economic and military features, making them more formidable
                    opponents.
                  </li>
                  <li>
                    <strong>Redesigned Research Panel:</strong> The UI for the
                    Research panel has been completely redesigned with new
                    categories to accommodate the new upgrades.
                  </li>
                </ul>
              </div>
              <div class="news-content">
                <h1>Terratomic v0.1.11: Performance & Peace</h1>
                <p>
                  This version brings two major updates: a significant
                  performance boost for games with many AI players and a new
                  "Protected Start" option for a more relaxed early game.
                </p>
                <h2>Key Features</h2>
                <ul>
                  <li>
                    <strong>AI Performance Boost:</strong> The game's AI has
                    been significantly optimized to reduce lag and stutter,
                    especially in large, late-game scenarios with many bots. You
                    should experience much smoother gameplay.
                  </li>
                  <li>
                    <strong>New! Protected Start:</strong> You can now add a
                    peace timer (e.g., 5, 10, or 15 minutes) to single-player
                    and private lobby games. During this time, no attacks are
                    allowed, giving everyone a chance to build up their economy
                    and defenses before the action starts. You can find the
                    option in the game setup menu.
                  </li>
                </ul>
              </div>
              <div class="news-content">
                <h1>Terratomic v0.1.10 – Release Notes</h1>
                <p>
                  We’re back with another quality update focused on UI
                  improvements, smoother gameplay interactions, and better
                  translations. This version tackles some long-standing
                  usability issues and adds helpful touches to make the game
                  more intuitive.
                </p>
                <h2>Gameplay & UI Fixes</h2>
                <ul>
                  <li>
                    <strong>Fixed sticky map dragging:</strong> Dragging the map
                    will now properly stop when your cursor moves over UI
                    overlays, resolving the “endless drag” issue.
                  </li>
                  <li>
                    <strong>Improved build panel behavior:</strong> Fixed a race
                    condition where the build panel would immediately close if
                    you clicked too quickly after hovering. Navigation between
                    build options should now feel smooth and reliable.
                  </li>
                </ul>
                <h2>Visual & Interaction Improvements</h2>
                <ul>
                  <li>
                    <strong>Better cursor visibility in build mode:</strong> The
                    build-mode crosshair cursor has been changed from black to
                    white, making it far easier to spot against dark
                    territories.
                  </li>
                  <li>
                    <strong>Build menu hotkeys displayed:</strong> Each
                    buildable item now shows its configured hotkey directly in
                    the menu. No more guesswork—faster building at your
                    fingertips!
                  </li>
                </ul>
                <h2>Translation & Localization</h2>
                <ul>
                  <li>
                    <strong>Corrected Airfield unit translation:</strong> The
                    Airfield unit now properly displays as “Airfield” instead of
                    a raw key value.
                  </li>
                  <li>
                    <strong>Consolidated alliance event translations:</strong>
                    Redundant and inconsistent alliance-related translations
                    have been streamlined for better clarity and consistency
                    across the UI.
                  </li>
                </ul>
              </div>
              <div class="news-content">
                <h1>Release v0.1.9</h1>
                <p>
                  This release focuses on improving the user interface and user
                  experience, with a particular focus on the military theme and
                  hotkeys. We've also made some improvements to the build menu
                  and radial menu to make them more intuitive and easier to use.
                </p>
                <h2>What's New</h2>
                <ul>
                  <li>
                    <strong>UI Improvements to Radial and Build Menus:</strong>
                    The radial menu now closes automatically when you select an
                    item from the build menu, and the layout of the radial menu
                    has been corrected to be symmetrical when there are only
                    three items.
                  </li>
                  <li>
                    <strong>Build Hotkeys:</strong> You can now use hotkeys to
                    build units and structures, which should make it faster and
                    easier to build up your forces.
                  </li>
                  <li>
                    <strong>Military Theme Overhaul:</strong> The military theme
                    has been updated to be less bulky, with less padding, lower
                    heights, and a more opaque background. It also now fits
                    better on smaller screens.
                  </li>
                  <li>
                    <strong>Player Info Overlay:</strong> The Player Info
                    Overlay has been revamped and moved to better fit the new
                    military theme.
                  </li>
                </ul>
              </div>
              <div class="news-content">
                <h1>Release v0.1.8</h1>
                <p>
                  This version (v0.1.8) introduces a complete visual overhaul of
                  the game and a more intuitive building process, all inspired
                  by a Cold War / WWII military command aesthetic. The new
                  interface is designed to be more immersive and thematic, with
                  a focus on providing a clear and concise overview of the game
                  state.
                </p>
                <p>
                  <strong>Key Features:</strong>
                </p>
                <ul>
                  <li>
                    <strong>New, Intuitive Build Flow:</strong> The building
                    process has been reversed to be more user-friendly. You now
                    <strong
                      >first select the unit or structure you want to
                      build</strong
                    >
                    from the new build menu, and then you click on the map to
                    place it.
                  </li>
                  <li>
                    <strong>Redesigned Control Panel:</strong> The main control
                    panel has been redesigned and now includes tabs for "Build",
                    "Attack", "Economy", and "Research", making it easier to
                    access all the game's features.
                  </li>
                  <li>
                    <strong>Integrated Build Menu:</strong> The build menu is
                    now part of the control panel, allowing for a more
                    streamlined building experience. It also includes a "Mass
                    Production" option for building multiple units.
                  </li>
                  <li>
                    <strong>Updated Unit Names:</strong> Several units have been
                    renamed to better fit the new theme (e.g., "City" is now
                    "Industrial Complex", "Warship" is now "Destroyer").
                  </li>
                  <li>
                    <strong>Improved Visuals:</strong> The game now features new
                    background images.
                  </li>
                </ul>
                <p>
                  This update aims to provide a more engaging, intuitive, and
                  visually appealing experience for all players.
                </p>
              </div>
              <div class="news-content">
                <h1>Release v0.1.7</h1>
                <p>
                  This test version introduces a new mechanic:
                  <strong>Investment</strong>.
                </p>
                <p>
                  A new <strong>Investment Slider</strong> lets you dedicate a
                  portion of your nation's gold to productivity growth. Gold
                  spent on investment is subtracted before any other expenses.
                </p>
                <p>
                  The more you invest, the faster your
                  <strong>worker productivity</strong> increases—boosting your
                  long-term gold income. Productivity grows gradually and
                  compounds over time, meaning consistent investment can lead to
                  a powerful economic advantage.
                </p>
                <p>
                  Nuclear strikes now <strong>reduce productivity</strong>
                  proportionally to the number of tiles you lose. This creates
                  longer-term economic damage beyond just troop and worker
                  losses.
                </p>
              </div>
            </div>
          </div>
        </div>
      </o-modal>
    `;
  }

  public open() {
    this.requestUpdate();
    this.modalEl?.open();
  }

  private close() {
    this.modalEl?.close();
  }
}
