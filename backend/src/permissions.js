export function hasPermission(user, permission) {
  return Boolean(user?.permissions?.includes("commissioner_admin") || user?.permissions?.includes(permission));
}

export function actorForUser(user, elevated = false) {
  return {
    actorUserId: user?.id ?? null,
    actorTeamId: user?.teamId ?? null,
    actorLabel: user?.displayName ?? "Unknown",
    isCommissioner: Boolean(elevated || user?.permissions?.includes("commissioner_admin"))
  };
}
