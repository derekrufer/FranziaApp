# Database Notes

The app can run with either an in-memory demo store or PostgreSQL.

## Storage Modes

- Without `DATABASE_URL`, the backend uses seeded in-memory data so the draft room can be opened quickly.
- With `DATABASE_URL`, the backend runs `schema.sql`, connects to PostgreSQL, and enables persistent league setup, accounts, imports, keeper saves, draft picks, audit history, Fleaflicker sync history, and exports.

The Docker stack mounts `schema.sql` into the Postgres init directory for first-time database creation. The backend also calls the schema during startup through `ensureSchema()`, so new `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE`, and index additions can be applied to an existing database.

## Core Tables

- `teams`: league teams and owners.
- `app_users`, `user_permissions`, `user_sessions`: authentication, granular rights, and bearer sessions.
- `players`: current player pool and rankings.
- `drafts`: draft season, round count, mode/status, and keeper lock deadline.
- `last_year_draft_results`: prior-year draft source used for keeper costs.
- `end_of_year_rosters`: keeper rights by end-of-season team.
- `draft_picks`: real draft board, including original team and current pick owner for traded picks.
- `mock_draft_picks`: per-user mock draft boards scoped by `mock_user_id`, including keeper pick copies from the real board.
- `simulator_settings`: per-user, per-season mock draft simulator settings, including enabled state, controlled teams, default strategy, per-team strategy overrides, and randomness.
- `selected_keepers`: saved keeper choices and assigned rounds.
- `draft_events`: audit log for admin and draft actions.
- `fleaflicker_sync_runs`: Fleaflicker sync status, results, errors, and actor metadata.
- `player_match_decisions`: approved/rejected player matching decisions for imported/Fleaflicker data.

Keeper rules represented by the schema:

- Last year's Round 1 and Round 2 picks are not keeper eligible.
- Drafted players cost two rounds earlier than last year.
- Undrafted end-of-season roster players cost Round 10.
- Keeper rights belong to the team holding the player at season end.
- Pick ownership lives on `draft_picks.current_owner_team_id`, which allows traded picks.

## Setup Data Flow

The Commissioner setup workflow can populate PostgreSQL from CSV files or Fleaflicker:

1. Import or sync teams.
2. Import or sync the player/rankings pool.
3. Import prior-year draft results, including the headerless draft-round format.
4. Import or sync end-of-season rosters.
5. Import or sync traded picks.
6. Select keepers.
7. Rebuild keeper picks or draft order when setup data changes.

The backend computes keeper options from `players`, `last_year_draft_results`, and `end_of_year_rosters`, then places saved keepers onto `draft_picks`.

Private mock draft simulator actions write to `mock_draft_picks` for the logged-in user only. The simulator uses the same draft order, keeper placements, traded-pick ownership, and imported player rankings as the rest of the draft room, while `draft_picks` remains the shared real draft board.

## Accounts And Rights

Accounts are PostgreSQL-only. Seeded and self-registered users are stored in `app_users`, password hashes use Node's `crypto.scrypt`, active sessions are stored in `user_sessions`, and permissions live in `user_permissions`.

Supported permissions are:

- `commissioner_admin`
- `manage_draft`
- `manage_keepers`
- `manage_rankings`
- `sync_fleaflicker`
- `view_audit_log`

`commissioner_admin` grants all permission checks. Derek and Mitch have intentional delegated commissioner rights in the current seed data, and Dom has commissioner rights.

## Fleaflicker State

Fleaflicker roster and traded-pick sync require PostgreSQL and `sync_fleaflicker`. Each sync writes a row to `fleaflicker_sync_runs`; player-name conflicts can be resolved through `player_match_decisions`.
