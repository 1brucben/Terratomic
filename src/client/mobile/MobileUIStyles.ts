export const MOBILE_UI_STYLE_ID = "mobile-ui-styles";

export const MOBILE_UI_STYLES = `
      body.mobile-ui-enabled {
        /* Prevent overscroll bounce on iOS */
        overscroll-behavior: none;
        
        /* Prevent text selection during touch */
        user-select: none;
        -webkit-user-select: none;
        
        /* Prevent touch callouts on iOS */
        -webkit-touch-callout: none;
        
        /* Smoother touch interactions */
        -webkit-tap-highlight-color: transparent;
      }
      
      /* Hide desktop-only UI components when mobile is enabled */
      body.mobile-ui-enabled .desktop-only {
        display: none !important;
      }

      /* Hide desktop HUD elements while mobile UI is active */
      body.mobile-ui-enabled #customMenu,
      body.mobile-ui-enabled #radialMenu,
      body.mobile-ui-enabled #settings-button,
      body.mobile-ui-enabled control-panel,
      body.mobile-ui-enabled control-panel2,
      body.mobile-ui-enabled chat-display,
      body.mobile-ui-enabled events-display,
      body.mobile-ui-enabled options-menu,
      body.mobile-ui-enabled replay-panel,
      body.mobile-ui-enabled player-info-overlay,
      body.mobile-ui-enabled tutorial-toast,
      body.mobile-ui-enabled tech-unlock-notification,
      /* Hide desktop research button on mobile */
      body.mobile-ui-enabled research-toggle-button,
      body.mobile-ui-enabled game-left-sidebar,
      body.mobile-ui-enabled top-bar,
      body.mobile-ui-enabled .desktop-hud {
        display: none !important;
      }
      
      /* Game canvas touch optimization */
      body.mobile-ui-enabled canvas {
        touch-action: pan-x pan-y;
      }

      /* Compact research priority modal on mobile */
      body.mobile-ui-enabled .research-priority-banner {
        top: calc(env(safe-area-inset-top, 0px) + 56px) !important;
        width: min(92vw, 460px) !important;
        max-width: 460px !important;
        max-height: calc(100vh - (env(safe-area-inset-top, 0px) + 72px)) !important;
        border-radius: 12px !important;
        font-size: 13px !important;
        z-index: 1700 !important;
        border: 1px solid rgba(157, 168, 182, 0.26) !important;
        background:
          linear-gradient(
            180deg,
            rgba(128, 138, 151, 0.12) 0%,
            rgba(74, 84, 96, 0.09) 38%,
            rgba(21, 26, 34, 0.04) 100%
          ),
          linear-gradient(
            180deg,
            rgba(34, 40, 49, 0.97) 0%,
            rgba(22, 27, 35, 0.98) 56%,
            rgba(14, 18, 24, 0.98) 100%
          ) !important;
        box-shadow:
          inset 0 1px 0 rgba(231, 238, 246, 0.1),
          0 10px 24px rgba(0, 0, 0, 0.48) !important;
      }
      body.mobile-ui-enabled .banner-header {
        padding: 0.6rem 0.9rem !important;
        background: linear-gradient(
          180deg,
          rgba(16, 20, 28, 0.88) 0%,
          rgba(11, 15, 21, 0.92) 100%
        ) !important;
        border-bottom: 1px solid rgba(149, 159, 173, 0.22) !important;
      }
      body.mobile-ui-enabled .banner-title {
        font-size: 15px !important;
        color: rgba(234, 241, 249, 0.95) !important;
      }
      body.mobile-ui-enabled .banner-close-btn {
        width: 24px !important;
        height: 24px !important;
        border-radius: 6px !important;
        border: 1px solid rgba(129, 140, 154, 0.3) !important;
        color: rgba(245, 188, 122, 0.95) !important;
        background: linear-gradient(
          180deg,
          rgba(18, 24, 33, 0.9) 0%,
          rgba(11, 15, 22, 0.94) 100%
        ) !important;
      }
      body.mobile-ui-enabled .banner-content {
        padding: 0.75rem 0.9rem !important;
        overflow-y: auto !important;
      }
      body.mobile-ui-enabled .banner-intro {
        font-size: 0.85em !important;
        margin-bottom: 0.7rem !important;
        text-align: left !important;
      }
      body.mobile-ui-enabled .categories-row {
        grid-template-columns: 1fr !important;
        gap: 8px !important;
      }
      body.mobile-ui-enabled .category-tile {
        min-height: 68px !important;
        padding: 10px 12px !important;
        gap: 10px !important;
        flex-direction: row !important;
        align-items: center !important;
        text-align: left !important;
        border-width: 1px !important;
        border-color: rgba(124, 136, 151, 0.28) !important;
        border-radius: 8px !important;
      }
      body.mobile-ui-enabled .category-tile-icon {
        width: 28px !important;
        height: 28px !important;
      }
      body.mobile-ui-enabled .category-tile-name {
        font-size: 0.95em !important;
      }
      body.mobile-ui-enabled .category-tile-desc {
        font-size: 0.7em !important;
        display: -webkit-box !important;
        -webkit-line-clamp: 2 !important;
        -webkit-box-orient: vertical !important;
        overflow: hidden !important;
      }
      body.mobile-ui-enabled .category-tile-badge {
        margin-left: auto !important;
        font-size: 0.65em !important;
        padding: 2px 7px !important;
        border-radius: 999px !important;
      }
      body.mobile-ui-enabled .banner-footer {
        font-size: 0.75em !important;
        padding-top: 0.3rem !important;
      }

      /* Compact research priority confirmation toast on mobile */
      body.mobile-ui-enabled .research-priority-confirmation-toast {
        top: calc(env(safe-area-inset-top, 0px) + 56px) !important;
        width: min(92vw, 300px) !important;
        min-width: 0 !important;
        left: 50% !important;
        transform: translateX(-50%) translateY(-10px) !important;
        font-size: 13px !important;
        z-index: 1700 !important;
        pointer-events: none !important;
        border: 1px solid rgba(145, 157, 172, 0.28) !important;
        border-radius: 10px !important;
        background:
          linear-gradient(
            180deg,
            rgba(125, 136, 149, 0.12) 0%,
            rgba(71, 81, 93, 0.08) 42%,
            rgba(19, 25, 33, 0.04) 100%
          ),
          linear-gradient(
            180deg,
            rgba(32, 38, 47, 0.97) 0%,
            rgba(20, 26, 35, 0.98) 100%
          ) !important;
        box-shadow:
          inset 0 1px 0 rgba(233, 240, 248, 0.09),
          0 8px 20px rgba(0, 0, 0, 0.44) !important;
      }
      body.mobile-ui-enabled .research-priority-confirmation-toast.show {
        transform: translateX(-50%) translateY(0) !important;
      }

      body.mobile-ui-enabled .research-priority-confirmation-toast .toast-icon {
        width: 22px !important;
        height: 22px !important;
        min-width: 22px !important;
        border-radius: 999px !important;
        font-size: 13px !important;
      }

      body.mobile-ui-enabled .research-priority-confirmation-toast .toast-title {
        font-size: 12px !important;
        line-height: 1.2 !important;
      }

      body.mobile-ui-enabled .research-priority-confirmation-toast .toast-message {
        font-size: 11px !important;
        line-height: 1.3 !important;
      }

      body.mobile-ui-enabled .mobile-economy-tab,
      body.mobile-ui-enabled .mobile-intel-tab,
      body.mobile-ui-enabled .mobile-research-tab {
        position: fixed;
        right: 12px;
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background:
          linear-gradient(
            180deg,
            rgba(135, 145, 157, 0.12) 0%,
            rgba(79, 88, 99, 0.08) 40%,
            rgba(24, 29, 38, 0.04) 100%
          ),
          linear-gradient(
            180deg,
            rgba(27, 33, 42, 0.96) 0%,
            rgba(16, 21, 29, 0.98) 55%,
            rgba(11, 15, 22, 0.98) 100%
          );
        border: 1px solid rgba(162, 173, 186, 0.24);
        box-shadow:
          inset 0 1px 0 rgba(231, 238, 246, 0.1),
          inset 0 -1px 0 rgba(0, 0, 0, 0.52),
          0 4px 14px rgba(0, 0, 0, 0.42);
        z-index: 1700;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        transition:
          transform 0.1s ease,
          filter 0.12s ease,
          border-color 0.15s ease,
          box-shadow 0.15s ease;
        overflow: visible;
      }

      body.mobile-ui-enabled .mobile-economy-tab {
        top: calc(env(safe-area-inset-top, 0px) + 60px);
        color: rgba(246, 190, 94, 0.96);
      }

      body.mobile-ui-enabled .mobile-intel-tab {
        top: calc(env(safe-area-inset-top, 0px) + 180px); /* 60 + 48 + 12 + 48 + 12 = 180 */
        color: rgba(116, 182, 255, 0.95);
      }

      body.mobile-ui-enabled .mobile-research-tab {
        top: calc(env(safe-area-inset-top, 0px) + 120px); /* 60 + 48 + 12 = 120 */
        color: rgba(185, 152, 255, 0.95);
      }

      body.mobile-ui-enabled .mobile-research-tab::before {
        content: attr(data-progress);
        position: absolute;
        top: -7px;
        right: -7px;
        min-width: 30px;
        height: 16px;
        padding: 0 5px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.1px;
        color: rgba(248, 238, 255, 0.96);
        background: linear-gradient(
          180deg,
          rgba(127, 92, 188, 0.94) 0%,
          rgba(73, 43, 121, 0.96) 100%
        );
        border: 1px solid rgba(215, 190, 255, 0.54);
        box-shadow:
          0 2px 7px rgba(0, 0, 0, 0.46),
          inset 0 1px 0 rgba(255, 255, 255, 0.16);
        pointer-events: none;
      }

      body.mobile-ui-enabled .mobile-economy-tab svg,
      body.mobile-ui-enabled .mobile-intel-tab svg,
      body.mobile-ui-enabled .mobile-research-tab svg {
        width: 22px;
        height: 22px;
      }

      body.mobile-ui-enabled .mobile-economy-tab::after,
      body.mobile-ui-enabled .mobile-intel-tab::after,
      body.mobile-ui-enabled .mobile-research-tab::after {
        content: "";
        position: absolute;
        left: 6px;
        right: 6px;
        bottom: 4px;
        height: 1px;
        background: rgba(218, 229, 241, 0.14);
      }

      body.mobile-ui-enabled .mobile-economy-tab:active,
      body.mobile-ui-enabled .mobile-intel-tab:active,
      body.mobile-ui-enabled .mobile-research-tab:active {
        transform: translateY(1px) scale(0.95);
        filter: brightness(1.08);
        border-color: rgba(186, 198, 214, 0.3);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.08),
          inset 0 -1px 0 rgba(0, 0, 0, 0.6),
          0 2px 8px rgba(0, 0, 0, 0.5);
      }

      /* Zoom control buttons - left side, vertically centered */
      body.mobile-ui-enabled .mobile-zoom-in,
      body.mobile-ui-enabled .mobile-zoom-center,
      body.mobile-ui-enabled .mobile-zoom-out {
        position: fixed;
        left: 12px;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background: rgba(15, 15, 20, 0.65);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: rgba(255, 255, 255, 0.85);
        z-index: 1700;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        border: none;
        transition: transform 0.1s ease, background 0.1s ease;
      }

      body.mobile-ui-enabled .mobile-zoom-in {
        top: calc(50% - 60px); /* Center minus offset for 3 buttons */
      }

      body.mobile-ui-enabled .mobile-zoom-center {
        top: calc(50% - 18px); /* Center */
      }

      body.mobile-ui-enabled .mobile-zoom-out {
        top: calc(50% + 24px); /* Center plus offset */
      }

      body.mobile-ui-enabled .mobile-zoom-in:active,
      body.mobile-ui-enabled .mobile-zoom-center:active,
      body.mobile-ui-enabled .mobile-zoom-out:active {
        transform: scale(0.9);
        background: rgba(25, 25, 30, 0.85);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      }
      
      /* Support for notched devices */
      @supports (padding: env(safe-area-inset-top)) {
        body.mobile-ui-enabled {
          padding-top: env(safe-area-inset-top);
          padding-bottom: env(safe-area-inset-bottom);
          padding-left: env(safe-area-inset-left);
          padding-right: env(safe-area-inset-right);
        }
      }
    `;
