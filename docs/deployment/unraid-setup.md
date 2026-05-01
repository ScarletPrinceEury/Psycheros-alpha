# UnRAID Setup

## Prerequisites

- UnRAID with Docker enabled
- GHCR access configured (PAT for pulling from private registry)
- Authelia + reverse proxy already in place

## Quick Start (Docker CLI)

```bash
docker run -d \
  --name psycheros \
  --restart unless-stopped \
  -p 3000:3000 \
  -e ZAI_API_KEY=<your-key> \
  -e TZ=America/Los_Angeles \
  -v /mnt/user/appdata/psycheros/entity-core-data:/app/entity-core/data \
  -v /mnt/user/appdata/psycheros/db:/app/Psycheros/.psycheros \
  -v /mnt/user/appdata/psycheros/snapshots:/app/Psycheros/.snapshots \
  ghcr.io/zarilewis/psycheros:latest
```

That's it. On first run, the entrypoint script seeds identity templates into entity-core's data directory automatically.

## UnRAID "Add Container" UI

Step-by-step for the Docker tab → Add Container form:

| Field | Value |
|-------|-------|
| **Name** | `psycheros` |
| **Repository** | `ghcr.io/zarilewis/psycheros:latest` |
| **Registry URL** | `https://ghcr.io` |
| **Network Type** | Bridge |
| **Extra Parameters** | `--restart unless-stopped` |

### Port Mapping

| Container Port | Host Port | Protocol |
|---------------|-----------|----------|
| 3000 | 3000 | TCP |

### Environment Variables

| Name | Value | Notes |
|------|-------|-------|
| `ZAI_API_KEY` | _(your key)_ | **Required** — Z.ai API key |
| `TZ` | `America/Los_Angeles` | Timezone for memory timestamps |

All MCP-related variables are pre-configured in the image — do not set them unless you need to override the defaults.

### Volume Mappings (Paths)

| Container Path | Host Path | Access |
|---------------|-----------|--------|
| `/app/entity-core/data` | `/mnt/user/appdata/psycheros/entity-core-data` | Read/Write |
| `/app/Psycheros/.psycheros` | `/mnt/user/appdata/psycheros/db` | Read/Write |
| `/app/Psycheros/.snapshots` | `/mnt/user/appdata/psycheros/snapshots` | Read/Write |

**What's in each volume:**
- **entity-core-data** — The entity's canonical identity, memories, and knowledge graph. This is the most important volume. On first run, it's seeded with default identity templates.
- **db** — Conversation history, RAG search index, vault documents, chat attachments, generated images, and all settings. Losing this means losing chat history and vault data (but memories are safe in entity-core-data).
- **snapshots** — Identity file backups. Nice to have but not critical.

## First Run

1. Create the container with the settings above
2. Start it — the entrypoint script will log:
   ```
   [Entrypoint] Seeded self/ with 5 template file(s)
   [Entrypoint] Seeded user/ with 6 template file(s)
   [Entrypoint] Seeded relationship/ with 3 template file(s)
   ```
3. Wait ~30 seconds for the embedding model to load from cache
4. Access via `http://<unraid-ip>:3000` (or through your reverse proxy)

On subsequent starts, the entrypoint detects existing files and skips seeding.

## Health Check

The image includes a built-in Docker HEALTHCHECK. UnRAID shows health status in the Docker tab. You can also verify manually:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Reverse Proxy

Add to your reverse proxy config (nginx/Caddy/Traefik):
- External domain: e.g., `psycheros.yourdomain.com`
- Proxy to: `http://psycheros:3000`
- Authelia middleware: standard protection

### SSE Considerations

Psycheros uses Server-Sent Events for streaming. Reverse proxy must:
- Not buffer responses (`proxy_buffering off` in nginx)
- Support long-lived connections
- Pass through `Content-Type: text/event-stream`

Example nginx snippet:
```nginx
location / {
    proxy_pass http://psycheros:3000;
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding off;
}
```

## Updating

```bash
docker pull ghcr.io/zarilewis/psycheros:latest
docker stop psycheros
docker rm psycheros
# Re-create with the same docker run command (volumes persist)
```

Or in UnRAID: click the container → Update.

## Backup Strategy

Back up `/mnt/user/appdata/psycheros/` — all three subdirectories.

Priority:
1. **entity-core-data/** — the entity's identity and memories (irreplaceable)
2. **db/** — conversation history, vault documents, generated images, settings (large, but memories are safe in entity-core-data)
3. **snapshots/** — identity backups (redundant if entity-core-data is backed up)
