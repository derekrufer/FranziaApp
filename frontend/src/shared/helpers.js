import { UUID_PATTERN } from "./constants.js";

export function mockLobbyUserIdFor(userId) {
  return UUID_PATTERN.test(String(userId ?? "")) ? userId : null;
}

export function userHasPermission(user, permission) {
  return Boolean(user?.permissions?.includes("commissioner_admin") || user?.permissions?.includes(permission));
}

export function groupPicksByRound(picks) {
  return picks.reduce((acc, pick) => {
    if (!acc[pick.round]) {
      acc[pick.round] = [];
    }
    acc[pick.round].push(pick);
    return acc;
  }, {});
}

export function positionClass(position) {
  return `position-${String(position ?? "unk").toLowerCase()}`;
}
