CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  nfl_team TEXT NOT NULL,
  bye_week INTEGER,
  rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  season INTEGER NOT NULL,
  round_count INTEGER NOT NULL DEFAULT 19,
  status TEXT NOT NULL DEFAULT 'setup',
  keeper_lock_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS keeper_lock_deadline TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS last_year_draft_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  drafted_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  pick_number INTEGER,
  UNIQUE (draft_id, player_id)
);

ALTER TABLE last_year_draft_results ALTER COLUMN drafted_team_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS end_of_year_rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE (draft_id, player_id)
);

CREATE TABLE IF NOT EXISTS draft_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  pick_number INTEGER NOT NULL,
  original_team_id UUID NOT NULL REFERENCES teams(id),
  current_owner_team_id UUID NOT NULL REFERENCES teams(id),
  player_id UUID REFERENCES players(id),
  pick_type TEXT NOT NULL DEFAULT 'open',
  UNIQUE (draft_id, pick_number)
);

CREATE TABLE IF NOT EXISTS mock_draft_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  lobby_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  mock_user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  source_pick_id UUID NOT NULL REFERENCES draft_picks(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id),
  pick_type TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, lobby_team_id, source_pick_id)
);

CREATE TABLE IF NOT EXISTS selected_keepers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  assigned_round INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'selected',
  UNIQUE (draft_id, player_id)
);

CREATE TABLE IF NOT EXISTS draft_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  actor_team_id UUID REFERENCES teams(id),
  actor_label TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE draft_events ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE draft_events ADD COLUMN IF NOT EXISTS actor_team_id UUID REFERENCES teams(id);
ALTER TABLE draft_events ADD COLUMN IF NOT EXISTS actor_label TEXT;

CREATE TABLE IF NOT EXISTS simulator_settings (
  draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  controlled_team_ids JSONB NOT NULL DEFAULT '[]',
  strategy TEXT NOT NULL DEFAULT 'balanced',
  team_strategies JSONB NOT NULL DEFAULT '{}',
  randomness TEXT NOT NULL DEFAULT 'medium',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, user_id)
);

ALTER TABLE simulator_settings ADD COLUMN IF NOT EXISTS team_strategies JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS fleaflicker_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  result JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  actor_team_id UUID REFERENCES teams(id),
  actor_label TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fleaflicker_sync_runs ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS player_match_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name TEXT NOT NULL,
  player_id_set TEXT NOT NULL,
  decision TEXT NOT NULL,
  target_player_id UUID REFERENCES players(id),
  source_player_ids JSONB NOT NULL DEFAULT '[]',
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  actor_team_id UUID REFERENCES teams(id),
  actor_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_name, player_id_set)
);

ALTER TABLE player_match_decisions ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE mock_draft_picks ADD COLUMN IF NOT EXISTS mock_user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;
ALTER TABLE mock_draft_picks ALTER COLUMN lobby_team_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_team ON app_users (team_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_permission ON user_permissions (permission);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_draft_picks_draft_round ON draft_picks (draft_id, round);
CREATE INDEX IF NOT EXISTS idx_mock_draft_picks_lobby ON mock_draft_picks (draft_id, lobby_team_id);
CREATE INDEX IF NOT EXISTS idx_mock_draft_picks_user ON mock_draft_picks (draft_id, mock_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mock_draft_picks_user_source ON mock_draft_picks (draft_id, mock_user_id, source_pick_id) WHERE mock_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_players_position_rank ON players (position, rank);
CREATE INDEX IF NOT EXISTS idx_draft_events_draft_created ON draft_events (draft_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulator_settings_user ON simulator_settings (user_id, draft_id);
CREATE INDEX IF NOT EXISTS idx_fleaflicker_sync_runs_draft_type ON fleaflicker_sync_runs (draft_id, sync_type, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_match_decisions_name ON player_match_decisions (normalized_name, decision);
