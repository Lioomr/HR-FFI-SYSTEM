#!/bin/bash
# Installs the serena-agent CLI so the project-scoped Serena MCP server
# declared in .mcp.json (command: `serena start-mcp-server ...`) has its
# binary available in a fresh Claude Code on the web container. Web-only,
# idempotent, and never fails session start (uv/network issues are logged
# and skipped rather than aborting).
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

if command -v serena >/dev/null 2>&1; then
  exit 0
fi

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf --max-time 30 https://astral.sh/uv/install.sh 2>/dev/null | sh >/dev/null 2>&1 || true
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "session-start: uv unavailable, skipping serena-agent install (Serena MCP server will not start this session)" >&2
  exit 0
fi

if ! uv tool install -p 3.13 serena-agent >/dev/null 2>&1; then
  echo "session-start: serena-agent install failed (offline?), Serena MCP server will not start this session" >&2
fi

exit 0
