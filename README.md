# Obsidian LLM Plugin

An Obsidian plugin that integrates with LLM CLI tools (Claude, Codex, OpenCode, Gemini) to provide AI-powered assistance directly within your vault.

## Features

- **Chat Panel** - Sidebar panel for conversations with LLMs (like an embedded terminal)
- **Multiple Providers** - Support for Claude, Codex, OpenCode, and Gemini CLI tools
- **Open Files Context** - Optionally include content from open notes as context
- **System Prompt from File** - Use a markdown file in your vault as the system prompt
- **Progress Indicators** - See what the LLM is doing (reading files, searching, etc.)
- **Markdown Rendering** - LLM responses rendered with full Obsidian markdown support, including internal links
- **Create Notes from Responses** - Save LLM responses as new notes in your vault
- **Quick Prompts** - Commands for summarizing, explaining, and improving selected text

## Requirements

At least one LLM CLI tool must be installed and accessible in your PATH:

- [Claude CLI](https://github.com/anthropics/claude-cli) - `claude`
- [Codex CLI](https://github.com/openai/codex) - `codex`
- [OpenCode](https://github.com/opencode-ai/opencode) - `opencode`
- [Gemini CLI](https://github.com/google/gemini-cli) - `gemini`

## Installation

### Manual Installation

1. Download the latest release from the releases page
2. Extract to your vault's `.obsidian/plugins/obsidian-llm/` directory
3. Enable the plugin in Obsidian's Community Plugins settings

### Build from Source

```bash
git clone https://github.com/hardbyte/obsidian-llm-plugin.git
cd obsidian-llm-plugin
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugins folder.

## Usage

### Chat Panel

1. Click the message icon in the ribbon or use the command "LLM: Open Chat"
2. The chat panel opens in the right sidebar
3. Type your message and press Enter to send (Shift+Enter for newlines)
4. Toggle "Include open files" to provide context from your workspace

**Message Actions:**
- Hover over any assistant message to reveal action buttons
- **Copy** - Copy the response to clipboard
- **Create Note** - Save the response as a new note in your vault

### Quick Commands

- **LLM: Quick Prompt** - Open a prompt dialog
- **LLM: Send Selection to LLM** - Send selected text to the LLM
- **LLM: Summarize Selection** - Summarize selected text
- **LLM: Explain Selection** - Get an explanation of selected text
- **LLM: Improve Writing** - Improve selected text
- **LLM: Generate from Current Note Context** - Generate based on current note

### Settings

![Settings](images/settings.png)

- **Default Provider** - Choose which LLM to use by default
- **System Prompt File** - Select a markdown file to use as the system prompt
- **Default Timeout** - Set timeout for LLM requests (can be overridden per-provider)
- **Include Open Files** - Control whether open file content is sent as context
- **Conversation History** - Configure how many messages to include as context

## Configuration

### Provider Settings

Each provider can be configured with:
- Enable/disable
- Custom command (if CLI is named differently)
- Timeout override

### System Prompt

Create a markdown file in your vault (e.g., `System Prompt.md`) with your preferred system prompt, then select it in settings. The content will be prepended to all LLM requests.

## Development

```bash
# Install dependencies
npm install

# Build for development (with watch)
npm run dev

# Build for production
npm run build
```

### Testing in Obsidian

1. Create a test vault or use an existing one
2. Create a symbolic link from the build output to your vault's plugins folder:
   ```bash
   ln -s /path/to/obsidian-llm /path/to/vault/.obsidian/plugins/obsidian-llm
   ```
3. Run `npm run dev` to watch for changes
4. In Obsidian, enable the plugin and use Cmd/Ctrl+R to reload after changes
5. Open the Developer Console (Cmd/Ctrl+Shift+I) to see logs and errors

## Architecture Notes

### Session Continuation

The plugin captures session IDs from CLI tools and uses them for subsequent requests within the same conversation:
- **Claude**: `--resume <session_id>`
- **OpenCode**: `--session <session_id>`
- **Gemini**: `--resume <session_id>`
- **Codex**: Uses `resume` subcommand (different pattern, not fully supported)

This improves response times for follow-up messages. Clearing the conversation resets the session.

### Future Improvements

**Long-lived CLI Process**: Currently each request spawns a new CLI process. A more efficient approach would be to keep a long-running process and communicate via stdin/stdout or a local socket. Some CLI tools support this:
- `opencode serve` / `opencode attach` - Headless server mode
- `codex mcp-server` - MCP server mode
- `gemini` - Potential ACP mode

**MCP Integration**: Model Context Protocol (MCP) could provide a standardized way to communicate with LLM tools. Instead of spawning CLI processes, the plugin could:
1. Connect to MCP servers provided by each tool
2. Use a unified protocol for all providers
3. Maintain persistent connections for faster responses
4. Access tool-specific capabilities (file editing, web browsing, etc.)

This would require significant refactoring but could provide a much better UX with near-instant response times.

## License

MIT

## Credits

Built with [Obsidian Plugin API](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin).
