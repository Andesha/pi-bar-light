# pi-bar-light

An owned, dependency-free Pi footer showing:

- Git branch and context use
- Active model and thinking level
- Session input/output tokens and cost
- Anthropic 5-hour/7-day plan usage
- OpenAI Codex primary/secondary rate-limit usage

The footer refreshes quota data at most once per minute and keeps last-known-good data visible during transient failures. Provider requests use OAuth credentials directly from existing Pi, Claude, or Codex auth stores; credentials are never persisted or logged by this extension.

## Install

```bash
pi install "$HOME/Documents/pi-bar-light"
```

For a one-off test:

```bash
pi -e "$HOME/Documents/pi-bar-light"
```

## Credential sources

- Pi: `~/.pi/agent/auth.json`
- Claude Code: `~/.claude/.credentials.json`
- Codex: `${CODEX_HOME:-~/.codex}/auth.json`

Only exact Pi provider IDs `anthropic` and `openai-codex` activate quota requests. Missing suitable OAuth credentials show `quota unavailable`; unsupported providers omit quota entirely.

## Development

```bash
npm install
npm run check
```

Tests inject credentials and `fetch`; they make no live provider requests.
