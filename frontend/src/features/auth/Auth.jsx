import React, { useState } from "react";
import { loginAccount, logoutAccount, registerAccount, setAccountPassword } from "../../api.js";

export function AccountAccessPanel({ database, currentUser, authToken, onAuthenticated, onLoggedOut }) {
  const [authMode, setAuthMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");

  async function handleAuth(action) {
    setBusyAction(action);
    setMessage("");
    try {
      const result = action === "register"
        ? await registerAccount(name, email, password)
        : action === "set-password"
          ? await setAccountPassword(email, password)
          : await loginAccount(email, password);
      onAuthenticated(result);
      setName("");
      setPassword("");
      setMessage(action === "register" ? "Account created and logged in." : action === "set-password" ? "Password set and logged in." : "Logged in.");
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
          <h2>{authMode === "register" ? "Create Account" : "Login"}</h2>
        </div>
      </div>
      <p className="panel-note">
        {authMode === "register"
          ? "Create an account to join the draft. The first registered account becomes the initial commissioner."
          : "Log in to make picks, manage keepers, sync Fleaflicker data, or use commissioner tools based on your account permissions."}
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
          <div className="auth-mode-switch">
            <button type="button" className={authMode === "login" ? "active" : ""} disabled={Boolean(busyAction)} onClick={() => {
              setAuthMode("login");
              setMessage("");
            }}>
              Login
            </button>
            <button type="button" className={authMode === "register" ? "active" : ""} disabled={Boolean(busyAction)} onClick={() => {
              setAuthMode("register");
              setMessage("");
            }}>
              Create Account
            </button>
          </div>
          {authMode === "register" && (
            <label>
              Name
              <input value={name} disabled={!database?.connected || Boolean(busyAction)} onChange={(event) => setName(event.target.value)} />
            </label>
          )}
          <label>
            Email
            <input value={email} disabled={!database?.connected || Boolean(busyAction)} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} disabled={!database?.connected || Boolean(busyAction)} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <div className="auth-actions">
            {authMode === "register" ? (
              <button className="primary-action" disabled={!database?.connected || Boolean(busyAction) || !name || !email || !password} onClick={() => handleAuth("register")}>
                {busyAction === "register" ? "Creating..." : "Create Account"}
              </button>
            ) : (
              <>
                <button className="secondary-action" disabled={!database?.connected || Boolean(busyAction) || !email || !password} onClick={() => handleAuth("set-password")}>
                  {busyAction === "set-password" ? "Setting..." : "Set Password"}
                </button>
                <button className="primary-action" disabled={!database?.connected || Boolean(busyAction) || !email || !password} onClick={() => handleAuth("login")}>
                  {busyAction === "login" ? "Logging in..." : "Log In"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!database?.connected && <div className="import-message">PostgreSQL is required for account access.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

export function LoginPage({ database, currentUser, authToken, onAuthenticated, onLoggedOut }) {
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
