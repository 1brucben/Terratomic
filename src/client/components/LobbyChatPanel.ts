import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LobbyMessage } from "../../core/Schemas";
import { getServerConfigFromClient } from "../../core/configuration/ConfigLoader";

@customElement("lobby-chat-panel")
export class LobbyChatPanel extends LitElement {
  @property({ type: Array }) messages: LobbyMessage[] = [];
  @property({ type: String }) clientID: string = "";
  @property({ type: String }) gameID: string = "";
  @property({ type: String }) username: string = "";
  @state() private inputText: string = "";

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    if (changedProperties.has("messages")) {
      this.scrollToBottom();
    }
  }

  private async scrollToBottom() {
    await this.updateComplete;
    const container = this.renderRoot.querySelector(
      ".lcp-messages",
    ) as HTMLElement | null;
    if (container) container.scrollTop = container.scrollHeight;
  }

  private async sendMessage() {
    const text = this.inputText.trim();
    console.log("LobbyChatPanel.sendMessage called", {
      text,
      clientID: this.clientID,
      gameID: this.gameID,
      username: this.username,
    });
    if (!text) return;
    if (!this.clientID || !this.gameID || !this.username) {
      console.warn("LobbyChatPanel: Missing clientID, gameID, or username", {
        clientID: this.clientID,
        gameID: this.gameID,
        username: this.username,
      });
      return;
    }

    const capped = text.slice(0, 300);
    this.inputText = ""; // Clear immediately for better UX

    try {
      const config = await getServerConfigFromClient();
      const url = `/${config.workerPath(this.gameID)}/api/lobby/${this.gameID}/messages`;
      console.log("LobbyChatPanel: Sending POST to", url);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientID: this.clientID,
          username: this.username,
          text: capped,
        }),
      });
      console.log("LobbyChatPanel: Response status", response.status);
      if (!response.ok) {
        console.error("Failed to send lobby message:", response.statusText);
      }
    } catch (err) {
      console.error("Error sending lobby message:", err);
    }
  }

  render() {
    return html`
      <div class="lcp-container">
        <div class="lcp-messages">
          ${this.messages.map((m) => {
            const displayName = m.isHost ? `${m.username} (Host)` : m.username;
            const isLocal = m.clientID === this.clientID;
            const msgClass = isLocal
              ? "lcp-msg lcp-msg--local"
              : "lcp-msg lcp-msg--remote";
            return html`<div class="${msgClass}">
              <span class="lcp-sender">${displayName}:</span> ${m.text}
            </div>`;
          })}
        </div>
        <div class="lcp-input-row">
          <input
            class="lcp-input"
            type="text"
            maxlength="300"
            .value=${this.inputText}
            @input=${(e: Event) =>
              (this.inputText = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                this.sendMessage();
              }
            }}
            placeholder="Type a message..."
          />
          <button class="lcp-send" @click=${() => this.sendMessage()}>
            Send
          </button>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // use light DOM for existing styles
  }
}

const style = document.createElement("style");
style.textContent = `
  .lcp-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    min-height: 200px;
  }
  .lcp-messages {
    overflow-y: auto;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 8px;
    flex: 1;
    min-height: 100px;
    background: rgba(0, 0, 0, 0.5);
    color: #ddd;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lcp-msg {
    font-size: 0.9rem;
    padding: 6px 10px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.6);
  }
  .lcp-msg--local {
    align-self: flex-end;
    text-align: right;
    background: rgba(36, 59, 85, 0.7);
  }
  .lcp-msg--remote {
    align-self: flex-start;
    text-align: left;
    background: rgba(0, 0, 0, 0.6);
  }
  .lcp-sender {
    color: #9ae6b4;
    margin-right: 4px;
  }
  .lcp-input-row {
    display: flex;
    gap: 8px;
  }
  .lcp-input {
    flex: 1;
    border-radius: 8px;
    padding: 6px 10px;
    color: #000;
  }
  .lcp-send {
    border-radius: 8px;
    padding: 6px 12px;
  }
`;
document.head.appendChild(style);
