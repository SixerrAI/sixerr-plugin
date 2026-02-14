#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Sixerr Installer
#
# One-command setup for plugin owners:
#   curl -fsSL https://raw.githubusercontent.com/SixerrAI/sixerr-plugin/main/install.sh | bash
#
# Installs:
#   ~/sixerr/openclaw/   — OpenClaw fork (dev/relay-integration)
#   ~/sixerr/plugin/     — sixerr-plugin
#   ~/.local/bin/openclaw — CLI wrapper
#   ~/.local/bin/sixerr   — CLI wrapper
# =============================================================================

SIXERR_DIR="$HOME/sixerr"
OPENCLAW_DIR="$SIXERR_DIR/openclaw"
PLUGIN_DIR="$SIXERR_DIR/plugin"
OPENCLAW_REPO="https://github.com/SixerrAI/openclaw.git"
OPENCLAW_BRANCH="dev/relay-integration"
PLUGIN_REPO="https://github.com/SixerrAI/sixerr-plugin.git"
BIN_DIR="$HOME/.local/bin"

# ---------------------------------------------------------------------------
# Colors & UI helpers
# ---------------------------------------------------------------------------

BOLD='\033[1m'
DIM='\033[2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RESET='\033[0m'

ui_info()    { printf "${BLUE}ℹ${RESET}  %s\n" "$1"; }
ui_success() { printf "${GREEN}✔${RESET}  %s\n" "$1"; }
ui_warn()    { printf "${YELLOW}⚠${RESET}  %s\n" "$1"; }
ui_error()   { printf "${RED}✖${RESET}  %s\n" "$1" >&2; }
ui_section() { printf "\n${BOLD}${CYAN}▸ %s${RESET}\n\n" "$1"; }

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

check_prereqs() {
  ui_section "Checking prerequisites"

  local ok=true

  # Node.js 22+
  if command -v node &>/dev/null; then
    local node_major
    node_major=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
    if [ "$node_major" -ge 22 ] 2>/dev/null; then
      ui_success "Node.js v$(node --version | tr -d v)"
    else
      ui_error "Node.js 22+ required (found v$(node --version | tr -d v))"
      printf "       Install via: ${DIM}https://nodejs.org/${RESET} or ${DIM}nvm install 22${RESET}\n"
      ok=false
    fi
  else
    ui_error "Node.js not found — version 22+ required"
    printf "       Install via: ${DIM}https://nodejs.org/${RESET} or ${DIM}nvm install 22${RESET}\n"
    ok=false
  fi

  # Git
  if command -v git &>/dev/null; then
    ui_success "Git $(git --version | awk '{print $3}')"
  else
    ui_error "Git not found"
    printf "       Install via: ${DIM}https://git-scm.com/downloads${RESET}\n"
    ok=false
  fi

  if [ "$ok" = false ]; then
    printf "\n"
    ui_error "Missing prerequisites — install them and re-run this script."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# OpenClaw fork
# ---------------------------------------------------------------------------

install_openclaw() {
  ui_section "Installing OpenClaw fork"

  mkdir -p "$SIXERR_DIR"

  if [ -d "$OPENCLAW_DIR/.git" ]; then
    ui_info "Existing clone found — updating"
    cd "$OPENCLAW_DIR"
    if git diff --quiet && git diff --cached --quiet; then
      git fetch origin
      git rebase "origin/$OPENCLAW_BRANCH"
      ui_success "Updated to latest"
    else
      ui_warn "Local changes detected — skipping pull"
    fi
  else
    ui_info "Cloning $OPENCLAW_REPO ($OPENCLAW_BRANCH)"
    git clone -b "$OPENCLAW_BRANCH" "$OPENCLAW_REPO" "$OPENCLAW_DIR"
    ui_success "Cloned"
  fi

  cd "$OPENCLAW_DIR"

  # Ensure pnpm is available via corepack
  ui_info "Enabling corepack + pnpm"
  corepack enable
  corepack prepare pnpm@latest --activate 2>/dev/null || true

  ui_info "Installing dependencies (pnpm install)"
  pnpm install --frozen-lockfile

  ui_info "Building OpenClaw"
  pnpm build

  # Create CLI wrapper at ~/.local/bin/openclaw
  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/openclaw" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
OPENCLAW_DIR="$HOME/sixerr/openclaw"
exec node "$OPENCLAW_DIR/dist/src/index.js" "$@"
WRAPPER
  chmod +x "$BIN_DIR/openclaw"

  # Ensure ~/.local/bin is on PATH for this session
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    export PATH="$BIN_DIR:$PATH"
  fi

  ui_success "OpenClaw built — CLI at $BIN_DIR/openclaw"

  # Hint about PATH if needed
  if ! grep -qsE "(\.local/bin)" "$HOME/.bashrc" "$HOME/.zshrc" 2>/dev/null; then
    ui_warn "Add ~/.local/bin to your PATH if it isn't already:"
    printf "       ${DIM}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}\n"
  fi
}

# ---------------------------------------------------------------------------
# OpenClaw onboarding (interactive — first install only)
# ---------------------------------------------------------------------------

onboard_openclaw() {
  if [ -f "$HOME/.openclaw/openclaw.json" ]; then
    ui_info "OpenClaw already configured — skipping onboarding"
    return 0
  fi

  ui_section "OpenClaw first-time onboarding"
  ui_info "This is interactive — follow the prompts to configure OpenClaw."
  printf "\n"

  openclaw onboard --install-daemon
}

# ---------------------------------------------------------------------------
# Configure OpenClaw for Sixerr
# ---------------------------------------------------------------------------

configure_openclaw() {
  ui_section "Configuring OpenClaw for Sixerr"

  # 1. Enable the HTTP /v1/responses endpoint (required for plugin relay)
  ui_info "Enabling HTTP responses endpoint"
  openclaw config set gateway.http.endpoints.responses.enabled true

  # 2. Add sixerr-default agent with tools deny [*] (clientTools passthrough)
  #    Reads existing agents list, appends only if not already present.
  ui_info "Adding sixerr-default agent"
  local existing_agents
  existing_agents=$(openclaw config get agents.list --json 2>/dev/null || echo "null")

  local new_agents
  new_agents=$(node -e "
    const existing = JSON.parse(process.argv[1]);
    const agents = Array.isArray(existing) ? existing : [];
    if (agents.some(a => a.id === 'sixerr-default')) {
      process.stdout.write('ALREADY_EXISTS');
    } else {
      agents.push({ id: 'sixerr-default', tools: { deny: ['*'] } });
      process.stdout.write(JSON.stringify(agents));
    }
  " "$existing_agents")

  if [ "$new_agents" = "ALREADY_EXISTS" ]; then
    ui_info "sixerr-default agent already exists"
  else
    openclaw config set agents.list "$new_agents" --json
    ui_success "sixerr-default agent added"
  fi

  # 3. Read gateway token for plugin setup
  GATEWAY_TOKEN=$(openclaw config get gateway.auth.token 2>/dev/null || true)
  if [ -n "$GATEWAY_TOKEN" ]; then
    ui_success "Gateway token retrieved"
  else
    ui_warn "Could not read gateway token — you'll need to enter it manually during setup"
  fi

  # 4. Restart gateway so config changes take effect
  ui_info "Restarting OpenClaw gateway..."
  openclaw gateway --force &>/dev/null &
  sleep 3
  if curl -sf http://localhost:18789/health &>/dev/null; then
    ui_success "Gateway restarted with new config"
  else
    ui_warn "Gateway may still be starting — if plugin can't connect, run 'openclaw gateway --force'"
  fi

  ui_success "OpenClaw configured for Sixerr"
}

# ---------------------------------------------------------------------------
# Sixerr plugin
# ---------------------------------------------------------------------------

install_plugin() {
  ui_section "Installing Sixerr plugin"

  if [ -d "$PLUGIN_DIR/.git" ]; then
    ui_info "Existing clone found — updating"
    cd "$PLUGIN_DIR"
    if git diff --quiet && git diff --cached --quiet; then
      git pull --rebase
      ui_success "Updated to latest"
    else
      ui_warn "Local changes detected — skipping pull"
    fi
  else
    ui_info "Cloning $PLUGIN_REPO"
    git clone "$PLUGIN_REPO" "$PLUGIN_DIR"
    ui_success "Cloned"
  fi

  cd "$PLUGIN_DIR"

  ui_info "Installing dependencies (npm install)"
  npm install

  # Create CLI wrapper at ~/.local/bin/sixerr
  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/sixerr" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_DIR="$HOME/sixerr/plugin"
exec npx --prefix "$PLUGIN_DIR" tsx "$PLUGIN_DIR/src/cli/cli.ts" "$@"
WRAPPER
  chmod +x "$BIN_DIR/sixerr"

  ui_success "Plugin installed — CLI at $BIN_DIR/sixerr"
}

# ---------------------------------------------------------------------------
# Plugin setup wizard (interactive)
# ---------------------------------------------------------------------------

run_setup_wizard() {
  ui_section "Plugin setup wizard"
  ui_info "Configure your wallet, pricing, and OpenClaw gateway connection."
  printf "\n"

  cd "$PLUGIN_DIR"
  SIXERR_OPENCLAW_TOKEN="${GATEWAY_TOKEN:-}" npx tsx src/cli/cli.ts setup
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  printf "\n"
  printf "${BOLD}${CYAN}  ╔═══════════════════════════════════════╗${RESET}\n"
  printf "${BOLD}${CYAN}  ║      Sixerr Installer                 ║${RESET}\n"
  printf "${BOLD}${CYAN}  ║      Monetize your agent's downtime    ║${RESET}\n"
  printf "${BOLD}${CYAN}  ╚═══════════════════════════════════════╝${RESET}\n"
  printf "\n"
  printf "  ${DIM}Install dir:  ~/sixerr/${RESET}\n"
  printf "  ${DIM}CLI wrappers: ~/.local/bin/openclaw, ~/.local/bin/sixerr${RESET}\n"
  printf "\n"

  check_prereqs
  install_openclaw
  onboard_openclaw
  configure_openclaw
  install_plugin
  run_setup_wizard

  printf "\n"
  ui_section "All done!"
  printf "  To start monetizing your agent's downtime:\n"
  printf "    ${BOLD}sixerr start${RESET}\n"
  printf "\n"
}

main "$@"
