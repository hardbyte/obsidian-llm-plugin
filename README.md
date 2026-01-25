# Obsidian LLM Plugin

An Obsidian plugin that integrates with LLM CLI tools (Claude, Codex, OpenCode, Gemini) to provide AI-powered assistance directly within your vault.

## Features

- **Chat Panel** - Sidebar panel for conversations with LLMs (like an embedded terminal)
- **Multiple Providers** - Support for Claude, Codex, OpenCode, and Gemini CLI tools
- **Open Files Context** - Optionally include content from open notes as context
- **System Prompt from File** - Use a markdown file in your vault as the system prompt
- **Progress Indicators** - See what the LLM is doing (reading files, searching, etc.)
- **Markdown Rendering** - LLM responses rendered with full Obsidian markdown support
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

### Quick Commands

- **LLM: Quick Prompt** - Open a prompt dialog
- **LLM: Send Selection to LLM** - Send selected text to the LLM
- **LLM: Summarize Selection** - Summarize selected text
- **LLM: Explain Selection** - Get an explanation of selected text
- **LLM: Improve Writing** - Improve selected text
- **LLM: Generate from Current Note Context** - Generate based on current note

### Settings

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

## License

MIT

## Credits

Built with [Obsidian Plugin API](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin).
