import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import { getDraftState, makePick, resetDraftedPicks, undoLastPick } from "./draftStore.js";
import { getDatabaseStatus } from "./db.js";
import {
  approvePlayerMatch,
  createAccountAdmin,
  getPostgresDraftState,
  getAccounts,
  getAuditLog,
  getCurrentUser,
  getFleaflickerSyncStatus,
  getPlayerMatchingReview,
  importFleaflickerEndOfSeasonRosters,
  importFleaflickerTradedPicks,
  importLastYearDraft,
  importLastYearDraftRounds,
  importPlayers,
  importRosters,
  importSelectedKeepers,
  importTeams,
  importTradedPicks,
  loginAccount,
  logoutAccount,
  markDraftAsSourceForNextYear,
  editPostgresPick,
  makePostgresPick,
  registerAccount,
  recordFleaflickerSyncRun,
  rejectPlayerMatch,
  resetPostgresDraftedPicks,
  resetAccountPasswordAdmin,
  rebuildSelectedKeeperPicks,
  seedLastYearDraftSource,
  setAccountPassword,
  undoPostgresPick,
  updateAccountAdmin,
  updateDraftOrder,
  updateDraftMode,
  updateKeeperLockDeadline,
  updateSelectedKeepers
} from "./postgresStore.js";

const port = Number(process.env.PORT ?? 4000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: clientOrigin,
    methods: ["GET", "POST"]
  }
});

app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: "5mb" }));

function getDraftSeason(value, fallback = 2026) {
  const season = Number(value ?? fallback);
  return Number.isFinite(season) ? season : fallback;
}

function getAuditActor(body = {}) {
  return {
    actorTeamId: body?.actorTeamId ?? null,
    actorLabel: body?.actorLabel ?? "Unknown"
  };
}

function requestError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function getBearerToken(request) {
  const header = request.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function hasPermission(user, permission) {
  return Boolean(user?.permissions?.includes("commissioner_admin") || user?.permissions?.includes(permission));
}

function actorForUser(user, elevated = false) {
  return {
    actorUserId: user?.id ?? null,
    actorTeamId: user?.teamId ?? null,
    actorLabel: user?.displayName ?? "Unknown",
    isCommissioner: Boolean(elevated || user?.permissions?.includes("commissioner_admin"))
  };
}

async function requireLoggedIn(request) {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    throw requestError(400, "PostgreSQL is required for account permissions.");
  }

  const user = await getCurrentUser(getBearerToken(request));
  if (!user) {
    throw requestError(401, "Log in to continue.");
  }
  return user;
}

async function requirePermission(request, permission) {
  const user = await requireLoggedIn(request);
  if (!hasPermission(user, permission)) {
    throw requestError(403, "Your account does not have permission for this action.");
  }
  return user;
}

async function runTrackedFleaflickerSync({ syncType, draftSeason, actor, operation }) {
  const startedAt = new Date().toISOString();
  try {
    const result = await operation();
    await recordFleaflickerSyncRun({
      draftSeason: result?.draftSeason ?? draftSeason,
      syncType,
      status: "success",
      result,
      startedAt,
      actor
    });
    return { ok: true, result };
  } catch (error) {
    await recordFleaflickerSyncRun({
      draftSeason,
      syncType,
      status: "error",
      result: {},
      errorMessage: error.message,
      startedAt,
      actor
    });
    return { ok: false, error: error.message };
  }
}

async function getActiveDraftState(season = 2026, mockLobbyTeamId = null) {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    return {
      ...getDraftState(),
      storageMode: "memory",
      database
    };
  }

  return getPostgresDraftState({ season, mockLobbyTeamId });
}

async function emitDraftState(season = 2026) {
  const state = await getActiveDraftState(season);
  io.emit("draft:updated", state);
  return state;
}

function asyncRoute(handler) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      response.status(error.statusCode ?? 400).json({ error: error.message });
    }
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csvFromRows(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function sendDownload(response, filename, content, contentType) {
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.send(content);
}

function fleaflickerPlayerId(player) {
  const externalId = player?.externalId ?? "";
  return externalId.startsWith("fleaflicker:") ? externalId.replace("fleaflicker:", "") : externalId;
}

function teamNameById(teams) {
  return teams.reduce((acc, team) => {
    acc[team.id] = team.name;
    return acc;
  }, {});
}

function playerById(players) {
  return players.reduce((acc, player) => {
    acc[player.id] = player;
    return acc;
  }, {});
}

function draftBoardRows(state) {
  const teamsById = teamNameById(state.teams ?? []);
  return [
    ["Pick", "Round", "Original Team", "Current Owner", "Traded", "Pick Type", "Player", "Position", "NFL Team", "Rank", "Fleaflicker Player ID"],
    ...(state.picks ?? []).slice().sort((a, b) => a.pickNumber - b.pickNumber).map((pick) => [
      pick.pickNumber,
      pick.round,
      teamsById[pick.originalTeamId] ?? "",
      pick.team?.name ?? teamsById[pick.currentOwnerTeamId] ?? "",
      pick.originalTeamId !== pick.currentOwnerTeamId ? "Yes" : "No",
      pick.pickType,
      pick.player?.name ?? "",
      pick.player?.position ?? "",
      pick.player?.nflTeam ?? "",
      pick.player?.rank ?? "",
      fleaflickerPlayerId(pick.player)
    ])
  ];
}

function keeperRows(state) {
  const playersById = playerById(state.players ?? []);
  const teamsById = teamNameById(state.teams ?? []);
  const keeperOptionsByPlayerId = (state.keeperOptions ?? []).reduce((acc, keeper) => {
    acc[keeper.playerId] = keeper;
    return acc;
  }, {});
  const keeperPickByPlayerId = (state.picks ?? []).reduce((acc, pick) => {
    if (pick.pickType === "keeper" && pick.playerId) {
      acc[pick.playerId] = pick;
    }
    return acc;
  }, {});

  return [
    ["Fantasy Team", "Player", "Position", "NFL Team", "Rank", "Last Year Round", "Keeper Cost Round", "Assigned Pick"],
    ...(state.selectedKeepers ?? []).map((keeper) => {
      const player = playersById[keeper.playerId] ?? {};
      const option = keeperOptionsByPlayerId[keeper.playerId] ?? {};
      const pick = keeperPickByPlayerId[keeper.playerId];
      return [
        teamsById[keeper.teamId] ?? option.teamName ?? "",
        player.name ?? option.playerName ?? "",
        player.position ?? option.position ?? "",
        player.nflTeam ?? option.nflTeam ?? "",
        player.rank ?? option.rank ?? "",
        option.lastYearDraftRound ?? "",
        keeper.round,
        pick ? `Round ${pick.round}, Pick ${pick.pickNumber}` : ""
      ];
    })
  ];
}

function fleaflickerEntryRows(state) {
  const teamOrder = new Map((state.teams ?? []).map((team, index) => [team.id, index]));
  const draftedPicks = (state.picks ?? [])
    .filter((pick) => pick.player)
    .slice()
    .sort((a, b) => {
      const teamCompare = (teamOrder.get(a.currentOwnerTeamId) ?? 999) - (teamOrder.get(b.currentOwnerTeamId) ?? 999);
      return teamCompare || a.pickNumber - b.pickNumber;
    });

  return [
    ["Fantasy Team", "Round", "Pick", "Player", "Position", "NFL Team", "Fleaflicker Player ID", "Entry Type"],
    ...draftedPicks.map((pick) => [
      pick.team?.name,
      pick.round,
      pick.pickNumber,
      pick.player?.name,
      pick.player?.position,
      pick.player?.nflTeam,
      fleaflickerPlayerId(pick.player),
      pick.pickType === "keeper" ? "Keeper" : "Drafted"
    ])
  ];
}

function playersRows(state) {
  return [
    ["ID", "External ID", "Player", "Position", "NFL Team", "Bye", "Rank", "Last Year Round", "Original Draft Team ID", "End Season Team ID"],
    ...(state.players ?? []).map((player) => [
      player.id,
      player.externalId,
      player.name,
      player.position,
      player.nflTeam,
      player.byeWeek,
      player.rank,
      player.lastYearDraftRound,
      player.originalDraftTeamId,
      player.endOfSeasonTeamId
    ])
  ];
}

function teamsRows(state) {
  return [
    ["ID", "Slug", "Team", "Owner"],
    ...(state.teams ?? []).map((team) => [team.id, team.slug, team.name, team.ownerName])
  ];
}

function tradedPickRows(state) {
  const teamsById = teamNameById(state.teams ?? []);
  return [
    ["Round", "Pick", "Original Team", "Current Owner"],
    ...(state.picks ?? [])
      .filter((pick) => pick.originalTeamId !== pick.currentOwnerTeamId)
      .sort((a, b) => a.pickNumber - b.pickNumber)
      .map((pick) => [pick.round, pick.pickNumber, teamsById[pick.originalTeamId] ?? "", teamsById[pick.currentOwnerTeamId] ?? pick.team?.name ?? ""])
  ];
}

function auditLogRows(events) {
  return [
    ["Timestamp", "Actor", "Action", "Details"],
    ...events.map((event) => [
      event.createdAt,
      event.actorName,
      event.eventType,
      JSON.stringify(event.payload ?? {})
    ])
  ];
}

function syncHistoryRows(syncRuns) {
  return [
    ["Started", "Finished", "Actor", "Sync Type", "Status", "Error", "Result"],
    ...syncRuns.map((run) => [
      run.startedAt,
      run.finishedAt,
      run.actorName,
      run.syncType,
      run.status,
      run.errorMessage,
      JSON.stringify(run.result ?? {})
    ])
  ];
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function zipDateTime(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = zipDateTime();

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, "utf8");
    const dataBuffer = Buffer.from(file.content, "utf8");
    const checksum = crc32(dataBuffer);
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50), writeUInt16(20), writeUInt16(0), writeUInt16(0), writeUInt16(time), writeUInt16(date),
      writeUInt32(checksum), writeUInt32(dataBuffer.length), writeUInt32(dataBuffer.length), writeUInt16(nameBuffer.length), writeUInt16(0)
    ]);
    localParts.push(localHeader, nameBuffer, dataBuffer);
    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50), writeUInt16(20), writeUInt16(20), writeUInt16(0), writeUInt16(0), writeUInt16(time), writeUInt16(date),
      writeUInt32(checksum), writeUInt32(dataBuffer.length), writeUInt32(dataBuffer.length), writeUInt16(nameBuffer.length),
      writeUInt16(0), writeUInt16(0), writeUInt16(0), writeUInt16(0), writeUInt32(0), writeUInt32(offset)
    ]);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.concat([
    writeUInt32(0x06054b50), writeUInt16(0), writeUInt16(0), writeUInt16(files.length), writeUInt16(files.length),
    writeUInt32(centralSize), writeUInt32(offset), writeUInt16(0)
  ]);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

app.get("/health", asyncRoute(async (_request, response) => {
  response.json({ ok: true, database: await getDatabaseStatus() });
}));

app.get("/api/storage-status", asyncRoute(async (_request, response) => {
  response.json(await getDatabaseStatus());
}));

app.get("/api/draft-state", asyncRoute(async (request, response) => {
  response.json(await getActiveDraftState(getDraftSeason(request.query?.season), request.query?.mockLobbyTeamId ?? null));
}));

app.get("/api/accounts", asyncRoute(async (_request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.json([]);
    return;
  }

  await requirePermission(_request, "commissioner_admin");
  response.json(await getAccounts());
}));

app.post("/api/admin/accounts", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL is required for account administration." });
    return;
  }

  const user = await requirePermission(request, "commissioner_admin");
  response.status(201).json(await createAccountAdmin(request.body, actorForUser(user, true)));
}));

app.post("/api/admin/accounts/:accountId", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL is required for account administration." });
    return;
  }

  await requirePermission(request, "commissioner_admin");
  response.json(await updateAccountAdmin(request.params.accountId, request.body));
}));

app.post("/api/admin/accounts/:accountId/reset-password", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL is required for account administration." });
    return;
  }

  await requirePermission(request, "commissioner_admin");
  response.json(await resetAccountPasswordAdmin(request.params.accountId));
}));

app.post("/api/auth/set-password", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL is required for accounts." });
    return;
  }

  response.json(await setAccountPassword({
    email: request.body?.email,
    password: request.body?.password
  }));
}));

app.post("/api/auth/login", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL is required for accounts." });
    return;
  }

  response.json(await loginAccount({
    email: request.body?.email,
    password: request.body?.password
  }));
}));

app.post("/api/auth/register", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL is required for accounts." });
    return;
  }

  response.status(201).json(await registerAccount({
    name: request.body?.name,
    email: request.body?.email,
    password: request.body?.password
  }));
}));

app.get("/api/auth/me", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.json({ user: null });
    return;
  }

  response.json({ user: await getCurrentUser(getBearerToken(request)) });
}));

app.post("/api/auth/logout", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.json({ ok: true });
    return;
  }

  response.json(await logoutAccount(getBearerToken(request)));
}));

app.get("/api/audit-log", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.json([]);
    return;
  }

  await requirePermission(request, "view_audit_log");
  response.json(await getAuditLog(getDraftSeason(request.query?.season), Number(request.query?.limit ?? 50)));
}));

app.get("/api/admin/fleaflicker/sync-status", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.json([]);
    return;
  }

  await requirePermission(request, "sync_fleaflicker");
  response.json(await getFleaflickerSyncStatus(getDraftSeason(request.query?.season), request.query?.history === "1"));
}));

app.get("/api/admin/player-matching-review", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.json([]);
    return;
  }

  await requirePermission(request, "manage_rankings");
  response.json(await getPlayerMatchingReview());
}));

app.get("/api/exports/draft-board.csv", asyncRoute(async (request, response) => {
  const draftSeason = getDraftSeason(request.query?.season);
  const state = await getActiveDraftState(draftSeason);
  sendDownload(response, `draft-board-${draftSeason}.csv`, csvFromRows(draftBoardRows(state)), "text/csv; charset=utf-8");
}));

app.get("/api/exports/keepers.csv", asyncRoute(async (request, response) => {
  const draftSeason = getDraftSeason(request.query?.season);
  const state = await getActiveDraftState(draftSeason);
  sendDownload(response, `keepers-${draftSeason}.csv`, csvFromRows(keeperRows(state)), "text/csv; charset=utf-8");
}));

app.get("/api/exports/fleaflicker-entry-sheet.csv", asyncRoute(async (request, response) => {
  const draftSeason = getDraftSeason(request.query?.season);
  const state = await getActiveDraftState(draftSeason);
  sendDownload(response, "fleaflicker-entry-sheet.csv", csvFromRows(fleaflickerEntryRows(state)), "text/csv; charset=utf-8");
}));

app.get("/api/exports/full-season-backup.zip", asyncRoute(async (request, response) => {
  const draftSeason = getDraftSeason(request.query?.season);
  const state = await getActiveDraftState(draftSeason);
  const [auditLog, syncHistory] = await Promise.all([
    getAuditLog(draftSeason, 200),
    getFleaflickerSyncStatus(draftSeason, true)
  ]);
  const stamp = new Date().toISOString();
  const files = [
    { name: "manifest.csv", content: csvFromRows([["Draft Season", "Exported At", "Draft Status"], [draftSeason, stamp, state.draft?.status]]) },
    { name: "teams.csv", content: csvFromRows(teamsRows(state)) },
    { name: "players.csv", content: csvFromRows(playersRows(state)) },
    { name: "draft_board.csv", content: csvFromRows(draftBoardRows(state)) },
    { name: "keepers.csv", content: csvFromRows(keeperRows(state)) },
    { name: "traded_picks.csv", content: csvFromRows(tradedPickRows(state)) },
    { name: "fleaflicker_entry_sheet.csv", content: csvFromRows(fleaflickerEntryRows(state)) },
    { name: "audit_log.csv", content: csvFromRows(auditLogRows(auditLog)) },
    { name: "fleaflicker_sync_history.csv", content: csvFromRows(syncHistoryRows(syncHistory)) }
  ];
  sendDownload(response, `fantasy-draft-${draftSeason}-backup.zip`, createZip(files), "application/zip");
}));

app.post("/api/admin/player-matching-review/approve", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to approve a player match." });
    return;
  }

  const user = await requirePermission(request, "manage_rankings");
  const result = await approvePlayerMatch({
    normalizedName: request.body?.normalizedName,
    targetPlayerId: request.body?.targetPlayerId,
    sourcePlayerIds: request.body?.sourcePlayerIds,
    actor: actorForUser(user, true)
  });
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  const state = await emitDraftState(draftSeason);
  response.json({ ...result, review: await getPlayerMatchingReview(), state });
}));

app.post("/api/admin/player-matching-review/reject", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to reject a player match." });
    return;
  }

  const user = await requirePermission(request, "manage_rankings");
  const result = await rejectPlayerMatch({
    normalizedName: request.body?.normalizedName,
    playerIds: request.body?.playerIds,
    actor: actorForUser(user, true)
  });
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  const state = await emitDraftState(draftSeason);
  response.json({ ...result, review: await getPlayerMatchingReview(), state });
}));

app.post("/api/imports/:type", asyncRoute(async (request, response) => {
  const csv = request.body?.csv;
  if (!csv || typeof csv !== "string") {
    response.status(400).json({ error: "CSV text is required." });
    return;
  }

  const importers = {
    teams: importTeams,
    players: importPlayers,
    "last-year-draft": importLastYearDraft,
    "last-year-draft-rounds": importLastYearDraftRounds,
    rosters: importRosters,
    keepers: importSelectedKeepers,
    "traded-picks": importTradedPicks
  };

  const importer = importers[request.params.type];
  if (!importer) {
    response.status(404).json({ error: "Unknown import type." });
    return;
  }

  const requiredPermissionByImportType = {
    teams: "sync_fleaflicker",
    players: "manage_rankings",
    "last-year-draft": "manage_rankings",
    "last-year-draft-rounds": "manage_rankings",
    rosters: "sync_fleaflicker",
    keepers: "manage_keepers",
    "traded-picks": "sync_fleaflicker"
  };
  const user = await requirePermission(request, requiredPermissionByImportType[request.params.type]);
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  const actor = actorForUser(user, true);
  const result = request.params.type === "players" ? await importer(csv, draftSeason, actor) : await importer(csv, draftSeason, actor);
  const state = await emitDraftState(draftSeason);
  response.json({ ...result, state });
}));

app.post("/api/admin/rebuild-keeper-picks", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to rebuild keeper picks." });
    return;
  }

  await requirePermission(request, "manage_keepers");
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  const result = await rebuildSelectedKeeperPicks(draftSeason);
  const state = await emitDraftState(draftSeason);
  response.json({ ...result, state });
}));

app.post("/api/admin/draft-order", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to save draft order." });
    return;
  }

  await requirePermission(request, "manage_draft");
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  const result = await updateDraftOrder(request.body?.teamIds, draftSeason);
  const state = await emitDraftState(draftSeason);
  response.json({ ...result, state });
}));

app.post("/api/admin/keeper-deadline", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to save a keeper deadline." });
    return;
  }

  const user = await requirePermission(request, "manage_keepers");
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  const result = await updateKeeperLockDeadline(draftSeason, request.body?.keeperLockDeadline ?? null, actorForUser(user, true));
  const state = await emitDraftState(draftSeason);
  response.json({ ...result, state });
}));

app.post("/api/admin/draft-mode", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to change draft mode." });
    return;
  }

  const user = await requirePermission(request, "manage_draft");
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  const result = await updateDraftMode(draftSeason, request.body?.mode, actorForUser(user, true));
  const state = await emitDraftState(draftSeason);
  response.json({ ...result, state });
}));

app.post("/api/admin/picks/edit", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to edit a pick." });
    return;
  }

  const user = await requirePermission(request, "manage_draft");
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  const state = await editPostgresPick({
    draftSeason,
    pickId: request.body?.pickId,
    playerId: request.body?.playerId || null,
    actor: actorForUser(user, true)
  });
  io.emit("draft:updated", state);
  response.json(state);
}));

app.post("/api/admin/finalize-draft", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to finalize a draft." });
    return;
  }

  const user = await requirePermission(request, "manage_draft");
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  const result = await markDraftAsSourceForNextYear(draftSeason, actorForUser(user, true));
  const state = await emitDraftState(draftSeason);
  response.json({ ...result, state });
}));

app.post("/api/admin/fleaflicker/rosters", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to sync Fleaflicker rosters." });
    return;
  }

  const user = await requirePermission(request, "sync_fleaflicker");
  const actor = actorForUser(user, true);
  const targetDraftSeason = request.body?.draftSeason == null
    ? Number(request.body?.season ?? 2025) + 1
    : getDraftSeason(request.body?.draftSeason);
  const tracked = await runTrackedFleaflickerSync({
    syncType: "rosters",
    draftSeason: targetDraftSeason,
    actor,
    operation: () => importFleaflickerEndOfSeasonRosters({
      leagueId: Number(request.body?.leagueId ?? 164549),
      season: Number(request.body?.season ?? 2025),
      scoringPeriod: Number(request.body?.scoringPeriod ?? 18),
      draftSeason: request.body?.draftSeason == null ? null : targetDraftSeason,
      actor
    })
  });
  if (!tracked.ok) {
    response.status(400).json({ error: tracked.error });
    return;
  }

  const result = tracked.result;
  const state = await emitDraftState(result.draftSeason);
  response.json({ ...result, state });
}));

app.post("/api/admin/fleaflicker/traded-picks", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to sync Fleaflicker traded picks." });
    return;
  }

  const user = await requirePermission(request, "sync_fleaflicker");
  const actor = actorForUser(user, true);
  const targetDraftSeason = request.body?.draftSeason == null
    ? Number(request.body?.pickSeason ?? 2026)
    : getDraftSeason(request.body?.draftSeason);
  const tracked = await runTrackedFleaflickerSync({
    syncType: "traded_picks",
    draftSeason: targetDraftSeason,
    actor,
    operation: () => importFleaflickerTradedPicks({
      leagueId: Number(request.body?.leagueId ?? 164549),
      standingsSeason: Number(request.body?.standingsSeason ?? 2025),
      pickSeason: Number(request.body?.pickSeason ?? 2026),
      draftSeason: request.body?.draftSeason == null ? null : targetDraftSeason,
      actor
    })
  });
  if (!tracked.ok) {
    response.status(400).json({ error: tracked.error });
    return;
  }

  const result = tracked.result;
  const state = await emitDraftState(result.draftSeason);
  response.json({ ...result, state });
}));

app.post("/api/admin/fleaflicker/setup-sync", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to sync Fleaflicker setup data." });
    return;
  }

  const user = await requirePermission(request, "sync_fleaflicker");
  const actor = actorForUser(user, true);
  const leagueId = Number(request.body?.leagueId ?? 164549);
  const season = Number(request.body?.season ?? 2025);
  const scoringPeriod = Number(request.body?.scoringPeriod ?? 18);
  const pickSeason = Number(request.body?.pickSeason ?? season + 1);
  const targetDraftSeason = request.body?.draftSeason == null ? pickSeason : getDraftSeason(request.body?.draftSeason);

  const rosters = await runTrackedFleaflickerSync({
    syncType: "rosters",
    draftSeason: targetDraftSeason,
    actor,
    operation: () => importFleaflickerEndOfSeasonRosters({
      leagueId,
      season,
      scoringPeriod,
      draftSeason: targetDraftSeason,
      actor
    })
  });

  const tradedPicks = await runTrackedFleaflickerSync({
    syncType: "traded_picks",
    draftSeason: targetDraftSeason,
    actor,
    operation: () => importFleaflickerTradedPicks({
      leagueId,
      standingsSeason: season,
      pickSeason,
      draftSeason: targetDraftSeason,
      actor
    })
  });

  const seededDraftSource = await seedLastYearDraftSource(targetDraftSeason, actor);
  const state = await emitDraftState(targetDraftSeason);
  response.json({
    ok: rosters.ok && tradedPicks.ok,
    draftSeason: targetDraftSeason,
    rosters,
    tradedPicks,
    seededDraftSource,
    state
  });
}));

app.post("/api/keepers/:teamId", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  if (!database.connected) {
    response.status(400).json({ error: "PostgreSQL must be connected to save keeper selections." });
    return;
  }

  const user = await requireLoggedIn(request);
  const canManageKeepers = hasPermission(user, "manage_keepers");
  if (!canManageKeepers && user.teamId !== request.params.teamId) {
    throw requestError(403, "You can only edit keepers for your own team.");
  }
  if (request.body?.commissionerOverride && !canManageKeepers) {
    throw requestError(403, "Only keeper managers can override the keeper lock.");
  }

  const draftSeason = getDraftSeason(request.body?.draftSeason);
  const result = await updateSelectedKeepers(request.params.teamId, request.body?.playerIds, draftSeason, actorForUser(user, canManageKeepers), {
    commissionerOverride: Boolean(request.body?.commissionerOverride)
  });
  const state = await emitDraftState(draftSeason);
  response.json({ ...result, state });
}));

app.post("/api/picks", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  let state;
  if (database.connected) {
    const user = await requireLoggedIn(request);
    const canManageDraft = hasPermission(user, "manage_draft");
    const draftSeason = getDraftSeason(request.body?.draftSeason);
    const mockLobbyTeamId = request.body?.mockLobbyTeamId ?? null;
    const currentState = await getActiveDraftState(draftSeason, mockLobbyTeamId);
    const isMockDraft = currentState.draft?.status === "mock";

    if (isMockDraft) {
      if (!mockLobbyTeamId) {
        throw requestError(400, "Select a mock draft lobby before making a mock pick.");
      }
      if (!canManageDraft && user.teamId !== mockLobbyTeamId) {
        throw requestError(403, "You can only make picks in your own mock lobby.");
      }
    } else if (!canManageDraft && user.teamId !== request.body?.teamId) {
      throw requestError(403, "You can only make real draft picks for your own team.");
    }

    state = await makePostgresPick({
      ...request.body,
      draftSeason,
      mockLobbyTeamId,
      teamId: canManageDraft ? request.body?.teamId : user.teamId,
      actor: actorForUser(user, canManageDraft)
    });
  } else {
    state = makePick(request.body);
  }
  if (state.draft?.status !== "mock" || !state.draft?.mockLobbyTeamId) {
    io.emit("draft:updated", state);
  }
  response.status(201).json(state);
}));

app.post("/api/picks/undo", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  let state;
  if (database.connected) {
    const user = await requireLoggedIn(request);
    const canManageDraft = hasPermission(user, "manage_draft");
    const mockLobbyTeamId = request.body?.mockLobbyTeamId ?? null;
    const currentState = await getActiveDraftState(draftSeason, mockLobbyTeamId);
    const isMockDraft = currentState.draft?.status === "mock";
    if (isMockDraft) {
      if (!mockLobbyTeamId) {
        throw requestError(400, "Select a mock draft lobby before undoing a mock pick.");
      }
      if (!canManageDraft && user.teamId !== mockLobbyTeamId) {
        throw requestError(403, "You can only undo picks in your own mock lobby.");
      }
    } else if (!canManageDraft) {
      throw requestError(403, "Only draft managers can undo a real draft pick.");
    }
    state = await undoPostgresPick(draftSeason, mockLobbyTeamId, actorForUser(user, canManageDraft));
  } else {
    state = undoLastPick();
  }
  if (state.draft?.status !== "mock" || !state.draft?.mockLobbyTeamId) {
    io.emit("draft:updated", state);
  }
  response.json(state);
}));

app.post("/api/draft/reset", asyncRoute(async (request, response) => {
  const database = await getDatabaseStatus();
  const draftSeason = getDraftSeason(request.body?.draftSeason);
  let state;
  if (database.connected) {
    const user = await requireLoggedIn(request);
    const canManageDraft = hasPermission(user, "manage_draft");
    const mockLobbyTeamId = request.body?.mockLobbyTeamId ?? null;
    const currentState = await getActiveDraftState(draftSeason, mockLobbyTeamId);
    const isMockDraft = currentState.draft?.status === "mock";
    if (isMockDraft) {
      if (!mockLobbyTeamId) {
        throw requestError(400, "Select a mock draft lobby before resetting a mock draft.");
      }
      if (!canManageDraft && user.teamId !== mockLobbyTeamId) {
        throw requestError(403, "You can only reset your own mock lobby.");
      }
    } else if (!canManageDraft) {
      throw requestError(403, "Only draft managers can reset a real draft.");
    }
    state = await resetPostgresDraftedPicks(draftSeason, actorForUser(user, canManageDraft), mockLobbyTeamId);
  } else {
    state = resetDraftedPicks();
  }
  if (state.draft?.status !== "mock" || !state.draft?.mockLobbyTeamId) {
    io.emit("draft:updated", state);
  }
  response.json(state);
}));

io.on("connection", async (socket) => {
  socket.emit("draft:updated", await getActiveDraftState());
});

server.listen(port, () => {
  console.log(`Draft backend listening on http://localhost:${port}`);
});
