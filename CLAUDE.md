# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `src/ops-commands.ts` | Fast ops commands (/help, /status, /memory, /disk, /logs, /processes, /health) |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/` | Skills loaded inside agent containers (browser, status, formatting) |

## Skills

Four types of skills exist in NanoClaw. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full taxonomy and guidelines.

- **Feature skills** — merge a `skill/*` branch to add capabilities (e.g. `/add-telegram`, `/add-slack`)
- **Utility skills** — ship code files alongside SKILL.md (e.g. `/claw`)
- **Operational skills** — instruction-only workflows, always on `main` (e.g. `/setup`, `/debug`)
- **Container skills** — loaded inside agent containers at runtime (`container/skills/`)

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Contributing

Before creating a PR, adding a skill, or preparing any contribution, you MUST read [CONTRIBUTING.md](CONTRIBUTING.md). It covers accepted change types, the four skill types and their guidelines, SKILL.md format rules, PR requirements, and the pre-submission checklist (searching for existing PRs/issues, testing, description format).

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Memory Management

Three-layer memory architecture ensures no learnings are lost:

**Layer 1: Auto Memory** (Automatic, continuous)
- Location: `~/.claude/projects/-Users-clawdia-nanoclaw/memory/`
- Triggered: Every ~5K tokens (Claude Code writes continuously)
- Captures: Learnings, patterns, decisions from development sessions
- Persistence: Session-local (stays on disk until deleted)

**Layer 2: PreCompact Hooks** (Automatic, at compression)
- Trigger: Before `/compact` (manual or automatic at ~80% context)
- Captures: Full memory state snapshot before context compression
- Location: `.claude/pre-compact-backups/` in repo
- Purpose: Insurance against losing insights just before compression

**Layer 3: Checkpoint** (Manual, explicit versioning)
- Trigger: `./cp "message"` (you decide when to save)
- Captures: Memory snapshot + code + git commit
- Location: `.claude/memory-backups/` in repo (committed to git)
- Persistence: GitHub (durable, long-term backup)

**Quick commands:**
```bash
./cp "feat: add new feature"  # Layer 3: Backs up memory + commits + pushes
./scripts/restore-memory.sh   # Restore on new machine
./scripts/init-memory.sh      # Initialize memory for new sessions
```

See `docs/MEMORY-MANAGEMENT.md` for complete workflow details.

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate skill, not bundled in core. Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`) to install it. Existing auth credentials and groups are preserved.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.

## Ops Commands (Spec 61)

Fast, non-LLM commands for system monitoring. These execute instantly without loading the model:

- `/help` — List all ops commands
- `/status` — Service health (PostgreSQL, Ollama, NanoClaw, RSS daemon)
- `/memory` — Memory breakdown (free, active, inactive, compressed, pressure)
- `/disk` — Disk usage by volume
- `/logs` — Last 30 lines of NanoClaw container logs
- `/processes` — Top 10 processes by memory usage
- `/health` — Full system diagnostic (status + memory + disk)

These bypass the trigger requirement and agent container execution. Implemented in `src/ops-commands.ts`, executed directly by the main process.

## Podman Container Execution

NanoClaw uses Podman with virtio-fs shared directory mounts for agent container execution. Key considerations:

- **Container image:** Uses `localhost/nanoclaw-agent:latest` (local build, not Docker Hub)
- **Mount paths:** `/Users/clawdia/nanoclaw` shared from macOS to Podman machine via virtio-fs
- **Hybrid LLM:** Local `gemma2:2b` (ollama) with Haiku API fallback via credential proxy
- **Watchdog:** Monitors Podman mount health, container image availability, and NanoClaw process

If Podman mounts fail (virtio-fs disconnection), the watchdog will restart the machine and rebuild the container image. See `scripts/watchdog.sh` checks 8–9.
