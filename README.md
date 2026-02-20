# Fedi+

**Google+ reborn on the Fediverse.**

Fedi+ is a federated social platform that brings back the best features of Google+ — Circles, Communities, Collections, +1 reactions, photo albums, and more — on top of [ActivityPub](https://www.w3.org/TR/activitypub/). It connects to the wider Fediverse (Mastodon, Misskey, etc.) while providing a familiar, accessible experience for anyone who misses what Google+ offered.

## Features

### Implemented

- **Circles** — Organize people into Friends, Family, Acquaintances, Following, or custom circles. Control exactly who sees each post. Circles are local-only and never federate; they resolve to individual ActivityPub actor URIs for delivery.
- **Stream** — A Google+-style home feed with real-time updates via Server-Sent Events. Filter by circle to see only posts from specific groups of people.
- **Posts** — Rich text posts with hashtags, mentions, audience targeting (public, circles, followers-only, direct), content warnings, and edit history.
- **+1 Reactions** — The classic Google+ reaction, federated as ActivityPub Like activities.
- **Comments** — Threaded replies on posts, federated as ActivityPub Note objects with `inReplyTo`.
- **Reshares** — Boost posts to your followers, federated as ActivityPub Announce activities.
- **Communities** — Group actors for topic-based discussion. Public or private, with owner/moderator/member roles and optional post approval.
- **Collections** — Pinterest-style curation of posts into ordered, named collections.
- **Media** — Multi-file upload (up to 50 per post) with automatic image processing (resize, thumbnail generation, blurhash placeholders), alt text support, and photo albums. Local filesystem storage for development; S3-compatible storage for production.
- **Photos** — Dedicated photo gallery page with grid layout, album navigation, and a keyboard-accessible lightbox viewer.
- **Notifications** — Real-time notifications for follows, reactions, comments, mentions, and reshares, delivered via SSE.
- **Federation** — Full ActivityPub support via [Fedify](https://fedify.dev/): WebFinger, NodeInfo, HTTP Signatures, Object Integrity Proofs, Follow/Accept/Reject/Block activities, inbox/outbox.
- **Profiles** — User profiles with display name, bio, cover photo, avatar, custom fields, and follower/post counts.
- **Accessibility** — ARIA live regions for screen reader announcements, semantic HTML, keyboard navigation, skip links, `prefers-reduced-motion` support, dual-mode circle management (drag-and-drop or checkbox list).
- **Dark mode** — System-aware dark/light theme with manual toggle, using CSS custom properties.

### Planned

- **Events** — Create events with RSVP, calendar view, party mode (live event photo stream), and iCal export.
- **Direct Messages** — 1:1 and group messaging with WebSocket delivery.
- **Hangouts** — Video chat via LiveKit WebRTC (up to 10 participants), with screen sharing and text chat.
- **Ripples** — Reshare chain visualization showing how a post spread across the network.
- **Sparks** — Content discovery with trending hashtags and full-text search via Meilisearch.
- **Business Pages** — Service actor type with custom circles, team management, and analytics.
- **Developer Platform** — OAuth2 provider, webhook system, TypeScript SDK, and OpenAPI docs.

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | npm workspaces + Turborepo |
| Backend | TypeScript, Fastify, Drizzle ORM |
| Federation | Fedify (ActivityPub) |
| Frontend | React 19, Next.js 15 (App Router), Radix UI, Zustand |
| Database | PostgreSQL 16 |
| Cache/Queue | Redis 7 + BullMQ |
| Media Storage | Local filesystem (dev) / S3-compatible (prod) |
| Image Processing | Sharp |
| Styling | CSS Modules with custom properties |
| Testing | Vitest + Playwright |

## Project Structure

```
fediplus/
├── packages/
│   ├── shared/       # Shared types, Zod validation, constants
│   ├── backend/      # Fastify API server + Fedify federation
│   ├── frontend/     # Next.js 15 web client
│   └── sdk/          # Developer SDK (coming in Phase 8)
├── docker-compose.yml
├── turbo.json
└── .env.example
```

## Prerequisites

- **Node.js** 20 or later
- **PostgreSQL** 16
- **Redis** 7

## Local Development

### 1. Clone and install

```bash
git clone https://github.com/your-org/fediplus.git
cd fediplus
npm install
```

### 2. Start services

You need PostgreSQL and Redis running. Pick one of:

**Option A: Docker Compose** (if you have Docker)

```bash
docker compose up -d
```

This starts PostgreSQL on port 5432 and Redis on port 6379 with the default credentials from `.env.example`.

**Option B: Install natively**

Install PostgreSQL and Redis using your OS package manager or official installers.

#### PostgreSQL

**Windows:** Download and install from https://www.postgresql.org/download/windows/. During setup, note the password you set for the `postgres` superuser. The installer adds PostgreSQL to your PATH. After installation, open a **new** terminal and run:

```cmd
psql -U postgres -c "CREATE USER fediplus WITH PASSWORD 'fediplus';"
psql -U postgres -c "CREATE DATABASE fediplus OWNER fediplus;"
```

If `psql` is not found, add the PostgreSQL `bin` directory to your PATH (e.g. `C:\Program Files\PostgreSQL\16\bin`).

**Linux:**
```bash
sudo apt install postgresql-16
sudo -u postgres psql -c "CREATE USER fediplus WITH PASSWORD 'fediplus';"
sudo -u postgres psql -c "CREATE DATABASE fediplus OWNER fediplus;"
```

**macOS:**
```bash
brew install postgresql@16
brew services start postgresql@16
psql -U postgres -c "CREATE USER fediplus WITH PASSWORD 'fediplus';"
psql -U postgres -c "CREATE DATABASE fediplus OWNER fediplus;"
```

#### Redis

**Windows:** Use Memurai (https://www.memurai.com/) as a Redis-compatible server, or skip Redis for now — the backend defaults to in-process queues in development.

**Linux:** `sudo apt install redis-server && sudo systemctl start redis`

**macOS:** `brew install redis && brew services start redis`

Media storage uses the local filesystem by default — no extra services needed. If you prefer S3-compatible storage (MinIO, AWS S3, etc.), set `STORAGE_TYPE=s3` in your `.env` and configure the `S3_*` variables.

### 3. Configure environment

**Linux/macOS:**
```bash
cp .env.example .env
```

**Windows (CMD):**
```cmd
copy .env.example .env
```

Edit `.env` if your service credentials or ports differ from the defaults.

### 4. Run database migrations

```bash
npm run db:migrate
```

### 5. Start development servers

```bash
npm run dev
```

This starts:
- **Backend** at `http://localhost:3001` (Fastify API + federation)
- **Frontend** at `http://localhost:3000` (Next.js)

## Production Deployment

### With Docker Compose

For production, you would add the Fedi+ backend and frontend as services to the `docker-compose.yml`, or build them into Docker images. A minimal approach:

1. **Build the project:**
   ```bash
   npm install
   npm run build
   ```

2. **Start infrastructure services:**
   ```bash
   docker compose up -d
   ```

3. **Configure `.env` for production:**
   ```bash
   NODE_ENV=production
   PUBLIC_URL=https://your-domain.com
   JWT_SECRET=generate-a-strong-random-secret
   DATABASE_URL=postgresql://fediplus:strong-password@localhost:5432/fediplus
   STORAGE_TYPE=s3
   S3_ENDPOINT=http://localhost:9000
   S3_ACCESS_KEY=your-minio-access-key
   S3_SECRET_KEY=your-minio-secret-key
   ```

4. **Run migrations and start:**
   ```bash
   npm run db:migrate

   # Backend
   cd packages/backend && node dist/index.js

   # Frontend
   cd packages/frontend && npx next start -p 3000
   ```

5. **Set up a reverse proxy** (nginx, Caddy, etc.) to serve both on your domain with HTTPS. Example nginx config:
   ```nginx
   server {
       listen 443 ssl http2;
       server_name your-domain.com;

       ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

       # Frontend
       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # Backend API and federation endpoints
       location /api/ {
           proxy_pass http://127.0.0.1:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # WebFinger, NodeInfo, ActivityPub
       location /.well-known/ {
           proxy_pass http://127.0.0.1:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # Actor endpoints and inbox/outbox
       location /users/ {
           proxy_pass http://127.0.0.1:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # SSE — disable buffering
       location /api/v1/sse {
           proxy_pass http://127.0.0.1:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_buffering off;
           proxy_cache off;
           proxy_read_timeout 86400s;
       }

       # Media files (proxy to MinIO when using S3 storage)
       location /media/ {
           proxy_pass http://127.0.0.1:9000/fediplus-media/;
       }

       client_max_body_size 50M;
   }
   ```

### Without Docker (native install)

1. **Install services on your VPS:**
   ```bash
   # Ubuntu/Debian example
   sudo apt update
   sudo apt install -y postgresql-16 redis-server

   # Node.js (via nvm or NodeSource)
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs

   # MinIO (optional, only if using S3 storage)
   wget https://dl.min.io/server/minio/release/linux-amd64/minio
   chmod +x minio
   sudo mv minio /usr/local/bin/
   ```

2. **Configure PostgreSQL:**
   ```bash
   sudo -u postgres psql -c "CREATE USER fediplus WITH PASSWORD 'your-strong-password';"
   sudo -u postgres psql -c "CREATE DATABASE fediplus OWNER fediplus;"
   ```

3. **Create systemd services:**

   `/etc/systemd/system/fediplus-backend.service`:
   ```ini
   [Unit]
   Description=Fedi+ Backend
   After=network.target postgresql.service redis.service

   [Service]
   User=fediplus
   WorkingDirectory=/opt/fediplus/packages/backend
   EnvironmentFile=/opt/fediplus/.env
   ExecStart=/usr/bin/node dist/index.js
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

   `/etc/systemd/system/fediplus-frontend.service`:
   ```ini
   [Unit]
   Description=Fedi+ Frontend
   After=network.target fediplus-backend.service

   [Service]
   User=fediplus
   WorkingDirectory=/opt/fediplus/packages/frontend
   EnvironmentFile=/opt/fediplus/.env
   ExecStart=/usr/bin/npx next start -p 3000
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

4. **Deploy:**
   ```bash
   # Clone to /opt/fediplus
   sudo git clone https://github.com/your-org/fediplus.git /opt/fediplus
   cd /opt/fediplus

   # Configure
   sudo cp .env.example .env
   sudo nano .env  # Set production values

   # Install and build
   npm install --production=false
   npm run build

   # Run migrations
   npm run db:migrate

   # Enable and start services
   sudo systemctl daemon-reload
   sudo systemctl enable --now fediplus-backend fediplus-frontend
   ```

5. **Set up a reverse proxy** with nginx or Caddy (see the nginx config above) and configure HTTPS with Let's Encrypt:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` or `production` |
| `HOST` | `localhost` | Backend bind address |
| `PORT` | `3001` | Backend port |
| `PUBLIC_URL` | `http://localhost:3000` | Public-facing URL (used for ActivityPub IDs) |
| `DATABASE_URL` | `postgresql://fediplus:fediplus@localhost:5432/fediplus` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | `change-me-in-production` | Secret for signing JWT tokens |
| `JWT_EXPIRY` | `7d` | JWT token lifetime |
| `STORAGE_TYPE` | `local` | `local` (filesystem) or `s3` (S3-compatible) |
| `STORAGE_LOCAL_PATH` | `./data/media` | Directory for local media storage |
| `S3_ENDPOINT` | `http://localhost:9000` | S3 endpoint (only when `STORAGE_TYPE=s3`) |
| `S3_ACCESS_KEY` | `fediplus` | S3 access key |
| `S3_SECRET_KEY` | `fediplus-secret` | S3 secret key |
| `S3_BUCKET` | `fediplus-media` | S3 bucket name |
| `S3_REGION` | `us-east-1` | S3 region |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API URL for the frontend |
| `NEXT_PUBLIC_SITE_NAME` | `Fedi+` | Site name shown in the UI |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start all dev servers (backend + frontend) |
| `npm run build` | Build all packages |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run db:generate` | Generate a new Drizzle migration |
| `npm run db:migrate` | Apply pending migrations |

## Federation

Fedi+ speaks ActivityPub and is compatible with Mastodon, Misskey, Pleroma, and other Fediverse software. Key endpoints:

- `/.well-known/webfinger` — WebFinger discovery
- `/.well-known/nodeinfo` — NodeInfo
- `/users/{username}` — Actor profile (Accept: `application/activity+json`)
- `/users/{username}/inbox` — Inbox
- `/users/{username}/outbox` — Outbox

## License

TBD
