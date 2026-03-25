import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, authApi, gameApi, questionApi, powerupApi } from "@/lib/api";
import { GameWebSocket } from "@/lib/ws";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Player {
  id: string;
  session_id: string;
  name: string;
  score: number;
  is_frozen: boolean;
  frozen_until: string | null;
  has_shield: boolean;
  skip_count: number;
  current_question_index: number;
  consecutive_correct: number;
}

interface LeaderboardPlayer {
  id: string;
  name: string;
  score: number;
  is_frozen: boolean;
  has_shield: boolean;
  streak: number;
}

interface GameSession {
  id: string;
  status: string;
}

interface CurrentQuestion {
  id: string;
  question: string;
  options: string[];
  category?: string;
  difficulty?: string;
  question_index: number;
  total_questions: number;
  streak?: number;
  streak_points_correct?: number;
  streak_points_wrong?: number;
}

interface AnswerResult {
  is_correct: boolean;
  correct_option: number;
  points_awarded: number;
  new_score: number;
  streak: number;
  streak_points_correct?: number;
  streak_points_wrong?: number;
}

interface StreakTier {
  threshold: number;
  points_correct: number;
  points_wrong: number;
  powerup_discount: number;
}

export interface GameConstants {
  timer_duration: number;
  points_correct: number;
  points_wrong: number;
  cost_freeze: number;
  cost_shield: number;
  max_skips: number;
  freeze_duration_seconds: number;
  freeze_cooldown_seconds: number;
  shield_duration_seconds: number;
  shield_cooldown_seconds: number;
  streak_tiers?: StreakTier[];
}

const DEFAULT_CONSTANTS: GameConstants = {
  timer_duration: 30,
  points_correct: 30,
  points_wrong: -40,
  cost_freeze: 40,
  cost_shield: 30,
  max_skips: 5,
  freeze_duration_seconds: 45,
  freeze_cooldown_seconds: 90,
  shield_duration_seconds: 30,
  shield_cooldown_seconds: 45,
};

interface GameContextType {
  session: GameSession | null;
  player: Player | null;
  players: LeaderboardPlayer[];
  currentQuestion: CurrentQuestion | null;
  answerResult: AnswerResult | null;
  quizCompleted: boolean;
  finalScore: number;
  constants: GameConstants;
  isLoggedIn: boolean;
  isRestoring: boolean;
  loginAndJoin: (username: string, password: string) => Promise<void>;
  fetchCurrentQuestion: () => Promise<void>;
  submitAnswer: (questionId: string, selectedOption: number) => Promise<AnswerResult | null>;
  submitTimeout: (questionId: string) => Promise<AnswerResult | null>;
  skipQuestion: (questionId: string) => Promise<void>;
  usePowerupFreeze: () => void;
  selectFreezeTarget: (targetId: string) => Promise<void>;
  usePowerupShield: () => Promise<void>;
  showTargetPicker: boolean;
  cancelFreeze: () => void;
  isFrozen: boolean;
  frozenRemaining: number;
  loading: boolean;
  error: string | null;
  freezeCooldownRemaining: number;
  shieldCooldownRemaining: number;
  shieldActiveRemaining: number;
  streak: number;
}

const GameContext = createContext<GameContextType | null>(null);

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be inside GameProvider");
  return ctx;
}

// ─── Storage helpers ────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  playerId: "eh_player_id",
  playerToken: "eh_player_token",
  sessionId: "eh_session_id",
  playerName: "eh_player_name",
};

function saveCredentials(playerId: string, token: string, sessionId: string, name: string) {
  localStorage.setItem(STORAGE_KEYS.playerId, playerId);
  localStorage.setItem(STORAGE_KEYS.playerToken, token);
  localStorage.setItem(STORAGE_KEYS.sessionId, sessionId);
  localStorage.setItem(STORAGE_KEYS.playerName, name);
}

function readCredentialsFromStorage(storage: Storage) {
  return {
    playerId: storage.getItem(STORAGE_KEYS.playerId),
    playerToken: storage.getItem(STORAGE_KEYS.playerToken),
    sessionId: storage.getItem(STORAGE_KEYS.sessionId),
    playerName: storage.getItem(STORAGE_KEYS.playerName),
  };
}

function hasCoreCredentials(creds: ReturnType<typeof readCredentialsFromStorage>) {
  return Boolean(creds.playerId && creds.playerToken && creds.sessionId);
}

function loadCredentials() {
  const localCreds = readCredentialsFromStorage(localStorage);
  if (hasCoreCredentials(localCreds)) {
    return localCreds;
  }

  // Legacy migration from sessionStorage.
  const sessionCreds = readCredentialsFromStorage(sessionStorage);
  if (hasCoreCredentials(sessionCreds)) {
    saveCredentials(
      sessionCreds.playerId!,
      sessionCreds.playerToken!,
      sessionCreds.sessionId!,
      sessionCreds.playerName || "Player"
    );
  }

  return sessionCreds;
}

function clearCredentials() {
  Object.values(STORAGE_KEYS).forEach((k) => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
}

// ─── Provider ──────────────────────────────────────────────────────────────

export function GameProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<GameSession | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<CurrentQuestion | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [constants, setConstants] = useState<GameConstants>(DEFAULT_CONSTANTS);
  const [showTargetPicker, setShowTargetPicker] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [frozenRemaining, setFrozenRemaining] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [streak, setStreak] = useState(0);

  const [freezeCooldownUntil, setFreezeCooldownUntil] = useState<number>(0);
  const [shieldCooldownUntil, setShieldCooldownUntil] = useState<number>(0);
  const [shieldActiveUntil, setShieldActiveUntil] = useState<number>(0);
  const [freezeCooldownRemaining, setFreezeCooldownRemaining] = useState(0);
  const [shieldCooldownRemaining, setShieldCooldownRemaining] = useState(0);
  const [shieldActiveRemaining, setShieldActiveRemaining] = useState(0);

  const wsRef = useRef<GameWebSocket | null>(null);
  const playerTokenRef = useRef<string | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const clearAuthState = useCallback((redirectToLogin = true, message: string | null = null) => {
    clearCredentials();
    wsRef.current?.disconnect();
    wsRef.current = null;
    playerTokenRef.current = null;
    playerIdRef.current = null;
    sessionIdRef.current = null;
    setSession(null);
    setPlayer(null);
    setPlayers([]);
    setCurrentQuestion(null);
    setAnswerResult(null);
    setQuizCompleted(false);
    setFinalScore(0);
    setShowTargetPicker(false);
    setIsLoggedIn(false);
    setStreak(0);
    setError(message);
    if (redirectToLogin) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  const handleAuthError = useCallback((err: unknown, redirectToLogin = true) => {
    if (err instanceof ApiError && err.status === 401) {
      clearAuthState(redirectToLogin, "Session expired. Please log in again.");
      return true;
    }
    return false;
  }, [clearAuthState]);

  // Fetch game constants on mount
  useEffect(() => {
    gameApi.getConstants().then(setConstants).catch(() => {});
  }, []);

  // Cooldown tick
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setFreezeCooldownRemaining(Math.max(0, (freezeCooldownUntil - now) / 1000));
      setShieldCooldownRemaining(Math.max(0, (shieldCooldownUntil - now) / 1000));
      setShieldActiveRemaining(Math.max(0, (shieldActiveUntil - now) / 1000));
    }, 200);
    return () => clearInterval(interval);
  }, [freezeCooldownUntil, shieldCooldownUntil, shieldActiveUntil]);

  // Freeze status tick
  useEffect(() => {
    if (!player?.is_frozen || !player?.frozen_until) {
      setIsFrozen(false);
      setFrozenRemaining(0);
      return;
    }
    const check = setInterval(() => {
      const remaining = (new Date(player.frozen_until!).getTime() - Date.now()) / 1000;
      if (remaining <= 0) {
        setIsFrozen(false);
        setFrozenRemaining(0);
        setPlayer((prev) => prev ? { ...prev, is_frozen: false, frozen_until: null } : prev);
      } else {
        setIsFrozen(true);
        setFrozenRemaining(remaining);
      }
    }, 100);
    return () => clearInterval(check);
  }, [player?.is_frozen, player?.frozen_until]);

  // Setup WebSocket handlers
  const setupWs = useCallback((sessionId: string, playerId: string, token: string) => {
    if (wsRef.current) wsRef.current.disconnect();

    const ws = new GameWebSocket(sessionId, playerId, token);

    ws.on("session_updated", (data: any) => {
      setSession((prev) => prev ? { ...prev, status: data.status } : prev);
    });

    ws.on("player_joined", (_data: any) => {
      // Leaderboard update will follow
    });

    ws.on("player_left", (_data: any) => {
      // Leaderboard update will follow
    });

    ws.on("leaderboard_update", (data: any) => {
      if (data.players) {
        setPlayers(data.players);
        // Update our own player data from leaderboard
        const me = data.players.find((p: any) => p.id === playerIdRef.current);
        if (me) {
          setPlayer((prev) => prev ? {
            ...prev,
            score: me.score,
            is_frozen: me.is_frozen,
            has_shield: me.has_shield,
            consecutive_correct: me.streak ?? prev.consecutive_correct,
          } : prev);
          setStreak(me.streak ?? 0);
        }
      }
    });

    ws.on("score_updated", (data: any) => {
      if (data.player_id === playerIdRef.current) {
        setPlayer((prev) => prev ? { ...prev, score: data.score } : prev);
      }
    });

    ws.on("player_frozen", (data: any) => {
      if (data.player_id === playerIdRef.current) {
        const frozenUntil = new Date(Date.now() + (data.duration || constants.freeze_duration_seconds) * 1000).toISOString();
        setPlayer((prev) => prev ? { ...prev, is_frozen: true, frozen_until: frozenUntil } : prev);
      }
    });

    ws.on("player_unfrozen", (data: any) => {
      if (data.player_id === playerIdRef.current) {
        setPlayer((prev) => prev ? { ...prev, is_frozen: false, frozen_until: null } : prev);
      }
    });

    ws.on("shield_activated", (_data: any) => {
      // Our shield absorbed a freeze
      setPlayer((prev) => prev ? { ...prev, has_shield: false } : prev);
      setShieldActiveUntil(0);
    });

    ws.on("player_session_reset", () => {
      clearAuthState(true, "Session reset by admin. Please log in again.");
    });

    ws.connect();
    wsRef.current = ws;
  }, [clearAuthState, constants.freeze_duration_seconds]);

  // Attempt reconnect from persisted credentials on mount
  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      const creds = loadCredentials();
      if (!creds.playerToken || !creds.playerId || !creds.sessionId) {
        if (!cancelled) setIsRestoring(false);
        return;
      }

      playerTokenRef.current = creds.playerToken;
      playerIdRef.current = creds.playerId;
      sessionIdRef.current = creds.sessionId;

      try {
        const restored = await gameApi.getPlayerSession(creds.playerToken);
        if (cancelled) return;

        saveCredentials(
          restored.player_id,
          creds.playerToken,
          restored.session_id,
          restored.name || creds.playerName || "Player"
        );
        playerIdRef.current = restored.player_id;
        sessionIdRef.current = restored.session_id;

        setSession({ id: restored.session_id, status: restored.session_status });
        setPlayer({
          id: restored.player_id,
          session_id: restored.session_id,
          name: restored.name || creds.playerName || "Player",
          score: restored.score ?? 0,
          is_frozen: restored.is_frozen ?? false,
          frozen_until: restored.frozen_until ?? null,
          has_shield: restored.has_shield ?? false,
          skip_count: restored.skip_count ?? 0,
          current_question_index: restored.current_question_index ?? 0,
          consecutive_correct: restored.consecutive_correct ?? 0,
        });
        setIsLoggedIn(true);
        setStreak(restored.consecutive_correct ?? 0);
        setupWs(restored.session_id, restored.player_id, creds.playerToken);

        gameApi.getLeaderboard(restored.session_id).then(setPlayers).catch(() => {});
      } catch (err) {
        if (cancelled) return;

        if (!handleAuthError(err, false)) {
          setError("Unable to restore your session. Check your connection and try again.");
        }
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    };

    restoreSession();

    return () => {
      cancelled = true;
      wsRef.current?.disconnect();
    };
  }, [handleAuthError, setupWs]);

  // Login and join game
  const loginAndJoin = useCallback(async (username: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      // Step 1: Authenticate
      const loginResult = await authApi.login(username, password);
      const { player_token: authToken, display_name } = loginResult;

      // Step 2: Join game using the auth token
      const joinResult = await gameApi.join(authToken);
      const { player_id, player_token, session_id, session_status } = joinResult;

      saveCredentials(player_id, player_token, session_id, display_name);
      playerTokenRef.current = player_token;
      playerIdRef.current = player_id;
      sessionIdRef.current = session_id;

      setSession({ id: session_id, status: session_status });
      setPlayer({
        id: player_id,
        session_id,
        name: display_name,
        score: 0,
        is_frozen: false,
        frozen_until: null,
        has_shield: false,
        skip_count: 0,
        current_question_index: 0,
        consecutive_correct: 0,
      });
      setQuizCompleted(false);
      setFinalScore(0);
      setIsLoggedIn(true);
      setIsRestoring(false);
      setStreak(0);

      setupWs(session_id, player_id, player_token);

      // Fetch leaderboard
      const lb = await gameApi.getLeaderboard(session_id);
      setPlayers(lb);
    } catch (err: any) {
      setError(err.message || "Login failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }, [setupWs]);

  // Fetch current question
  const fetchCurrentQuestion = useCallback(async () => {
    if (!playerTokenRef.current) return;
    try {
      const result = await questionApi.getCurrent(playerTokenRef.current);
      if (result.completed) {
        setQuizCompleted(true);
        setFinalScore(result.final_score);
        setCurrentQuestion(null);
        return;
      }
      if (result.already_answered) {
        // Advance — this shouldn't normally happen but handle gracefully
        setCurrentQuestion(null);
        return;
      }
      setCurrentQuestion(result);
      setAnswerResult(null);
      if (result.streak !== undefined) setStreak(result.streak);
    } catch (err) {
      if (handleAuthError(err)) return;
      // error fetching question
    }
  }, [handleAuthError]);

  // Submit answer
  const submitAnswer = useCallback(async (questionId: string, selectedOption: number): Promise<AnswerResult | null> => {
    if (!playerTokenRef.current) return null;
    try {
      const result = await questionApi.submitAnswer(playerTokenRef.current, questionId, selectedOption);
      setAnswerResult(result);
      setPlayer((prev) => prev ? {
        ...prev,
        score: result.new_score,
        current_question_index: prev.current_question_index + 1,
        consecutive_correct: result.streak ?? 0,
      } : prev);
      setStreak(result.streak ?? 0);
      return result;
    } catch (err) {
      handleAuthError(err);
      return null;
    }
  }, [handleAuthError]);

  // Submit timeout
  const submitTimeout = useCallback(async (questionId: string): Promise<AnswerResult | null> => {
    if (!playerTokenRef.current) return null;
    try {
      const result = await questionApi.submitTimeout(playerTokenRef.current, questionId);
      setAnswerResult(result);
      setPlayer((prev) => prev ? {
        ...prev,
        score: result.new_score,
        current_question_index: prev.current_question_index + 1,
        consecutive_correct: 0,
      } : prev);
      setStreak(0);
      return result;
    } catch (err) {
      handleAuthError(err);
      return null;
    }
  }, [handleAuthError]);

  // Skip question
  const skipQuestion = useCallback(async (questionId: string) => {
    if (!playerTokenRef.current) return;
    try {
      await powerupApi.skip(playerTokenRef.current, questionId);
      setPlayer((prev) => prev ? {
        ...prev,
        skip_count: prev.skip_count + 1,
        current_question_index: prev.current_question_index + 1,
      } : prev);
      await fetchCurrentQuestion();
    } catch (err) {
      handleAuthError(err);
      // skip failed
    }
  }, [fetchCurrentQuestion, handleAuthError]);

  // Powerups
  const usePowerupFreeze = useCallback(() => {
    setShowTargetPicker(true);
  }, []);

  const cancelFreeze = useCallback(() => {
    setShowTargetPicker(false);
  }, []);

  const selectFreezeTarget = useCallback(async (targetId: string) => {
    if (!playerTokenRef.current) return;
    setShowTargetPicker(false);
    try {
      const result = await powerupApi.freeze(playerTokenRef.current, targetId);
      setPlayer((prev) => prev ? { ...prev, score: prev.score - (result.cost_paid ?? constants.cost_freeze) } : prev);
      setFreezeCooldownUntil(Date.now() + constants.freeze_cooldown_seconds * 1000);
    } catch (err) {
      handleAuthError(err);
      // freeze failed
    }
  }, [constants, handleAuthError]);

  const usePowerupShield = useCallback(async () => {
    if (!playerTokenRef.current) return;
    try {
      const result = await powerupApi.shield(playerTokenRef.current);
      setPlayer((prev) => prev ? {
        ...prev,
        score: prev.score - (result.cost_paid ?? constants.cost_shield),
        has_shield: true,
      } : prev);
      setShieldActiveUntil(Date.now() + constants.shield_duration_seconds * 1000);
      setShieldCooldownUntil(Date.now() + constants.shield_cooldown_seconds * 1000);
    } catch (err) {
      handleAuthError(err);
      // shield failed
    }
  }, [constants, handleAuthError]);

  return (
    <GameContext.Provider
      value={{
        session,
        player,
        players,
        currentQuestion,
        answerResult,
        quizCompleted,
        finalScore,
        constants,
        isLoggedIn,
        isRestoring,
        loginAndJoin,
        fetchCurrentQuestion,
        submitAnswer,
        submitTimeout,
        skipQuestion,
        usePowerupFreeze,
        selectFreezeTarget,
        usePowerupShield,
        showTargetPicker,
        cancelFreeze,
        isFrozen,
        frozenRemaining,
        loading,
        error,
        freezeCooldownRemaining,
        shieldCooldownRemaining,
        shieldActiveRemaining,
        streak,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}
