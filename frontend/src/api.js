import axios from "axios";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const AUTH_TOKEN_STORAGE_KEY = "fantasy-draft-auth-token";

axios.interceptors.request.use((config) => {
  if (typeof window === "undefined") {
    return config;
  }

  const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (token && !config.headers?.Authorization) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`
    };
  }
  return config;
});

export async function fetchDraftState(draftSeason = 2026, options = {}) {
  const response = await axios.get(`${API_BASE_URL}/api/draft-state`, {
    params: { season: draftSeason, mockLobbyTeamId: options.mockLobbyTeamId || undefined }
  });
  return response.data;
}

export async function fetchAccounts() {
  const response = await axios.get(`${API_BASE_URL}/api/accounts`);
  return response.data;
}

export async function updateAccount(accountId, payload) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/accounts/${accountId}`, payload);
  return response.data;
}

export async function resetAccountPassword(accountId) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/accounts/${accountId}/reset-password`);
  return response.data;
}

export async function setAccountPassword(email, password) {
  const response = await axios.post(`${API_BASE_URL}/api/auth/set-password`, { email, password });
  return response.data;
}

export async function loginAccount(email, password) {
  const response = await axios.post(`${API_BASE_URL}/api/auth/login`, { email, password });
  return response.data;
}

export async function registerAccount(name, email, password) {
  const response = await axios.post(`${API_BASE_URL}/api/auth/register`, { name, email, password });
  return response.data;
}

export async function fetchCurrentUser(token) {
  const response = await axios.get(`${API_BASE_URL}/api/auth/me`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  return response.data.user;
}

export async function logoutAccount(token) {
  const response = await axios.post(`${API_BASE_URL}/api/auth/logout`, {}, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  return response.data;
}

export async function fetchAuditLog(draftSeason = 2026, limit = 50) {
  const response = await axios.get(`${API_BASE_URL}/api/audit-log`, { params: { season: draftSeason, limit } });
  return response.data;
}

export async function submitPick(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/picks`, payload);
  return response.data;
}

export async function undoPick(draftSeason, actor = {}, options = {}) {
  const response = await axios.post(`${API_BASE_URL}/api/picks/undo`, { draftSeason, ...actor, ...options });
  return response.data;
}

export async function resetDraft(draftSeason, actor = {}, options = {}) {
  const response = await axios.post(`${API_BASE_URL}/api/draft/reset`, { draftSeason, ...actor, ...options });
  return response.data;
}

export async function importCsv(type, csv, draftSeason, actor = {}) {
  const response = await axios.post(`${API_BASE_URL}/api/imports/${type}`, { csv, draftSeason, ...actor });
  return response.data;
}

export async function saveDraftOrder(teamIds, draftSeason) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/draft-order`, { teamIds, draftSeason });
  return response.data;
}

export async function finalizeDraft(draftSeason, actor = {}) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/finalize-draft`, { draftSeason, ...actor });
  return response.data;
}

export async function saveKeeperDeadline(draftSeason, keeperLockDeadline, actor = {}) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/keeper-deadline`, { draftSeason, keeperLockDeadline, ...actor });
  return response.data;
}

export async function saveDraftMode(draftSeason, mode, actor = {}) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/draft-mode`, { draftSeason, mode, ...actor });
  return response.data;
}

export async function editPick(draftSeason, pickId, playerId, actor = {}) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/picks/edit`, { draftSeason, pickId, playerId, ...actor });
  return response.data;
}

export async function syncFleaflickerRosters(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/fleaflicker/rosters`, payload);
  return response.data;
}

export async function syncFleaflickerSetup(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/fleaflicker/setup-sync`, payload);
  return response.data;
}

export async function syncFleaflickerTradedPicks(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/fleaflicker/traded-picks`, payload);
  return response.data;
}

export async function fetchFleaflickerSyncStatus(draftSeason = 2026, history = false) {
  const response = await axios.get(`${API_BASE_URL}/api/admin/fleaflicker/sync-status`, { params: { season: draftSeason, history: history ? "1" : "0" } });
  return response.data;
}

export async function fetchPlayerMatchingReview() {
  const response = await axios.get(`${API_BASE_URL}/api/admin/player-matching-review`);
  return response.data;
}

export async function approvePlayerMatch(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/player-matching-review/approve`, payload);
  return response.data;
}

export async function rejectPlayerMatch(payload) {
  const response = await axios.post(`${API_BASE_URL}/api/admin/player-matching-review/reject`, payload);
  return response.data;
}

export async function saveKeeperSelections(teamId, playerIds, draftSeason, actor = {}, options = {}) {
  const response = await axios.post(`${API_BASE_URL}/api/keepers/${teamId}`, { playerIds, draftSeason, ...actor, ...options });
  return response.data;
}
