import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { ChevronDown, ChevronUp, Database, FileUp, RotateCcw, Search, ShieldCheck } from "lucide-react";
import {
  API_BASE_URL,
  approvePlayerMatch,
  editPick,
  fetchAccounts,
  fetchCurrentUser,
  fetchAuditLog,
  fetchDraftState,
  fetchFleaflickerSyncStatus,
  fetchPlayerMatchingReview,
  finalizeDraft,
  importCsv,
  loginAccount,
  logoutAccount,
  resetDraft,
  resetAccountPassword,
  saveDraftOrder,
  saveDraftMode,
  saveKeeperDeadline,
  saveKeeperSelections,
  setAccountPassword,
  submitPick,
  rejectPlayerMatch,
  syncFleaflickerRosters,
  syncFleaflickerSetup,
  syncFleaflickerTradedPicks,
  undoPick,
  updateAccount
} from "./api.js";

const POSITIONS = ["QB", "RB", "WR", "TE", "DST", "K"];
const PICK_TIMER_SECONDS = 120;
const COMMISSIONER_ID = "commissioner";
const AUTH_TOKEN_STORAGE_KEY = "fantasy-draft-auth-token";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEAM_COLORS = [
  "#2662d9",
  "#1f8a4c",
  "#c2410c",
  "#7c3aed",
  "#b91c1c",
  "#0f766e",
  "#a16207",
  "#be185d",
  "#4f46e5",
  "#15803d",
  "#0369a1",
  "#9333ea"
];
const PAGES = [
  { id: "draft", label: "Draft Room" },
  { id: "login", label: "Login" },
  { id: "keepers", label: "Keepers" },
  { id: "matching", label: "Player Matching" },
  { id: "commissioner", label: "Commissioner" }
];

const IMPORTS = [
  {
    type: "players",
    label: "Player Pool",
    columns: "rank,name,position,nflTeam,byeWeek"
  }
];
const ACCOUNT_PERMISSIONS = [
  "commissioner_admin",
  "sync_fleaflicker",
  "manage_rankings",
  "manage_keepers",
  "manage_draft",
  "view_audit_log"
];

function TopNavigation({ pages, selectedPage, onSelectPage }) {
  return (
    <nav className="top-nav" aria-label="Primary navigation">
      {pages.map((page) => (
        <button
          key={page.id}
          className={selectedPage === page.id ? "active" : ""}
          onClick={() => onSelectPage(page.id)}
          type="button"
        >
          {page.label}
        </button>
      ))}
    </nav>
  );
}

function mockLobbyTeamIdFor(teamId) {
  return teamId && teamId !== COMMISSIONER_ID && UUID_PATTERN.test(String(teamId)) ? teamId : null;
}

function userHasPermission(user, permission) {
  return Boolean(user?.permissions?.includes("commissioner_admin") || user?.permissions?.includes(permission));
}

function groupPicksByRound(picks) {
  return picks.reduce((acc, pick) => {
    if (!acc[pick.round]) {
      acc[pick.round] = [];
    }
    acc[pick.round].push(pick);
    return acc;
  }, {});
}

function positionClass(position) {
  return `position-${String(position ?? "unk").toLowerCase()}`;
}

function PickCell({ pick, isCurrent, teamColor }) {
  const player = pick.player;
  const isKeeper = pick.pickType === "keeper";
  const isTraded = pick.originalTeamId !== pick.currentOwnerTeamId;
  const tradeStyle = isTraded ? { "--trade-team-color": teamColor } : undefined;

  return (
    <div className={`pick-cell ${isCurrent ? "current" : ""} ${isKeeper ? "keeper" : ""} ${isTraded ? "traded" : ""} ${player ? positionClass(player.position) : ""}`} style={tradeStyle}>
      <div className="pick-meta">
        <span>{pick.pickNumber}</span>
        <span className="pick-badges">
          {isTraded && <span className="trade-chip">T</span>}
          {isKeeper && <span className="keeper-chip">K</span>}
        </span>
      </div>
      {isTraded && <span className="trade-owner-chip">{pick.team.name}</span>}
      {player ? (
        <>
          <strong>{player.name}</strong>
          <small>{player.position} - {player.nflTeam}</small>
        </>
      ) : (
        <>
          <strong>{isTraded ? pick.team.name : "Open pick"}</strong>
          {isTraded && <small>Traded pick</small>}
        </>
      )}
    </div>
  );
}

function PlayerRow({ player, displayRank, disabled, onPick }) {
  return (
    <button className={`player-row ${positionClass(player.position)}`} disabled={disabled} onClick={() => onPick(player.id)}>
      <span className="rank">{displayRank}</span>
      <span className="player-main">
        <strong>{player.name}</strong>
        <small>{player.position} - {player.nflTeam} - Bye {player.byeWeek ?? "?"} - Rank {player.rank ?? "N/A"}</small>
      </span>
    </button>
  );
}

function CommissionerImports({ database, draftSeason, canManageRankings, auditActor, onImported }) {
  const [busyType, setBusyType] = useState("");
  const [message, setMessage] = useState("");

  async function handleFile(type, file) {
    if (!file) {
      return;
    }

    setBusyType(type);
    setMessage("");
    try {
      const csv = await file.text();
      const result = await importCsv(type, csv, draftSeason, auditActor);
      if (type === "players") {
        setMessage(`Saved ${result.count} player rankings to PostgreSQL.`);
      } else {
        setMessage(`Imported ${result.count} rows into ${type}.`);
      }
      onImported(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyType("");
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Commissioner</p>
          <h2>Upload League Data</h2>
        </div>
        <Database size={20} />
      </div>

      <div className={`database-status ${database?.connected ? "connected" : "offline"}`}>
        <span>{database?.connected ? "PostgreSQL connected" : "Using demo memory data"}</span>
        {!database?.connected && <small>{database?.error ?? "Start Postgres to enable imports."}</small>}
      </div>

      <div className="import-grid">
        {IMPORTS.map((item) => (
          <label className="import-tile" key={item.type}>
            <span className="import-title">
              <FileUp size={17} />
              {item.label}
            </span>
            <small>{item.columns}</small>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={!database?.connected || !canManageRankings || busyType === item.type}
              onChange={(event) => handleFile(item.type, event.target.files?.[0])}
            />
          </label>
        ))}
      </div>

      {!canManageRankings && <div className="import-message">Log in with Manage Rankings permission to update rankings or source data.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function DraftOrderEditor({ teams, database, draftSeason, canManageDraft, onSaved }) {
  const [orderedTeams, setOrderedTeams] = useState(teams);
  const [draggedTeamId, setDraggedTeamId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOrderedTeams(teams);
  }, [teams]);

  function moveTeam(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
      return;
    }

    setOrderedTeams((currentTeams) => {
      const nextTeams = currentTeams.slice();
      const [movedTeam] = nextTeams.splice(fromIndex, 1);
      nextTeams.splice(toIndex, 0, movedTeam);
      return nextTeams;
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    try {
      const result = await saveDraftOrder(orderedTeams.map((team) => team.id), draftSeason);
      setMessage("Draft order saved.");
      onSaved(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Commissioner</p>
          <h2>Draft Order</h2>
        </div>
      </div>

      <div className="draft-order-list">
        {orderedTeams.map((team, index) => (
          <div
            className={`draft-order-row ${draggedTeamId === team.id ? "dragging" : ""}`}
            draggable={database?.connected && canManageDraft}
            key={team.id}
            onDragStart={() => setDraggedTeamId(team.id)}
            onDragEnd={() => setDraggedTeamId("")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              const fromIndex = orderedTeams.findIndex((candidate) => candidate.id === draggedTeamId);
              moveTeam(fromIndex, index);
              setDraggedTeamId("");
            }}
          >
            <span className="draft-order-position">{index + 1}</span>
            <strong>{team.name}</strong>
          </div>
        ))}
      </div>

      <div className="commissioner-actions">
        <button className="primary-action" disabled={!database?.connected || !canManageDraft || saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save Draft Order"}
        </button>
      </div>

      {!canManageDraft && <div className="import-message">Log in with Manage Draft permission to adjust draft order.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function syncTypeLabel(syncType) {
  return syncType === "traded_picks" ? "Traded Picks" : "Rosters";
}

function FleaflickerSetupSync({ database, draftSeason, canSyncFleaflicker, auditActor, onDraftSeasonChange, onSynced, refreshKey }) {
  const [leagueId, setLeagueId] = useState("164549");
  const [season, setSeason] = useState(String(draftSeason - 1));
  const [scoringPeriod, setScoringPeriod] = useState("18");
  const [pickSeason, setPickSeason] = useState(String(draftSeason));
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState([]);

  useEffect(() => {
    setSeason(String(draftSeason - 1));
    setPickSeason(String(draftSeason));
  }, [draftSeason]);

  async function loadSyncStatus() {
    if (!database?.connected || !canSyncFleaflicker) {
      setSyncStatus([]);
      return;
    }

    try {
      setSyncStatus(await fetchFleaflickerSyncStatus(draftSeason));
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    }
  }

  useEffect(() => {
    loadSyncStatus();
  }, [database?.connected, canSyncFleaflicker, draftSeason, refreshKey]);

  async function handleSyncAll() {
    setSyncing(true);
    setMessage("");
    try {
      const result = await syncFleaflickerSetup({
        leagueId: Number(leagueId),
        season: Number(season),
        scoringPeriod: Number(scoringPeriod),
        pickSeason: Number(pickSeason),
        draftSeason,
        ...auditActor
      });
      onDraftSeasonChange(result.draftSeason);
      onSynced(result.state);
      await loadSyncStatus();
      const rosterText = result.rosters?.ok ? "rosters synced" : `rosters failed: ${result.rosters?.error}`;
      const picksText = result.tradedPicks?.ok ? "traded picks synced" : `traded picks failed: ${result.tradedPicks?.error}`;
      const seedText = result.seededDraftSource?.skipped
        ? "draft source seed skipped"
        : `${result.seededDraftSource?.count ?? 0} keeper-source picks seeded`;
      setMessage(`Setup sync complete: ${rosterText}; ${picksText}; ${seedText}.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fleaflicker</p>
          <h2>Setup Sync</h2>
        </div>
      </div>
      <div className="fleaflicker-setup-controls">
        <label>
          League ID
          <input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} />
        </label>
        <label>
          Roster Season
          <input value={season} onChange={(event) => setSeason(event.target.value)} />
        </label>
        <label>
          Week
          <input value={scoringPeriod} onChange={(event) => setScoringPeriod(event.target.value)} />
        </label>
        <label>
          Pick Season
          <input value={pickSeason} onChange={(event) => setPickSeason(event.target.value)} />
        </label>
        <button className="primary-action" disabled={!database?.connected || !canSyncFleaflicker || syncing} onClick={handleSyncAll}>
          {syncing ? "Syncing..." : "Sync All Setup Data"}
        </button>
      </div>

      {!canSyncFleaflicker && <div className="import-message">Log in with Sync Fleaflicker permission to run setup sync.</div>}
      {message && <div className="import-message">{message}</div>}
      <div className="sync-status-grid">
        {["rosters", "traded_picks"].map((syncType) => {
          const item = syncStatus.find((candidate) => candidate.syncType === syncType);
          return (
            <div className={`sync-status-card ${item?.status ?? ""}`} key={syncType}>
              <strong>{syncTypeLabel(syncType)}</strong>
              {item ? (
                <>
                  <span>{item.status === "success" ? "Success" : "Error"} at {new Date(item.finishedAt).toLocaleString()}</span>
                  <small>{item.status === "success" ? syncStatusSummary(item) : item.errorMessage}</small>
                </>
              ) : (
                <span>No sync recorded for {draftSeason}.</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function syncStatusSummary(item) {
  const result = item.result ?? {};
  if (item.syncType === "rosters") {
    return `${result.count ?? 0} players, ${result.teamCount ?? 0} teams`;
  }
  if (item.syncType === "traded_picks") {
    return `${result.count ?? 0} traded picks`;
  }
  return "";
}

function FleaflickerRosterSync({ database, canSyncFleaflicker, auditActor, onDraftSeasonChange, onSynced }) {
  const [leagueId, setLeagueId] = useState("164549");
  const [season, setSeason] = useState("2025");
  const [scoringPeriod, setScoringPeriod] = useState("18");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [rosterCounts, setRosterCounts] = useState([]);

  async function handleSync() {
    setSyncing(true);
    setMessage("");
    setRosterCounts([]);
    try {
      const result = await syncFleaflickerRosters({
        leagueId: Number(leagueId),
        season: Number(season),
        scoringPeriod: Number(scoringPeriod),
        ...auditActor
      });
      onDraftSeasonChange(result.draftSeason);
      setMessage(`Synced ${result.count} roster players from Fleaflicker for the ${result.draftSeason} draft.`);
      setRosterCounts(result.rosterCounts ?? []);
      onSynced(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fleaflicker</p>
          <h2>End of Season Rosters</h2>
        </div>
      </div>

      <div className="fleaflicker-controls">
        <label>
          League ID
          <input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} />
        </label>
        <label>
          Season
          <input value={season} onChange={(event) => setSeason(event.target.value)} />
        </label>
        <label>
          Week
          <input value={scoringPeriod} onChange={(event) => setScoringPeriod(event.target.value)} />
        </label>
        <button className="primary-action" disabled={!database?.connected || !canSyncFleaflicker || syncing} onClick={handleSync}>
          {syncing ? "Syncing..." : "Sync Rosters"}
        </button>
      </div>

      {!canSyncFleaflicker && <div className="import-message">Log in with Sync Fleaflicker permission to sync rosters.</div>}
      {message && <div className="import-message">{message}</div>}
      {rosterCounts.length > 0 && (
        <div className="roster-count-grid">
          {rosterCounts.map((item) => (
            <div className={`roster-count-tile ${item.count === 19 ? "complete" : "incomplete"}`} key={item.teamName}>
              <strong>{item.teamName}</strong>
              <span>{item.count} of 19</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FleaflickerPickSync({ database, canSyncFleaflicker, auditActor, onDraftSeasonChange, onSynced }) {
  const [leagueId, setLeagueId] = useState("164549");
  const [standingsSeason, setStandingsSeason] = useState("2025");
  const [pickSeason, setPickSeason] = useState("2026");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [tradedPicks, setTradedPicks] = useState([]);

  async function handleSync() {
    setSyncing(true);
    setMessage("");
    setTradedPicks([]);
    try {
      const result = await syncFleaflickerTradedPicks({
        leagueId: Number(leagueId),
        standingsSeason: Number(standingsSeason),
        pickSeason: Number(pickSeason),
        ...auditActor
      });
      onDraftSeasonChange(result.draftSeason);
      setMessage(`Synced ${result.count} traded picks from Fleaflicker.`);
      setTradedPicks(result.tradedPicks ?? []);
      onSynced(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fleaflicker</p>
          <h2>Traded Draft Picks</h2>
        </div>
      </div>

      <div className="fleaflicker-controls">
        <label>
          League ID
          <input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} />
        </label>
        <label>
          Standings Season
          <input value={standingsSeason} onChange={(event) => setStandingsSeason(event.target.value)} />
        </label>
        <label>
          Pick Season
          <input value={pickSeason} onChange={(event) => setPickSeason(event.target.value)} />
        </label>
        <button className="primary-action" disabled={!database?.connected || !canSyncFleaflicker || syncing} onClick={handleSync}>
          {syncing ? "Syncing..." : "Sync Traded Picks"}
        </button>
      </div>

      {!canSyncFleaflicker && <div className="import-message">Log in with Sync Fleaflicker permission to sync traded picks.</div>}
      {message && <div className="import-message">{message}</div>}
      {tradedPicks.length > 0 && (
        <div className="traded-pick-list">
          {tradedPicks.map((pick) => (
            <div className="traded-pick-row" key={`${pick.round}-${pick.originalOwner}-${pick.ownedBy}`}>
              <strong>Round {pick.round}</strong>
              <span>{`${pick.originalOwner} -> ${pick.ownedBy}`}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csvFromRows(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function triggerDownload(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function writeUint16(output, value) {
  output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(output, value) {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function zipDateTime(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const central = [];
  let offset = 0;
  const { time, date } = zipDateTime();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const checksum = crc32(data);
    const local = [];
    writeUint32(local, 0x04034b50);
    writeUint16(local, 20);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint16(local, time);
    writeUint16(local, date);
    writeUint32(local, checksum);
    writeUint32(local, data.length);
    writeUint32(local, data.length);
    writeUint16(local, nameBytes.length);
    writeUint16(local, 0);
    localParts.push(new Uint8Array(local), nameBytes, data);

    const centralHeader = [];
    writeUint32(centralHeader, 0x02014b50);
    writeUint16(centralHeader, 20);
    writeUint16(centralHeader, 20);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, time);
    writeUint16(centralHeader, date);
    writeUint32(centralHeader, checksum);
    writeUint32(centralHeader, data.length);
    writeUint32(centralHeader, data.length);
    writeUint16(centralHeader, nameBytes.length);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint32(centralHeader, 0);
    writeUint32(centralHeader, offset);
    central.push(new Uint8Array(centralHeader), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = [];
  writeUint32(end, 0x06054b50);
  writeUint16(end, 0);
  writeUint16(end, 0);
  writeUint16(end, files.length);
  writeUint16(end, files.length);
  writeUint32(end, centralSize);
  writeUint32(end, offset);
  writeUint16(end, 0);
  return new Blob([...localParts, ...central, new Uint8Array(end)], { type: "application/zip" });
}

function fleaflickerPlayerId(player) {
  const externalId = player?.externalId ?? "";
  return externalId.startsWith("fleaflicker:") ? externalId.replace("fleaflicker:", "") : externalId;
}

function exportUrl(path, draftSeason) {
  return `${API_BASE_URL}${path}?season=${encodeURIComponent(draftSeason)}`;
}

async function startDownload(url, filename) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Export failed with status ${response.status}`);
  }
  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return downloadUrl;
}

function fleaflickerEntryRows(picks, teams) {
    const teamOrder = new Map(teams.map((team, index) => [team.id, index]));
    const draftedPicks = picks
      .filter((pick) => pick.player)
      .slice()
      .sort((a, b) => {
        const teamCompare = (teamOrder.get(a.currentOwnerTeamId) ?? 999) - (teamOrder.get(b.currentOwnerTeamId) ?? 999);
        return teamCompare || a.pickNumber - b.pickNumber;
      });

    const rows = [
      ["Fantasy Team", "Round", "Pick", "Player", "Position", "NFL Team", "Fleaflicker Player ID", "Entry Type"]
    ];

    for (const pick of draftedPicks) {
      rows.push([
        pick.team?.name,
        pick.round,
        pick.pickNumber,
        pick.player?.name,
        pick.player?.position,
        pick.player?.nflTeam,
        fleaflickerPlayerId(pick.player),
        pick.pickType === "keeper" ? "Keeper" : "Drafted"
      ]);
    }
  return rows;
}

function FleaflickerEntryExport({ draftSeason, onDownloaded }) {
  const [exportLink, setExportLink] = useState(null);

  async function handleExport() {
    const filename = "fleaflicker-entry-sheet.csv";
    const url = exportUrl("/api/exports/fleaflicker-entry-sheet.csv", draftSeason);
    const downloadUrl = await startDownload(url, filename);
    setExportLink({ filename, url: downloadUrl, createdAt: new Date().toLocaleString() });
    onDownloaded?.(filename);
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fleaflicker</p>
          <h2>Entry Sheet Export</h2>
        </div>
      </div>
      <div className="commissioner-actions">
        <button className="primary-action" onClick={handleExport}>
          Export Entry Sheet
        </button>
      </div>
      {exportLink && (
        <div className="export-link-list">
          <div className="export-link-row">
            <a className="link-button" href={exportLink.url} download={exportLink.filename}>
              {exportLink.filename}
            </a>
            <span>{exportLink.createdAt}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function teamNameById(teams) {
  return teams.reduce((acc, team) => {
    acc[team.id] = team.name;
    return acc;
  }, {});
}

function playerNameById(players) {
  return players.reduce((acc, player) => {
    acc[player.id] = player;
    return acc;
  }, {});
}

function draftBoardRows(picks, teams) {
  const teamsById = teamNameById(teams);
  return [
    ["Pick", "Round", "Original Team", "Current Owner", "Traded", "Pick Type", "Player", "Position", "NFL Team", "Rank", "Fleaflicker Player ID"],
    ...picks.slice().sort((a, b) => a.pickNumber - b.pickNumber).map((pick) => [
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

function keeperRows(selectedKeepers, keeperOptions, players, teams, picks) {
  const playersById = playerNameById(players);
  const teamsById = teamNameById(teams);
  const keeperOptionsByPlayerId = keeperOptions.reduce((acc, keeper) => {
    acc[keeper.playerId] = keeper;
    return acc;
  }, {});
  const keeperPickByPlayerId = picks.reduce((acc, pick) => {
    if (pick.pickType === "keeper" && pick.playerId) {
      acc[pick.playerId] = pick;
    }
    return acc;
  }, {});

  return [
    ["Fantasy Team", "Player", "Position", "NFL Team", "Rank", "Last Year Round", "Keeper Cost Round", "Assigned Pick"],
    ...selectedKeepers.map((keeper) => {
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

function playersRows(players) {
  return [
    ["ID", "External ID", "Player", "Position", "NFL Team", "Bye", "Rank", "Last Year Round", "Original Draft Team ID", "End Season Team ID"],
    ...players.map((player) => [
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

function teamsRows(teams) {
  return [
    ["ID", "Slug", "Team", "Owner"],
    ...teams.map((team) => [team.id, team.slug, team.name, team.ownerName])
  ];
}

function tradedPickRows(picks, teams) {
  const teamsById = teamNameById(teams);
  return [
    ["Round", "Pick", "Original Team", "Current Owner"],
    ...picks
      .filter((pick) => pick.originalTeamId !== pick.currentOwnerTeamId)
      .sort((a, b) => a.pickNumber - b.pickNumber)
      .map((pick) => [pick.round, pick.pickNumber, teamsById[pick.originalTeamId] ?? "", teamsById[pick.currentOwnerTeamId] ?? pick.team?.name ?? ""])
  ];
}

function auditRows(events) {
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

function ExportBackupPanel({ state, draftSeason, onDownloaded }) {
  const [message, setMessage] = useState("");
  const [exportLinks, setExportLinks] = useState([]);

  async function rememberExport(filename, url) {
    const downloadUrl = await startDownload(url, filename);
    setExportLinks((currentLinks) => [
      { filename, url: downloadUrl, createdAt: new Date().toLocaleString() },
      ...currentLinks
    ].slice(0, 8));
    onDownloaded?.(filename);
  }

  async function handleBackendExport(filename, path) {
    setMessage("");
    try {
      await rememberExport(filename, exportUrl(path, draftSeason));
      setMessage(`Downloaded ${filename}. Use the link above to download it again while this page is open.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Export</p>
          <h2>Backup Files</h2>
        </div>
      </div>
      <div className="export-actions">
        <button className="secondary-action" onClick={() => handleBackendExport(`draft-board-${draftSeason}.csv`, "/api/exports/draft-board.csv")}>
          Export Draft Board
        </button>
        <button className="secondary-action" onClick={() => handleBackendExport(`keepers-${draftSeason}.csv`, "/api/exports/keepers.csv")}>
          Export Keepers
        </button>
        <button className="primary-action" onClick={() => handleBackendExport(`fantasy-draft-${draftSeason}-backup.zip`, "/api/exports/full-season-backup.zip")}>
          Full Season Backup
        </button>
      </div>
      {exportLinks.length > 0 && (
        <div className="export-link-list">
          {exportLinks.map((item) => (
            <div className="export-link-row" key={`${item.filename}-${item.createdAt}`}>
              <a className="link-button" href={item.url} download={item.filename}>
                {item.filename}
              </a>
              <span>{item.createdAt}</span>
            </div>
          ))}
        </div>
      )}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function chooseDefaultMatchTarget(players) {
  return players
    .slice()
    .sort((a, b) => {
      const rankCompare = (a.rank == null ? 1 : 0) - (b.rank == null ? 1 : 0);
      return rankCompare || (a.rank ?? 99999) - (b.rank ?? 99999) || a.name.localeCompare(b.name);
    })[0]?.id;
}

function PlayerMatchingReview({ database, draftSeason, canManageRankings, auditActor, onStateChanged }) {
  const [conflicts, setConflicts] = useState([]);
  const [targetByConflict, setTargetByConflict] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");

  async function loadConflicts() {
    if (!database?.connected) {
      setConflicts([]);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const review = await fetchPlayerMatchingReview();
      setConflicts(review);
      setTargetByConflict(review.reduce((acc, conflict) => {
        acc[conflict.playerIdSet] = chooseDefaultMatchTarget(conflict.players);
        return acc;
      }, {}));
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(conflict) {
    const targetPlayerId = targetByConflict[conflict.playerIdSet] ?? chooseDefaultMatchTarget(conflict.players);
    const sourcePlayerIds = conflict.players.map((player) => player.id).filter((playerId) => playerId !== targetPlayerId);
    setBusyKey(conflict.playerIdSet);
    setMessage("");
    try {
      const result = await approvePlayerMatch({
        normalizedName: conflict.normalizedName,
        targetPlayerId,
        sourcePlayerIds,
        draftSeason,
        ...auditActor
      });
      setConflicts(result.review ?? []);
      if (result.state) {
        onStateChanged(result.state);
      }
      setMessage(`Approved match and merged ${result.mergedCount} player record${result.mergedCount === 1 ? "" : "s"}.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyKey("");
    }
  }

  async function handleReject(conflict) {
    setBusyKey(conflict.playerIdSet);
    setMessage("");
    try {
      const result = await rejectPlayerMatch({
        normalizedName: conflict.normalizedName,
        playerIds: conflict.players.map((player) => player.id),
        draftSeason,
        ...auditActor
      });
      setConflicts(result.review ?? []);
      if (result.state) {
        onStateChanged(result.state);
      }
      setMessage("Rejected match. It will no longer appear in this review.");
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyKey("");
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Player Matching</p>
          <h2>Name Review</h2>
        </div>
        <button className="primary-action compact-action" disabled={!database?.connected || !canManageRankings || loading} onClick={loadConflicts}>
          {loading ? "Checking..." : "Run Name Review"}
        </button>
      </div>
      <p className="panel-note">
        Reviews players whose names normalize to the same value after suffixes like Jr. or III are removed. Approving merges the records into the selected target.
      </p>
      {!canManageRankings && <div className="import-message">Log in with Manage Rankings permission to approve or reject player matches.</div>}
      {message && <div className="import-message">{message}</div>}
      <div className="matching-review-list">
        {conflicts.map((conflict) => (
          <div className="matching-review-row" key={conflict.normalizedName}>
            <strong>{conflict.normalizedName}</strong>
            <div>
              <div className="matching-player-options">
                {conflict.players.map((player) => (
                  <label key={player.id}>
                    <input
                      type="radio"
                      name={`match-target-${conflict.playerIdSet}`}
                      checked={(targetByConflict[conflict.playerIdSet] ?? chooseDefaultMatchTarget(conflict.players)) === player.id}
                      disabled={!canManageRankings || busyKey === conflict.playerIdSet}
                      onChange={() => setTargetByConflict((current) => ({ ...current, [conflict.playerIdSet]: player.id }))}
                    />
                    <span>{player.name} - {player.position} - {player.nflTeam} - Rank {player.rank ?? "N/A"}{player.externalId ? ` - ${player.externalId}` : ""}</span>
                  </label>
                ))}
              </div>
              <div className="matching-actions">
                <button className="primary-action compact-action" disabled={!canManageRankings || busyKey === conflict.playerIdSet} onClick={() => handleApprove(conflict)}>
                  {busyKey === conflict.playerIdSet ? "Working..." : "Approve Match"}
                </button>
                <button className="secondary-action compact-action" disabled={!canManageRankings || busyKey === conflict.playerIdSet} onClick={() => handleReject(conflict)}>
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
        {database?.connected && conflicts.length === 0 && !loading && message && (
          <div className="audit-empty">No suffix/name conflicts found.</div>
        )}
      </div>
    </section>
  );
}

function DraftResetPanel({ database, draftSeason, picks, draftMode, mockLobbyTeamId, canManageDraft, auditActor, onReset }) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const draftedCount = picks.filter((pick) => pick.pickType === "drafted").length;
  const canReset = draftMode === "mock" ? Boolean(mockLobbyTeamId) : canManageDraft;

  async function handleReset() {
    if (!confirming) {
      setConfirming(true);
      setMessage("");
      return;
    }

    setResetting(true);
    setMessage("");
    try {
      const nextState = await resetDraft(draftSeason, auditActor, { mockLobbyTeamId });
      setMessage("Draft reset. Keepers stayed on the board and drafted players returned to the available pool.");
      setConfirming(false);
      onReset(nextState);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Mock Draft</p>
          <h2>Reset Draft Board</h2>
        </div>
        <RotateCcw size={20} />
      </div>
      <p className="panel-note">
        Clears {draftedCount} drafted picks while keeping selected keepers, draft order, traded picks, and player data. In Mock Draft mode, any team account can reset its own lobby.
      </p>
      <div className="commissioner-actions">
        <button className={`secondary-action ${confirming ? "danger-action" : ""}`} disabled={!database?.connected || !canReset || resetting || draftedCount === 0} onClick={handleReset}>
          {resetting ? "Resetting..." : confirming ? "Confirm Reset Draft" : "Reset Mock Draft"}
        </button>
        {confirming && (
          <button className="secondary-action" disabled={resetting} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        )}
      </div>
      {!canReset && <div className="import-message">{draftMode === "mock" ? "Log in to reset your own mock lobby." : "Log in with Manage Draft permission to reset while Draft Mode is Real."}</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function PickEditorPanel({ database, draftSeason, picks, players, canManageDraft, auditActor, onSaved }) {
  const editablePicks = useMemo(() => picks.filter((pick) => pick.pickType !== "keeper"), [picks]);
  const [selectedPickId, setSelectedPickId] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedPick = editablePicks.find((pick) => pick.id === selectedPickId) ?? editablePicks[0] ?? null;
  const usedPlayerIds = useMemo(() => new Set(
    picks
      .filter((pick) => pick.playerId && pick.id !== selectedPick?.id)
      .map((pick) => pick.playerId)
  ), [picks, selectedPick?.id]);
  const playerOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return players
      .filter((player) => !usedPlayerIds.has(player.id))
      .filter((player) => {
        if (!query) {
          return true;
        }
        return `${player.name} ${player.position} ${player.nflTeam}`.toLowerCase().includes(query);
      })
      .slice()
      .sort((a, b) => (a.rank ?? 99999) - (b.rank ?? 99999) || a.name.localeCompare(b.name))
      .slice(0, 80);
  }, [players, search, usedPlayerIds]);

  useEffect(() => {
    if (!selectedPickId && editablePicks[0]) {
      setSelectedPickId(editablePicks[0].id);
    }
  }, [editablePicks, selectedPickId]);

  useEffect(() => {
    setSelectedPlayerId(selectedPick?.playerId ?? "");
  }, [selectedPick?.id, selectedPick?.playerId]);

  async function handleSave(nextPlayerId) {
    if (!selectedPick) {
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const nextState = await editPick(draftSeason, selectedPick.id, nextPlayerId || null, auditActor);
      onSaved(nextState);
      setMessage(nextPlayerId ? `Pick ${selectedPick.pickNumber} updated.` : `Pick ${selectedPick.pickNumber} cleared.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Correction</p>
          <h2>Edit Specific Pick</h2>
        </div>
      </div>
      <div className="pick-editor-grid">
        <label>
          Pick
          <select value={selectedPick?.id ?? ""} onChange={(event) => setSelectedPickId(event.target.value)}>
            {editablePicks.map((pick) => (
              <option key={pick.id} value={pick.id}>
                Pick {pick.pickNumber}, Round {pick.round} - {pick.team?.name ?? "Unknown"}{pick.player ? ` - ${pick.player.name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search Player
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, position, or NFL team" />
        </label>
        <label>
          Player
          <select value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)}>
            <option value="">Open pick</option>
            {playerOptions.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name} - {player.position} - {player.nflTeam} - Rank {player.rank ?? "N/A"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="commissioner-actions pick-editor-actions">
        <button className="secondary-action" disabled={!database?.connected || !canManageDraft || !selectedPick || saving} onClick={() => handleSave("")}>
          Clear Pick
        </button>
        <button className="primary-action" disabled={!database?.connected || !canManageDraft || !selectedPick || !selectedPlayerId || saving} onClick={() => handleSave(selectedPlayerId)}>
          Save Pick
        </button>
      </div>
      {!canManageDraft && <div className="import-message">Log in with Manage Draft permission to edit a pick.</div>}
      {selectedPick?.pickType === "keeper" && <div className="import-message">Keeper picks should be changed from the Keepers page.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function DraftFinalizePanel({ database, draftSeason, picks, canManageDraft, auditActor, onFinalized }) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const completedCount = picks.filter((pick) => pick.playerId).length;

  async function handleFinalize() {
    if (!confirming) {
      setConfirming(true);
      setMessage("");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const result = await finalizeDraft(draftSeason, auditActor);
      setMessage(`Saved ${result.count} players from ${result.draftSeason} as the keeper source for ${result.nextDraftSeason}.`);
      setConfirming(false);
      onFinalized(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Final Draft</p>
          <h2>Save Keeper Source</h2>
        </div>
        <Database size={20} />
      </div>
      <p className="panel-note">
        Marks the {draftSeason} draft as final and saves its drafted/kept players as last year&apos;s draft data for {draftSeason + 1}.
      </p>
      <div className="commissioner-actions">
        <button className={`secondary-action ${confirming ? "danger-action" : ""}`} disabled={!database?.connected || !canManageDraft || saving || completedCount === 0} onClick={handleFinalize}>
          {saving ? "Saving..." : confirming ? "Confirm Save Source" : "Save as Next Year's Source"}
        </button>
        {confirming && (
          <button className="secondary-action" disabled={saving} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        )}
      </div>
      {!canManageDraft && <div className="import-message">Log in with Manage Draft permission to save the final draft source.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function toDateTimeLocalValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString();
}

function KeeperDeadlinePanel({ database, draft, canManageKeepers, auditActor, onSaved }) {
  const [deadlineValue, setDeadlineValue] = useState(toDateTimeLocalValue(draft?.keeperLockDeadline));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDeadlineValue(toDateTimeLocalValue(draft?.keeperLockDeadline));
    setMessage("");
  }, [draft?.keeperLockDeadline, draft?.season]);

  async function handleSaveDeadline(nextValue = deadlineValue) {
    setSaving(true);
    setMessage("");
    try {
      const result = await saveKeeperDeadline(draft.season, fromDateTimeLocalValue(nextValue), auditActor);
      setMessage(result.keeperLockDeadline ? "Keeper deadline saved." : "Keeper deadline cleared.");
      onSaved(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSaving(false);
    }
  }

  const lockText = draft?.keeperLockDeadline
    ? `${draft.keeperLocked ? "Locked since" : "Locks"} ${new Date(draft.keeperLockDeadline).toLocaleString()}`
    : "No keeper deadline set.";

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Keepers</p>
          <h2>Keeper Lock Deadline</h2>
        </div>
      </div>
      <p className="panel-note">{lockText} Commissioners can override after lock.</p>
      <div className="deadline-controls">
        <label>
          Deadline
          <input
            type="datetime-local"
            value={deadlineValue}
            disabled={!database?.connected || !canManageKeepers || saving}
            onChange={(event) => setDeadlineValue(event.target.value)}
          />
        </label>
        <button className="primary-action" disabled={!database?.connected || !canManageKeepers || saving} onClick={() => handleSaveDeadline()}>
          {saving ? "Saving..." : "Save Deadline"}
        </button>
        <button
          className="secondary-action"
          disabled={!database?.connected || !canManageKeepers || saving || !draft?.keeperLockDeadline}
          onClick={() => {
            setDeadlineValue("");
            handleSaveDeadline("");
          }}
        >
          Clear
        </button>
      </div>
      {!canManageKeepers && <div className="import-message">Log in with Manage Keepers permission to change the keeper deadline.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function auditEventTitle(eventType) {
  const titles = {
    keepers_changed: "Keeper changed",
    rankings_uploaded: "Rankings uploaded",
    legacy_draft_uploaded: "Draft source seeded",
    fleaflicker_rosters_synced: "Fleaflicker rosters synced",
    fleaflicker_traded_picks_synced: "Fleaflicker picks synced",
    draft_finalized: "Draft finalized",
    keeper_deadline_updated: "Keeper deadline updated",
    pick_made: "Pick made",
    pick_undone: "Pick undone",
    pick_edited: "Pick edited",
    draft_mode_updated: "Draft mode updated",
    draft_reset: "Draft reset"
  };
  return titles[eventType] ?? eventType.replace(/_/g, " ");
}

function auditEventDetail(event) {
  const payload = event.payload ?? {};
  if (event.eventType === "keepers_changed") {
    return `${payload.count ?? 0} keeper${payload.count === 1 ? "" : "s"} saved`;
  }
  if (event.eventType === "rankings_uploaded") {
    return `${payload.count ?? 0} player rankings`;
  }
  if (event.eventType === "legacy_draft_uploaded") {
    return `${payload.count ?? 0} draft picks saved as keeper source`;
  }
  if (event.eventType === "fleaflicker_rosters_synced") {
    return `${payload.count ?? 0} roster players, ${payload.teamCount ?? 0} teams`;
  }
  if (event.eventType === "fleaflicker_traded_picks_synced") {
    return `${payload.count ?? 0} traded picks`;
  }
  if (event.eventType === "draft_finalized") {
    return `${payload.savedPlayerCount ?? 0} players saved for ${payload.nextDraftSeason}`;
  }
  if (event.eventType === "keeper_deadline_updated") {
    return payload.keeperLockDeadline ? `Deadline set to ${new Date(payload.keeperLockDeadline).toLocaleString()}` : "Deadline cleared";
  }
  if (event.eventType === "draft_reset") {
    return `${payload.clearedPickCount ?? 0} drafted picks cleared`;
  }
  if (event.eventType === "pick_edited") {
    const previous = payload.previousPlayerName ?? "Open pick";
    const next = payload.nextPlayerName ?? "Open pick";
    return `Pick ${payload.pickNumber}: ${previous} -> ${next}`;
  }
  if (event.eventType === "draft_mode_updated") {
    return payload.mode === "mock" ? "Mock Draft enabled" : "Real draft enabled";
  }
  return "";
}

function AuditLogPanel({ database, draftSeason, refreshKey }) {
  const [events, setEvents] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadEvents() {
    if (!database?.connected) {
      setEvents([]);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      setEvents(await fetchAuditLog(draftSeason));
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents();
  }, [database?.connected, draftSeason, refreshKey]);

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Audit Log</p>
          <h2>Recent Activity</h2>
        </div>
        <button className="secondary-action compact-action" disabled={!database?.connected || loading} onClick={loadEvents}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {!database?.connected && <div className="import-message">PostgreSQL is required for the audit log.</div>}
      {message && <div className="import-message">{message}</div>}
      <div className="audit-list">
        {events.map((event) => (
          <div className="audit-row" key={event.id}>
            <div>
              <strong>{auditEventTitle(event.eventType)}</strong>
              <span>{auditEventDetail(event)}</span>
            </div>
            <div className="audit-meta">
              <span>{event.actorName}</span>
              <time>{new Date(event.createdAt).toLocaleString()}</time>
            </div>
          </div>
        ))}
        {database?.connected && events.length === 0 && !loading && (
          <div className="audit-empty">No audited activity yet for {draftSeason}.</div>
        )}
      </div>
    </section>
  );
}

function AccountAdminPanel({ database, teams, currentUser }) {
  const [accounts, setAccounts] = useState([]);
  const [draftsById, setDraftsById] = useState({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState("");

  async function loadAccounts() {
    if (!database?.connected) {
      setAccounts([]);
      setDraftsById({});
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const nextAccounts = await fetchAccounts();
      setAccounts(nextAccounts);
      setDraftsById(nextAccounts.reduce((acc, account) => {
        acc[account.id] = {
          email: account.email ?? "",
          displayName: account.displayName ?? "",
          teamId: account.teamId ?? "",
          isActive: Boolean(account.isActive),
          permissions: account.permissions ?? []
        };
        return acc;
      }, {}));
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, [database?.connected]);

  function updateDraft(accountId, patch) {
    setDraftsById((current) => ({
      ...current,
      [accountId]: {
        ...(current[accountId] ?? {}),
        ...patch
      }
    }));
  }

  function togglePermission(accountId, permission) {
    const draft = draftsById[accountId] ?? {};
    const permissions = new Set(draft.permissions ?? []);
    if (permissions.has(permission)) {
      permissions.delete(permission);
    } else {
      permissions.add(permission);
    }
    updateDraft(accountId, { permissions: Array.from(permissions) });
  }

  async function handleSave(account) {
    setBusyAccountId(account.id);
    setMessage("");
    try {
      const updated = await updateAccount(account.id, draftsById[account.id]);
      setAccounts((current) => current.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
      updateDraft(updated.id, {
        email: updated.email ?? "",
        displayName: updated.displayName ?? "",
        teamId: updated.teamId ?? "",
        isActive: Boolean(updated.isActive),
        permissions: updated.permissions ?? []
      });
      setMessage(`${updated.displayName} saved.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyAccountId("");
    }
  }

  async function handleResetPassword(account) {
    setBusyAccountId(account.id);
    setMessage("");
    try {
      const result = await resetAccountPassword(account.id);
      setAccounts((current) => current.map((candidate) => (candidate.id === result.user.id ? result.user : candidate)));
      setMessage(`${result.user.displayName}'s password was reset. They can set a new password from Login.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyAccountId("");
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Accounts</p>
          <h2>Account Admin</h2>
        </div>
        <button className="secondary-action compact-action" disabled={!database?.connected || loading} onClick={loadAccounts}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {!database?.connected && <div className="import-message">PostgreSQL is required for accounts.</div>}
      {message && <div className="import-message">{message}</div>}
      <div className="account-list">
        {accounts.map((account) => {
          const draft = draftsById[account.id] ?? {};
          const busy = busyAccountId === account.id;
          return (
            <div className="account-admin-row" key={account.id}>
              <div className="account-admin-main">
                <label>
                  Name
                  <input value={draft.displayName ?? ""} disabled={busy} onChange={(event) => updateDraft(account.id, { displayName: event.target.value })} />
                </label>
                <label>
                  Email
                  <input value={draft.email ?? ""} disabled={busy} onChange={(event) => updateDraft(account.id, { email: event.target.value })} />
                </label>
                <label>
                  Fantasy Team
                  <select value={draft.teamId ?? ""} disabled={busy} onChange={(event) => updateDraft(account.id, { teamId: event.target.value })}>
                    <option value="">No team linked</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                </label>
                <label className="account-active-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.isActive)}
                    disabled={busy}
                    onChange={(event) => updateDraft(account.id, { isActive: event.target.checked })}
                  />
                  Active
                </label>
              </div>

              <div className="permission-grid">
                {ACCOUNT_PERMISSIONS.map((permission) => (
                  <label key={permission} className="permission-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.permissions?.includes(permission))}
                      disabled={busy}
                      onChange={() => togglePermission(account.id, permission)}
                    />
                    {permission.replace(/_/g, " ")}
                  </label>
                ))}
              </div>

              <div className="account-admin-footer">
                <div>
                  <span>{account.hasPassword ? "Password set" : "No password set"}</span>
                  {account.id === currentUser?.id && <small>Current user</small>}
                </div>
                <div className="account-admin-actions">
                  <button className="secondary-action compact-action" disabled={busy} onClick={() => handleResetPassword(account)}>
                    Reset Password
                  </button>
                  <button className="primary-action compact-action" disabled={busy} onClick={() => handleSave(account)}>
                    {busy ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {database?.connected && accounts.length === 0 && !loading && (
          <div className="audit-empty">No accounts found.</div>
        )}
      </div>
    </section>
  );
}

function AccountAccessPanel({ database, currentUser, authToken, onAuthenticated, onLoggedOut }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");

  async function handleAuth(action) {
    setBusyAction(action);
    setMessage("");
    try {
      const result = action === "set-password"
        ? await setAccountPassword(email, password)
        : await loginAccount(email, password);
      onAuthenticated(result);
      setPassword("");
      setMessage(action === "set-password" ? "Password set and logged in." : "Logged in.");
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyAction("");
    }
  }

  async function handleLogout() {
    setBusyAction("logout");
    setMessage("");
    try {
      await logoutAccount(authToken);
      onLoggedOut();
      setMessage("Logged out.");
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyAction("");
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Account</p>
          <h2>Login</h2>
        </div>
      </div>
      <p className="panel-note">
        Log in to make picks, manage keepers, sync Fleaflicker data, or use commissioner tools based on your account permissions.
      </p>

      {currentUser ? (
        <div className="account-session">
          <div>
            <strong>{currentUser.displayName}</strong>
            <span>{currentUser.email}</span>
            <small>{currentUser.permissions?.length ? currentUser.permissions.join(", ") : "normal user"}</small>
          </div>
          <button className="secondary-action" disabled={busyAction === "logout"} onClick={handleLogout}>
            {busyAction === "logout" ? "Logging out..." : "Log Out"}
          </button>
        </div>
      ) : (
        <div className="auth-grid">
          <label>
            Email
            <input value={email} disabled={!database?.connected || Boolean(busyAction)} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} disabled={!database?.connected || Boolean(busyAction)} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <div className="auth-actions">
            <button className="secondary-action" disabled={!database?.connected || Boolean(busyAction) || !email || !password} onClick={() => handleAuth("set-password")}>
              {busyAction === "set-password" ? "Setting..." : "Set Password"}
            </button>
            <button className="primary-action" disabled={!database?.connected || Boolean(busyAction) || !email || !password} onClick={() => handleAuth("login")}>
              {busyAction === "login" ? "Logging in..." : "Log In"}
            </button>
          </div>
        </div>
      )}

      {!database?.connected && <div className="import-message">PostgreSQL is required for account access.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function LoginPage({ database, currentUser, authToken, onAuthenticated, onLoggedOut }) {
  return (
    <section className="login-page">
      <AccountAccessPanel
        database={database}
        currentUser={currentUser}
        authToken={authToken}
        onAuthenticated={onAuthenticated}
        onLoggedOut={onLoggedOut}
      />
    </section>
  );
}

function projectKeeperPicks(selectedPlayerIds, keepers, ownedPicksByRound) {
  const projectedPicks = new Map();

  for (const playerId of selectedPlayerIds) {
    const keeper = keepers.find((candidate) => candidate.playerId === playerId);
    if (!keeper?.keeperCost) {
      continue;
    }

    for (let round = keeper.keeperCost; round >= 1; round -= 1) {
      const availablePicks = ownedPicksByRound.get(round) ?? [];
      const projectedPick = availablePicks.shift();
      if (projectedPick) {
        projectedPicks.set(playerId, projectedPick);
        break;
      }
    }

    if (!projectedPicks.has(playerId)) {
      projectedPicks.set(playerId, null);
    }
  }

  return projectedPicks;
}

function formatKeeperValue(value) {
  if (value == null) {
    return "N/A";
  }

  return value > 0 ? `+${value}` : String(value);
}

function KeepersPage({ teams, keeperOptions, selectedKeepers, players, picks, draft, draftSeason, canManageKeepers, currentUserTeamId, auditActor, onSaved }) {
  const [selectedKeeperTeamId, setSelectedKeeperTeamId] = useState("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);
  const [pendingKeeperTeamId, setPendingKeeperTeamId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [sortByValue, setSortByValue] = useState(false);

  useEffect(() => {
    if (!teams.length) {
      return;
    }

    const selectedTeamExists = teams.some((team) => team.id === selectedKeeperTeamId);
    if (!selectedTeamExists) {
      setSelectedKeeperTeamId(teams[0].id);
    }
  }, [selectedKeeperTeamId, teams]);

  const keepers = useMemo(() => {
    return keeperOptions
      .filter((keeper) => keeper.teamId === selectedKeeperTeamId)
      .slice()
      .sort((a, b) => {
        if (sortByValue) {
          const aValue = a.keeperValue ?? -999;
          const bValue = b.keeperValue ?? -999;
          return bValue - aValue || (a.keeperCost ?? 999) - (b.keeperCost ?? 999) || a.playerName.localeCompare(b.playerName);
        }

        const aCost = a.keeperCost ?? 999;
        const bCost = b.keeperCost ?? 999;
        return aCost - bCost || a.playerName.localeCompare(b.playerName);
      });
  }, [keeperOptions, selectedKeeperTeamId, sortByValue]);
  const positionalRanks = useMemo(() => {
    const ranks = {};
    for (const player of players.slice().sort((a, b) => (a.rank ?? 99999) - (b.rank ?? 99999) || a.name.localeCompare(b.name))) {
      if (!player.position || player.rank == null) {
        continue;
      }
      ranks[player.position] = (ranks[player.position] ?? 0) + 1;
      ranks[player.id] = `${player.position}${ranks[player.position]}`;
    }
    return ranks;
  }, [players]);
  const playerById = useMemo(() => {
    return players.reduce((acc, player) => {
      acc[player.id] = player;
      return acc;
    }, {});
  }, [players]);
  const hasFullRoster = keepers.length === 19;
  const selectedTeamKeepers = useMemo(
    () => selectedKeepers.filter((keeper) => keeper.teamId === selectedKeeperTeamId).map((keeper) => keeper.playerId),
    [selectedKeeperTeamId, selectedKeepers]
  );
  const ownedPicksByRound = useMemo(() => {
    return picks.reduce((acc, pick) => {
      if (pick.currentOwnerTeamId !== selectedKeeperTeamId || pick.pickType === "drafted") {
        return acc;
      }

      if (!acc.has(pick.round)) {
        acc.set(pick.round, []);
      }
      acc.get(pick.round).push({
        round: pick.round,
        pickNumber: pick.pickNumber
      });
      return acc;
    }, new Map());
  }, [picks, selectedKeeperTeamId]);
  for (const roundPicks of ownedPicksByRound.values()) {
    roundPicks.sort((a, b) => b.pickNumber - a.pickNumber);
  }
  const hasUnsavedKeeperChanges =
    selectedPlayerIds.length !== selectedTeamKeepers.length ||
    selectedPlayerIds.some((playerId, index) => playerId !== selectedTeamKeepers[index]);
  const projectedKeeperPicks = useMemo(
    () => projectKeeperPicks(selectedPlayerIds, keepers, new Map(Array.from(ownedPicksByRound, ([round, roundPicks]) => [round, roundPicks.slice()]))),
    [selectedPlayerIds, keepers, ownedPicksByRound]
  );
  const hasInvalidProjection = Array.from(projectedKeeperPicks.values()).some((pick) => !pick);
  const keeperLocked = Boolean(draft?.keeperLocked);
  const ownsSelectedKeeperTeam = currentUserTeamId && currentUserTeamId === selectedKeeperTeamId;
  const canEditSelectedTeam = canManageKeepers || ownsSelectedKeeperTeam;
  const canOverrideKeeperLock = canManageKeepers;
  const canEditKeepers = canEditSelectedTeam && (!keeperLocked || canOverrideKeeperLock);

  useEffect(() => {
    setSelectedPlayerIds(selectedTeamKeepers);
    setMessage("");
  }, [selectedTeamKeepers]);

  function toggleKeeper(playerId) {
    if (!canEditKeepers) {
      return;
    }

    setSelectedPlayerIds((currentIds) =>
      currentIds.includes(playerId)
        ? currentIds.filter((currentId) => currentId !== playerId)
        : [...currentIds, playerId]
    );
  }

  function handleKeeperTeamChange(nextTeamId) {
    if (nextTeamId === selectedKeeperTeamId) {
      return;
    }

    if (hasUnsavedKeeperChanges) {
      setPendingKeeperTeamId(nextTeamId);
      setMessage("");
      return;
    }

    setPendingKeeperTeamId("");
    setSelectedKeeperTeamId(nextTeamId);
  }

  function discardKeeperChanges() {
    if (pendingKeeperTeamId) {
      setSelectedKeeperTeamId(pendingKeeperTeamId);
      setPendingKeeperTeamId("");
      return;
    }

    setSelectedPlayerIds(selectedTeamKeepers);
  }

  async function handleSaveKeepers(nextTeamId = "") {
    setSaving(true);
    setMessage("");
    try {
      const result = await saveKeeperSelections(selectedKeeperTeamId, selectedPlayerIds, draftSeason, auditActor, {
        commissionerOverride: keeperLocked && canOverrideKeeperLock
      });
      setMessage(`Saved ${result.count} keeper selections.`);
      onSaved(result.state);
      if (nextTeamId) {
        setSelectedKeeperTeamId(nextTeamId);
        setPendingKeeperTeamId("");
      }
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="keepers-page">
      <div className="keeper-toolbar">
        <div>
          <p className="eyebrow">End of Season Roster</p>
          <h2>Potential Keepers</h2>
          <small className={hasFullRoster ? "keeper-count complete" : "keeper-count incomplete"}>
            {keepers.length} of 19 players listed
          </small>
          <small className="keeper-selection-count">
            {selectedPlayerIds.length} selected
          </small>
          {draft?.keeperLockDeadline && (
            <small className={`keeper-selection-count ${keeperLocked ? "locked" : ""}`}>
              {keeperLocked ? "Locked" : "Locks"} {new Date(draft.keeperLockDeadline).toLocaleString()}
            </small>
          )}
        </div>
        <div className="keeper-actions">
          <label>
            Fantasy Team
            <select value={selectedKeeperTeamId} onChange={(event) => handleKeeperTeamChange(event.target.value)}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>
          <button className="primary-action" disabled={saving || !selectedKeeperTeamId || hasInvalidProjection || !canEditKeepers} onClick={() => handleSaveKeepers()}>
            {saving ? "Saving..." : keeperLocked && canOverrideKeeperLock ? "Override Lock and Save" : "Save Keepers"}
          </button>
        </div>
      </div>

      {keeperLocked && !canOverrideKeeperLock && (
        <div className="keeper-warning">
          Keeper selections are locked for this draft season. Ask a commissioner to make an override change.
        </div>
      )}
      {!canEditSelectedTeam && (
        <div className="keeper-warning">
          Viewing only. You can review other teams&apos; keepers, but only accounts with Manage Keepers permission can edit any team.
        </div>
      )}
      {keeperLocked && canOverrideKeeperLock && (
        <div className="keeper-warning">
          Keeper selections are locked. Saving with Manage Keepers permission will be recorded as an override.
        </div>
      )}

      {pendingKeeperTeamId && (
        <div className="keeper-warning keeper-unsaved-warning">
          <span>Save keeper changes before switching teams?</span>
          <div className="keeper-warning-actions">
            <button className="primary-action" disabled={saving || hasInvalidProjection || !canEditKeepers} onClick={() => handleSaveKeepers(pendingKeeperTeamId)}>
              Save and Switch
            </button>
            <button className="secondary-action" disabled={saving} onClick={discardKeeperChanges}>
              Discard Changes
            </button>
          </div>
        </div>
      )}

      {hasInvalidProjection && (
        <div className="keeper-warning">
          One or more selected keepers cannot be assigned because this team has no available pick in that round or an earlier round.
        </div>
      )}
      {message && <div className="import-message">{message}</div>}

      <div className="keeper-list">
        <div className="keeper-list-header">
          <span>Keep</span>
          <span>Player</span>
          <span>Rank</span>
          <span>Pos</span>
          <span>NFL</span>
          <span>Drafted</span>
          <span>Cost</span>
          <span>ADP Round</span>
          <span>
            <button className={`keeper-sort-button ${sortByValue ? "active" : ""}`} onClick={() => setSortByValue((current) => !current)} type="button">
              Value{sortByValue ? " ↓" : ""}
            </button>
          </span>
          <span>Rating</span>
          <span>Status</span>
        </div>
        {keepers.map((keeper) => (
          <div className={`keeper-row ${positionClass(keeper.position)} ${keeper.eligible ? "" : "ineligible"}`} key={keeper.playerId}>
            <label className="keeper-check">
              <input
                type="checkbox"
                checked={selectedPlayerIds.includes(keeper.playerId)}
                disabled={!keeper.eligible || !canEditKeepers}
                onChange={() => toggleKeeper(keeper.playerId)}
              />
            </label>
            <strong>{keeper.playerName}</strong>
            <span>
              {(keeper.rank ?? playerById[keeper.playerId]?.rank)
                ? `OVR ${keeper.rank ?? playerById[keeper.playerId]?.rank}, ${positionalRanks[keeper.playerId] ?? keeper.position}`
                : "N/A"}
            </span>
            <span>{keeper.position}</span>
            <span>{keeper.nflTeam}</span>
            <span>{keeper.lastYearDraftRound ? `Round ${keeper.lastYearDraftRound}` : "Waiver"}</span>
            <span>
              {projectedKeeperPicks.has(keeper.playerId)
                ? projectedKeeperPicks.get(keeper.playerId)
                  ? `Round ${projectedKeeperPicks.get(keeper.playerId).round}, Pick ${projectedKeeperPicks.get(keeper.playerId).pickNumber}${projectedKeeperPicks.get(keeper.playerId).round !== keeper.keeperCost ? ` (from ${keeper.keeperCost})` : ""}`
                  : "No pick"
                : keeper.keeperCost ? `Round ${keeper.keeperCost}` : "N/A"}
            </span>
            <span>{keeper.consensusAdpRound ? `Round ${keeper.consensusAdpRound}` : "N/A"}</span>
            <span className={`keeper-value ${keeper.keeperValue > 0 ? "positive" : keeper.keeperValue < 0 ? "negative" : ""}`}>
              {formatKeeperValue(keeper.keeperValue)}
            </span>
            <span className="keeper-rating">{keeper.keeperRatingStars ?? "Unrated"}</span>
            <span>{selectedPlayerIds.includes(keeper.playerId) ? "Selected" : keeper.eligible ? "Available" : "Not eligible"}</span>
          </div>
        ))}
        {keepers.length === 0 && (
          <div className="keeper-empty">
            No end-of-season roster players found for this team.
          </div>
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [state, setState] = useState(null);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("");
  const [selectedPage, setSelectedPage] = useState("draft");
  const [selectedDraftSeason, setSelectedDraftSeason] = useState(2026);
  const [error, setError] = useState("");
  const [timerSeconds, setTimerSeconds] = useState(PICK_TIMER_SECONDS);
  const [pickAnnouncement, setPickAnnouncement] = useState(null);
  const [exportAnnouncement, setExportAnnouncement] = useState(null);
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const [authToken, setAuthToken] = useState(() => window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? "");
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(() => !window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY));
  const boardScrollRef = useRef(null);
  const selectedDraftSeasonRef = useRef(selectedDraftSeason);
  const stateRef = useRef(null);
  const announcedPickRef = useRef("");
  const announcementTimerRef = useRef(null);
  const exportAnnouncementTimerRef = useRef(null);

  useEffect(() => {
    selectedDraftSeasonRef.current = selectedDraftSeason;
  }, [selectedDraftSeason]);

  useEffect(() => {
    if (state) {
      stateRef.current = state;
    }
  }, [state]);

  useEffect(() => {
    if (!authToken) {
      setCurrentUser(null);
      setAuthChecked(true);
      return;
    }

    setAuthChecked(false);
    fetchCurrentUser(authToken).then((user) => {
      if (!user) {
        window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
        setAuthToken("");
        setCurrentUser(null);
        setAuthChecked(true);
        return;
      }
      setCurrentUser(user);
      setAuthChecked(true);
    }).catch(() => {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      setAuthToken("");
      setCurrentUser(null);
      setAuthChecked(true);
    });
  }, [authToken]);

  useEffect(() => {
    const accountMockLobbyTeamId = mockLobbyTeamIdFor(currentUser?.teamId);
    const mockLobbyTeamId = state?.draft?.status === "mock" ? accountMockLobbyTeamId : null;
    fetchDraftState(selectedDraftSeason, { mockLobbyTeamId }).then((nextState) => {
      setState(nextState);
    }).catch((caught) => setError(caught.message));
  }, [currentUser, selectedDraftSeason, state?.draft?.status]);

  useEffect(() => {
    return () => {
      if (announcementTimerRef.current) {
        window.clearTimeout(announcementTimerRef.current);
      }
      if (exportAnnouncementTimerRef.current) {
        window.clearTimeout(exportAnnouncementTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {

    const socket = io(API_BASE_URL);
    socket.on("draft:updated", (nextState) => {
      if (!nextState?.draft?.season || Number(nextState.draft.season) === Number(selectedDraftSeasonRef.current)) {
        const activeLobbyTeamId = mockLobbyTeamIdFor(currentUser?.teamId);
        if (nextState.draft?.status === "mock" && nextState.draft?.mockLobbyTeamId && nextState.draft.mockLobbyTeamId !== activeLobbyTeamId) {
          return;
        }
        applyDraftState(nextState);
      }
    });

    return () => socket.disconnect();
  }, [currentUser?.teamId]);

  function findNewDraftedPick(previousState, nextState) {
    if (!previousState?.picks || !nextState?.picks) {
      return null;
    }

    const previousById = new Map(previousState.picks.map((pick) => [pick.id, pick]));
    return nextState.picks.find((pick) => {
      const previousPick = previousById.get(pick.id);
      return pick.pickType === "drafted" && pick.player && !previousPick?.playerId;
    }) ?? null;
  }

  function announcePick(pick) {
    if (!pick?.player || announcedPickRef.current === pick.id) {
      return;
    }

    announcedPickRef.current = pick.id;
    setPickAnnouncement({
      id: `${pick.id}-${Date.now()}`,
      pickNumber: pick.pickNumber,
      playerName: pick.player.name,
      position: pick.player.position,
      nflTeam: pick.player.nflTeam,
      positionClassName: positionClass(pick.player.position)
    });

    if (announcementTimerRef.current) {
      window.clearTimeout(announcementTimerRef.current);
    }
    announcementTimerRef.current = window.setTimeout(() => {
      setPickAnnouncement(null);
    }, 11000);
  }

  function announceExport(filename) {
    setExportAnnouncement({
      id: `${filename}-${Date.now()}`,
      filename,
      location: "Downloads folder, usually C:\\Users\\derek\\Downloads"
    });

    if (exportAnnouncementTimerRef.current) {
      window.clearTimeout(exportAnnouncementTimerRef.current);
    }
    exportAnnouncementTimerRef.current = window.setTimeout(() => {
      setExportAnnouncement(null);
    }, 11000);
  }

  function applyDraftState(nextState) {
    const newDraftedPick = findNewDraftedPick(stateRef.current, nextState);
    stateRef.current = nextState;
    setState(nextState);
    if (newDraftedPick) {
      announcePick(newDraftedPick);
    }
  }

  const picksByRound = useMemo(() => groupPicksByRound(state?.picks ?? []), [state]);

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (state?.availablePlayers ?? [])
      .slice()
      .sort((a, b) => (a.rank ?? 99999) - (b.rank ?? 99999) || a.name.localeCompare(b.name))
      .filter((player) => {
      const matchesPosition = !position || player.position === position;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        player.name.toLowerCase().includes(normalizedQuery) ||
        player.nflTeam.toLowerCase().includes(normalizedQuery);

      return matchesPosition && matchesQuery;
    });
  }, [position, query, state]);

  const currentPick = state?.currentPick;
  const currentTeam = state?.teams.find((team) => team.id === currentPick?.currentOwnerTeamId);
  const nextUpPick = useMemo(() => {
    if (!currentPick || !state?.picks?.length) {
      return null;
    }

    return state.picks
      .slice()
      .sort((a, b) => a.pickNumber - b.pickNumber)
      .find((pick) => pick.pickNumber > currentPick.pickNumber && pick.playerId == null) ?? null;
  }, [currentPick, state?.picks]);
  const nextUpTeam = state?.teams.find((team) => team.id === nextUpPick?.currentOwnerTeamId);
  const canManageDraft = userHasPermission(currentUser, "manage_draft");
  const canManageKeepers = userHasPermission(currentUser, "manage_keepers");
  const canManageRankings = userHasPermission(currentUser, "manage_rankings");
  const canSyncFleaflicker = userHasPermission(currentUser, "sync_fleaflicker");
  const canViewAuditLog = userHasPermission(currentUser, "view_audit_log");
  const canAdminAccounts = userHasPermission(currentUser, "commissioner_admin");
  const canAccessCommissioner = canManageDraft || canManageKeepers || canManageRankings || canSyncFleaflicker || canViewAuditLog;
  const visiblePages = useMemo(
    () => PAGES.filter((page) => {
      if (page.id === "login") {
        return false;
      }
      if (page.id === "commissioner") {
        return canAccessCommissioner;
      }
      if (page.id === "matching") {
        return canAccessCommissioner;
      }
      return true;
    }),
    [canAccessCommissioner]
  );
  const draftMode = state?.draft?.status === "mock" ? "mock" : "real";
  const accountMockLobbyTeamId = mockLobbyTeamIdFor(currentUser?.teamId);
  const mockLobbyTeamId = draftMode === "mock" ? accountMockLobbyTeamId : null;
  const auditActor = {
    actorTeamId: currentUser?.teamId ?? null,
    actorLabel: currentUser?.displayName ?? "Unknown"
  };
  const selectedTeamCanPick = draftMode === "mock"
    ? Boolean(mockLobbyTeamId && currentUser)
    : canManageDraft || (currentUser?.teamId && currentPick?.currentOwnerTeamId === currentUser.teamId);
  const timerMinutes = Math.floor(timerSeconds / 60);
  const timerRemainder = String(timerSeconds % 60).padStart(2, "0");
  const timerDisplay = `${timerMinutes}:${timerRemainder}`;
  const boardGridStyle = {
    gridTemplateColumns: `34px repeat(${state?.teams.length ?? 0}, minmax(78px, 1fr))`
  };
  const teamColorById = useMemo(() => {
    return (state?.teams ?? []).reduce((acc, team, index) => {
      acc[team.id] = TEAM_COLORS[index % TEAM_COLORS.length];
      return acc;
    }, {});
  }, [state?.teams]);
  const teamsWithTradedPicks = useMemo(() => {
    return new Set(
      (state?.picks ?? [])
        .filter((pick) => pick.originalTeamId !== pick.currentOwnerTeamId)
        .map((pick) => pick.currentOwnerTeamId)
    );
  }, [state?.picks]);

  function syncScroll(source, target) {
    if (!source.current || !target.current) {
      return;
    }

    target.current.scrollLeft = source.current.scrollLeft;
  }

  useEffect(() => {
    setTimerSeconds(PICK_TIMER_SECONDS);
  }, [currentPick?.id]);

  useEffect(() => {
    if (!currentPick) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setTimerSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [currentPick?.id]);

  useEffect(() => {
    if (selectedPage === "commissioner" && !canAccessCommissioner) {
      setSelectedPage("draft");
    }
    if (selectedPage === "matching" && !canAccessCommissioner) {
      setSelectedPage("draft");
    }
  }, [canAccessCommissioner, selectedPage]);

  async function handleMakePick(playerId) {
    if (!currentPick) {
      return;
    }

    setError("");
    try {
      const nextState = await submitPick({
        pickId: currentPick.id,
        playerId,
        draftSeason: selectedDraftSeason,
        mockLobbyTeamId,
        teamId: canManageDraft || draftMode === "mock" ? currentPick.currentOwnerTeamId : currentUser?.teamId,
        ...auditActor
      });
      applyDraftState(nextState);
    } catch (caught) {
      setError(caught.response?.data?.error ?? caught.message);
    }
  }

  async function handleUndoPick() {
    setError("");
    try {
      const nextState = await undoPick(selectedDraftSeason, auditActor, { mockLobbyTeamId });
      stateRef.current = nextState;
      setState(nextState);
    } catch (caught) {
      setError(caught.response?.data?.error ?? caught.message);
    }
  }

  async function handleDraftModeChange(mode) {
    setError("");
    try {
      const result = await saveDraftMode(selectedDraftSeason, mode, auditActor);
      applyAuditedState(result.state);
    } catch (caught) {
      setError(caught.response?.data?.error ?? caught.message);
    }
  }

  function stepDraftSeason(delta) {
    setSelectedDraftSeason((season) => Math.min(2100, Math.max(2000, Number(season) + delta)));
  }

  function applyAuditedState(nextState) {
    setState(nextState);
    setAuditRefreshKey((currentKey) => currentKey + 1);
  }

  function handleAuthenticated(result) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, result.token);
    setAuthToken(result.token);
    setCurrentUser(result.user);
    setAuthChecked(true);
  }

  function handleLoggedOut() {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    setAuthToken("");
    setCurrentUser(null);
  }

  if (!state || !authChecked) {
    return <main className="loading">Loading draft room...</main>;
  }

  if (!currentUser) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">RotoBaller Keeper League</p>
            <h1>Fantasy Keeper Draft</h1>
          </div>
        </header>
        <LoginPage
          database={state.database}
          currentUser={currentUser}
          authToken={authToken}
          onAuthenticated={handleAuthenticated}
          onLoggedOut={handleLoggedOut}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">RotoBaller Keeper League</p>
          <h1>Fantasy Keeper Draft</h1>
          <TopNavigation pages={visiblePages} selectedPage={selectedPage} onSelectPage={setSelectedPage} />
        </div>
        <div className="topbar-actions">
          <label>
            Draft Season
              <span className="season-stepper">
                <button type="button" aria-label="Previous draft season" onClick={() => stepDraftSeason(-1)} disabled={selectedDraftSeason <= 2000}>
                  <ChevronDown size={16} />
                </button>
                <input
                  type="text"
                inputMode="none"
                readOnly
                value={selectedDraftSeason}
                aria-label="Draft Season"
                />
                <button type="button" aria-label="Next draft season" onClick={() => stepDraftSeason(1)} disabled={selectedDraftSeason >= 2100}>
                  <ChevronUp size={16} />
                </button>
              </span>
          </label>
          <button className="icon-button" onClick={handleUndoPick} title="Undo last drafted pick">
            <RotateCcw size={18} />
          </button>
          <button className="secondary-action compact-action" onClick={handleLoggedOut}>
            Log Out
          </button>
        </div>
      </header>

      {pickAnnouncement && (
        <div className={`pick-announcement ${pickAnnouncement.positionClassName}`} key={pickAnnouncement.id}>
          <span className="label">Drafted</span>
          <strong>
            {pickAnnouncement.playerName} - {pickAnnouncement.position} - {pickAnnouncement.nflTeam} - Pick {pickAnnouncement.pickNumber}
          </strong>
        </div>
      )}

      {exportAnnouncement && (
        <div className="pick-announcement export-announcement" key={exportAnnouncement.id}>
          <span className="label">Backup Downloaded</span>
          <strong>{exportAnnouncement.filename}</strong>
          <small>{exportAnnouncement.location}</small>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="app-content">
          {selectedPage === "commissioner" && canAccessCommissioner ? (
            <section className="page-section">
              <CommissionerImports database={state.database} draftSeason={selectedDraftSeason} canManageRankings={canManageRankings} auditActor={auditActor} onImported={applyAuditedState} />
              <FleaflickerSetupSync
                database={state.database}
                draftSeason={selectedDraftSeason}
                canSyncFleaflicker={canSyncFleaflicker}
                auditActor={auditActor}
                onDraftSeasonChange={setSelectedDraftSeason}
                onSynced={applyAuditedState}
                refreshKey={auditRefreshKey}
              />
              <FleaflickerRosterSync
                database={state.database}
                canSyncFleaflicker={canSyncFleaflicker}
                auditActor={auditActor}
                onDraftSeasonChange={setSelectedDraftSeason}
                onSynced={applyAuditedState}
              />
              <FleaflickerPickSync
                database={state.database}
                canSyncFleaflicker={canSyncFleaflicker}
                auditActor={auditActor}
                onDraftSeasonChange={setSelectedDraftSeason}
                onSynced={applyAuditedState}
              />
              {canAdminAccounts ? (
                <AccountAdminPanel database={state.database} teams={state.teams} currentUser={currentUser} />
              ) : (
                <section className="commissioner-panel">
                  <p className="eyebrow">Accounts</p>
                  <h2>Account Admin</h2>
                  <div className="import-message">Log in with Commissioner Admin permission to manage accounts.</div>
                </section>
              )}
              <ExportBackupPanel state={state} draftSeason={selectedDraftSeason} onDownloaded={announceExport} />
              <FleaflickerEntryExport draftSeason={selectedDraftSeason} onDownloaded={announceExport} />
              <PickEditorPanel
                database={state.database}
                draftSeason={selectedDraftSeason}
                picks={state.picks}
                players={state.players ?? []}
                canManageDraft={canManageDraft}
                auditActor={auditActor}
                onSaved={applyAuditedState}
              />
              <DraftResetPanel
                database={state.database}
                draftSeason={selectedDraftSeason}
                picks={state.picks}
                draftMode={draftMode}
                mockLobbyTeamId={mockLobbyTeamId}
                canManageDraft={canManageDraft}
                auditActor={auditActor}
                onReset={setState}
              />
              <DraftFinalizePanel database={state.database} draftSeason={selectedDraftSeason} picks={state.picks} canManageDraft={canManageDraft} auditActor={auditActor} onFinalized={applyAuditedState} />
              <KeeperDeadlinePanel database={state.database} draft={state.draft} canManageKeepers={canManageKeepers} auditActor={auditActor} onSaved={applyAuditedState} />
              <DraftOrderEditor teams={state.teams} database={state.database} draftSeason={selectedDraftSeason} canManageDraft={canManageDraft} onSaved={setState} />
              {canViewAuditLog ? (
                <AuditLogPanel database={state.database} draftSeason={selectedDraftSeason} refreshKey={auditRefreshKey} />
              ) : (
                <section className="commissioner-panel">
                  <p className="eyebrow">Audit Log</p>
                  <h2>Recent Activity</h2>
                  <div className="import-message">Log in with View Audit Log permission to review activity.</div>
                </section>
              )}
            </section>
          ) : selectedPage === "login" ? (
            <LoginPage
              database={state.database}
              currentUser={currentUser}
              authToken={authToken}
              onAuthenticated={handleAuthenticated}
              onLoggedOut={handleLoggedOut}
            />
          ) : selectedPage === "matching" ? (
            <section className="page-section">
              <PlayerMatchingReview
                database={state.database}
                draftSeason={selectedDraftSeason}
                canManageRankings={canManageRankings}
                auditActor={auditActor}
                onStateChanged={applyAuditedState}
              />
            </section>
          ) : selectedPage === "keepers" ? (
            <section className="page-section">
              <KeepersPage
                teams={state.teams}
                keeperOptions={state.keeperOptions ?? []}
                selectedKeepers={state.selectedKeepers ?? []}
                players={state.players ?? []}
                picks={state.picks ?? []}
                draft={state.draft}
                draftSeason={selectedDraftSeason}
                canManageKeepers={canManageKeepers}
                currentUserTeamId={currentUser?.teamId ?? null}
                auditActor={auditActor}
                onSaved={applyAuditedState}
              />
            </section>
          ) : (
            <>
              {draftMode === "mock" && (
                <section className="page-section">
                  <DraftResetPanel
                    database={state.database}
                    draftSeason={selectedDraftSeason}
                    picks={state.picks}
                    draftMode={draftMode}
                    mockLobbyTeamId={mockLobbyTeamId}
                    canManageDraft={canManageDraft}
                    auditActor={auditActor}
                    onReset={applyDraftState}
                  />
                </section>
              )}

              <section className="status-band">
                <div>
                  <span className="label">On the clock</span>
                  <strong className="clock-line">
                    <span>{currentTeam?.name ?? "Draft complete"}</span>
                    {currentPick && <span className={`pick-timer ${timerSeconds === 0 ? "expired" : ""}`}>{timerDisplay}</span>}
                  </strong>
                </div>
                <div>
                  <span className="label">Pick</span>
                  <strong>{currentPick ? `${currentPick.round}.${currentPick.pickNumber}` : "Done"}</strong>
                </div>
                <div>
                  <span className="label">Next Up</span>
                  <strong>{nextUpTeam?.name ?? "Done"}</strong>
                </div>
                <div>
                  <span className="label">Draft Mode</span>
                  <select
                    className="mode-select"
                    value={draftMode}
                    disabled={!canManageDraft}
                    onChange={(event) => handleDraftModeChange(event.target.value)}
                  >
                    <option value="mock">Mock Draft</option>
                    <option value="real">Real</option>
                  </select>
                </div>
              </section>

              <section className="workspace">
                <aside className="players-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Available</p>
                      <h2>Player Pool</h2>
                    </div>
                    <ShieldCheck size={20} />
                  </div>

                  <div className="search-box">
                    <Search size={18} />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search players or NFL team"
                    />
                  </div>

                  <div className="position-tabs">
                    {POSITIONS.map((item) => (
                      <button
                        key={item}
                        className={position === item ? "active" : ""}
                        onClick={() => setPosition((currentPosition) => (currentPosition === item ? "" : item))}
                      >
                        {item}
                      </button>
                    ))}
                  </div>

                  <div className="players-list">
                    {filteredPlayers.map((player, index) => (
                      <PlayerRow
                        key={player.id}
                        player={player}
                        displayRank={index + 1}
                        disabled={!selectedTeamCanPick}
                        onPick={handleMakePick}
                      />
                    ))}
                  </div>
                </aside>

                <section className="draft-board">
                  <div
                    className="board-scroll"
                    ref={boardScrollRef}
                  >
                    <div className="board-grid team-header" style={boardGridStyle}>
                      <div className="round-header">Rd</div>
                      {state.teams.map((team) => (
                        <div
                          className={`team-name ${teamsWithTradedPicks.has(team.id) ? "has-traded-pick" : ""}`}
                          key={team.id}
                          style={teamsWithTradedPicks.has(team.id) ? { "--team-color": teamColorById[team.id] } : undefined}
                        >
                          {team.name}
                        </div>
                      ))}
                    </div>
                    {Object.entries(picksByRound).map(([round, picks]) => (
                      <div className="board-grid" key={round} style={boardGridStyle}>
                        <div className="round-number">{round}</div>
                        {picks.map((pick) => (
                          <PickCell
                            key={pick.id}
                            pick={pick}
                            isCurrent={pick.id === currentPick?.id}
                            teamColor={teamColorById[pick.currentOwnerTeamId]}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </section>
              </section>
            </>
          )}
      </div>
    </main>
  );
}
