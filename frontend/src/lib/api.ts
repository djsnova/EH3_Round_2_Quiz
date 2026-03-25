const BASE = import.meta.env.VITE_API_BASE_URL || "/api/v1";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function playerHeaders(token: string): HeadersInit {
  return { "Content-Type": "application/json", "X-Player-Token": token };
}

function adminHeaders(token: string): HeadersInit {
  return { "Content-Type": "application/json", "X-Admin-Token": token };
}

async function handleResponse(res: Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail || res.statusText);
  }
  return res.json();
}

// ─── Auth API ──────────────────────────────────────────────────────────────

export const authApi = {
  login: (username: string, password: string) =>
    fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(handleResponse),
};

// ─── Game API ──────────────────────────────────────────────────────────────

export const gameApi = {
  join: (playerToken: string, sessionId?: string) =>
    fetch(`${BASE}/game/join`, {
      method: "POST",
      headers: playerHeaders(playerToken),
      body: JSON.stringify({ session_id: sessionId }),
    }).then(handleResponse),

  getSession: (sessionId: string) =>
    fetch(`${BASE}/game/session/${sessionId}`).then(handleResponse),

  getPlayerSession: (playerToken: string) =>
    fetch(`${BASE}/game/player/session`, { headers: playerHeaders(playerToken) }).then(handleResponse),

  getLeaderboard: (sessionId: string) =>
    fetch(`${BASE}/game/leaderboard/${sessionId}`).then(handleResponse),

  getConstants: () =>
    fetch(`${BASE}/game/constants`).then(handleResponse),
};

// ─── Question API ──────────────────────────────────────────────────────────

export const questionApi = {
  getCurrent: (token: string) =>
    fetch(`${BASE}/questions/current`, { headers: playerHeaders(token) }).then(handleResponse),

  submitAnswer: (token: string, questionId: string, selectedOption: number) =>
    fetch(`${BASE}/questions/answer`, {
      method: "POST",
      headers: playerHeaders(token),
      body: JSON.stringify({ question_id: questionId, selected_option: selectedOption }),
    }).then(handleResponse),

  submitTimeout: (token: string, questionId: string) =>
    fetch(`${BASE}/questions/timeout`, {
      method: "POST",
      headers: playerHeaders(token),
      body: JSON.stringify({ question_id: questionId }),
    }).then(handleResponse),
};

// ─── Powerup API ───────────────────────────────────────────────────────────

export const powerupApi = {
  freeze: (token: string, targetPlayerId: string) =>
    fetch(`${BASE}/powerups/freeze`, {
      method: "POST",
      headers: playerHeaders(token),
      body: JSON.stringify({ target_player_id: targetPlayerId }),
    }).then(handleResponse),

  shield: (token: string) =>
    fetch(`${BASE}/powerups/shield`, {
      method: "POST",
      headers: playerHeaders(token),
      body: JSON.stringify({}),
    }).then(handleResponse),

  skip: (token: string, questionId: string) =>
    fetch(`${BASE}/powerups/skip`, {
      method: "POST",
      headers: playerHeaders(token),
      body: JSON.stringify({ question_id: questionId }),
    }).then(handleResponse),
};

// ─── Admin API ─────────────────────────────────────────────────────────────

export const adminApi = {
  // Sessions
  getSessions: (token: string) =>
    fetch(`${BASE}/admin/sessions`, { headers: adminHeaders(token) }).then(handleResponse),

  createSession: (token: string) =>
    fetch(`${BASE}/admin/sessions`, { method: "POST", headers: adminHeaders(token) }).then(handleResponse),

  updateSession: (token: string, sessionId: string, status: string) =>
    fetch(`${BASE}/admin/sessions/${sessionId}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ status }),
    }).then(handleResponse),

  resetSession: (token: string, sessionId: string) =>
    fetch(`${BASE}/admin/sessions/${sessionId}/reset`, {
      method: "POST",
      headers: adminHeaders(token),
    }).then(handleResponse),

  // Players (in-game)
  getPlayers: (token: string, sessionId: string) =>
    fetch(`${BASE}/admin/sessions/${sessionId}/players`, { headers: adminHeaders(token) }).then(handleResponse),

  updateScore: (token: string, playerId: string, score: number) =>
    fetch(`${BASE}/admin/players/${playerId}/score`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ score }),
    }).then(handleResponse),

  removePlayer: (token: string, playerId: string) =>
    fetch(`${BASE}/admin/players/${playerId}`, {
      method: "DELETE",
      headers: adminHeaders(token),
    }).then(handleResponse),

  freezePlayer: (token: string, playerId: string, durationSeconds?: number) =>
    fetch(`${BASE}/admin/players/${playerId}/freeze`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ duration_seconds: durationSeconds ?? 60 }),
    }).then(handleResponse),

  // Registered players (whitelisting)
  getRegisteredPlayers: (token: string) =>
    fetch(`${BASE}/admin/players/registered`, { headers: adminHeaders(token) }).then(handleResponse),

  registerPlayer: (token: string, data: { username: string; password: string; display_name?: string }) =>
    fetch(`${BASE}/admin/players/register`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify(data),
    }).then(handleResponse),

  registerPlayersBulk: (token: string, players: { username: string; password: string; display_name?: string }[]) =>
    fetch(`${BASE}/admin/players/register/bulk`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ players }),
    }).then(handleResponse),

  deleteRegisteredPlayer: (token: string, playerId: string) =>
    fetch(`${BASE}/admin/players/registered/${playerId}`, {
      method: "DELETE",
      headers: adminHeaders(token),
    }).then(handleResponse),

  // Questions
  getQuestions: (token: string) =>
    fetch(`${BASE}/admin/questions`, { headers: adminHeaders(token) }).then(handleResponse),

  createQuestion: (token: string, data: Record<string, unknown>) =>
    fetch(`${BASE}/admin/questions`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify(data),
    }).then(handleResponse),

  updateQuestion: (token: string, questionId: string, data: Record<string, unknown>) =>
    fetch(`${BASE}/admin/questions/${questionId}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify(data),
    }).then(handleResponse),

  deleteQuestion: (token: string, questionId: string) =>
    fetch(`${BASE}/admin/questions/${questionId}`, {
      method: "DELETE",
      headers: adminHeaders(token),
    }).then(handleResponse),

  importQuestions: (token: string, questions: Record<string, unknown>[]) =>
    fetch(`${BASE}/admin/questions/import`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ questions }),
    }).then(handleResponse),

  reorderQuestions: (token: string, questionIds: string[]) =>
    fetch(`${BASE}/admin/questions/reorder`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ question_ids: questionIds }),
    }).then(handleResponse),
};
