#!/bin/bash
# SessionStart hook — restore tooling that does not survive an ephemeral container.
#
# Claude Code on the web clones this repo into a fresh container each session and
# reclaims it afterwards, so anything installed into ~/.claude is gone next time.
# The OpenSEO plugin (nine SEO skills + its MCP server) installs per-user, not
# per-repo, so without this hook every session starts without it and has to be
# told to install it by hand.
#
# Both plugin commands are natively idempotent and exit 0 when the marketplace or
# plugin is already present, so this is safe to re-run.
#
# Deliberately never fails the session: this repo's own tests are zero-dependency
# Node and do not need the plugin. A network blip must not block startup.

set -uo pipefail

# Local machines already have whatever the developer installed; only the
# throwaway remote containers need restoring.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "session-start: claude CLI not on PATH; skipping OpenSEO plugin install" >&2
  exit 0
fi

echo "session-start: restoring OpenSEO plugin (marketplace + nine SEO skills + MCP server)"

if claude plugin marketplace add every-app/open-seo 2>&1; then
  claude plugin install openseo@openseo 2>&1 \
    || echo "session-start: plugin install failed; run 'claude plugin install openseo@openseo' by hand" >&2
else
  echo "session-start: marketplace add failed; run 'claude plugin marketplace add every-app/open-seo' by hand" >&2
fi

# The MCP server authenticates interactively and cannot be scripted. Say so once,
# here, rather than leaving a future session to rediscover it.
echo "session-start: OpenSEO MCP needs an interactive login — run /mcp, pick OpenSEO, sign in."

exit 0
