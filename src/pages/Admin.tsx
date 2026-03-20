import { useEffect, useState, useCallback } from "react";
import { Starfield } from "@/components/Starfield";
import { supabase } from "@/integrations/supabase/client";
import { questions, TIMER_DURATION } from "@/lib/questions";
import { Play, Pause, SkipForward, RotateCcw, Snowflake, Trash2, Edit3 } from "lucide-react";

interface GameSession {
  id: string;
  status: string;
  current_question_index: number;
  timer_started_at: string | null;
}

interface Player {
  id: string;
  name: string;
  score: number;
  is_frozen: boolean;
  has_shield: boolean;
}

export default function Admin() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [editingScore, setEditingScore] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState("");

  const loadSession = useCallback(async () => {
    const { data } = await supabase
      .from("game_sessions")
      .select("*")
      .in("status", ["waiting", "active", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (data) setSession(data as unknown as GameSession);
  }, []);

  const loadPlayers = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase
      .from("players")
      .select("*")
      .eq("session_id", session.id)
      .order("score", { ascending: false });
    if (data) setPlayers(data as unknown as Player[]);
  }, [session?.id]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    loadPlayers();
    if (!session) return;
    const channel = supabase
      .channel("admin-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "game_sessions", filter: `id=eq.${session.id}` }, (p) => {
        if (p.new) setSession(p.new as unknown as GameSession);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `session_id=eq.${session.id}` }, () => {
        loadPlayers();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id, loadPlayers]);

  const startQuiz = async () => {
    if (!session) return;
    await supabase.from("game_sessions").update({
      status: "active",
      timer_started_at: new Date().toISOString(),
    }).eq("id", session.id);
  };

  const pauseQuiz = async () => {
    if (!session) return;
    await supabase.from("game_sessions").update({ status: "paused", timer_started_at: null }).eq("id", session.id);
  };

  const nextQuestion = async () => {
    if (!session) return;
    const next = session.current_question_index + 1;
    if (next >= questions.length) {
      await supabase.from("game_sessions").update({ status: "finished" }).eq("id", session.id);
    } else {
      await supabase.from("game_sessions").update({
        current_question_index: next,
        timer_started_at: new Date().toISOString(),
      }).eq("id", session.id);
    }
  };

  const resetGame = async () => {
    if (!session) return;
    // Reset session
    await supabase.from("game_sessions").update({
      status: "waiting",
      current_question_index: 0,
      timer_started_at: null,
    }).eq("id", session.id);
    // Reset all player scores
    for (const p of players) {
      await supabase.from("players").update({
        score: 0,
        is_frozen: false,
        frozen_until: null,
        has_shield: false,
        freeze_used: false,
        shield_used: false,
        skip_count: 0,
      }).eq("id", p.id);
    }
    // Delete answers
    await supabase.from("player_answers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  };

  const freezePlayer = async (playerId: string) => {
    if (!session) return;
    const frozenUntil = new Date(Date.now() + 60000).toISOString();
    await supabase.from("players").update({ is_frozen: true, frozen_until: frozenUntil }).eq("id", playerId);
    await supabase.from("powerup_events").insert({
      session_id: session.id,
      source_player_id: playerId,
      target_player_id: playerId,
      powerup_type: "freeze",
    });
  };

  const removePlayer = async (playerId: string) => {
    await supabase.from("players").delete().eq("id", playerId);
  };

  const updateScore = async (playerId: string) => {
    const newScore = parseInt(scoreInput);
    if (isNaN(newScore)) return;
    await supabase.from("players").update({ score: newScore }).eq("id", playerId);
    setEditingScore(null);
  };

  const createNewSession = async () => {
    const { data } = await supabase
      .from("game_sessions")
      .insert({ status: "waiting", current_question_index: 0 })
      .select()
      .single();
    if (data) setSession(data as unknown as GameSession);
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <Starfield />
      <div className="fixed inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse at 50% 30%, hsla(0 60% 30% / 0.08) 0%, transparent 50%)",
      }} />

      <div className="relative z-10 max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
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

        {!session ? (
          <div className="glass-panel p-8 text-center">
            <p className="text-muted-foreground mb-4">No active session</p>
            <button onClick={createNewSession} className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium text-sm hover:brightness-110 active:scale-[0.98] transition-all">
              Create Session
            </button>
          </div>
        ) : (
          <>
            {/* Controls */}
            <div className="glass-panel p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-sm text-muted-foreground">
                  Q {session.current_question_index + 1} / {questions.length}
                </span>
                <span className="text-xs text-muted-foreground">
                  {players.length} players connected
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
                <button onClick={nextQuestion} className="flex items-center gap-2 bg-primary/20 text-primary border border-primary/30 px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/30 active:scale-[0.97] transition-all">
                  <SkipForward className="w-4 h-4" /> Next Question
                </button>
                <button onClick={resetGame} className="flex items-center gap-2 bg-destructive/20 text-destructive border border-destructive/30 px-4 py-2 rounded-lg text-sm font-medium hover:bg-destructive/30 active:scale-[0.97] transition-all">
                  <RotateCcw className="w-4 h-4" /> Reset
                </button>
              </div>
            </div>

            {/* Current question preview */}
            {questions[session.current_question_index] && (
              <div className="glass-panel p-5 mb-6">
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2 font-mono">
                  Current Question
                </h3>
                <p className="font-medium mb-3">
                  {questions[session.current_question_index].question}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {questions[session.current_question_index].options.map((opt, i) => (
                    <span key={i} className={`text-xs px-3 py-2 rounded-md ${i === questions[session.current_question_index].correct ? "bg-success/15 text-success border border-success/30" : "bg-muted/20 text-muted-foreground"}`}>
                      {["A", "B", "C", "D"][i]}. {opt}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Players */}
            <div className="glass-panel p-5">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3 font-mono">
                Players
              </h3>
              <div className="space-y-2">
                {players.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted/10 border border-border/20">
                    <span className="flex-1 text-sm font-medium">{p.name}</span>
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
          </>
        )}
      </div>
    </div>
  );
}
