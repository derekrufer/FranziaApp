import React, { useState } from "react";
import { API_BASE_URL } from "../../api.js";

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

export function FleaflickerEntryExport({ draftSeason, onDownloaded }) {
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

export function ExportBackupPanel({ state, draftSeason, onDownloaded }) {
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
