import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import "./components/baseComponents/Modal";

@customElement("language-modal")
export class LanguageModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private visible = false;
  @state() private languageList: any[] = [];
  @state() private currentLang = "en";
  @state() private searchQuery = "";
  private searchTimeout?: any;

  createRenderRoot() {
    return this; // Light DOM for Tailwind/global accessibility
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      "open-language-modal",
      this.handleOpen as EventListener,
    );
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      "open-language-modal",
      this.handleOpen as EventListener,
    );
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  /**
   * Closes the modal when the Escape key is pressed.
   * @param e - The keyboard event.
   */
  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.visible) {
      this.modalEl.close();
    }
  };

  /**
   * Opens the language selection modal and populates the language list.
   * @param e - Custom event containing the language list and current language.
   */
  private handleOpen = async (e: CustomEvent) => {
    this.languageList = e.detail.languageList;
    this.currentLang = e.detail.currentLang;
    this.visible = true;
    this.searchQuery = "";
    this.modalEl.open();
    // Focus search input
    await this.updateComplete;
    this.querySelector("input")?.focus();
  };

  /**
   * Dispatches a language-selected event and closes the modal.
   * @param lang - The language code to select.
   */
  private selectLanguage = (lang: string) => {
    this.dispatchEvent(
      new CustomEvent("language-selected", {
        detail: { lang },
        bubbles: true,
        composed: true,
      }),
    );
    this.modalEl.close();
  };

  /**
   * Updates the search query with a debounce delay.
   * @param e - The input event from the search field.
   */
  private handleSearch = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.searchQuery = value.toLowerCase();
    }, 150);
  };

  render() {
    const filteredList = this.languageList.filter((lang) => {
      const search = this.searchQuery.trim();
      if (!search) return true;
      return (
        lang.native.toLowerCase().includes(search) ||
        lang.en.toLowerCase().includes(search) ||
        lang.code.toLowerCase().includes(search)
      );
    });

    return html`
      <o-modal
        title=${translateText("select_lang.title")}
        max-width="960px"
        max-height="64vh"
        @modal-close=${() => (this.visible = false)}
      >
        <div class="space-y-8">
          <!-- Search Input -->
          <div class="relative group">
            <div
              class="absolute inset-y-0 left-4 flex items-center pointer-events-none text-white/20 group-focus-within:text-cyan-400 transition-colors"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              type="text"
              @input=${this.handleSearch}
              placeholder=${translateText("select_lang.search_placeholder")}
              aria-label=${translateText("select_lang.search_label")}
              class="w-full bg-black/40 border border-white/10 focus:border-cyan-500/50 rounded-xl py-4 pl-12 pr-4 text-white placeholder-white/20 outline-none transition-all duration-300 focus:ring-1 focus:ring-cyan-500/30 font-ocr tracking-widest"
            />
          </div>

          <!-- Language Grid -->
          <div
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6"
          >
            ${filteredList.map((lang) => {
              const isActive = this.currentLang === lang.code;
              const isDebug = lang.code === "debug";

              let containerClasses = `
                group relative flex flex-col items-center text-center p-5 rounded-2xl border transition-all duration-300
                cursor-pointer overflow-hidden
              `;

              if (isDebug) {
                containerClasses += `
                  border-dashed border-cyan-400/50 bg-gradient-to-br from-red-500/10 via-purple-500/10 to-blue-500/10
                  hover:border-cyan-400 animate-pulse
                `;
              } else if (isActive) {
                containerClasses += `
                  bg-cyan-500/20 border-cyan-500/50 ring-1 ring-cyan-500/30
                `;
              } else {
                containerClasses += `
                  bg-black/20 border-white/5 hover:bg-white/5 hover:border-white/20
                `;
              }

              return html`
                <div
                  class="${containerClasses}"
                  @click=${() => this.selectLanguage(lang.code)}
                >
                  <!-- Flag Focus (Larger) -->
                  <div
                    class="relative w-20 h-14 mb-4 flex-shrink-0 shadow-2xl overflow-hidden rounded-lg transition-all duration-500 group-hover:scale-110 group-hover:rotate-1"
                  >
                    <img
                      src="/flags/${lang.svg}.svg"
                      class="w-full h-full object-cover"
                      alt="${lang.code}"
                    />
                    ${isActive
                      ? html`<div
                          class="absolute inset-0 border-2 border-cyan-400 rounded-lg"
                        ></div>`
                      : ""}
                  </div>

                  <div class="flex flex-col gap-1 w-full text-center">
                    <span
                      class="text-sm font-bold text-white/90 transition-colors group-hover:text-white leading-tight"
                    >
                      ${lang.native}
                    </span>
                    <span
                      class="text-[8px] uppercase font-ocr tracking-widest text-white/30 group-hover:text-white/50 leading-relaxed"
                    >
                      ${lang.en}
                    </span>
                  </div>

                  ${isActive
                    ? html`
                        <div
                          class="absolute top-2 right-2 w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee]"
                        ></div>
                      `
                    : ""}
                </div>
              `;
            })}
            ${filteredList.length === 0
              ? html`
                  <div class="col-span-full py-20 text-center opacity-30">
                    <div class="font-ocr uppercase tracking-[0.3em] text-sm">
                      ${translateText("select_lang.no_results")}
                    </div>
                  </div>
                `
              : ""}
          </div>
        </div>
      </o-modal>
    `;
  }
}
