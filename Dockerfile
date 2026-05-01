# Psycheros + entity-core single-container image
# Target: linux/amd64 (UnRAID homelab)
#
# Build context is the Zari workspace root (parent of both repos).
# Usage:
#   docker build --platform linux/amd64 -t psycheros .
#   docker run -p 3000:3000 -e ZAI_API_KEY=<key> psycheros

FROM denoland/deno:2.6.7

# Install dumb-init for proper PID 1 signal handling, plus an SSH server and a
# small set of diagnostic tools used when an operator (or an external Claude
# Code agent) connects via SSH for live in-container debugging. SSH is gated
# at runtime by PSYCHEROS_SSH_ENABLED (default off) — the binaries are baked
# in but inert unless explicitly turned on.
RUN apt-get update && apt-get install -y --no-install-recommends \
        dumb-init \
        openssh-server \
        bash \
        ca-certificates \
        git \
        curl \
        wget \
        jq \
        less \
        vim-tiny \
        procps \
        htop \
        sqlite3 \
        ripgrep \
        lsof \
        iproute2 \
        iputils-ping \
        tree \
        file \
    && ln -sf /usr/bin/vim.tiny /usr/local/bin/vim \
    && mkdir -p /var/run/sshd /root/.ssh \
    && chmod 700 /root/.ssh \
    && rm -rf /var/lib/apt/lists/*

# Interactive-shell niceties for human operators (only fires for login shells;
# agent sessions over non-TTY ssh are unaffected because aliases don't apply).
RUN printf '%s\n' \
    '# Psycheros debug shell — interactive niceties' \
    'if command -v dircolors >/dev/null 2>&1; then eval "$(dircolors -b)"; fi' \
    "alias ls='ls --color=auto'" \
    "alias ll='ls --color=auto -lh'" \
    "alias la='ls --color=auto -lhA'" \
    "alias grep='grep --color=auto'" \
    > /etc/profile.d/psycheros-debug.sh

# Hardened sshd drop-in. The entrypoint sets the listen port at runtime and
# generates / loads host keys from the persistent .psycheros volume so the
# host key fingerprint is stable across container restarts.
RUN printf '%s\n' \
    '# Psycheros debug SSH — runtime-gated, key-only, root login restricted to keys.' \
    'PermitRootLogin prohibit-password' \
    'PasswordAuthentication no' \
    'PermitEmptyPasswords no' \
    'ChallengeResponseAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'PubkeyAuthentication yes' \
    'UsePAM no' \
    'X11Forwarding no' \
    'PrintMotd no' \
    'AuthorizedKeysFile /root/.ssh/authorized_keys' \
    'HostKey /app/Psycheros/.psycheros/ssh/ssh_host_ed25519_key' \
    'HostKey /app/Psycheros/.psycheros/ssh/ssh_host_rsa_key' \
    'LogLevel VERBOSE' \
    'Subsystem sftp internal-sftp' \
    '# Force agent-friendly env into every child session. Required because' \
    "# Dockerfile ENV doesn't propagate through sshd, and AcceptEnv from the" \
    '# client (e.g. macOS sending LANG=en_US.UTF-8) would otherwise win.' \
    '# NOTE: OpenSSH only honors the FIRST SetEnv line at a given scope —' \
    '# all variables must be on one line.' \
    'SetEnv LANG=C.UTF-8 LC_ALL=C.UTF-8 EDITOR=vi PAGER=cat GIT_PAGER=cat MANPAGER=cat' \
    > /etc/ssh/sshd_config.d/psycheros.conf

WORKDIR /app

# Copy application source
COPY Psycheros/ ./Psycheros/
COPY entity-core/ ./entity-core/

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Drop the agent orientation brief into root's home so an AI agent that
# connects via SSH can `cat ~/AGENT_BRIEF.md` for layout, process model,
# and rules of engagement before doing anything.
RUN cp /app/Psycheros/scripts/AGENT_BRIEF.md /root/AGENT_BRIEF.md

# Enable nodeModulesDir + vendor in both projects (Docker only, not in source repos).
# nodeModulesDir: npm packages go to local node_modules/ instead of /deno-dir
# vendor: JSR/remote modules go to local vendor/ instead of /deno-dir
# The global /deno-dir cache is unreliable in CI-built images.
RUN cd /app/Psycheros && deno eval "\
    const j = JSON.parse(Deno.readTextFileSync('deno.json')); \
    j.nodeModulesDir = 'auto'; j.vendor = true; \
    Deno.writeTextFileSync('deno.json', JSON.stringify(j, null, 2) + '\n');" \
    && cd /app/entity-core && deno eval "\
    const j = JSON.parse(Deno.readTextFileSync('deno.json')); \
    j.nodeModulesDir = 'auto'; j.vendor = true; \
    Deno.writeTextFileSync('deno.json', JSON.stringify(j, null, 2) + '\n');"

# Install all dependencies into local node_modules/ directories
RUN cd /app/Psycheros && deno install --entrypoint src/main.ts \
    && cd /app/entity-core && deno install --entrypoint src/mod.ts

# Cache dynamic imports that deno install can't statically analyze
RUN cd /app/Psycheros && deno cache npm:@huggingface/transformers@3.3.1

# Warm-start both apps to cache any remaining transitive JSR deps
# (e.g. @denosaurs/plug → @std/path@0.217.0 pulled by @db/sqlite)
RUN cd /app/entity-core && timeout 5s deno run -A --unstable-cron src/mod.ts || true
RUN cd /app/Psycheros && timeout 10s deno run -A --unstable-cron src/main.ts || true

# Create volume-mounted directories (will be overlaid by volume mounts)
# Note: /app/Psycheros/memories is NOT listed here — the entrypoint symlinks
# it to /app/entity-core/data/memories so both systems share one physical copy.
RUN mkdir -p \
    /app/Psycheros/.snapshots \
    /app/Psycheros/.psycheros/backgrounds \
    /app/Psycheros/.psycheros/vault \
    /app/entity-core/data

EXPOSE 3000

# Debug SSH (only reachable when PSYCHEROS_SSH_ENABLED=true and the host maps
# the port). Default is an obscure high port to avoid collision with anything
# operators may already run; can be overridden with PSYCHEROS_SSH_PORT.
EXPOSE 47291

# Default environment — MCP wired up for single-container layout
# Force UTC to prevent local-time Date methods from drifting
ENV TZ=UTC

# Shell environment defaults. Tuned for AI-agent debug sessions: predictable
# UTF-8, no pagers (which would hang a non-TTY ssh session), sensible editor.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    EDITOR=vi \
    PAGER=cat \
    GIT_PAGER=cat \
    MANPAGER=cat

ENV PSYCHEROS_HOST=0.0.0.0
ENV PSYCHEROS_PORT=3000
ENV PSYCHEROS_MCP_ENABLED=true
ENV PSYCHEROS_MCP_COMMAND=deno
ENV PSYCHEROS_MCP_ARGS="run -A --cached-only --unstable-cron /app/entity-core/src/mod.ts"
ENV PSYCHEROS_ENTITY_CORE_DATA_DIR=/app/entity-core/data

# Debug SSH defaults — disabled unless explicitly enabled at runtime.
ENV PSYCHEROS_SSH_ENABLED=false
ENV PSYCHEROS_SSH_PORT=47291

# Health check (start-period accounts for embedding model load time)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD deno eval "const r = await fetch('http://localhost:3000/health'); if (!r.ok) Deno.exit(1);"

# Set working directory to Psycheros so Deno.cwd() resolves static files correctly
WORKDIR /app/Psycheros

# Entrypoint seeds identity templates, then execs into dumb-init → deno
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["deno", "run", "-A", "--cached-only", "--unstable-cron", "/app/Psycheros/src/main.ts"]
