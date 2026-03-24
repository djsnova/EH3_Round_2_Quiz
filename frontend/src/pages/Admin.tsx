import { useEffect, useState, useCallback } from "react";
import { Starfield } from "@/components/Starfield";
import { adminApi } from "@/lib/api";
import { Play, Pause, RotateCcw, Snowflake, Trash2, Edit3, Plus, Upload, Lock, Eye, EyeOff, UserPlus, Users } from "lucide-react";

interface GameSession {
  id: string;
  status: string;
  player_count: number;
}

interface Player {
  id: string;
  name: string;
  score: number;
  is_frozen: boolean;
  has_shield: boolean;
  consecutive_correct?: number;
  registered_username?: string;
}

interface RegisteredPlayer {
  id: string;
  username: string;
  display_name: string;
  last_login?: string;
  created_at?: string;
}

interface Question {
  id: string;
  question: string;
  options: string[];
  correct: number;
  category?: string;
  difficulty?: string;
  active: boolean;
  order: number;
}

type AdminTab = "game" | "players" | "questions" | "registered";

export default function Admin() {
  const [adminToken, setAdminToken] = useState<string>(sessionStorage.getItem("eh_admin_token") || "");
  const [authenticated, setAuthenticated] = useState(false);
  const [tokenInput, setTokenInput] = useState("");

  const [session, setSession] = useState<GameSession | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [registeredPlayers, setRegisteredPlayers] = useState<RegisteredPlayer[]>([]);
  const [activeTab, setActiveTab] = useState<AdminTab>("game");
  const [editingScore, setEditingScore] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState("");

  // Question form state
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [qForm, setQForm] = useState({
    question: "",
    optionA: "",
    optionB: "",
    optionC: "",
    optionD: "",
    correct: 0,
    category: "General",
    difficulty: "medium",
    active: true,
  });

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState("");

  // Register player form
  const [showRegForm, setShowRegForm] = useState(false);
  const [regForm, setRegForm] = useState({ username: "", password: "", display_name: "" });
  const [showRegImport, setShowRegImport] = useState(false);
  const [regImportJson, setRegImportJson] = useState("");

  // ─── Auth ──────────────────────────────────────────────

  const handleLogin = useCallback(async () => {
    if (!tokenInput.trim()) return;
    try {
      await adminApi.getSessions(tokenInput.trim());
      setAdminToken(tokenInput.trim());
      sessionStorage.setItem("eh_admin_token", tokenInput.trim());
      setAuthenticated(true);
    } catch (err: any) {
      alert(err.message || "Failed to authenticate");
    }
  }, [tokenInput]);

  useEffect(() => {
    if (adminToken) {
      adminApi.getSessions(adminToken).then(() => {
        setAuthenticated(true);
      }).catch(() => {
        sessionStorage.removeItem("eh_admin_token");
        setAdminToken("");
      });
    }
  }, [adminToken]);

  // ─── Data loading ──────────────────────────────────────

  const loadSession = useCallback(async () => {
    if (!adminToken) return;
    try {
      const sessions = await adminApi.getSessions(adminToken);
      const active = sessions.find((s: GameSession) =>
        ["waiting", "active", "paused"].includes(s.status)
      );
      if (active) setSession(active);
    } catch { /* ignore */ }
  }, [adminToken]);

  const loadPlayers = useCallback(async () => {
    if (!adminToken || !session) return;
    try {
      const data = await adminApi.getPlayers(adminToken, session.id);
      setPlayers(data);
    } catch { /* ignore */ }
  }, [adminToken, session?.id]);

  const loadQuestions = useCallback(async () => {
    if (!adminToken) return;
    try {
      const data = await adminApi.getQuestions(adminToken);
      setQuestions(data);
    } catch { /* ignore */ }
  }, [adminToken]);

  const loadRegisteredPlayers = useCallback(async () => {
    if (!adminToken) return;
    try {
      const data = await adminApi.getRegisteredPlayers(adminToken);
      setRegisteredPlayers(data);
    } catch { /* ignore */ }
  }, [adminToken]);

  useEffect(() => {
    if (authenticated) loadSession();
  }, [authenticated, loadSession]);

  useEffect(() => {
    if (session) loadPlayers();
  }, [session?.id, loadPlayers]);

  useEffect(() => {
    if (authenticated && activeTab === "questions") loadQuestions();
  }, [authenticated, activeTab, loadQuestions]);

  useEffect(() => {
    if (authenticated && activeTab === "registered") loadRegisteredPlayers();
  }, [authenticated, activeTab, loadRegisteredPlayers]);

  // WebSocket for live updates
  useEffect(() => {
    if (!authenticated || !session || !adminToken) return;
    const wsBase = import.meta.env.VITE_WS_BASE_URL || `ws://${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/admin/${session.id}?token=${adminToken}`);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "session_updated") {
          setSession((prev) => prev ? { ...prev, status: msg.data.status } : prev);
        }
        if (["player_joined", "player_left", "leaderboard_update", "score_updated"].includes(msg.type)) {
          loadPlayers();
        }
      } catch { /* ignore */ }
    };

    return () => ws.close();
  }, [authenticated, session?.id, adminToken, loadPlayers]);

  // Poll players periodically as fallback
  useEffect(() => {
    if (!authenticated || !session) return;
    const interval = setInterval(loadPlayers, 5000);
    return () => clearInterval(interval);
  }, [authenticated, session?.id, loadPlayers]);

  // ─── Session actions ───────────────────────────────────

  const startQuiz = async () => {
    if (!session || !adminToken) return;
    await adminApi.updateSession(adminToken, session.id, "active");
    setSession((prev) => prev ? { ...prev, status: "active" } : prev);
  };

  const pauseQuiz = async () => {
    if (!session || !adminToken) return;
    await adminApi.updateSession(adminToken, session.id, "paused");
    setSession((prev) => prev ? { ...prev, status: "paused" } : prev);
  };

  const resetGame = async () => {
    if (!session || !adminToken) return;
    if (!confirm("Reset game? All scores will be cleared.")) return;
    await adminApi.resetSession(adminToken, session.id);
    setSession((prev) => prev ? { ...prev, status: "waiting" } : prev);
    loadPlayers();
  };

  const freezePlayer = async (playerId: string) => {
    if (!adminToken) return;
    await adminApi.freezePlayer(adminToken, playerId, 60);
    loadPlayers();
  };

  const removePlayer = async (playerId: string) => {
    if (!adminToken) return;
    if (!confirm("Remove this player?")) return;
    await adminApi.removePlayer(adminToken, playerId);
    loadPlayers();
  };

  const updateScore = async (playerId: string) => {
    const newScore = parseInt(scoreInput);
    if (isNaN(newScore) || !adminToken) return;
    await adminApi.updateScore(adminToken, playerId, newScore);
    setEditingScore(null);
    loadPlayers();
  };

  const createNewSession = async () => {
    if (!adminToken) return;
    const result = await adminApi.createSession(adminToken);
    setSession({ id: result.id, status: result.status, player_count: 0 });
  };

  // ─── Question actions ──────────────────────────────────

  const openQuestionForm = (q?: Question) => {
    if (q) {
      setEditingQuestion(q);
      setQForm({
        question: q.question,
        optionA: q.options[0] || "",
        optionB: q.options[1] || "",
        optionC: q.options[2] || "",
        optionD: q.options[3] || "",
        correct: q.correct,
        category: q.category || "General",
        difficulty: q.difficulty || "medium",
        active: q.active,
      });
    } else {
      setEditingQuestion(null);
      setQForm({
        question: "",
        optionA: "",
        optionB: "",
        optionC: "",
        optionD: "",
        correct: 0,
        category: "General",
        difficulty: "medium",
        active: true,
      });
    }
    setShowQuestionForm(true);
  };

  const saveQuestion = async () => {
    if (!adminToken) return;
    const data = {
      question: qForm.question,
      options: [qForm.optionA, qForm.optionB, qForm.optionC, qForm.optionD],
      correct: qForm.correct,
      category: qForm.category,
      difficulty: qForm.difficulty,
      active: qForm.active,
    };

    if (editingQuestion) {
      await adminApi.updateQuestion(adminToken, editingQuestion.id, data);
    } else {
      await adminApi.createQuestion(adminToken, data);
    }
    setShowQuestionForm(false);
    loadQuestions();
  };

  const deleteQuestion = async (id: string) => {
    if (!adminToken) return;
    if (!confirm("Deactivate this question?")) return;
    await adminApi.deleteQuestion(adminToken, id);
    loadQuestions();
  };

  const handleImport = async () => {
    if (!adminToken) return;
    try {
      const parsed = JSON.parse(importJson);
      const qs = Array.isArray(parsed) ? parsed : parsed.questions;
      await adminApi.importQuestions(adminToken, qs);
      setShowImport(false);
      setImportJson("");
      loadQuestions();
    } catch {
      alert("Invalid JSON format");
    }
  };

  // ─── Registered player actions ─────────────────────────

  const handleRegister = async () => {
    if (!adminToken || !regForm.username.trim() || !regForm.password) return;
    try {
      await adminApi.registerPlayer(adminToken, {
        username: regForm.username.trim().toLowerCase(),
        password: regForm.password,
        display_name: regForm.display_name.trim() || undefined,
      });
      setShowRegForm(false);
      setRegForm({ username: "", password: "", display_name: "" });
      loadRegisteredPlayers();
    } catch (err: any) {
      alert(err.message || "Failed to register player");
    }
  };

  const handleRegImport = async () => {
    if (!adminToken) return;
    try {
      const parsed = JSON.parse(regImportJson);
      const players = Array.isArray(parsed) ? parsed : parsed.players;
      const result = await adminApi.registerPlayersBulk(adminToken, players);
      alert(`Created ${result.created} accounts. Skipped ${result.skipped}.`);
      setShowRegImport(false);
      setRegImportJson("");
      loadRegisteredPlayers();
    } catch {
      alert("Invalid JSON format");
    }
  };

  const deleteRegistered = async (id: string) => {
    if (!adminToken) return;
    if (!confirm("Delete this registered player?")) return;
    await adminApi.deleteRegisteredPlayer(adminToken, id);
    loadRegisteredPlayers();
  };

  const labels = ["A", "B", "C", "D"];

  // ─── Login screen ──────────────────────────────────────

  if (!authenticated) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <Starfield />
        <div className="fixed inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse at 50% 30%, hsla(0 60% 30% / 0.08) 0%, transparent 50%)",
        }} />
        <div className="relative z-10 max-w-md mx-auto px-6 py-20">
          <div className="glass-panel p-8 text-center">
            <Lock className="w-10 h-10 text-primary mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Admin Access</h1>
            <p className="text-sm text-muted-foreground mb-6">Enter admin token to continue</p>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="Admin token..."
              className="w-full bg-muted/20 border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200 mb-4"
            />
            <button
              onClick={handleLogin}
              disabled={!tokenInput.trim()}
              className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold text-sm uppercase tracking-wider transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
            >
              Authenticate
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main admin panel ─────────────────────────────────

  return (
    <div className="relative min-h-screen overflow-hidden">
      <Starfield />
      <div className="fixed inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse at 50% 30%, hsla(0 60% 30% / 0.08) 0%, transparent 50%)",
      }} />

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Admin Control Center</h1>
            <p className="text-sm text-muted-foreground">EVENT HORIZON 3.0</p>
          </div>
          {session && (
            <span className={`px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider ${
              session.status === "active" ? "bg-success/15 text-success" :
              session.status === "paused" ? "bg-yellow-500/15 text-yellow-400" :
              session.status === "finished" ? "bg-destructive/15 text-destructive" :
              "bg-muted/30 text-muted-foreground"
            }`}>
              {session.status}
            </span>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 flex-wrap">
          {(["game", "players", "questions", "registered"] as AdminTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium capitalize transition-all duration-200 ${
                activeTab === tab
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
              }`}
            >
              {tab === "game" ? "Game Control" : tab === "registered" ? "Registered Players" : tab}
            </button>
          ))}
        </div>

        {/* ─── Game Control Tab ──────────────────────────── */}
        {activeTab === "game" && (
          <>
            {!session ? (
              <div className="glass-panel p-8 text-center">
                <p className="text-muted-foreground mb-4">No active session</p>
                <button onClick={createNewSession} className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium text-sm hover:brightness-110 active:scale-[0.98] transition-all">
                  Create Session
                </button>
              </div>
            ) : (
              <div className="glass-panel p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs text-muted-foreground">
                    {players.length} players connected
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {questions.length > 0 ? `${questions.filter(q => q.active).length} active questions` : "Loading..."}
                  </span>
                </div>
                <div className="flex gap-3 flex-wrap">
                  {session.status !== "active" ? (
                    <button onClick={startQuiz} className="flex items-center gap-2 bg-success/20 text-success border border-success/30 px-4 py-2 rounded-lg text-sm font-medium hover:bg-success/30 active:scale-[0.97] transition-all">
                      <Play className="w-4 h-4" /> Start
                    </button>
                  ) : (
                    <button onClick={pauseQuiz} className="flex items-center gap-2 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-4 py-2 rounded-lg text-sm font-medium hover:bg-yellow-500/30 active:scale-[0.97] transition-all">
                      <Pause className="w-4 h-4" /> Pause
                    </button>
                  )}
                  <button onClick={resetGame} className="flex items-center gap-2 bg-destructive/20 text-destructive border border-destructive/30 px-4 py-2 rounded-lg text-sm font-medium hover:bg-destructive/30 active:scale-[0.97] transition-all">
                    <RotateCcw className="w-4 h-4" /> Reset
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-3">
                  Players progress through questions independently after you start the quiz.
                </p>
              </div>
            )}
          </>
        )}

        {/* ─── Players Tab ───────────────────────────────── */}
        {activeTab === "players" && (
          <div className="glass-panel p-5">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3 font-mono">
              Players ({players.length})
            </h3>
            <div className="space-y-2">
              {players.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted/10 border border-border/20">
                  <span className="flex-1 text-sm font-medium">{p.name}</span>
                  {(p.consecutive_correct ?? 0) >= 3 && (
                    <span className="text-[10px] text-orange-400 uppercase font-mono">🔥 {p.consecutive_correct}</span>
                  )}
                  {p.is_frozen && <span className="text-[10px] text-accent uppercase">frozen</span>}
                  {p.has_shield && <span className="text-[10px] text-secondary uppercase">shielded</span>}

                  {editingScore === p.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={scoreInput}
                        onChange={(e) => setScoreInput(e.target.value)}
                        className="w-20 bg-muted/30 border border-border/40 rounded px-2 py-1 text-sm font-mono"
                        onKeyDown={(e) => e.key === "Enter" && updateScore(p.id)}
                      />
                      <button onClick={() => updateScore(p.id)} className="text-xs text-success hover:underline">
                        Save
                      </button>
                    </div>
                  ) : (
                    <span className="font-mono text-sm font-semibold tabular-nums w-16 text-right">
                      {p.score}
                    </span>
                  )}

                  <button onClick={() => { setEditingScore(p.id); setScoreInput(String(p.score)); }} className="p-1.5 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors" title="Edit score">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => freezePlayer(p.id)} className="p-1.5 rounded hover:bg-accent/20 text-muted-foreground hover:text-accent transition-colors" title="Freeze">
                    <Snowflake className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => removePlayer(p.id)} className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors" title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {players.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No players have joined yet
                </p>
              )}
            </div>
          </div>
        )}

        {/* ─── Registered Players Tab ─────────────────────── */}
        {activeTab === "registered" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {registeredPlayers.length} registered accounts
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowRegImport(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-muted/20 border border-border/30 hover:bg-muted/30 transition-all"
                >
                  <Upload className="w-3.5 h-3.5" /> Import JSON
                </button>
                <button
                  onClick={() => setShowRegForm(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-all"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add Player
                </button>
              </div>
            </div>

            <div className="glass-panel p-4">
              <div className="space-y-2">
                {registeredPlayers.map((rp) => (
                  <div key={rp.id} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted/10 border border-border/20">
                    <Users className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{rp.display_name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">@{rp.username}</p>
                    </div>
                    {rp.last_login && (
                      <span className="text-[10px] text-muted-foreground">
                        Last: {new Date(rp.last_login).toLocaleDateString()}
                      </span>
                    )}
                    <button onClick={() => deleteRegistered(rp.id)} className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {registeredPlayers.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No registered players. Add some or import from JSON.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Questions Tab ─────────────────────────────── */}
        {activeTab === "questions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {questions.length} total · {questions.filter(q => q.active).length} active
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowImport(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-muted/20 border border-border/30 hover:bg-muted/30 transition-all"
                >
                  <Upload className="w-3.5 h-3.5" /> Import JSON
                </button>
                <button
                  onClick={() => openQuestionForm()}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Question
                </button>
              </div>
            </div>

            <div className="glass-panel p-4">
              <div className="space-y-2">
                {questions.map((q) => (
                  <div key={q.id} className={`flex items-start gap-3 px-4 py-3 rounded-lg border transition-all ${q.active ? "bg-muted/10 border-border/20" : "bg-muted/5 border-border/10 opacity-50"}`}>
                    <span className="font-mono text-xs text-muted-foreground w-6 pt-1 shrink-0">#{q.order}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium mb-1 truncate">{q.question}</p>
                      <div className="flex gap-2 flex-wrap">
                        {q.options.map((opt, i) => (
                          <span key={i} className={`text-[11px] px-2 py-0.5 rounded ${i === q.correct ? "bg-success/15 text-success" : "bg-muted/20 text-muted-foreground"}`}>
                            {labels[i]}: {opt.length > 20 ? opt.slice(0, 20) + "…" : opt}
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-1">
                        {q.category && <span className="text-[10px] text-muted-foreground">{q.category}</span>}
                        {q.difficulty && <span className="text-[10px] text-muted-foreground">· {q.difficulty}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openQuestionForm(q)} className="p-1.5 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!adminToken) return;
                          await adminApi.updateQuestion(adminToken, q.id, { active: !q.active });
                          loadQuestions();
                        }}
                        className="p-1.5 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                        title={q.active ? "Deactivate" : "Activate"}
                      >
                        {q.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => deleteQuestion(q.id)} className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors" title="Deactivate">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {questions.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No questions yet. Add some or import from JSON.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Register Player Modal ──────────────────────── */}
        {showRegForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setShowRegForm(false)} />
            <div className="relative glass-panel-strong p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">Register Player</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wide">Username</label>
                  <input
                    type="text"
                    value={regForm.username}
                    onChange={(e) => setRegForm({ ...regForm, username: e.target.value })}
                    placeholder="username"
                    className="w-full mt-1 bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wide">Password</label>
                  <input
                    type="text"
                    value={regForm.password}
                    onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                    placeholder="password"
                    className="w-full mt-1 bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wide">Display Name (optional)</label>
                  <input
                    type="text"
                    value={regForm.display_name}
                    onChange={(e) => setRegForm({ ...regForm, display_name: e.target.value })}
                    placeholder="Shown on leaderboard"
                    className="w-full mt-1 bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowRegForm(false)} className="flex-1 py-2.5 rounded-lg text-sm font-medium text-muted-foreground bg-muted/20 hover:bg-muted/30 transition-all">
                  Cancel
                </button>
                <button
                  onClick={handleRegister}
                  disabled={!regForm.username.trim() || !regForm.password}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.98] disabled:opacity-40 transition-all"
                >
                  Register
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── Register Players Import Modal ──────────────── */}
        {showRegImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setShowRegImport(false)} />
            <div className="relative glass-panel-strong p-6 w-full max-w-lg">
              <h3 className="text-lg font-bold mb-4">Import Players</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Paste a JSON array with: username, password, display_name (optional)
              </p>
              <textarea
                value={regImportJson}
                onChange={(e) => setRegImportJson(e.target.value)}
                rows={10}
                placeholder='[{"username":"john","password":"pass123","display_name":"John Doe"}]'
                className="w-full bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 mb-4"
              />
              <div className="flex gap-3">
                <button onClick={() => setShowRegImport(false)} className="flex-1 py-2.5 rounded-lg text-sm font-medium text-muted-foreground bg-muted/20 hover:bg-muted/30 transition-all">
                  Cancel
                </button>
                <button
                  onClick={handleRegImport}
                  disabled={!regImportJson.trim()}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.98] disabled:opacity-40 transition-all"
                >
                  Import
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── Question Form Modal ───────────────────────── */}
        {showQuestionForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setShowQuestionForm(false)} />
            <div className="relative glass-panel-strong p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-bold mb-4">{editingQuestion ? "Edit Question" : "Add Question"}</h3>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wide">Question</label>
                  <textarea
                    value={qForm.question}
                    onChange={(e) => setQForm({ ...qForm, question: e.target.value })}
                    rows={3}
                    className="w-full mt-1 bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                  />
                </div>

                {["A", "B", "C", "D"].map((label, i) => (
                  <div key={label} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct"
                      checked={qForm.correct === i}
                      onChange={() => setQForm({ ...qForm, correct: i })}
                      className="accent-[hsl(var(--success))]"
                    />
                    <span className="text-xs font-bold w-4">{label}</span>
                    <input
                      type="text"
                      value={[qForm.optionA, qForm.optionB, qForm.optionC, qForm.optionD][i]}
                      onChange={(e) => {
                        const update: Record<string, string> = {};
                        const keys = ["optionA", "optionB", "optionC", "optionD"];
                        update[keys[i]] = e.target.value;
                        setQForm({ ...qForm, ...update });
                      }}
                      placeholder={`Option ${label}`}
                      className="flex-1 bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                ))}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground uppercase tracking-wide">Category</label>
                    <input
                      type="text"
                      value={qForm.category}
                      onChange={(e) => setQForm({ ...qForm, category: e.target.value })}
                      className="w-full mt-1 bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground uppercase tracking-wide">Difficulty</label>
                    <select
                      value={qForm.difficulty}
                      onChange={(e) => setQForm({ ...qForm, difficulty: e.target.value })}
                      className="w-full mt-1 bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={qForm.active}
                    onChange={(e) => setQForm({ ...qForm, active: e.target.checked })}
                    className="accent-[hsl(var(--primary))]"
                  />
                  <span className="text-sm">Active</span>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowQuestionForm(false)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium text-muted-foreground bg-muted/20 hover:bg-muted/30 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={saveQuestion}
                  disabled={!qForm.question.trim() || !qForm.optionA.trim()}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.98] disabled:opacity-40 transition-all"
                >
                  {editingQuestion ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── Import JSON Modal ────────────────────────── */}
        {showImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setShowImport(false)} />
            <div className="relative glass-panel-strong p-6 w-full max-w-lg">
              <h3 className="text-lg font-bold mb-4">Import Questions</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Paste a JSON array of questions with: question, options, correct, category, difficulty
              </p>
              <textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                rows={10}
                placeholder='[{"question":"...","options":["A","B","C","D"],"correct":0}]'
                className="w-full bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 mb-4"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setShowImport(false)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium text-muted-foreground bg-muted/20 hover:bg-muted/30 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={!importJson.trim()}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.98] disabled:opacity-40 transition-all"
                >
                  Import
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
