# Franzia Keeper Draft App

A starter web app for a 12-team fantasy football keeper draft.

## What Is Included

- React/Vite draft room frontend
- Express backend API
- Socket.IO live draft updates
- Keeper-cost engine
- Seeded 12-team league data
- Draft board with keeper slots
- Available player search and position filters
- Commissioner undo endpoint
- PostgreSQL schema for the full persistent version
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

The Commissioner panel appears above the draft board. Imports are enabled when the backend can connect to PostgreSQL.

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
- End rosters: `teamName,playerName,position,nflTeam`
- Selected keepers: `teamName,playerName,round`
- Traded picks: `round,originalTeam,currentOwner`

If `DATABASE_URL` is not configured or Postgres is not running, the app stays usable with demo memory data but upload buttons are disabled.

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
