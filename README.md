# Franzia Keeper Draft App

A web app for running the Franzia 12-team fantasy football keeper draft, including keeper setup, mock drafts, commissioner tools, Fleaflicker sync, and a PostgreSQL-backed production mode.

## What Is Included

- React/Vite draft room frontend
- Express backend API
- Socket.IO live draft updates
- Keeper-cost engine
- Seeded 12-team league data
- Draft board with keeper slots
- Available player search and position filters
- Account registration, login, sessions, and granular permissions
- Commissioner tools for setup, imports, account management, draft controls, exports, and audit history
- PostgreSQL persistence for teams, users, sessions, players, drafts, keepers, picks, audit events, sync runs, and player matching decisions
- Fleaflicker roster and traded-pick sync
- Per-user mock draft boards
- Private per-user mock draft simulator with controlled teams, strategy, randomness, and auto-pick controls
- Docker Compose for local or NAS deployment

## League Rules In The Scaffold

- Linear draft order
- 12 teams
- 19 rounds
- Last year's Round 1 and Round 2 picks cannot be kept
- Drafted players cost two rounds earlier than last year
- Undrafted end-of-season roster players cost Round 10
- Keeper rights belong to the team with the player at season end
- No keeper limit

## Storage, Accounts, And Permissions

The backend supports two storage modes:

- `memory`: used when `DATABASE_URL` is not configured or PostgreSQL is unavailable. This keeps the draft room usable with seeded demo data, but account login, imports, keeper saves, Fleaflicker sync, audit history, and most commissioner tools are disabled.
- `postgres`: used when `DATABASE_URL` connects successfully. The backend applies `database/schema.sql`, stores all draft data persistently, enables accounts and permissions, and unlocks the full commissioner workflow.

Accounts are stored in PostgreSQL. Users can self-register, and the first self-registered account receives commissioner permissions if no seeded accounts exist yet. The app also seeds known league accounts when teams are present, including Dom as commissioner and Derek/Mitch with the delegated commissioner rights currently used by the app.

Available permissions include:

- `commissioner_admin`
- `manage_draft`
- `manage_keepers`
- `manage_rankings`
- `sync_fleaflicker`
- `view_audit_log`

`commissioner_admin` is treated as an override for permission checks. Draft actions in real draft mode require the team on the clock or draft-management rights. Mock draft mode is scoped per logged-in user so each account gets its own private mock board.

In Mock Draft mode, each user can enable a private Draft Simulator. Simulator settings are scoped by draft season and user, default controlled teams to the user’s fantasy team, and let the user choose additional controlled teams, an auto-pick strategy, and randomness. Auto-picked teams use imported player rankings, roster needs, keepers, traded-pick ownership, strategy boosts, and bounded randomness. Simulator writes only to the user’s private mock board and does not affect the shared Real Draft board.

## Fleaflicker Sync

When PostgreSQL is connected and the user has `sync_fleaflicker`, the Commissioner setup tools can pull data from Fleaflicker:

- End-of-season rosters for keeper rights
- Traded draft picks for the target draft season
- A setup sync that combines rosters, traded picks, and seeded prior-year draft results

Sync runs are recorded in `fleaflicker_sync_runs`, and player-name conflicts can be reviewed through the player matching tools. Fleaflicker team and owner mappings currently live in `backend/src/postgresStore.js`.

## Frontend Architecture

The React app is organized by feature under `frontend/src`:

- `App.jsx`: top-level draft-room orchestration, socket connection, page routing, and shared state.
- `features/auth`: login, registration, password setup, and logout UI.
- `features/draftBoard`: player pool, draft status band, draft board cells, and mock reset placement.
- `features/keepers`: keeper selection workflow and keeper value display.
- `features/commissioner`: imports, Fleaflicker sync panels, player matching, draft controls, account admin, and audit log panels.
- `features/exports`: CSV/ZIP export helpers and backup download panels.
- `shared`: app constants, reusable layout components, and small UI/domain helpers.

## Local Development

Install dependencies in each app:

```powershell
cd backend
npm install
npm run dev
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## Docker Deployment

This project includes a production Docker setup for a NAS or Portainer deployment:

- `postgres`: PostgreSQL 16 with a persistent named volume
- `backend`: Node/Express API on port `4000`
- `frontend`: Nginx serving the Vite build on port `8088`
- Shared Docker network: `fantasy-draft-network`

The frontend container proxies `/api`, `/health`, and `/socket.io` to the backend over Docker networking. In production, the browser only needs to reach the frontend URL.

### 1. Create Environment File

From the project root:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and change `POSTGRES_PASSWORD`. Keep `DATABASE_URL` in sync with the same password.

For Nginx Proxy Manager later, set `CLIENT_ORIGIN` to the public URL you will use, for example:

```text
CLIENT_ORIGIN=https://draft.your-domain.com
```

Leave `VITE_API_BASE_URL` blank for Docker production. That makes the frontend use same-origin API calls through Nginx.

### 2. Build Containers

```powershell
docker compose build
```

### 3. Start Containers

```powershell
docker compose up -d
```

Open:

```text
http://localhost:8088
```

On the NAS, replace `localhost` with the NAS IP address:

```text
http://NAS-IP:8088
```

### 4. Stop Containers

```powershell
docker compose down
```

This stops the app but keeps the PostgreSQL named volume.

If PostgreSQL failed during first-time initialization because the init SQL file was mounted incorrectly, remove the failed database volume before redeploying. PostgreSQL only runs files in `/docker-entrypoint-initdb.d` the first time it creates the database directory.

```powershell
docker compose down
docker volume rm fantasy-draft-postgres-data
docker compose up -d
```

Only remove this volume when you are intentionally wiping a failed or test database. Back up production data before removing any PostgreSQL volume.

### 5. View Logs

```powershell
docker compose logs -f frontend
docker compose logs -f backend
docker compose logs -f postgres
```

### 6. Test Health Endpoint

Through the frontend/Nginx container:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8088/health
```

Directly against the backend troubleshooting port:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4000/health
```

Expected response includes:

```json
{"ok":true}
```

### 7. Back Up PostgreSQL

Create a `backups` folder first if needed:

```powershell
New-Item -ItemType Directory -Force backups
```

Create a compressed custom-format backup inside the database container, then copy it to the project `backups` folder:

```powershell
docker compose exec -T postgres pg_dump -U draft -d fantasy_draft -Fc -f /tmp/fantasy_draft.dump
docker cp fantasy-draft-db:/tmp/fantasy_draft.dump backups\fantasy_draft.dump
```

For a dated backup:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
docker compose exec -T postgres pg_dump -U draft -d fantasy_draft -Fc -f /tmp/fantasy_draft.dump
docker cp fantasy-draft-db:/tmp/fantasy_draft.dump "backups\fantasy_draft-$stamp.dump"
```

### 8. Restore PostgreSQL

Stop the app containers that write to the database:

```powershell
docker compose stop backend frontend
```

Restore into the existing database:

```powershell
docker cp backups\fantasy_draft.dump fantasy-draft-db:/tmp/restore.dump
docker compose exec -T postgres pg_restore -U draft -d fantasy_draft --clean --if-exists /tmp/restore.dump
```

Start the app again:

```powershell
docker compose up -d
```

### 9. Portainer Notes

In Portainer, create a stack from this repository folder or paste the `docker-compose.yml` contents. Add the `.env` values in Portainer's environment section. Do not expose PostgreSQL publicly unless you specifically need external database access.

### 10. Nginx Proxy Manager Notes

When you add Nginx Proxy Manager later, point the proxy host to:

```text
http://fantasy-draft-frontend:80
```

If Nginx Proxy Manager is on a different Docker network, either attach it to `fantasy-draft-network` or proxy to the NAS IP and port `8088`.

## Commissioner Imports

The Commissioner tools are available to logged-in users with the relevant permissions. Imports are enabled when the backend can connect to PostgreSQL and the user can manage rankings.

Recommended import order:

1. `database/samples/teams.csv`
2. `database/samples/players.csv`
3. `database/samples/last-year-draft.csv`
4. `database/samples/rosters.csv`
5. `database/samples/keepers.csv`
6. `database/samples/traded-picks.csv`

Supported CSV headers:

- Teams: `name,ownerName,slug`
- Player pool: `rank,name,position,nflTeam,byeWeek`
- Last year draft: `round,pickNumber,teamName,playerName,position,nflTeam`
- Headerless draft round import: one row per round with team columns in league draft order
- End rosters: `teamName,playerName,position,nflTeam`
- Selected keepers: `teamName,playerName,round`
- Traded picks: `round,originalTeam,currentOwner`

If `DATABASE_URL` is not configured or Postgres is not running, the app stays usable with demo memory data but upload buttons, account tools, and persistent keeper/draft changes are disabled.

## Tests

Focused backend tests use Node's built-in test runner:

```powershell
cd backend
npm test
```

The current tests cover keeper rules, in-memory draft pick mutation, permission helpers, mock draft scoping helpers, and draft simulator scoring behavior.

## Local Development Notes

The Docker setup does not replace the local dev workflow. These commands still work:

```powershell
cd backend
npm install
npm run dev
```

```powershell
cd frontend
npm install
npm run dev
```

Local dev frontend defaults to `http://localhost:4000` for API calls when `VITE_API_BASE_URL` is unset.
