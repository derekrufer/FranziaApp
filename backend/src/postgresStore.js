import { getKeeperCost, getKeeperOptimizerFields, validateKeeperSelections } from "./keeperEngine.js";
import { chooseSimulatorPlayer, createSimulationSeed, createTeamPreferences } from "./simulatorEngine.js";
import { numberOrNull, parseCsv, parseCsvRows, pick } from "./csv.js";
import { getDatabaseStatus, withDb } from "./db.js";
import { getMockBoardUserId } from "./mockDraftScope.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { promisify } from "node:util";

const DEFAULT_DRAFT = {
  name: "Franzia Keeper Draft",
  season: 2026,
  roundCount: 19
};
const SEEDED_LEGACY_DRAFT_SEASON = 2026;
const SEEDED_LEGACY_DRAFT_SOURCE = "box-wine-league-2025.csv";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSWORD_ITERATIONS = 210000;
const PASSWORD_KEY_LENGTH = 32;
const SESSION_DAYS = 14;
const pbkdf2 = promisify(crypto.pbkdf2);

const AUDIT_LOG_EVENT_TYPES = [
  "first_account_created",
  "account_registered",
  "account_created",
  "keepers_changed",
  "rankings_uploaded",
  "legacy_draft_uploaded",
  "fleaflicker_rosters_synced",
  "fleaflicker_traded_picks_synced",
  "draft_finalized",
  "keeper_deadline_updated",
  "pick_edited",
  "draft_mode_updated"
];

const FLEAFLICKER_TEAM_ID_TO_LOCAL_NAME = new Map([
  [1140832, "Derek"],
  [1173515, "Nick"],
  [1140860, "Dom"],
  [1446548, "Bump"],
  [1668560, "Hunter"],
  [1185977, "Jeremy"],
  [1140819, "Lance"],
  [1446260, "Jared"],
  [1668648, "Eric"],
  [1140858, "Mitch"],
  [1173530, "Kevin"],
  [1140847, "Tyler"]
]);

const LEGACY_2025_DRAFT_COLUMN_TEAMS = [
  "Bump",
  "Nick",
  "Dom",
  "Jared",
  "Lance",
  "Mitch",
  "Kevin",
  "Jeremy",
  "Derek",
  "Hunter",
  "Eric",
  "Tyler"
];

const INITIAL_ACCOUNT_SEEDS = [
  {
    displayName: "Tyler",
    email: "tpickner@asbsd.org",
    teamName: "Tyler",
    permissions: []
  },
  {
    displayName: "Derek",
    email: "derekrufer@gmail.com",
    teamName: "Derek",
    permissions: ["commissioner_admin", "sync_fleaflicker", "manage_rankings", "manage_keepers", "manage_draft", "view_audit_log"]
  },
  {
    displayName: "Mitch",
    email: "mitchellrufer15@gmail.com",
    teamName: "Mitch",
    permissions: ["sync_fleaflicker", "manage_rankings", "manage_keepers", "manage_draft", "view_audit_log"]
  },
  {
    displayName: "Dom",
    email: "domrad07@gmail.com",
    teamName: "Dom",
    permissions: ["commissioner_admin", "sync_fleaflicker", "manage_rankings", "manage_keepers", "manage_draft", "view_audit_log"]
  }
];

const COMMISSIONER_PERMISSIONS = [
  "commissioner_admin",
  "manage_draft",
  "manage_keepers",
  "manage_rankings",
  "sync_fleaflicker",
  "view_audit_log"
];

const FLEAFLICKER_OWNER_TO_LOCAL_NAME = new Map([
  ["drufer", "Derek"],
  ["nsime", "Nick"],
  ["dominic4 3", "Dom"],
  ["bump2023", "Bump"],
  ["hp78", "Hunter"],
  ["jcjohnson", "Jeremy"],
  ["lswens", "Lance"],
  ["jaredberg", "Jared"],
  ["peschong", "Eric"],
  ["sttf sky daddy", "Mitch"],
  ["strick5", "Kevin"],
  ["tpickner", "Tyler"]
]);

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toCamelPlayer(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    position: row.position,
    nflTeam: row.nfl_team,
    byeWeek: row.bye_week,
    rank: row.rank,
    lastYearDraftRound: row.last_year_draft_round,
    originalDraftTeamId: row.original_draft_team_id,
    endOfSeasonTeamId: row.end_of_season_team_id
  };
}

function toCamelTeam(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ownerName: row.owner_name
  };
}

function basePosition(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized.startsWith("DST") || normalized.startsWith("D/ST") || normalized.startsWith("DEF")) {
    return "DST";
  }

  const match = normalized.match(/^(QB|RB|WR|TE|K)/);
  return match?.[1] ?? (normalized || "UNK");
}

async function getOrCreateDraft(client, season = DEFAULT_DRAFT.season) {
  const draftSeason = Number(season || DEFAULT_DRAFT.season);
  const existing = await client.query("SELECT * FROM drafts WHERE season = $1 ORDER BY created_at LIMIT 1", [draftSeason]);
  if (existing.rows[0]) {
    if (existing.rows[0].round_count < DEFAULT_DRAFT.roundCount) {
      const updated = await client.query(
        "UPDATE drafts SET round_count = $1 WHERE id = $2 RETURNING *",
        [DEFAULT_DRAFT.roundCount, existing.rows[0].id]
      );
      return updated.rows[0];
    }
    return existing.rows[0];
  }

  const inserted = await client.query(
    `INSERT INTO drafts (name, season, round_count, status)
     VALUES ($1, $2, $3, 'setup')
     RETURNING *`,
    [`${DEFAULT_DRAFT.name} ${draftSeason}`, draftSeason, DEFAULT_DRAFT.roundCount]
  );
  return inserted.rows[0];
}

function cleanAuditActor(actor = {}) {
  const actorTeamId = UUID_PATTERN.test(String(actor.actorTeamId ?? ""))
    ? actor.actorTeamId
    : null;
  const actorUserId = UUID_PATTERN.test(String(actor.actorUserId ?? ""))
    ? actor.actorUserId
    : null;
  const actorLabel = String(actor.actorLabel ?? "").trim() || (actorTeamId ? null : "Unknown");
  return { actorTeamId, actorUserId, actorLabel, isCommissioner: Boolean(actor.isCommissioner) };
}

async function resolveAuditActor(client, actor = {}) {
  const auditActor = cleanAuditActor(actor);
  let actorTeamId = auditActor.actorTeamId;
  let actorUserId = auditActor.actorUserId;
  let actorLabel = auditActor.actorLabel;

  if (actorUserId) {
    const user = await client.query(
      `SELECT u.id, u.display_name, u.email, u.team_id, t.id AS team_id
       FROM app_users u
       LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.id = $1`,
      [actorUserId]
    );
    if (user.rows[0]) {
      actorTeamId = actorTeamId ?? user.rows[0].team_id ?? null;
      actorLabel = actorLabel || user.rows[0].display_name || user.rows[0].email || "Unknown";
    } else {
      actorUserId = null;
    }
  }

  if (actorTeamId) {
    const team = await client.query("SELECT id FROM teams WHERE id = $1", [actorTeamId]);
    if (!team.rows[0]) {
      actorTeamId = null;
    }
  }

  return {
    actorTeamId,
    actorUserId,
    actorLabel: actorLabel || "Unknown"
  };
}

function isCommissionerActor(actor = {}) {
  return Boolean(actor.isCommissioner) || String(actor.actorLabel ?? "").trim().toLowerCase() === "commissioner";
}

function parseKeeperLockDeadline(value) {
  if (value === null || value === "" || value === undefined) {
    return null;
  }

  const deadline = new Date(value);
  if (Number.isNaN(deadline.getTime())) {
    throw new Error("Keeper deadline must be a valid date and time.");
  }
  return deadline.toISOString();
}

function normalizeDraftMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "mock" || mode === "real") {
    return mode;
  }
  throw new Error("Draft mode must be Mock Draft or Real.");
}

async function recordDraftEvent(client, draftId, eventType, payload = {}, actor = {}) {
  const auditActor = await resolveAuditActor(client, actor);
  await client.query(
    `INSERT INTO draft_events (draft_id, actor_user_id, actor_team_id, actor_label, event_type, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [draftId, auditActor.actorUserId, auditActor.actorTeamId, auditActor.actorLabel, eventType, payload]
  );
}

export async function recordFleaflickerSyncRun({ draftSeason = DEFAULT_DRAFT.season, syncType, status, result = {}, errorMessage = "", startedAt = new Date().toISOString(), actor = {} }) {
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    const auditActor = await resolveAuditActor(client, actor);
    const inserted = await client.query(
      `INSERT INTO fleaflicker_sync_runs (draft_id, sync_type, status, result, error_message, actor_user_id, actor_team_id, actor_label, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       RETURNING *`,
      [draft.id, syncType, status, result ?? {}, errorMessage || null, auditActor.actorUserId, auditActor.actorTeamId, auditActor.actorLabel, startedAt]
    );
    return inserted.rows[0];
  });
}

async function findTeamId(client, nameOrSlug) {
  const value = String(nameOrSlug ?? "").trim();
  if (!value) {
    return null;
  }

  const result = await client.query(
    "SELECT id FROM teams WHERE lower(name) = lower($1) OR slug = $2 LIMIT 1",
    [value, slugify(value)]
  );
  return result.rows[0]?.id ?? null;
}

async function seedInitialAccountsForClient(client) {
  let count = 0;

  for (const account of INITIAL_ACCOUNT_SEEDS) {
    const email = account.email.trim().toLowerCase();
    const teamId = await findTeamId(client, account.teamName);
    const inserted = await client.query(
      `INSERT INTO app_users (email, display_name, team_id, is_active, updated_at)
       VALUES ($1, $2, $3, true, now())
       ON CONFLICT (email)
       DO UPDATE SET display_name = EXCLUDED.display_name,
         team_id = COALESCE(EXCLUDED.team_id, app_users.team_id),
         is_active = true,
         updated_at = now()
       RETURNING id`,
      [email, account.displayName, teamId]
    );
    const userId = inserted.rows[0].id;
    await client.query("DELETE FROM user_permissions WHERE user_id = $1", [userId]);

    for (const permission of account.permissions) {
      await client.query(
        `INSERT INTO user_permissions (user_id, permission)
         VALUES ($1, $2)
         ON CONFLICT (user_id, permission) DO NOTHING`,
        [userId, permission]
      );
    }
    count += 1;
  }

  return { count };
}

export async function seedInitialAccounts() {
  return withDb((client) => seedInitialAccountsForClient(client));
}

function publicAccount(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    teamId: row.team_id,
    teamName: row.team_name,
    isActive: row.is_active,
    hasPassword: Boolean(row.password_hash),
    permissions: row.permissions ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getAccountRows(client, whereSql = "", params = []) {
  const result = await client.query(
    `SELECT u.id, u.email, u.display_name, u.password_hash, u.team_id, u.is_active, u.created_at, u.updated_at,
      t.name AS team_name,
      COALESCE(
        jsonb_agg(up.permission ORDER BY up.permission) FILTER (WHERE up.permission IS NOT NULL),
        '[]'::jsonb
      ) AS permissions
     FROM app_users u
     LEFT JOIN teams t ON t.id = u.team_id
     LEFT JOIN user_permissions up ON up.user_id = u.id
     ${whereSql}
     GROUP BY u.id, t.name
     ORDER BY u.display_name`,
    params
  );
  return result.rows;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = await pbkdf2(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, "sha256");
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt}$${hash.toString("base64url")}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, iterationsText, salt, hashText] = String(storedHash ?? "").split("$");
  if (scheme !== "pbkdf2_sha256" || !iterationsText || !salt || !hashText) {
    return false;
  }

  const expected = Buffer.from(hashText, "base64url");
  const actual = await pbkdf2(password, salt, Number(iterationsText), expected.length, "sha256");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function sessionTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(client, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sessionTokenHash(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await client.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );
  return { token, expiresAt };
}

function validatePasswordInput(password) {
  const value = String(password ?? "");
  if (value.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  return value;
}

function normalizeEmailInput(email) {
  const value = String(email ?? "").trim().toLowerCase();
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("A valid email is required.");
  }
  return value;
}

function normalizeDisplayNameInput(name) {
  const value = String(name ?? "").trim();
  if (!value) {
    throw new Error("Name is required.");
  }
  return value;
}

export async function getAccounts() {
  return withDb(async (client) => (await getAccountRows(client)).map(publicAccount));
}

export async function createAccountAdmin(input = {}, actor = {}) {
  return withDb(async (client) => {
    const displayName = normalizeDisplayNameInput(input.name ?? input.displayName);
    const normalizedEmail = normalizeEmailInput(input.email);
    const passwordValue = validatePasswordInput(input.password);
    const teamId = UUID_PATTERN.test(String(input.teamId ?? "")) ? input.teamId : null;
    if (teamId) {
      const team = await client.query("SELECT id FROM teams WHERE id = $1", [teamId]);
      if (!team.rows[0]) {
        throw new Error("Selected team was not found.");
      }
    }

    const duplicate = await client.query(
      `SELECT email, display_name
       FROM app_users
       WHERE lower(email) = lower($1) OR lower(display_name) = lower($2)
       LIMIT 1`,
      [normalizedEmail, displayName]
    );
    if (duplicate.rows[0]?.email?.toLowerCase() === normalizedEmail) {
      throw new Error("An account already exists for that email.");
    }
    if (duplicate.rows[0]) {
      throw new Error("An account already exists for that name.");
    }

    const passwordHash = await hashPassword(passwordValue);
    const inserted = await client.query(
      `INSERT INTO app_users (email, display_name, password_hash, team_id, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [normalizedEmail, displayName, passwordHash, teamId, input.active === undefined ? true : Boolean(input.active)]
    );
    const userId = inserted.rows[0].id;
    const permissions = Array.from(new Set((input.permissions ?? []).map((permission) => String(permission ?? "").trim()).filter(Boolean)));
    for (const permission of permissions) {
      await client.query(
        `INSERT INTO user_permissions (user_id, permission)
         VALUES ($1, $2)
         ON CONFLICT (user_id, permission) DO NOTHING`,
        [userId, permission]
      );
    }

    const draft = await getOrCreateDraft(client, DEFAULT_DRAFT.season);
    await recordDraftEvent(client, draft.id, "account_created", {
      userId,
      email: normalizedEmail,
      displayName,
      teamId,
      permissions
    }, actor);

    return publicAccount((await getAccountRows(client, "WHERE u.id = $1", [userId]))[0]);
  });
}

export async function updateAccountAdmin(accountId, updates = {}) {
  return withDb(async (client) => {
    if (!UUID_PATTERN.test(String(accountId ?? ""))) {
      throw new Error("Account id is required.");
    }

    const existing = (await getAccountRows(client, "WHERE u.id = $1", [accountId]))[0];
    if (!existing) {
      throw new Error("Account not found.");
    }

    const displayName = String(updates.displayName ?? "").trim();
    if (!displayName) {
      throw new Error("Display name is required.");
    }

    const email = String(updates.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required.");
    }

    const teamId = UUID_PATTERN.test(String(updates.teamId ?? "")) ? updates.teamId : null;
    if (teamId) {
      const team = await client.query("SELECT id FROM teams WHERE id = $1", [teamId]);
      if (!team.rows[0]) {
        throw new Error("Selected team was not found.");
      }
    }

    await client.query(
      `UPDATE app_users
       SET email = $2, display_name = $3, team_id = $4, is_active = $5, updated_at = now()
       WHERE id = $1`,
      [accountId, email, displayName, teamId, Boolean(updates.isActive)]
    );

    const permissions = Array.from(new Set((updates.permissions ?? []).map((permission) => String(permission ?? "").trim()).filter(Boolean)));
    await client.query("DELETE FROM user_permissions WHERE user_id = $1", [accountId]);
    for (const permission of permissions) {
      await client.query(
        `INSERT INTO user_permissions (user_id, permission)
         VALUES ($1, $2)
         ON CONFLICT (user_id, permission) DO NOTHING`,
        [accountId, permission]
      );
    }

    if (!updates.isActive) {
      await client.query("DELETE FROM user_sessions WHERE user_id = $1", [accountId]);
    }

    return publicAccount((await getAccountRows(client, "WHERE u.id = $1", [accountId]))[0]);
  });
}

export async function resetAccountPasswordAdmin(accountId) {
  return withDb(async (client) => {
    if (!UUID_PATTERN.test(String(accountId ?? ""))) {
      throw new Error("Account id is required.");
    }

    const account = (await getAccountRows(client, "WHERE u.id = $1", [accountId]))[0];
    if (!account) {
      throw new Error("Account not found.");
    }

    await client.query("UPDATE app_users SET password_hash = NULL, updated_at = now() WHERE id = $1", [accountId]);
    await client.query("DELETE FROM user_sessions WHERE user_id = $1", [accountId]);
    return { ok: true, user: publicAccount((await getAccountRows(client, "WHERE u.id = $1", [accountId]))[0]) };
  });
}

export async function setAccountPassword({ email, password }) {
  return withDb(async (client) => {
    const normalizedEmail = normalizeEmailInput(email);
    const passwordValue = validatePasswordInput(password);
    const rows = await getAccountRows(client, "WHERE lower(u.email) = lower($1) AND u.is_active = true", [normalizedEmail]);
    const account = rows[0];
    if (!account) {
      throw new Error("Account not found.");
    }
    if (account.password_hash) {
      throw new Error("Password is already set for this account.");
    }

    const passwordHash = await hashPassword(passwordValue);
    await client.query("UPDATE app_users SET password_hash = $2, updated_at = now() WHERE id = $1", [account.id, passwordHash]);
    const session = await createSession(client, account.id);
    const updated = (await getAccountRows(client, "WHERE u.id = $1", [account.id]))[0];
    return { user: publicAccount(updated), ...session };
  });
}

export async function registerAccount({ name, email, password }) {
  return withDb(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fantasy_draft_register_account'))");

    const displayName = normalizeDisplayNameInput(name);
    const normalizedEmail = normalizeEmailInput(email);
    const passwordValue = validatePasswordInput(password);

    const duplicate = await client.query(
      `SELECT email, display_name
       FROM app_users
       WHERE lower(email) = lower($1) OR lower(display_name) = lower($2)
       LIMIT 1`,
      [normalizedEmail, displayName]
    );
    if (duplicate.rows[0]?.email?.toLowerCase() === normalizedEmail) {
      throw new Error("An account already exists for that email.");
    }
    if (duplicate.rows[0]) {
      throw new Error("An account already exists for that name.");
    }

    const countResult = await client.query("SELECT COUNT(*)::int AS count FROM app_users");
    const isFirstAccount = Number(countResult.rows[0]?.count ?? 0) === 0;
    const passwordHash = await hashPassword(passwordValue);
    const inserted = await client.query(
      `INSERT INTO app_users (email, display_name, password_hash, is_active, updated_at)
       VALUES ($1, $2, $3, true, now())
       RETURNING id`,
      [normalizedEmail, displayName, passwordHash]
    );
    const userId = inserted.rows[0].id;

    const permissions = isFirstAccount ? COMMISSIONER_PERMISSIONS : [];
    for (const permission of permissions) {
      await client.query(
        `INSERT INTO user_permissions (user_id, permission)
         VALUES ($1, $2)
         ON CONFLICT (user_id, permission) DO NOTHING`,
        [userId, permission]
      );
    }

    const draft = await getOrCreateDraft(client, DEFAULT_DRAFT.season);
    await recordDraftEvent(client, draft.id, isFirstAccount ? "first_account_created" : "account_registered", {
      userId,
      email: normalizedEmail,
      displayName,
      permissions
    }, { actorUserId: userId, actorLabel: displayName });

    const session = await createSession(client, userId);
    const account = (await getAccountRows(client, "WHERE u.id = $1", [userId]))[0];
    return { user: publicAccount(account), ...session };
  });
}

export async function loginAccount({ email, password }) {
  return withDb(async (client) => {
    const normalizedEmail = normalizeEmailInput(email);
    const rows = await getAccountRows(client, "WHERE lower(u.email) = lower($1) AND u.is_active = true", [normalizedEmail]);
    const account = rows[0];
    if (!account?.password_hash || !(await verifyPassword(String(password ?? ""), account.password_hash))) {
      throw new Error("Invalid email or password.");
    }

    const session = await createSession(client, account.id);
    return { user: publicAccount(account), ...session };
  });
}

export async function getCurrentUser(token) {
  if (!token) {
    return null;
  }

  return withDb(async (client) => {
    const tokenHash = sessionTokenHash(token);
    const session = await client.query(
      `SELECT user_id
       FROM user_sessions
       WHERE token_hash = $1 AND expires_at > now()
       LIMIT 1`,
      [tokenHash]
    );
    const userId = session.rows[0]?.user_id;
    if (!userId) {
      return null;
    }

    await client.query("UPDATE user_sessions SET last_seen_at = now() WHERE token_hash = $1", [tokenHash]);
    const account = (await getAccountRows(client, "WHERE u.id = $1 AND u.is_active = true", [userId]))[0];
    return account ? publicAccount(account) : null;
  });
}

export async function logoutAccount(token) {
  if (!token) {
    return { ok: true };
  }

  return withDb(async (client) => {
    await client.query("DELETE FROM user_sessions WHERE token_hash = $1", [sessionTokenHash(token)]);
    return { ok: true };
  });
}

async function mergePlayerRows(client, fromPlayerId, toPlayerId) {
  if (!fromPlayerId || !toPlayerId || fromPlayerId === toPlayerId) {
    return toPlayerId;
  }

  await client.query(
    `DELETE FROM end_of_year_rosters source
     WHERE source.player_id = $1
       AND EXISTS (
         SELECT 1 FROM end_of_year_rosters target
         WHERE target.draft_id = source.draft_id AND target.player_id = $2
       )`,
    [fromPlayerId, toPlayerId]
  );
  await client.query(
    `DELETE FROM selected_keepers source
     WHERE source.player_id = $1
       AND EXISTS (
         SELECT 1 FROM selected_keepers target
         WHERE target.draft_id = source.draft_id AND target.player_id = $2
       )`,
    [fromPlayerId, toPlayerId]
  );
  await client.query(
    `DELETE FROM last_year_draft_results source
     WHERE source.player_id = $1
       AND EXISTS (
         SELECT 1 FROM last_year_draft_results target
         WHERE target.draft_id = source.draft_id AND target.player_id = $2
       )`,
    [fromPlayerId, toPlayerId]
  );

  await client.query("UPDATE draft_picks SET player_id = $2 WHERE player_id = $1", [fromPlayerId, toPlayerId]);
  await client.query("UPDATE end_of_year_rosters SET player_id = $2 WHERE player_id = $1", [fromPlayerId, toPlayerId]);
  await client.query("UPDATE selected_keepers SET player_id = $2 WHERE player_id = $1", [fromPlayerId, toPlayerId]);
  await client.query("UPDATE last_year_draft_results SET player_id = $2 WHERE player_id = $1", [fromPlayerId, toPlayerId]);

  const sourceValues = await client.query(
    `SELECT external_id, position, nfl_team, bye_week, rank
     FROM players
     WHERE id = $1`,
    [fromPlayerId]
  );
  const source = sourceValues.rows[0];
  await client.query("UPDATE players SET external_id = NULL WHERE id = $1", [fromPlayerId]);
  await client.query(
    `UPDATE players
     SET external_id = COALESCE(external_id, $2),
       position = COALESCE(NULLIF(position, 'UNK'), $3),
       nfl_team = COALESCE(NULLIF(nfl_team, 'FA'), $4),
       bye_week = COALESCE(bye_week, $5::integer),
       rank = COALESCE(rank, $6::integer)
     WHERE id = $1`,
    [toPlayerId, source?.external_id ?? null, source?.position ?? null, source?.nfl_team ?? null, source?.bye_week ?? null, source?.rank ?? null]
  );
  await client.query("DELETE FROM players WHERE id = $1", [fromPlayerId]);
  return toPlayerId;
}

async function upsertPlayer(client, { name, position = "UNK", nflTeam = "FA", byeWeek = null, rank = null, externalId = null }) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) {
    throw new Error("Player name is required.");
  }

  const normalizedCleanName = normalizePlayerName(cleanName);
  const byName = await client.query(
    `SELECT id FROM players
     WHERE lower(name) = lower($1)
       OR regexp_replace(
         trim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g'),
             '(^| )(jr|sr|ii|iii|iv|v)( |$)',
             ' ',
             'g'
           ),
           '\\s+',
           ' ',
           'g'
         )),
         '^kenneth( |$)',
         'kenny\\1'
       ) = $2
     ORDER BY rank NULLS LAST, created_at
     LIMIT 1`,
    [cleanName, normalizedCleanName]
  );

  if (externalId) {
    const byExternalId = await client.query("SELECT id FROM players WHERE external_id = $1 LIMIT 1", [externalId]);
    if (byExternalId.rows[0]) {
      const targetId = byName.rows[0]?.id;
      const externalIdRowId = byExternalId.rows[0].id;
      if (targetId && targetId !== externalIdRowId) {
        const mergedId = await mergePlayerRows(client, externalIdRowId, targetId);
        await client.query("UPDATE players SET external_id = $2 WHERE id = $1", [mergedId, externalId]);
        return mergedId;
      }

      await client.query(
        `UPDATE players
         SET name = CASE WHEN rank IS NULL OR $6::integer IS NOT NULL THEN $2 ELSE name END,
           position = $3,
           nfl_team = $4,
           bye_week = COALESCE($5::integer, bye_week),
           rank = COALESCE($6::integer, rank)
         WHERE id = $1`,
        [byExternalId.rows[0].id, cleanName, position || "UNK", nflTeam || "FA", byeWeek, rank]
      );
      return byExternalId.rows[0].id;
    }
  }

  if (byName.rows[0]) {
    await client.query(
      `UPDATE players
       SET external_id = COALESCE(external_id, $6),
         name = CASE WHEN rank IS NULL OR $5::integer IS NOT NULL THEN $7 ELSE name END,
         position = $2,
         nfl_team = $3,
         bye_week = COALESCE($4::integer, bye_week),
         rank = COALESCE($5::integer, rank)
       WHERE id = $1`,
      [byName.rows[0].id, position || "UNK", nflTeam || "FA", byeWeek, rank, externalId, cleanName]
    );
    return byName.rows[0].id;
  }

  const result = await client.query(
    `INSERT INTO players (external_id, name, position, nfl_team, bye_week, rank)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (external_id)
     DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position, nfl_team = EXCLUDED.nfl_team,
       bye_week = EXCLUDED.bye_week, rank = EXCLUDED.rank
     RETURNING id`,
    [externalId, cleanName, position || "UNK", nflTeam || "FA", byeWeek, rank]
  ).catch(async () => {
    const byName = await client.query("SELECT id FROM players WHERE lower(name) = lower($1) LIMIT 1", [cleanName]);
    if (byName.rows[0]) {
      await client.query(
        `UPDATE players SET position = $2, nfl_team = $3, bye_week = COALESCE($4::integer, bye_week), rank = COALESCE($5::integer, rank)
         WHERE id = $1`,
        [byName.rows[0].id, position || "UNK", nflTeam || "FA", byeWeek, rank]
      );
      return byName;
    }
    throw new Error(`Unable to import player "${cleanName}".`);
  });

  return result.rows[0].id;
}

function normalizeComparableName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePlayerName(value) {
  let normalized = normalizeComparableName(value)
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "hollywood brown") {
    return "marquise brown";
  }

  // Ranking and roster sources do not always agree on formal first names.
  // Canonicalize known aliases so imports reuse an existing player row and
  // Player Matching can surface any duplicates that already exist.
  normalized = normalized.replace(/^kenneth\b/, "kenny");

  return normalized;
}

function playerIdSet(playerIds = []) {
  return Array.from(new Set(playerIds.map((id) => String(id)).filter(Boolean))).sort().join("|");
}

function getFleaflickerLocalTeamName(fleaTeam) {
  const ownerNames = (fleaTeam.owners ?? []).map((owner) =>
    normalizeComparableName(owner?.displayName || owner?.display_name || owner?.name || owner?.userName || owner?.user_name)
  );

  return (
    FLEAFLICKER_TEAM_ID_TO_LOCAL_NAME.get(fleaTeam.id) ||
    ownerNames.map((ownerName) => FLEAFLICKER_OWNER_TO_LOCAL_NAME.get(ownerName)).find(Boolean) ||
    fleaTeam.name
  );
}

function getFleaflickerOwnerName(fleaTeam) {
  const owner = fleaTeam.owners?.[0];
  return owner?.displayName || owner?.display_name || owner?.name || owner?.userName || owner?.user_name || getFleaflickerLocalTeamName(fleaTeam);
}

function findLocalTeamId(teams, fleaTeam) {
  const fleaName = normalizeComparableName(fleaTeam.name);
  const ownerNames = (fleaTeam.owners ?? []).map((owner) =>
    normalizeComparableName(owner?.displayName || owner?.display_name || owner?.name || owner?.userName || owner?.user_name)
  );
  const ownerFirstNames = ownerNames
    .map((ownerName) => ownerName.split(" ")[0])
    .filter(Boolean);
  const mappedLocalName =
    FLEAFLICKER_TEAM_ID_TO_LOCAL_NAME.get(fleaTeam.id) ||
    ownerNames.map((ownerName) => FLEAFLICKER_OWNER_TO_LOCAL_NAME.get(ownerName)).find(Boolean);

  if (mappedLocalName) {
    const mappedTeam = teams.find((team) => normalizeComparableName(team.name) === normalizeComparableName(mappedLocalName));
    if (mappedTeam) {
      return mappedTeam.id;
    }
  }

  const byTeamName = teams.find((team) => normalizeComparableName(team.name) === fleaName);
  if (byTeamName) {
    return byTeamName.id;
  }

  const byOwnerName = teams.find((team) => ownerNames.includes(normalizeComparableName(team.ownerName)));
  if (byOwnerName) {
    return byOwnerName.id;
  }

  const byShortOwnerName = teams.find((team) => {
    const localTeamName = normalizeComparableName(team.name);
    const localOwnerName = normalizeComparableName(team.ownerName);
    return ownerFirstNames.includes(localTeamName) || ownerFirstNames.includes(localOwnerName);
  });
  return byShortOwnerName?.id ?? null;
}

async function upsertFleaflickerTeams(client, fleaTeams) {
  for (const fleaTeam of fleaTeams) {
    const localName = getFleaflickerLocalTeamName(fleaTeam);
    if (!localName) {
      continue;
    }

    await client.query(
      `INSERT INTO teams (slug, name, owner_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, owner_name = EXCLUDED.owner_name`,
      [slugify(localName), localName, getFleaflickerOwnerName(fleaTeam)]
    );
  }
}

function extractRosterPlayers(rosterResponse) {
  const players = (rosterResponse.groups ?? [])
    .flatMap((group) => group.slots ?? [])
    .map((slot) => slot.leaguePlayer?.proPlayer || slot.league_player?.pro_player)
    .filter(Boolean)
    .filter((player) => player.nameFull || player.name_full || player.nameShort || player.name_short)
    .map((player) => ({
      externalId: player.id ? `fleaflicker:${player.id}` : null,
      name: player.nameFull || player.name_full || player.nameShort || player.name_short,
      position: basePosition(player.position),
      nflTeam: player.proTeamAbbreviation || player.pro_team_abbreviation || player.proTeam?.abbreviation || player.pro_team?.abbreviation || "FA",
      byeWeek: numberOrNull(player.nflByeWeek ?? player.nfl_bye_week)
    }));

  const seen = new Set();
  return players.filter((player) => {
    const key = player.externalId ?? normalizeComparableName(player.name);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function fetchFleaflickerJson(path, params) {
  const url = new URL(`https://www.fleaflicker.com/api/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fleaflicker ${path} failed with ${response.status}.`);
  }

  return response.json();
}

function collectFleaflickerTeams(standingsResponse) {
  if (Array.isArray(standingsResponse.teams)) {
    return standingsResponse.teams;
  }

  if (Array.isArray(standingsResponse.divisions)) {
    return standingsResponse.divisions.flatMap((division) => division.teams ?? []);
  }

  return [];
}

function getFleaflickerTeamId(team) {
  return team?.id ?? null;
}

function getDraftPickField(pick, camelName, snakeName) {
  return pick?.[camelName] ?? pick?.[snakeName] ?? null;
}

function normalizeFleaflickerDraftPicks(picks, season) {
  const deduped = new Map();

  for (const pick of picks) {
    if (pick.deleted) {
      continue;
    }

    const pickSeason = pick.season ?? season;
    if (Number(pickSeason) !== Number(season)) {
      continue;
    }

    const originalOwner = getDraftPickField(pick, "originalOwner", "original_owner");
    const ownedBy = getDraftPickField(pick, "ownedBy", "owned_by");
    const slot = pick.slot;
    if (!pick.traded || !originalOwner || !ownedBy || !slot?.round) {
      continue;
    }

    const key = `${pickSeason}:${slot.round}:${getFleaflickerTeamId(originalOwner)}:${getFleaflickerTeamId(ownedBy)}`;
    const existing = deduped.get(key);
    if (!existing || existing.lost || existing.skipped) {
      deduped.set(key, pick);
    }
  }

  return Array.from(deduped.values());
}

async function ensureDraftPicks(client, draft) {
  const teams = await client.query("SELECT id FROM teams ORDER BY created_at");
  if (teams.rows.length === 0) {
    return;
  }

  for (let round = 1; round <= draft.round_count; round += 1) {
    for (let teamIndex = 0; teamIndex < teams.rows.length; teamIndex += 1) {
      const team = teams.rows[teamIndex];
      const pickNumber = (round - 1) * teams.rows.length + teamIndex + 1;
      await client.query(
        `INSERT INTO draft_picks (draft_id, round, pick_number, original_team_id, current_owner_team_id)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (draft_id, pick_number) DO NOTHING`,
        [draft.id, round, pickNumber, team.id]
      );
    }
  }
}

async function placeSelectedKeepers(client, draftId) {
  await client.query("UPDATE draft_picks SET player_id = NULL, pick_type = 'open' WHERE draft_id = $1 AND pick_type = 'keeper'", [draftId]);

  const keepers = await client.query(
    `SELECT team_id, player_id, assigned_round
     FROM selected_keepers
     WHERE draft_id = $1 AND status = 'selected'
     ORDER BY assigned_round`,
    [draftId]
  );

  for (const keeper of keepers.rows) {
    await client.query(
      `UPDATE draft_picks
       SET player_id = $3, pick_type = 'keeper'
       WHERE id = (
         SELECT id FROM draft_picks
         WHERE draft_id = $1 AND current_owner_team_id = $2 AND round = $4 AND player_id IS NULL
         ORDER BY pick_number DESC
         LIMIT 1
       )`,
      [draftId, keeper.team_id, keeper.player_id, keeper.assigned_round]
    );
  }
}

async function ensureMockDraftPicks(client, draftId, mockUserId) {
  if (!UUID_PATTERN.test(String(mockUserId ?? ""))) {
    throw new Error("A user is required for Mock Draft mode.");
  }

  const user = await client.query("SELECT id FROM app_users WHERE id = $1 AND is_active = true", [mockUserId]);
  if (!user.rows[0]) {
    throw new Error("Mock draft user not found.");
  }

  await client.query(
    `INSERT INTO mock_draft_picks (draft_id, mock_user_id, lobby_team_id, source_pick_id, player_id, pick_type)
     SELECT draft_id, $2, $3, id,
       CASE WHEN pick_type = 'keeper' THEN player_id ELSE NULL END,
       CASE WHEN pick_type = 'keeper' THEN 'keeper' ELSE 'open' END
     FROM draft_picks
     WHERE draft_id = $1
     ON CONFLICT (draft_id, mock_user_id, source_pick_id) WHERE mock_user_id IS NOT NULL DO NOTHING`,
    [draftId, mockUserId, null]
  );

  await client.query(
    `UPDATE mock_draft_picks mdp
     SET player_id = CASE
         WHEN dp.pick_type = 'keeper' THEN dp.player_id
         WHEN mdp.pick_type <> 'drafted' THEN NULL
         ELSE mdp.player_id
       END,
       pick_type = CASE
         WHEN dp.pick_type = 'keeper' THEN 'keeper'
         WHEN mdp.pick_type <> 'drafted' THEN 'open'
         ELSE mdp.pick_type
       END
     FROM draft_picks dp
     WHERE mdp.source_pick_id = dp.id
       AND mdp.draft_id = $1
       AND mdp.mock_user_id = $2`,
    [draftId, mockUserId]
  );
}

async function getOwnedPickCountsByRound(client, draftId, teamId) {
  const result = await client.query(
    `SELECT round, COUNT(*)::int AS count
     FROM draft_picks
     WHERE draft_id = $1 AND current_owner_team_id = $2 AND pick_type <> 'drafted'
     GROUP BY round`,
    [draftId, teamId]
  );

  return new Map(result.rows.map((row) => [row.round, row.count]));
}

function findAvailableKeeperRound(keeperCost, ownedPickCountsByRound, usedRoundCounts) {
  for (let round = keeperCost; round >= 1; round -= 1) {
    const ownedCount = ownedPickCountsByRound.get(round) ?? 0;
    const usedCount = usedRoundCounts.get(round) ?? 0;
    if (ownedCount > usedCount) {
      usedRoundCounts.set(round, usedCount + 1);
      return round;
    }
  }

  return null;
}

export async function importTeams(csvText, draftSeason = DEFAULT_DRAFT.season) {
  const records = parseCsv(csvText);
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    let count = 0;

    for (const record of records) {
      const name = pick(record, ["name", "team", "team_name"]);
      if (!name) {
        continue;
      }
      const ownerName = pick(record, ["owner_name", "owner", "manager"], name);
      const slug = pick(record, ["slug"], slugify(name));
      await client.query(
        `INSERT INTO teams (slug, name, owner_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, owner_name = EXCLUDED.owner_name`,
        [slug, name, ownerName]
      );
      count += 1;
    }

    await ensureDraftPicks(client, draft);
    await seedInitialAccountsForClient(client);
    return { count };
  });
}

export async function importPlayers(csvText, draftSeason = DEFAULT_DRAFT.season, actor = {}) {
  const records = parseCsv(csvText);
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    let count = 0;
    for (const record of records) {
      const name = pick(record, ["name", "player", "player_name"]);
      if (!name) {
        continue;
      }

      await upsertPlayer(client, {
        externalId: pick(record, ["external_id", "id"], null) || null,
        name,
        position: basePosition(pick(record, ["position", "pos"], "UNK")),
        nflTeam: pick(record, ["nfl_team", "team"], "FA"),
        byeWeek: numberOrNull(pick(record, ["bye_week", "bye"], "")),
        rank: numberOrNull(pick(record, ["rank", "rk", "overall_rank", "ecr"], ""))
      });
      count += 1;
    }
    await recordDraftEvent(client, draft.id, "rankings_uploaded", { count, draftSeason: draft.season }, actor);
    return { count };
  });
}

async function readSeedFile(filename) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const localSeedPath = path.resolve(__dirname, "../../database/seeds", filename);
  const dockerSeedPath = path.resolve("/database/seeds", filename);
  const seedPath = existsSync(localSeedPath) ? localSeedPath : dockerSeedPath;

  if (!existsSync(seedPath)) {
    return null;
  }

  return readFile(seedPath, "utf8");
}

function looksLikeHeaderDraftRows(rows) {
  const header = (rows[0] ?? []).map((value) => String(value ?? "").toLowerCase());
  return header.some((value) => ["player", "player_name", "name", "round", "draft_round", "team", "team_name"].includes(value.replace(/[^a-z_]+/g, "_")));
}

function legacyDraftCellToPlayer(cell) {
  const lines = String(cell ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const playerName = lines[0] ?? "";
  const details = lines.slice(1).join(" ");
  const match = details.match(/^(QB|RB|WR|TE|K|DST|D\/ST|DEF)\s*-\s*([A-Z]{2,3}|FA)(?:\s*\((\d+)\))?/i);

  return {
    playerName,
    position: basePosition(match?.[1] ?? "UNK"),
    nflTeam: match?.[2] ?? "FA",
    byeWeek: numberOrNull(match?.[3] ?? "")
  };
}

function normalizePlayerNameKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function legacyDraftGridRecords(csvText) {
  return parseCsvRows(csvText, { preserveEmptyRows: true }).flatMap((row, rowIndex) => {
    const round = rowIndex + 1;
    return row.map((cell, columnIndex) => {
      const teamName = LEGACY_2025_DRAFT_COLUMN_TEAMS[columnIndex] ?? "";
      const player = legacyDraftCellToPlayer(cell);
      return {
        playerName: player.playerName,
        teamName,
        round,
        pickNumber: rowIndex * LEGACY_2025_DRAFT_COLUMN_TEAMS.length + columnIndex + 1,
        position: player.position,
        nflTeam: player.nflTeam,
        byeWeek: player.byeWeek
      };
    });
  });
}

function tableDraftRecords(csvText) {
  return parseCsv(csvText).map((record) => ({
    playerName: pick(record, ["player_name", "player", "name"]),
    teamName: pick(record, ["team_name", "drafted_team", "original_team", "team"]),
    round: numberOrNull(pick(record, ["round", "draft_round", "last_year_round"], "")),
    pickNumber: numberOrNull(pick(record, ["pick_number", "pickNumber", "pick"], "")),
    position: basePosition(pick(record, ["position", "pos"], "UNK")),
    nflTeam: pick(record, ["nfl_team", "nfl", "pro_team"], "FA"),
    byeWeek: numberOrNull(pick(record, ["bye_week", "bye"], "")),
    rank: numberOrNull(pick(record, ["rank"], ""))
  }));
}

function draftRoundOnlyRecords(csvText) {
  return parseCsvRows(csvText, { preserveEmptyRows: true }).flatMap((row, rowIndex) => {
    const round = rowIndex + 1;
    return row
      .map((cell) => {
        const player = legacyDraftCellToPlayer(cell);
        return player.playerName
          ? {
              playerName: player.playerName,
              round,
              position: player.position,
              nflTeam: player.nflTeam,
              byeWeek: player.byeWeek
            }
          : null;
      })
      .filter(Boolean);
  });
}

export async function importLastYearDraft(csvText, draftSeason = DEFAULT_DRAFT.season, actor = {}) {
  const rows = parseCsvRows(csvText);
  const records = looksLikeHeaderDraftRows(rows) ? tableDraftRecords(csvText) : legacyDraftGridRecords(csvText);

  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    await client.query("DELETE FROM last_year_draft_results WHERE draft_id = $1", [draft.id]);
    let count = 0;

    for (const record of records) {
      const { playerName, teamName, round } = record;
      if (!playerName || !teamName || !round) {
        continue;
      }

      const teamId = await findTeamId(client, teamName);
      if (!teamId) {
        throw new Error(`Unknown team in last year draft import: ${teamName}`);
      }

      const playerId = await upsertPlayer(client, {
        name: playerName,
        position: record.position ?? "UNK",
        nflTeam: record.nflTeam ?? "FA",
        byeWeek: record.byeWeek ?? null,
        rank: record.rank ?? null
      });

      await client.query(
        `INSERT INTO last_year_draft_results (draft_id, player_id, drafted_team_id, round, pick_number)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (draft_id, player_id)
         DO UPDATE SET drafted_team_id = EXCLUDED.drafted_team_id, round = EXCLUDED.round, pick_number = EXCLUDED.pick_number`,
        [draft.id, playerId, teamId, round, record.pickNumber ?? null]
      );
      count += 1;
    }
    await recordDraftEvent(client, draft.id, "legacy_draft_uploaded", { count, draftSeason: draft.season }, actor);
    return { count };
  });
}

export async function importLastYearDraftRounds(csvText, draftSeason = DEFAULT_DRAFT.season, actor = {}) {
  const records = draftRoundOnlyRecords(csvText);
  const seenPlayers = new Map();
  const duplicatePlayers = [];

  for (const record of records) {
    const key = normalizePlayerNameKey(record.playerName);
    if (!key) {
      continue;
    }
    const existing = seenPlayers.get(key);
    if (existing) {
      duplicatePlayers.push({
        playerName: record.playerName,
        rounds: Array.from(new Set([existing.round, record.round])).sort((a, b) => a - b)
      });
    } else {
      seenPlayers.set(key, record);
    }
  }
  const uniqueRecords = Array.from(seenPlayers.values());

  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    await client.query("DELETE FROM last_year_draft_results WHERE draft_id = $1", [draft.id]);
    let count = 0;

    for (const record of uniqueRecords) {
      const { playerName, round } = record;
      if (!playerName || !round) {
        continue;
      }

      const playerId = await upsertPlayer(client, {
        name: playerName,
        position: record.position ?? "UNK",
        nflTeam: record.nflTeam ?? "FA",
        byeWeek: record.byeWeek ?? null,
        rank: null
      });

      await client.query(
        `INSERT INTO last_year_draft_results (draft_id, player_id, drafted_team_id, round, pick_number)
         VALUES ($1, $2, NULL, $3, NULL)
         ON CONFLICT (draft_id, player_id)
         DO UPDATE SET drafted_team_id = NULL, round = EXCLUDED.round, pick_number = NULL`,
        [draft.id, playerId, round]
      );
      count += 1;
    }

    const preview = uniqueRecords.slice(0, 60).map((record) => ({
      round: record.round,
      playerName: record.playerName,
      position: record.position,
      nflTeam: record.nflTeam,
      byeWeek: record.byeWeek
    }));
    const warnings = duplicatePlayers.map((duplicate) => `${duplicate.playerName} appears more than once (${duplicate.rounds.map((round) => `Round ${round}`).join(", ")}).`);

    await recordDraftEvent(client, draft.id, "legacy_draft_uploaded", {
      count,
      draftSeason: draft.season,
      sourceType: "draft_rounds_csv",
      warnings
    }, actor);
    return { count, preview, warnings };
  });
}

export async function seedLastYearDraftSource(draftSeason = DEFAULT_DRAFT.season, actor = {}) {
  if (Number(draftSeason) !== SEEDED_LEGACY_DRAFT_SEASON) {
    return { count: 0, skipped: true, reason: "No seed configured for this draft season." };
  }

  const csvText = await readSeedFile(SEEDED_LEGACY_DRAFT_SOURCE);
  if (!csvText) {
    return { count: 0, skipped: true, reason: `${SEEDED_LEGACY_DRAFT_SOURCE} was not found.` };
  }

  const result = await importLastYearDraft(csvText, draftSeason, actor);
  return { ...result, skipped: false, source: SEEDED_LEGACY_DRAFT_SOURCE };
}

export async function importRosters(csvText, draftSeason = DEFAULT_DRAFT.season) {
  const records = parseCsv(csvText);
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    let count = 0;

    for (const record of records) {
      const teamName = pick(record, ["team_name", "fantasy_team", "team"]);
      const playerName = pick(record, ["player_name", "player", "name"]);
      if (!teamName || !playerName) {
        continue;
      }

      const teamId = await findTeamId(client, teamName);
      if (!teamId) {
        throw new Error(`Unknown team in roster import: ${teamName}`);
      }

      const playerId = await upsertPlayer(client, {
        name: playerName,
        position: basePosition(pick(record, ["position", "pos"], "UNK")),
        nflTeam: pick(record, ["nfl_team", "nfl", "pro_team"], "FA"),
        byeWeek: numberOrNull(pick(record, ["bye_week", "bye"], "")),
        rank: numberOrNull(pick(record, ["rank"], ""))
      });

      await client.query(
        `INSERT INTO end_of_year_rosters (draft_id, team_id, player_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (draft_id, player_id)
         DO UPDATE SET team_id = EXCLUDED.team_id`,
        [draft.id, teamId, playerId]
      );
      count += 1;
    }
    return { count };
  });
}

export async function importSelectedKeepers(csvText, draftSeason = DEFAULT_DRAFT.season) {
  const records = parseCsv(csvText);
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    await ensureDraftPicks(client, draft);
    let count = 0;

    for (const record of records) {
      const teamName = pick(record, ["team_name", "fantasy_team", "team"]);
      const playerName = pick(record, ["player_name", "player", "name"]);
      if (!teamName || !playerName) {
        continue;
      }

      const teamId = await findTeamId(client, teamName);
      if (!teamId) {
        throw new Error(`Unknown team in selected keepers import: ${teamName}`);
      }

      const playerId = await upsertPlayer(client, {
        name: playerName,
        position: basePosition(pick(record, ["position", "pos"], "UNK")),
        nflTeam: pick(record, ["nfl_team", "nfl", "pro_team"], "FA")
      });

      const explicitRound = numberOrNull(pick(record, ["round", "keeper_round", "assigned_round"], ""));
      let assignedRound = explicitRound;
      if (!assignedRound) {
        const draftResult = await client.query(
          "SELECT round FROM last_year_draft_results WHERE draft_id = $1 AND player_id = $2",
          [draft.id, playerId]
        );
        assignedRound = getKeeperCost({ lastYearDraftRound: draftResult.rows[0]?.round ?? null });
      }

      if (!assignedRound) {
        throw new Error(`${playerName} is not keeper eligible.`);
      }

      await client.query(
        `INSERT INTO selected_keepers (draft_id, team_id, player_id, assigned_round, status)
         VALUES ($1, $2, $3, $4, 'selected')
         ON CONFLICT (draft_id, player_id)
         DO UPDATE SET team_id = EXCLUDED.team_id, assigned_round = EXCLUDED.assigned_round, status = 'selected'`,
        [draft.id, teamId, playerId, assignedRound]
      );
      count += 1;
    }

    await placeSelectedKeepers(client, draft.id);
    return { count };
  });
}

export async function importTradedPicks(csvText, draftSeason = DEFAULT_DRAFT.season) {
  const records = parseCsv(csvText);
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    await ensureDraftPicks(client, draft);
    let count = 0;

    for (const record of records) {
      const round = numberOrNull(pick(record, ["round"], ""));
      const originalTeam = pick(record, ["original_team", "original_team_name", "from_team"]);
      const currentOwner = pick(record, ["current_owner", "current_owner_team", "to_team", "owner_team"]);
      if (!round || !originalTeam || !currentOwner) {
        continue;
      }

      const originalTeamId = await findTeamId(client, originalTeam);
      const currentOwnerTeamId = await findTeamId(client, currentOwner);
      if (!originalTeamId || !currentOwnerTeamId) {
        throw new Error(`Unknown team in traded pick import: ${originalTeam} -> ${currentOwner}`);
      }

      await client.query(
        `UPDATE draft_picks
         SET current_owner_team_id = $4
         WHERE draft_id = $1 AND round = $2 AND original_team_id = $3`,
        [draft.id, round, originalTeamId, currentOwnerTeamId]
      );
      count += 1;
    }

    await placeSelectedKeepers(client, draft.id);
    return { count };
  });
}

export async function importFleaflickerEndOfSeasonRosters({ leagueId = 164549, season = 2025, scoringPeriod = 18, draftSeason = null, actor = {} } = {}) {
  return withDb(async (client) => {
    const targetDraftSeason = Number(draftSeason ?? Number(season) + 1);
    const draft = await getOrCreateDraft(client, targetDraftSeason);
    const standings = await fetchFleaflickerJson("FetchLeagueStandings", {
      sport: "NFL",
      league_id: leagueId,
      season
    });
    const fleaTeams = collectFleaflickerTeams(standings);
    if (fleaTeams.length === 0) {
      throw new Error("Fleaflicker did not return league teams.");
    }

    await upsertFleaflickerTeams(client, fleaTeams);
    await seedInitialAccountsForClient(client);
    let localTeams = (await client.query("SELECT * FROM teams ORDER BY created_at")).rows.map(toCamelTeam);
    await ensureDraftPicks(client, draft);
    localTeams = (await client.query("SELECT * FROM teams ORDER BY created_at")).rows.map(toCamelTeam);

    const mappedTeams = fleaTeams
      .map((fleaTeam) => ({
        fleaTeam,
        localTeamId: findLocalTeamId(localTeams, fleaTeam)
      }))
      .filter((team) => team.localTeamId);

    if (mappedTeams.length === 0) {
      throw new Error("Unable to match Fleaflicker teams to local teams.");
    }

    const missingMatches = fleaTeams
      .filter((fleaTeam) => !findLocalTeamId(localTeams, fleaTeam))
      .map((fleaTeam) => fleaTeam.name);

    const rosters = [];
    for (const mappedTeam of mappedTeams) {
      const roster = await fetchFleaflickerJson("FetchRoster", {
        sport: "NFL",
        league_id: leagueId,
        team_id: mappedTeam.fleaTeam.id,
        season,
        scoring_period: scoringPeriod
      });
      rosters.push({
        teamId: mappedTeam.localTeamId,
        teamName: localTeams.find((team) => team.id === mappedTeam.localTeamId)?.name,
        players: extractRosterPlayers(roster)
      });
    }

    await client.query("DELETE FROM end_of_year_rosters WHERE draft_id = $1", [draft.id]);

    let count = 0;
    for (const roster of rosters) {
      for (const player of roster.players) {
        const playerId = await upsertPlayer(client, player);
        await client.query(
          `INSERT INTO end_of_year_rosters (draft_id, team_id, player_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (draft_id, player_id)
           DO UPDATE SET team_id = EXCLUDED.team_id`,
          [draft.id, roster.teamId, playerId]
        );
        count += 1;
      }
    }

    const result = {
      count,
      leagueId,
      season,
      draftSeason: targetDraftSeason,
      scoringPeriod,
      teamCount: mappedTeams.length,
      missingMatches,
      rosterCounts: rosters.map((roster) => ({
        teamName: roster.teamName,
        count: roster.players.length
      }))
    };
    await recordDraftEvent(client, draft.id, "fleaflicker_rosters_synced", result, actor);
    return result;
  });
}

export async function importFleaflickerTradedPicks({ leagueId = 164549, standingsSeason = 2025, pickSeason = 2026, draftSeason = null, actor = {} } = {}) {
  return withDb(async (client) => {
    const targetDraftSeason = Number(draftSeason ?? pickSeason);
    const draft = await getOrCreateDraft(client, targetDraftSeason);
    await ensureDraftPicks(client, draft);

    const standings = await fetchFleaflickerJson("FetchLeagueStandings", {
      sport: "NFL",
      league_id: leagueId,
      season: standingsSeason
    });
    const fleaTeams = collectFleaflickerTeams(standings);
    if (fleaTeams.length === 0) {
      throw new Error("Fleaflicker did not return league teams.");
    }

    await upsertFleaflickerTeams(client, fleaTeams);
    await seedInitialAccountsForClient(client);
    const localTeams = (await client.query("SELECT * FROM teams ORDER BY created_at")).rows.map(toCamelTeam);
    await ensureDraftPicks(client, draft);

    const mappedTeams = fleaTeams
      .map((fleaTeam) => ({
        fleaTeam,
        localTeamId: findLocalTeamId(localTeams, fleaTeam)
      }))
      .filter((team) => team.localTeamId);

    if (mappedTeams.length === 0) {
      throw new Error("Unable to match Fleaflicker teams to local teams.");
    }

    const allPicks = [];
    for (const mappedTeam of mappedTeams) {
      const response = await fetchFleaflickerJson("FetchTeamPicks", {
        sport: "NFL",
        league_id: leagueId,
        team_id: mappedTeam.fleaTeam.id
      });
      allPicks.push(...(response.picks ?? []));
    }

    const tradedPicks = normalizeFleaflickerDraftPicks(allPicks, pickSeason);
    const updated = [];
    const skipped = [];

    await client.query(
      "UPDATE draft_picks SET player_id = NULL, pick_type = 'open' WHERE draft_id = $1 AND pick_type = 'keeper'",
      [draft.id]
    );
    await client.query(
      "UPDATE draft_picks SET current_owner_team_id = original_team_id WHERE draft_id = $1 AND pick_type <> 'drafted'",
      [draft.id]
    );

    for (const tradedPick of tradedPicks) {
      const originalOwner = getDraftPickField(tradedPick, "originalOwner", "original_owner");
      const ownedBy = getDraftPickField(tradedPick, "ownedBy", "owned_by");
      const originalTeamId = findLocalTeamId(localTeams, originalOwner);
      const currentOwnerTeamId = findLocalTeamId(localTeams, ownedBy);
      const round = tradedPick.slot?.round;

      if (!originalTeamId || !currentOwnerTeamId || !round) {
        skipped.push({
          round,
          originalOwner: originalOwner?.name,
          ownedBy: ownedBy?.name
        });
        continue;
      }

      const result = await client.query(
        `UPDATE draft_picks
         SET current_owner_team_id = $4
         WHERE draft_id = $1 AND round = $2 AND original_team_id = $3
         RETURNING id`,
        [draft.id, round, originalTeamId, currentOwnerTeamId]
      );

      if (result.rowCount > 0) {
        updated.push({
          round,
          originalOwner: localTeams.find((team) => team.id === originalTeamId)?.name,
          ownedBy: localTeams.find((team) => team.id === currentOwnerTeamId)?.name
        });
      }
    }

    await placeSelectedKeepers(client, draft.id);

    const result = {
      count: updated.length,
      leagueId,
      standingsSeason,
      pickSeason,
      draftSeason: targetDraftSeason,
      skipped,
      tradedPicks: updated
    };
    await recordDraftEvent(client, draft.id, "fleaflicker_traded_picks_synced", result, actor);
    return result;
  });
}

export async function updateSelectedKeepers(teamId, playerIds, draftSeason = DEFAULT_DRAFT.season, actor = {}, options = {}) {
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    await ensureDraftPicks(client, draft);
    const cleanActor = cleanAuditActor(actor);
    const isCommissioner = isCommissionerActor(cleanActor);
    if (!isCommissioner && cleanActor.actorTeamId !== teamId) {
      throw new Error("You can view other teams' keepers, but only edit your own team.");
    }

    const keeperLockDeadline = draft.keeper_lock_deadline ? new Date(draft.keeper_lock_deadline) : null;
    const keeperLocked = keeperLockDeadline ? keeperLockDeadline.getTime() <= Date.now() : false;
    const commissionerOverride = Boolean(options.commissionerOverride) && isCommissioner;
    if (keeperLocked && !commissionerOverride) {
      throw new Error("Keeper selections are locked. Ask a commissioner to make an override change.");
    }

    const team = await client.query("SELECT id FROM teams WHERE id = $1", [teamId]);
    if (!team.rows[0]) {
      throw new Error("Unknown team for keeper selections.");
    }

    const submittedPlayerIds = Array.isArray(playerIds) ? playerIds : [];
    if (new Set(submittedPlayerIds).size !== submittedPlayerIds.length) {
      throw new Error("Keeper selections contain duplicate players.");
    }

    const previous = await client.query(
      `SELECT player_id, assigned_round
       FROM selected_keepers
       WHERE draft_id = $1 AND team_id = $2
       ORDER BY assigned_round DESC, player_id`,
      [draft.id, teamId]
    );

    await client.query("DELETE FROM selected_keepers WHERE draft_id = $1 AND team_id = $2", [draft.id, teamId]);

    const ownedPickCountsByRound = await getOwnedPickCountsByRound(client, draft.id, teamId);
    const usedRoundCounts = new Map();
    for (const playerId of submittedPlayerIds) {
      const result = await client.query(
        `SELECT p.id, lyd.round AS last_year_draft_round
         FROM end_of_year_rosters eyr
         JOIN players p ON p.id = eyr.player_id
         LEFT JOIN last_year_draft_results lyd ON lyd.player_id = p.id AND lyd.draft_id = eyr.draft_id
         WHERE eyr.draft_id = $1 AND eyr.team_id = $2 AND p.id = $3`,
        [draft.id, teamId, playerId]
      );
      const player = result.rows[0];
      if (!player) {
        throw new Error("Selected keeper is not on this team's end-of-season roster.");
      }

      const assignedRound = getKeeperCost({
        lastYearDraftRound: player.last_year_draft_round
      });
      if (!assignedRound) {
        throw new Error("One of the selected players is not keeper eligible.");
      }

      const adjustedRound = findAvailableKeeperRound(assignedRound, ownedPickCountsByRound, usedRoundCounts);
      if (!adjustedRound) {
        throw new Error("A selected keeper cannot be assigned because this team has no available pick in that round or an earlier round.");
      }

      await client.query(
        `INSERT INTO selected_keepers (draft_id, team_id, player_id, assigned_round, status)
         VALUES ($1, $2, $3, $4, 'selected')
         ON CONFLICT (draft_id, player_id)
         DO UPDATE SET team_id = EXCLUDED.team_id, assigned_round = EXCLUDED.assigned_round, status = 'selected'`,
        [draft.id, teamId, playerId, adjustedRound]
      );
    }

    await placeSelectedKeepers(client, draft.id);
    await recordDraftEvent(client, draft.id, "keepers_changed", {
      teamId,
      previousPlayerIds: previous.rows.map((row) => row.player_id),
      playerIds: submittedPlayerIds,
      count: submittedPlayerIds.length,
      commissionerOverride
    }, cleanActor);
    return { count: submittedPlayerIds.length };
  });
}

export async function updateKeeperLockDeadline(draftSeason = DEFAULT_DRAFT.season, keeperLockDeadline = null, actor = {}) {
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    const parsedDeadline = parseKeeperLockDeadline(keeperLockDeadline);
    const updated = await client.query(
      "UPDATE drafts SET keeper_lock_deadline = $2 WHERE id = $1 RETURNING keeper_lock_deadline",
      [draft.id, parsedDeadline]
    );
    await recordDraftEvent(client, draft.id, "keeper_deadline_updated", {
      keeperLockDeadline: updated.rows[0]?.keeper_lock_deadline ?? null
    }, actor);
    return {
      draftSeason: draft.season,
      keeperLockDeadline: updated.rows[0]?.keeper_lock_deadline ?? null
    };
  });
}

export async function updateDraftMode(draftSeason = DEFAULT_DRAFT.season, mode, actor = {}) {
  const auditActor = cleanAuditActor(actor);
  if (!isCommissionerActor(auditActor)) {
    throw new Error("Only the commissioner can change the draft mode.");
  }

  const draftMode = normalizeDraftMode(mode);
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    await client.query("UPDATE drafts SET status = $2 WHERE id = $1", [draft.id, draftMode]);
    await recordDraftEvent(client, draft.id, "draft_mode_updated", { mode: draftMode }, auditActor);
    return { draftSeason: draft.season, mode: draftMode };
  });
}

export async function rebuildSelectedKeeperPicks(draftSeason = DEFAULT_DRAFT.season) {
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    await ensureDraftPicks(client, draft);
    await placeSelectedKeepers(client, draft.id);

    const result = await client.query(
      "SELECT COUNT(*)::int AS count FROM selected_keepers WHERE draft_id = $1 AND status = 'selected'",
      [draft.id]
    );
    return { count: result.rows[0]?.count ?? 0 };
  });
}

export async function updateDraftOrder(teamIds, draftSeason = DEFAULT_DRAFT.season) {
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    await ensureDraftPicks(client, draft);

    const teams = await client.query("SELECT id FROM teams ORDER BY created_at");
    const knownTeamIds = teams.rows.map((team) => team.id);
    const submittedIds = Array.isArray(teamIds) ? teamIds : [];

    if (submittedIds.length !== knownTeamIds.length) {
      throw new Error("Draft order must include every team exactly once.");
    }

    const knownSet = new Set(knownTeamIds);
    const submittedSet = new Set(submittedIds);
    if (submittedSet.size !== submittedIds.length || submittedIds.some((teamId) => !knownSet.has(teamId))) {
      throw new Error("Draft order contains an unknown or duplicate team.");
    }

    const offset = 100000;
    for (let round = 1; round <= draft.round_count; round += 1) {
      for (let index = 0; index < submittedIds.length; index += 1) {
        const pickNumber = (round - 1) * submittedIds.length + index + 1;
        await client.query(
          `UPDATE draft_picks
           SET pick_number = $4
           WHERE draft_id = $1 AND round = $2 AND original_team_id = $3`,
          [draft.id, round, submittedIds[index], pickNumber + offset]
        );
      }
    }

    for (let round = 1; round <= draft.round_count; round += 1) {
      for (let index = 0; index < submittedIds.length; index += 1) {
        const pickNumber = (round - 1) * submittedIds.length + index + 1;
        await client.query(
          `UPDATE draft_picks
           SET pick_number = $4
           WHERE draft_id = $1 AND round = $2 AND original_team_id = $3`,
          [draft.id, round, submittedIds[index], pickNumber]
        );
      }
    }

    await placeSelectedKeepers(client, draft.id);
    return { count: submittedIds.length };
  });
}

export async function getPostgresDraftState({ season = DEFAULT_DRAFT.season, mockUserId = null, mockLobbyTeamId = null } = {}) {
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, season);
    await ensureDraftPicks(client, draft);
    const draftMode = draft.status === "mock" ? "mock" : "real";
    const mockBoardUserId = getMockBoardUserId({ mockUserId, mockLobbyTeamId });
    const useMockLobby = draftMode === "mock" && mockBoardUserId;
    if (useMockLobby) {
      await ensureMockDraftPicks(client, draft.id, mockBoardUserId);
    }

    const pickQuery = useMockLobby
      ? client.query(
        `SELECT mdp.id, dp.draft_id, dp.round, dp.pick_number, dp.original_team_id, dp.current_owner_team_id,
          mdp.player_id, mdp.pick_type, mdp.source_pick_id,
          json_build_object('id', t.id, 'name', t.name, 'ownerName', t.owner_name, 'slug', t.slug) AS team,
          CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
            'id', p.id, 'externalId', p.external_id, 'name', p.name, 'position', p.position, 'nflTeam', p.nfl_team,
            'byeWeek', p.bye_week, 'rank', p.rank
          ) END AS player
         FROM mock_draft_picks mdp
         JOIN draft_picks dp ON dp.id = mdp.source_pick_id
         JOIN teams t ON t.id = dp.current_owner_team_id
         LEFT JOIN players p ON p.id = mdp.player_id
         WHERE mdp.draft_id = $1 AND mdp.mock_user_id = $2
         ORDER BY dp.pick_number`,
        [draft.id, mockBoardUserId]
      )
      : client.query(
        `SELECT dp.*,
          json_build_object('id', t.id, 'name', t.name, 'ownerName', t.owner_name, 'slug', t.slug) AS team,
          CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
            'id', p.id, 'externalId', p.external_id, 'name', p.name, 'position', p.position, 'nflTeam', p.nfl_team,
            'byeWeek', p.bye_week, 'rank', p.rank
          ) END AS player
         FROM draft_picks dp
         JOIN teams t ON t.id = dp.current_owner_team_id
         LEFT JOIN players p ON p.id = dp.player_id
         WHERE dp.draft_id = $1
         ORDER BY dp.pick_number`,
        [draft.id]
      );

    const [teamRows, playerRows, pickRows, keeperRows] = await Promise.all([
      client.query("SELECT * FROM teams ORDER BY created_at"),
      client.query(
        `SELECT p.*,
          lyd.round AS last_year_draft_round,
          lyd.drafted_team_id AS original_draft_team_id,
          eyr.team_id AS end_of_season_team_id
         FROM players p
         LEFT JOIN last_year_draft_results lyd ON lyd.player_id = p.id AND lyd.draft_id = $1
         LEFT JOIN end_of_year_rosters eyr ON eyr.player_id = p.id AND eyr.draft_id = $1
         ORDER BY COALESCE(p.rank, 9999), p.name`,
        [draft.id]
      ),
      pickQuery,
      client.query(
        "SELECT * FROM selected_keepers WHERE draft_id = $1 AND status = 'selected' ORDER BY team_id, assigned_round DESC",
        [draft.id]
      )
    ]);

    const draftOrderRows = await client.query(
      `SELECT original_team_id
       FROM draft_picks
       WHERE draft_id = $1 AND round = 1
       ORDER BY pick_number`,
      [draft.id]
    );
    const draftOrderIds = draftOrderRows.rows.map((row) => row.original_team_id);
    const unsortedTeams = teamRows.rows.map(toCamelTeam);
    const teams = draftOrderIds
      .map((teamId) => unsortedTeams.find((team) => team.id === teamId))
      .filter(Boolean);
    const players = playerRows.rows.map(toCamelPlayer);
    const selectedKeepers = keeperRows.rows.map((row) => ({
      playerId: row.player_id,
      teamId: row.team_id,
      round: row.assigned_round
    }));
    const picks = pickRows.rows.map((row) => ({
      id: row.id,
      draftId: row.draft_id,
      round: row.round,
      pickNumber: row.pick_number,
      originalTeamId: row.original_team_id,
      currentOwnerTeamId: row.current_owner_team_id,
      playerId: row.player_id,
      pickType: row.pick_type,
      sourcePickId: row.source_pick_id ?? null,
      team: row.team,
      player: row.player
    }));

    const draftedPlayerIds = new Set(picks.filter((pickRow) => pickRow.playerId).map((pickRow) => pickRow.playerId));
    const keeperOptions = players
      .filter((player) => player.endOfSeasonTeamId)
      .map((player) => {
        const team = teams.find((candidate) => candidate.id === player.endOfSeasonTeamId);
        const keeperCost = getKeeperCost(player);
        const optimizerFields = getKeeperOptimizerFields(player, keeperCost);
        return {
          playerId: player.id,
          playerName: player.name,
          position: player.position,
          nflTeam: player.nflTeam,
          rank: player.rank,
          teamId: team?.id,
          teamName: team?.name,
          lastYearDraftRound: player.lastYearDraftRound,
          originalDraftTeamId: player.originalDraftTeamId,
          keeperCost,
          ...optimizerFields,
          eligible: keeperCost != null
        };
      });

    return {
      storageMode: "postgres",
      database: await getDatabaseStatus(),
      draft: {
        id: draft.id,
        name: draft.name,
        season: draft.season,
        roundCount: draft.round_count,
        status: draft.status,
        mockLobbyTeamId: useMockLobby ? mockBoardUserId : null,
        mockUserId: useMockLobby ? mockBoardUserId : null,
        keeperLockDeadline: draft.keeper_lock_deadline,
        keeperLocked: draft.keeper_lock_deadline ? new Date(draft.keeper_lock_deadline).getTime() <= Date.now() : false
      },
      teams,
      players,
      keeperOptions,
      selectedKeepers,
      keeperValidation: validateKeeperSelections(selectedKeepers, picks),
      picks,
      availablePlayers: players.filter((player) => !draftedPlayerIds.has(player.id)),
      currentPick: picks.find((pickRow) => pickRow.playerId == null) ?? null
    };
  });
}

const SIMULATOR_STRATEGIES = new Set(["balanced", "best_available", "rb_heavy", "wr_heavy", "zero_rb", "wait_on_qb", "team_needs"]);
const SIMULATOR_RANDOMNESS = new Set(["low", "medium", "high"]);

function normalizeSimulatorStrategy(value) {
  return SIMULATOR_STRATEGIES.has(value) ? value : "balanced";
}

function normalizeSimulatorRandomness(value) {
  return SIMULATOR_RANDOMNESS.has(value) ? value : "medium";
}

function normalizeControlledTeamIds(teamIds = [], fallbackTeamId = null) {
  const ids = Array.isArray(teamIds) ? teamIds : [];
  const cleanIds = ids.filter((teamId) => UUID_PATTERN.test(String(teamId ?? "")));
  if (cleanIds.length === 0 && fallbackTeamId) {
    cleanIds.push(fallbackTeamId);
  }
  return Array.from(new Set(cleanIds));
}

function normalizeTeamStrategies(teamStrategies = {}, validTeamIds = null) {
  const validTeamSet = validTeamIds ? new Set(validTeamIds) : null;
  return Object.entries(teamStrategies ?? {}).reduce((acc, [teamId, strategy]) => {
    if (!UUID_PATTERN.test(String(teamId ?? ""))) {
      return acc;
    }
    if (validTeamSet && !validTeamSet.has(teamId)) {
      return acc;
    }
    const normalizedStrategy = normalizeSimulatorStrategy(strategy);
    if (normalizedStrategy !== "balanced" || strategy === "balanced") {
      acc[teamId] = normalizedStrategy;
    }
    return acc;
  }, {});
}

function simulatorSettingsFromRow(row, fallbackTeamId = null) {
  if (!row) {
    return {
      enabled: false,
      controlledTeamIds: normalizeControlledTeamIds([], fallbackTeamId),
      strategy: "balanced",
      teamStrategies: {},
      randomness: "medium",
      simulationSeed: "",
      simulationPreferences: {},
      lastAutoPickReason: ""
    };
  }

  return {
    enabled: Boolean(row.enabled),
    controlledTeamIds: normalizeControlledTeamIds(row.controlled_team_ids, fallbackTeamId),
    strategy: normalizeSimulatorStrategy(row.strategy),
    teamStrategies: normalizeTeamStrategies(row.team_strategies),
    randomness: normalizeSimulatorRandomness(row.randomness),
    simulationSeed: row.simulation_seed ?? "",
    simulationPreferences: row.simulation_preferences ?? {},
    lastAutoPickReason: row.last_auto_pick_reason ?? ""
  };
}

async function ensureSimulatorSettings(client, draftId, userId, fallbackTeamId = null) {
  const existing = await client.query(
    "SELECT * FROM simulator_settings WHERE draft_id = $1 AND user_id = $2",
    [draftId, userId]
  );
  if (existing.rows[0]) {
    return simulatorSettingsFromRow(existing.rows[0], fallbackTeamId);
  }

  const controlledTeamIds = normalizeControlledTeamIds([], fallbackTeamId);
  const inserted = await client.query(
    `INSERT INTO simulator_settings (draft_id, user_id, controlled_team_ids, team_strategies)
     VALUES ($1, $2, $3, '{}')
     RETURNING *`,
    [draftId, userId, JSON.stringify(controlledTeamIds)]
  );
  return simulatorSettingsFromRow(inserted.rows[0], fallbackTeamId);
}

async function loadMockSimulatorState(client, draft, userId) {
  await ensureDraftPicks(client, draft);
  await ensureMockDraftPicks(client, draft.id, userId);
  const [pickRows, playerRows] = await Promise.all([
    client.query(
      `SELECT mdp.id, mdp.player_id, mdp.pick_type, dp.round, dp.pick_number, dp.current_owner_team_id,
        CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
          'id', p.id, 'name', p.name, 'position', p.position, 'nflTeam', p.nfl_team, 'rank', p.rank
        ) END AS player
       FROM mock_draft_picks mdp
       JOIN draft_picks dp ON dp.id = mdp.source_pick_id
       LEFT JOIN players p ON p.id = mdp.player_id
       WHERE mdp.draft_id = $1 AND mdp.mock_user_id = $2
       ORDER BY dp.pick_number`,
      [draft.id, userId]
    ),
    client.query(
      `SELECT id, name, position, nfl_team AS "nflTeam", rank
       FROM players
       ORDER BY COALESCE(rank, 9999), name`
    )
  ]);

  const picks = pickRows.rows.map((row) => ({
    id: row.id,
    playerId: row.player_id,
    pickType: row.pick_type,
    round: row.round,
    pickNumber: row.pick_number,
    currentOwnerTeamId: row.current_owner_team_id,
    player: row.player
  }));
  const draftedPlayerIds = new Set(picks.filter((pickRow) => pickRow.playerId).map((pickRow) => pickRow.playerId));
  return {
    picks,
    availablePlayers: playerRows.rows
      .map((row) => ({ id: row.id, name: row.name, position: row.position, nflTeam: row.nflTeam, rank: row.rank }))
      .filter((player) => !draftedPlayerIds.has(player.id)),
    currentPick: picks.find((pickRow) => pickRow.playerId == null) ?? null
  };
}

async function writeSimulatorReason(client, draftId, userId, reason) {
  await client.query(
    `UPDATE simulator_settings
     SET updated_at = now()
     WHERE draft_id = $1 AND user_id = $2`,
    [draftId, userId]
  );
}

async function beginSimulatorRun(client, draftId, userId, teamIds = []) {
  const simulationSeed = createSimulationSeed();
  const simulationPreferences = createTeamPreferences(teamIds, simulationSeed);
  const result = await client.query(
    `UPDATE simulator_settings
     SET simulation_seed = $3, simulation_preferences = $4, updated_at = now()
     WHERE draft_id = $1 AND user_id = $2
     RETURNING *`,
    [draftId, userId, simulationSeed, JSON.stringify(simulationPreferences)]
  );
  return {
    simulationSeed,
    simulationPreferences,
    row: result.rows[0] ?? null
  };
}

function advanceSimulatorState(state, pickId, player) {
  const picks = state.picks.map((pick) => (
    pick.id === pickId
      ? { ...pick, playerId: player.id, player, pickType: "drafted" }
      : pick
  ));
  return {
    ...state,
    picks,
    availablePlayers: state.availablePlayers.filter((candidate) => candidate.id !== player.id),
    currentPick: picks.find((pick) => pick.playerId == null) ?? null
  };
}

async function autoPickOne(client, draft, user, settings, actor = {}, options = {}, simulatorState = null) {
  const state = simulatorState ?? await loadMockSimulatorState(client, draft, user.id);
  if (!state.currentPick) {
    return { picked: false, reason: "Draft complete", state };
  }
  if (!options.allowControlledTeams && settings.controlledTeamIds.includes(state.currentPick.currentOwnerTeamId)) {
    return { picked: false, reason: "Next pick is controlled by you", state };
  }

  const recommendation = chooseSimulatorPlayer({
    availablePlayers: state.availablePlayers,
    picks: state.picks,
    teamId: state.currentPick.currentOwnerTeamId,
    round: state.currentPick.round,
    pickNumber: state.currentPick.pickNumber,
    strategy: settings.teamStrategies?.[state.currentPick.currentOwnerTeamId] ?? settings.strategy,
    randomness: settings.randomness,
    simulationSeed: settings.simulationSeed,
    teamPreference: settings.simulationPreferences?.[state.currentPick.currentOwnerTeamId] ?? {}
  });
  if (!recommendation?.player) {
    return { picked: false, reason: "No available player found", state };
  }

  await client.query(
    "UPDATE mock_draft_picks SET player_id = $1, pick_type = 'drafted' WHERE id = $2 AND player_id IS NULL",
    [recommendation.player.id, state.currentPick.id]
  );
  await recordDraftEvent(client, draft.id, "pick_made", {
    pickId: state.currentPick.id,
    playerId: recommendation.player.id,
    teamId: state.currentPick.currentOwnerTeamId,
    draftMode: "mock",
    mockUserId: user.id,
    simulator: true,
    reason: recommendation.reason
  }, actor);
  const nextState = advanceSimulatorState(state, state.currentPick.id, recommendation.player);
  return {
    picked: true,
    reason: recommendation.reason,
    pickId: state.currentPick.id,
    playerId: recommendation.player.id,
    playerName: recommendation.player.name,
    state: nextState
  };
}

async function runSimulatorAction({ draftSeason = DEFAULT_DRAFT.season, user, actor = {}, action }) {
  let summary = { pickedCount: 0, lastReason: "" };
  await withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    if (draft.status !== "mock") {
      throw new Error("Simulator only runs in Mock Draft mode.");
    }
    let settings = await ensureSimulatorSettings(client, draft.id, user.id, user.teamId);
    if (!settings.enabled && action !== "reset") {
      throw new Error("Enable the simulator before auto-picking.");
    }

    if (action === "reset") {
      const result = await client.query(
        `UPDATE mock_draft_picks
         SET player_id = NULL, pick_type = 'open'
         WHERE draft_id = $1 AND mock_user_id = $2 AND pick_type = 'drafted'
         RETURNING id`,
        [draft.id, user.id]
      );
      await recordDraftEvent(client, draft.id, "draft_reset", {
        clearedPickCount: result.rowCount,
        draftMode: "mock",
        mockUserId: user.id,
        simulator: true
      }, actor);
      await beginSimulatorRun(client, draft.id, user.id, []);
      summary = { pickedCount: 0, resetCount: result.rowCount, lastReason: "Simulation reset" };
      return;
    }

    const teamIds = (await client.query("SELECT id FROM teams ORDER BY created_at, name")).rows.map((row) => row.id);
    const runState = await beginSimulatorRun(client, draft.id, user.id, teamIds);
    settings = {
      ...settings,
      simulationSeed: runState.simulationSeed,
      simulationPreferences: runState.simulationPreferences
    };

    const maxIterations = action === "autocomplete" ? 250 : action === "round" ? 12 : action === "until-user" ? 250 : 1;
    let startingRound = null;
    let simulatorState = await loadMockSimulatorState(client, draft, user.id);
    for (let index = 0; index < maxIterations; index += 1) {
      if (!simulatorState.currentPick) {
        break;
      }
      if (startingRound == null) {
        startingRound = simulatorState.currentPick.round;
      }
      if (action === "round" && simulatorState.currentPick.round !== startingRound) {
        break;
      }
      if ((action === "until-user" || action === "next") && settings.controlledTeamIds.includes(simulatorState.currentPick.currentOwnerTeamId)) {
        break;
      }

      const result = await autoPickOne(client, draft, user, settings, actor, {
        allowControlledTeams: action === "autocomplete"
      }, simulatorState);
      if (!result.picked) {
        summary.lastReason = result.reason;
        break;
      }
      simulatorState = result.state;
      summary.pickedCount += 1;
      summary.lastReason = result.reason;
    }
    if (summary.lastReason) {
      await writeSimulatorReason(client, draft.id, user.id, summary.lastReason);
    }
  });

  return {
    ...summary,
    state: await getPostgresDraftState({ season: draftSeason, mockUserId: user.id }),
    settings: await getSimulatorSettings(draftSeason, user)
  };
}

export async function getSimulatorSettings(draftSeason = DEFAULT_DRAFT.season, user) {
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    const settings = await ensureSimulatorSettings(client, draft.id, user.id, user.teamId);
    return {
      ...settings,
      draftMode: draft.status === "mock" ? "mock" : "real"
    };
  });
}

export async function updateSimulatorSettings(draftSeason = DEFAULT_DRAFT.season, user, input = {}) {
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    const controlledTeamIds = normalizeControlledTeamIds(input.controlledTeamIds, user.teamId);
    const strategyTeamIds = Object.keys(input.teamStrategies ?? {}).filter((teamId) => UUID_PATTERN.test(String(teamId ?? "")));
    const requestedTeamIds = Array.from(new Set([...controlledTeamIds, ...strategyTeamIds]));
    const validTeams = requestedTeamIds.length
      ? await client.query("SELECT id FROM teams WHERE id = ANY($1::uuid[])", [requestedTeamIds])
      : { rows: [] };
    const validRequestedTeamIds = validTeams.rows.map((row) => row.id);
    const validRequestedTeamSet = new Set(validRequestedTeamIds);
    const validControlledTeamIds = controlledTeamIds.filter((teamId) => validRequestedTeamSet.has(teamId));
    const teamStrategies = normalizeTeamStrategies(input.teamStrategies, validRequestedTeamIds);
    const result = await client.query(
      `INSERT INTO simulator_settings (draft_id, user_id, enabled, controlled_team_ids, strategy, team_strategies, randomness, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (draft_id, user_id)
       DO UPDATE SET enabled = EXCLUDED.enabled, controlled_team_ids = EXCLUDED.controlled_team_ids,
         strategy = EXCLUDED.strategy, team_strategies = EXCLUDED.team_strategies,
         randomness = EXCLUDED.randomness, updated_at = now()
       RETURNING *`,
      [
        draft.id,
        user.id,
        Boolean(input.enabled),
        JSON.stringify(validControlledTeamIds.length ? validControlledTeamIds : normalizeControlledTeamIds([], user.teamId)),
        normalizeSimulatorStrategy(input.strategy),
        JSON.stringify(teamStrategies),
        normalizeSimulatorRandomness(input.randomness)
      ]
    );
    return {
      ...simulatorSettingsFromRow(result.rows[0], user.teamId),
      draftMode: draft.status === "mock" ? "mock" : "real"
    };
  });
}

export async function userCanMakeMockPick(draftSeason = DEFAULT_DRAFT.season, user, pickId, canManageDraft = false) {
  if (canManageDraft) {
    return true;
  }
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    if (draft.status !== "mock") {
      return true;
    }
    await ensureMockDraftPicks(client, draft.id, user.id);
    const settings = await ensureSimulatorSettings(client, draft.id, user.id, user.teamId);
    const pick = await client.query(
      `SELECT dp.current_owner_team_id
       FROM mock_draft_picks mdp
       JOIN draft_picks dp ON dp.id = mdp.source_pick_id
       WHERE mdp.draft_id = $1 AND mdp.mock_user_id = $2 AND mdp.id = $3`,
      [draft.id, user.id, pickId]
    );
    return settings.controlledTeamIds.includes(pick.rows[0]?.current_owner_team_id);
  });
}

export function autoPickSimulatorNext(args) {
  return runSimulatorAction({ ...args, action: "next" });
}

export function autoPickSimulatorUntilUser(args) {
  return runSimulatorAction({ ...args, action: "until-user" });
}

export function autoPickSimulatorRound(args) {
  return runSimulatorAction({ ...args, action: "round" });
}

export function autocompleteSimulatorDraft(args) {
  return runSimulatorAction({ ...args, action: "autocomplete" });
}

export function resetSimulatorDraft(args) {
  return runSimulatorAction({ ...args, action: "reset" });
}

export async function makePostgresPick({ pickId, playerId, teamId, actor = {}, mockUserId = null, mockLobbyTeamId = null, draftSeason = DEFAULT_DRAFT.season }) {
  let resultDraftSeason = DEFAULT_DRAFT.season;
  const mockBoardUserId = getMockBoardUserId({ mockUserId, mockLobbyTeamId });
  await withDb(async (client) => {
    const requestedDraft = await getOrCreateDraft(client, draftSeason);
    const requestedDraftMode = requestedDraft.status === "mock" ? "mock" : "real";
    if (requestedDraftMode === "mock") {
      await ensureDraftPicks(client, requestedDraft);
      await ensureMockDraftPicks(client, requestedDraft.id, mockBoardUserId);
      const pick = await client.query(
        `SELECT mdp.*, dp.pick_number, dp.round, dp.current_owner_team_id
         FROM mock_draft_picks mdp
         JOIN draft_picks dp ON dp.id = mdp.source_pick_id
         WHERE mdp.draft_id = $1 AND mdp.mock_user_id = $2 AND mdp.id = $3
         FOR UPDATE OF mdp`,
        [requestedDraft.id, mockBoardUserId, pickId]
      );
      const currentPick = pick.rows[0];
      if (!currentPick) {
        throw new Error("Draft state refreshed; try again.");
      }
      if (currentPick.player_id) {
        throw new Error("Pick already taken.");
      }
      const player = await client.query("SELECT id FROM players WHERE id = $1", [playerId]);
      if (!player.rows[0]) {
        throw new Error("Player not found.");
      }

      const alreadyUsed = await client.query(
        "SELECT id FROM mock_draft_picks WHERE draft_id = $1 AND mock_user_id = $2 AND player_id = $3 LIMIT 1",
        [requestedDraft.id, mockBoardUserId, playerId]
      );
      if (alreadyUsed.rows[0]) {
        throw new Error("That player is already drafted or kept in this mock lobby.");
      }

      await client.query("UPDATE mock_draft_picks SET player_id = $1, pick_type = 'drafted' WHERE id = $2", [playerId, pickId]);
      await recordDraftEvent(client, requestedDraft.id, "pick_made", {
        pickId,
        playerId,
        teamId,
        draftMode: "mock",
        mockUserId: mockBoardUserId
      }, actor);
      resultDraftSeason = requestedDraft.season;
      return;
    }

    const pick = await client.query(
      `SELECT dp.*, d.season AS draft_season, d.status AS draft_status
       FROM draft_picks dp
       JOIN drafts d ON d.id = dp.draft_id
       WHERE dp.id = $1
       FOR UPDATE OF dp`,
      [pickId]
    );
    const currentPick = pick.rows[0];
    if (!currentPick) {
      throw new Error("Pick not found.");
    }
    resultDraftSeason = currentPick.draft_season;
    if (currentPick.player_id) {
      throw new Error("Pick already taken.");
    }
    const draftMode = currentPick.draft_status === "mock" ? "mock" : "real";
    const canOverrideOwner = isCommissionerActor(actor);
    const effectiveTeamId = canOverrideOwner ? teamId : actor.actorTeamId;
    if (!canOverrideOwner && currentPick.current_owner_team_id !== effectiveTeamId) {
      throw new Error("You can only draft for your own team.");
    }

    const alreadyUsed = await client.query(
      "SELECT id FROM draft_picks WHERE draft_id = $1 AND player_id = $2 LIMIT 1",
      [currentPick.draft_id, playerId]
    );
    if (alreadyUsed.rows[0]) {
      throw new Error("That player is already drafted or kept.");
    }

    await client.query("UPDATE draft_picks SET player_id = $1, pick_type = 'drafted' WHERE id = $2", [playerId, pickId]);
    await recordDraftEvent(client, currentPick.draft_id, "pick_made", { pickId, playerId, teamId: effectiveTeamId, draftMode }, actor);
  });
  return getPostgresDraftState({ season: resultDraftSeason, mockUserId: mockBoardUserId });
}

export async function undoPostgresPick(draftSeason = DEFAULT_DRAFT.season, mockUserId = null, actor = {}) {
  await withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    const draftMode = draft.status === "mock" ? "mock" : "real";
    if (draftMode === "mock") {
      await ensureDraftPicks(client, draft);
      await ensureMockDraftPicks(client, draft.id, mockUserId);
      const result = await client.query(
        `SELECT mdp.id, dp.pick_number
         FROM mock_draft_picks mdp
         JOIN draft_picks dp ON dp.id = mdp.source_pick_id
         WHERE mdp.draft_id = $1 AND mdp.mock_user_id = $2 AND mdp.pick_type = 'drafted' AND mdp.player_id IS NOT NULL
         ORDER BY dp.pick_number DESC
         LIMIT 1`,
        [draft.id, mockUserId]
      );
      const pick = result.rows[0];
      if (!pick) {
        throw new Error("There is no drafted pick to undo in this mock lobby.");
      }

      await client.query("UPDATE mock_draft_picks SET player_id = NULL, pick_type = 'open' WHERE id = $1", [pick.id]);
      await recordDraftEvent(client, draft.id, "pick_undone", {
        pickId: pick.id,
        pickNumber: pick.pick_number,
        draftMode,
        mockUserId
      }, actor);
      return;
    }

    const result = await client.query(
      `SELECT id FROM draft_picks
       WHERE draft_id = $1 AND pick_type = 'drafted' AND player_id IS NOT NULL
       ORDER BY pick_number DESC
       LIMIT 1`,
      [draft.id]
    );
    const pick = result.rows[0];
    if (!pick) {
      throw new Error("There is no drafted pick to undo.");
    }

    await client.query("UPDATE draft_picks SET player_id = NULL, pick_type = 'open' WHERE id = $1", [pick.id]);
    await recordDraftEvent(client, draft.id, "pick_undone", { pickId: pick.id, draftMode }, actor);
  });
  return getPostgresDraftState({ season: draftSeason, mockUserId });
}

export async function editPostgresPick({ draftSeason = DEFAULT_DRAFT.season, pickId, playerId = null, actor = {} }) {
  const cleanActor = cleanAuditActor(actor);
  if (!isCommissionerActor(cleanActor)) {
    throw new Error("Only the commissioner can edit a specific pick.");
  }

  await withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    const result = await client.query(
      `SELECT dp.*, old_player.name AS old_player_name, old_player.position AS old_player_position, old_player.nfl_team AS old_player_team
       FROM draft_picks dp
       LEFT JOIN players old_player ON old_player.id = dp.player_id
       WHERE dp.draft_id = $1 AND dp.id = $2
       FOR UPDATE OF dp`,
      [draft.id, pickId]
    );
    const pick = result.rows[0];
    if (!pick) {
      throw new Error("Pick not found for this draft season.");
    }
    if (pick.pick_type === "keeper") {
      throw new Error("Keeper picks should be changed from the Keepers page.");
    }

    let nextPlayer = null;
    if (playerId) {
      const playerResult = await client.query("SELECT id, name, position, nfl_team FROM players WHERE id = $1", [playerId]);
      nextPlayer = playerResult.rows[0];
      if (!nextPlayer) {
        throw new Error("Player not found.");
      }

      const alreadyUsed = await client.query(
        "SELECT pick_number FROM draft_picks WHERE draft_id = $1 AND player_id = $2 AND id <> $3 LIMIT 1",
        [draft.id, playerId, pickId]
      );
      if (alreadyUsed.rows[0]) {
        throw new Error(`That player is already used at pick ${alreadyUsed.rows[0].pick_number}.`);
      }
    }

    await client.query(
      "UPDATE draft_picks SET player_id = $1, pick_type = $2 WHERE id = $3",
      [playerId || null, playerId ? "drafted" : "open", pickId]
    );
    await recordDraftEvent(client, draft.id, "pick_edited", {
      pickId,
      pickNumber: pick.pick_number,
      round: pick.round,
      previousPlayerId: pick.player_id,
      previousPlayerName: pick.old_player_name,
      nextPlayerId: playerId || null,
      nextPlayerName: nextPlayer?.name ?? null
    }, cleanActor);
  });
  return getPostgresDraftState({ season: draftSeason });
}

export async function resetPostgresDraftedPicks(draftSeason = DEFAULT_DRAFT.season, actor = {}, mockUserId = null) {
  await withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    const draftMode = draft.status === "mock" ? "mock" : "real";
    if (draftMode === "mock") {
      await ensureDraftPicks(client, draft);
      await ensureMockDraftPicks(client, draft.id, mockUserId);
      const result = await client.query(
        `UPDATE mock_draft_picks
         SET player_id = NULL, pick_type = 'open'
         WHERE draft_id = $1 AND mock_user_id = $2 AND pick_type = 'drafted'
         RETURNING id`,
        [draft.id, mockUserId]
      );
      await ensureMockDraftPicks(client, draft.id, mockUserId);
      await recordDraftEvent(client, draft.id, "draft_reset", {
        clearedPickCount: result.rowCount,
        draftMode,
        mockUserId
      }, actor);
      return;
    }

    if (draftMode !== "mock" && !isCommissionerActor(actor)) {
      throw new Error("Only the commissioner can reset a real draft.");
    }

    const result = await client.query(
      `UPDATE draft_picks
       SET player_id = NULL, pick_type = 'open'
       WHERE draft_id = $1 AND pick_type = 'drafted'
       RETURNING id`,
      [draft.id]
    );

    await placeSelectedKeepers(client, draft.id);
    await recordDraftEvent(client, draft.id, "draft_reset", {
      clearedPickCount: result.rowCount,
      draftMode
    }, actor);
  });
  return getPostgresDraftState({ season: draftSeason, mockUserId });
}

export async function markDraftAsSourceForNextYear(draftSeason = DEFAULT_DRAFT.season, actor = {}) {
  return withDb(async (client) => {
    const sourceDraft = await getOrCreateDraft(client, draftSeason);
    const nextDraft = await getOrCreateDraft(client, Number(draftSeason) + 1);
    await ensureDraftPicks(client, nextDraft);

    const picks = await client.query(
      `SELECT player_id, current_owner_team_id, round, pick_number
       FROM draft_picks
       WHERE draft_id = $1 AND player_id IS NOT NULL
       ORDER BY pick_number`,
      [sourceDraft.id]
    );

    if (picks.rows.length === 0) {
      throw new Error("There are no drafted or kept players to save as next year's source.");
    }

    await client.query("DELETE FROM last_year_draft_results WHERE draft_id = $1", [nextDraft.id]);

    for (const pick of picks.rows) {
      await client.query(
        `INSERT INTO last_year_draft_results (draft_id, player_id, drafted_team_id, round, pick_number)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (draft_id, player_id)
         DO UPDATE SET drafted_team_id = EXCLUDED.drafted_team_id, round = EXCLUDED.round, pick_number = EXCLUDED.pick_number`,
        [nextDraft.id, pick.player_id, pick.current_owner_team_id, pick.round, pick.pick_number]
      );
    }

    await client.query("UPDATE drafts SET status = 'finalized' WHERE id = $1", [sourceDraft.id]);
    await recordDraftEvent(client, sourceDraft.id, "draft_finalized", {
      nextDraftSeason: nextDraft.season,
      savedPlayerCount: picks.rows.length
    }, actor);

    return {
      count: picks.rows.length,
      draftSeason: sourceDraft.season,
      nextDraftSeason: nextDraft.season
    };
  });
}

export async function getAuditLog(draftSeason = DEFAULT_DRAFT.season, limit = 50) {
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const result = await client.query(
      `SELECT de.id,
        de.event_type,
        de.payload,
        de.created_at,
        de.actor_label,
        u.id AS actor_user_id,
        u.display_name AS actor_user_name,
        u.email AS actor_user_email,
        t.id AS actor_team_id,
        t.name AS actor_team_name,
        d.season AS draft_season
       FROM draft_events de
       JOIN drafts d ON d.id = de.draft_id
       LEFT JOIN app_users u ON u.id = de.actor_user_id
       LEFT JOIN teams t ON t.id = de.actor_team_id
       WHERE de.draft_id = $1 AND de.event_type = ANY($3)
       ORDER BY de.created_at DESC
       LIMIT $2`,
      [draft.id, boundedLimit, AUDIT_LOG_EVENT_TYPES]
    );

    return result.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      payload: row.payload ?? {},
      createdAt: row.created_at,
      actorUserId: row.actor_user_id,
      actorTeamId: row.actor_team_id,
      actorName: row.actor_user_name ?? row.actor_user_email ?? row.actor_team_name ?? row.actor_label ?? "Unknown",
      draftSeason: row.draft_season
    }));
  });
}

export async function getFleaflickerSyncStatus(draftSeason = DEFAULT_DRAFT.season, includeHistory = false) {
  return withDb(async (client) => {
    const draft = await getOrCreateDraft(client, draftSeason);
    const result = await client.query(
      includeHistory
        ? `SELECT
        fsr.id,
        fsr.sync_type,
        fsr.status,
        fsr.result,
        fsr.error_message,
        fsr.started_at,
        fsr.finished_at,
        fsr.actor_label,
        u.display_name AS actor_user_name,
        u.email AS actor_user_email,
        t.name AS actor_team_name
       FROM fleaflicker_sync_runs fsr
       LEFT JOIN app_users u ON u.id = fsr.actor_user_id
       LEFT JOIN teams t ON t.id = fsr.actor_team_id
       WHERE fsr.draft_id = $1
       ORDER BY fsr.finished_at DESC`
        : `SELECT DISTINCT ON (sync_type)
        fsr.id,
        fsr.sync_type,
        fsr.status,
        fsr.result,
        fsr.error_message,
        fsr.started_at,
        fsr.finished_at,
        fsr.actor_label,
        u.display_name AS actor_user_name,
        u.email AS actor_user_email,
        t.name AS actor_team_name
       FROM fleaflicker_sync_runs fsr
       LEFT JOIN app_users u ON u.id = fsr.actor_user_id
       LEFT JOIN teams t ON t.id = fsr.actor_team_id
       WHERE fsr.draft_id = $1
       ORDER BY sync_type, finished_at DESC`,
      [draft.id]
    );

    return result.rows.map((row) => ({
      id: row.id,
      syncType: row.sync_type,
      status: row.status,
      result: row.result ?? {},
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      actorName: row.actor_user_name ?? row.actor_user_email ?? row.actor_team_name ?? row.actor_label ?? "Unknown"
    }));
  });
}

export async function getPlayerMatchingReview() {
  return withDb(async (client) => {
    const [result, decisions] = await Promise.all([
      client.query(
      `WITH normalized_players AS (
        SELECT id,
          external_id,
          name,
          position,
          nfl_team,
          rank,
          regexp_replace(
            trim(regexp_replace(
              regexp_replace(
                regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g'),
                '(^| )(jr|sr|ii|iii|iv|v)( |$)',
                ' ',
                'g'
              ),
              '\\s+',
              ' ',
              'g'
            )),
            '^kenneth( |$)',
            'kenny\\1'
          ) AS normalized_name
        FROM players
      )
      SELECT normalized_name,
        json_agg(json_build_object(
          'id', id,
          'externalId', external_id,
          'name', name,
          'position', position,
          'nflTeam', nfl_team,
          'rank', rank
        ) ORDER BY rank NULLS LAST, name) AS players
      FROM normalized_players
      WHERE normalized_name <> ''
      GROUP BY normalized_name
      HAVING COUNT(*) > 1
      ORDER BY normalized_name`
      ),
      client.query("SELECT normalized_name, player_id_set, decision FROM player_match_decisions")
    ]);

    const hiddenDecisionKeys = new Set(decisions.rows.map((row) => `${row.normalized_name}:${row.player_id_set}`));

    return result.rows
      .map((row) => ({
        normalizedName: row.normalized_name,
        playerIdSet: playerIdSet((row.players ?? []).map((player) => player.id)),
        players: row.players ?? []
      }))
      .filter((row) => !hiddenDecisionKeys.has(`${row.normalizedName}:${row.playerIdSet}`));
  });
}

export async function approvePlayerMatch({ normalizedName, targetPlayerId, sourcePlayerIds = [], actor = {} }) {
  return withDb(async (client) => {
    const allPlayerIds = [targetPlayerId, ...sourcePlayerIds].filter(Boolean);
    const uniquePlayerIds = Array.from(new Set(allPlayerIds));
    if (!normalizedName || !targetPlayerId || sourcePlayerIds.length === 0 || uniquePlayerIds.length < 2) {
      throw new Error("A target player and at least one source player are required to approve a match.");
    }

    const existing = await client.query("SELECT id, name FROM players WHERE id = ANY($1::uuid[])", [uniquePlayerIds]);
    if (existing.rows.length !== uniquePlayerIds.length) {
      throw new Error("One or more selected players no longer exists.");
    }

    for (const sourcePlayerId of sourcePlayerIds) {
      await mergePlayerRows(client, sourcePlayerId, targetPlayerId);
    }

    const auditActor = await resolveAuditActor(client, actor);
    await client.query(
      `INSERT INTO player_match_decisions (normalized_name, player_id_set, decision, target_player_id, source_player_ids, actor_user_id, actor_team_id, actor_label)
       VALUES ($1, $2, 'approved', $3, $4, $5, $6, $7)
       ON CONFLICT (normalized_name, player_id_set)
       DO UPDATE SET decision = 'approved', target_player_id = EXCLUDED.target_player_id,
         source_player_ids = EXCLUDED.source_player_ids, actor_user_id = EXCLUDED.actor_user_id, actor_team_id = EXCLUDED.actor_team_id,
         actor_label = EXCLUDED.actor_label, created_at = now()`,
      [normalizedName, playerIdSet(uniquePlayerIds), targetPlayerId, JSON.stringify(sourcePlayerIds), auditActor.actorUserId, auditActor.actorTeamId, auditActor.actorLabel]
    );

    return { mergedCount: sourcePlayerIds.length };
  });
}

export async function rejectPlayerMatch({ normalizedName, playerIds = [], actor = {} }) {
  return withDb(async (client) => {
    const uniquePlayerIds = Array.from(new Set(playerIds.filter(Boolean)));
    if (!normalizedName || uniquePlayerIds.length < 2) {
      throw new Error("At least two players are required to reject a match.");
    }

    const auditActor = await resolveAuditActor(client, actor);
    await client.query(
      `INSERT INTO player_match_decisions (normalized_name, player_id_set, decision, source_player_ids, actor_user_id, actor_team_id, actor_label)
       VALUES ($1, $2, 'rejected', $3, $4, $5, $6)
       ON CONFLICT (normalized_name, player_id_set)
       DO UPDATE SET decision = 'rejected', source_player_ids = EXCLUDED.source_player_ids,
         actor_user_id = EXCLUDED.actor_user_id, actor_team_id = EXCLUDED.actor_team_id, actor_label = EXCLUDED.actor_label, created_at = now()`,
      [normalizedName, playerIdSet(uniquePlayerIds), JSON.stringify(uniquePlayerIds), auditActor.actorUserId, auditActor.actorTeamId, auditActor.actorLabel]
    );

    return { rejected: true };
  });
}
