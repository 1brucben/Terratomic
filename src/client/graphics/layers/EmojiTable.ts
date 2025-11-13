import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { AllPlayers } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { TerraNulliusImpl } from "../../../core/game/TerraNulliusImpl";
import { emojiTable, flattenedEmojiTable } from "../../../core/Util";
import { ShowEmojiMenuEvent } from "../../InputHandler";
import { SendEmojiIntentEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";

@customElement("emoji-table")
export class EmojiTable extends LitElement {
  @state() public isVisible = false;
  public transformHandler: TransformHandler;
  public game: GameView;

  initEventBus(eventBus: EventBus) {
    eventBus.on(ShowEmojiMenuEvent, (e) => {
      this.isVisible = true;
      const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
      if (!this.game.isValidCoord(cell.x, cell.y)) {
        return;
      }

      const tile = this.game.ref(cell.x, cell.y);
      if (!this.game.hasOwner(tile)) {
        return;
      }

      const targetPlayer = this.game.owner(tile);
      // maybe redundant due to owner check but better safe than sorry
      if (targetPlayer instanceof TerraNulliusImpl) {
        return;
      }

      this.showTable((emoji) => {
        const recipient =
          targetPlayer === this.game.myPlayer()
            ? AllPlayers
            : (targetPlayer as PlayerView);
        eventBus.emit(
          new SendEmojiIntentEvent(
            recipient,
            flattenedEmojiTable.indexOf(emoji),
          ),
        );
        this.hideTable();
      });
    });
  }

  private onEmojiClicked: (emoji: string) => void = () => {};

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="bg-slate-800 max-w-[95vw] max-h-[95vh] pt-[0.9375rem] pb-[0.9375rem] fixed flex flex-col -translate-x-1/2 -translate-y-1/2 
                items-center rounded-[0.625rem] z-[9999] top-[50%] left-[50%] justify-center"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
        @wheel=${(e: WheelEvent) => e.stopPropagation()}
      >
        <!-- Close button -->
        <button
          class="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center
                  bg-red-500 hover:bg-red-900 text-white rounded-full
                  text-sm font-bold transition-colors"
          @click=${this.hideTable}
        >
          ✕
        </button>
        <div
          class="flex flex-col overflow-y-auto"
          style="scrollbar-gutter: stable both-edges;"
        >
          ${emojiTable.map(
            (row) => html`
              <div class="w-full justify-center flex">
                ${row.map(
                  (emoji) => html`
                    <button
                      class="flex transition-transform duration-300 ease justify-center items-center cursor-pointer
                              border border-solid border-slate-500 rounded-[0.75rem] bg-slate-700 hover:bg-slate-600 active:bg-slate-500 
                              md:m-[0.5rem] md:text-[3.75rem] md:w-[5rem] md:h-[5rem] hover:scale-[1.1] active:scale-[0.95]
                              sm:w-[3.75rem] sm:h-[3.75rem] sm:text-[2rem] sm:m-[0.3125rem] text-[1.75rem] w-[3.125rem] h-[3.125rem] m-[0.1875rem]"
                      @click=${() => this.onEmojiClicked(emoji)}
                    >
                      ${emoji}
                    </button>
                  `,
                )}
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  hideTable() {
    this.isVisible = false;
    this.requestUpdate();
  }

  showTable(oneEmojiClicked: (emoji: string) => void) {
    this.onEmojiClicked = oneEmojiClicked;
    this.isVisible = true;
    this.requestUpdate();
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
