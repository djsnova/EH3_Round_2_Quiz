import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { questions, TIMER_DURATION, POINTS_CORRECT, POINTS_WRONG, COST_FREEZE, COST_SHIELD, COST_SKIP, FREEZE_DURATION_SECONDS } from "@/lib/questions";

interface Player {
  id: string;
  session_id: string;
  name: string;
  score: number;
  is_frozen: boolean;
  frozen_until: string | null;
  has_shield: boolean;
  freeze_used: boolean;
  shield_used: boolean;
  skip_count: number;
}

interface GameSession {
  id: string;
  status: string;
  current_question_index: number;
  timer_started_at: string | null;
}

interface GameContextType {
  session: GameSession | null;
  player: Player | null;
  players: Player[];
  joinGame: (name: string) => Promise<void>;
  submitAnswer: (optionIndex: number) => Promise<void>;
  usePowerupFreeze: () => void;
  selectFreezeTarget: (targetId: string) => Promise<void>;
  usePowerupShield: () => Promise<void>;
  usePowerupSkip: () => Promise<void>;
  showTargetPicker: boolean;
  cancelFreeze: () => void;
  answeredCurrent: number | null;
  showResult: boolean;
  isFrozen: boolean;
  frozenRemaining: number;
  loading: boolean;
}

const GameContext = createContext<GameContextType | null>(null);

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be inside GameProvider");
  return ctx;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GameSession | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [answeredCurrent, setAnsweredCurrent] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [showTargetPicker, setShowTargetPicker] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [frozenRemaining, setFrozenRemaining] = useState(0);
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const playerIdRef = useRef<string | null>(null);

  // Find or create active session
  const getOrCreateSession = useCallback(async () => {
    const { data: existing } = await supabase
      .from("game_sessions")
      .select("*")
      .in("status", ["waiting", "active", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (existing) return existing as unknown as GameSession;

    const { data: created } = await supabase
      .from("game_sessions")
      .insert({ status: "waiting", current_question_index: 0 })
      .select()
      .single();

    return created as unknown as GameSession;
  }, []);

  // Join game
  const joinGame = useCallback(async (name: string) => {
    setLoading(true);
    try {
      const sess = await getOrCreateSession();
      if (!sess) return;
      setSession(sess);
      sessionIdRef.current = sess.id;

      const { data: p } = await supabase
        .from("players")
        .insert({ session_id: sess.id, name, score: 0 })
        .select()
        .single();

      if (p) {
        const playerData = p as unknown as Player;
        setPlayer(playerData);
        playerIdRef.current = playerData.id;
      }

      // Load all players
      const { data: allPlayers } = await supabase
        .from("players")
        .select("*")
        .eq("session_id", sess.id);

      if (allPlayers) setPlayers(allPlayers as unknown as Player[]);
    } finally {
      setLoading(false);
    }
  }, [getOrCreateSession]);

  // Subscribe to realtime changes
  useEffect(() => {
    if (!sessionIdRef.current) return;
    const sessionId = sessionIdRef.current;

    const channel = supabase
      .channel(`game-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_sessions", filter: `id=eq.${sessionId}` },
        (payload) => {
          if (payload.new) {
            const newSession = payload.new as unknown as GameSession;
            setSession(newSession);
            // Reset answer state on question change
            setAnsweredCurrent(null);
            setShowResult(false);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `session_id=eq.${sessionId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setPlayers((prev) => [...prev.filter(p => p.id !== (payload.new as any).id), payload.new as unknown as Player]);
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as unknown as Player;
            setPlayers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            if (updated.id === playerIdRef.current) {
              setPlayer(updated);
            }
          } else if (payload.eventType === "DELETE") {
            setPlayers((prev) => prev.filter((p) => p.id !== (payload.old as any).id));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "powerup_events", filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const event = payload.new as any;
          // If this player is the target of a freeze
          if (event.powerup_type === "freeze" && event.target_player_id === playerIdRef.current) {
            // Check if we have shield
            setPlayer((prev) => {
              if (prev?.has_shield) {
                // Shield blocks freeze, consume shield
                supabase.from("players").update({ has_shield: false }).eq("id", prev.id).then(() => {});
                return prev;
              }
              // Apply freeze
              const frozenUntil = new Date(Date.now() + FREEZE_DURATION_SECONDS * 1000).toISOString();
              supabase.from("players").update({ is_frozen: true, frozen_until: frozenUntil }).eq("id", prev!.id).then(() => {});
              return prev;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.id]);

  // Check freeze status
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
        supabase.from("players").update({ is_frozen: false, frozen_until: null }).eq("id", player.id).then(() => {});
      } else {
        setIsFrozen(true);
        setFrozenRemaining(remaining);
      }
    }, 100);

    return () => clearInterval(check);
  }, [player?.is_frozen, player?.frozen_until, player?.id]);

  // Submit answer
  const submitAnswer = useCallback(async (optionIndex: number) => {
    if (!player || !session || answeredCurrent !== null) return;

    const q = questions[session.current_question_index];
    const isCorrect = optionIndex === q.correct;
    const points = isCorrect ? POINTS_CORRECT : POINTS_WRONG;

    setAnsweredCurrent(optionIndex);

    // Show result after a brief pause
    setTimeout(() => setShowResult(true), 300);

    // Record answer
    await supabase.from("player_answers").insert({
      player_id: player.id,
      question_index: session.current_question_index,
      selected_option: optionIndex,
      is_correct: isCorrect,
      points_awarded: points,
    });

    // Update score
    await supabase
      .from("players")
      .update({ score: player.score + points })
      .eq("id", player.id);
  }, [player, session, answeredCurrent]);

  // Powerups
  const usePowerupFreeze = useCallback(() => {
    setShowTargetPicker(true);
  }, []);

  const cancelFreeze = useCallback(() => {
    setShowTargetPicker(false);
  }, []);

  const selectFreezeTarget = useCallback(async (targetId: string) => {
    if (!player || !session) return;
    setShowTargetPicker(false);

    // Deduct cost
    await supabase
      .from("players")
      .update({ score: player.score - COST_FREEZE, freeze_used: true })
      .eq("id", player.id);

    // Create powerup event
    await supabase.from("powerup_events").insert({
      session_id: session.id,
      source_player_id: player.id,
      target_player_id: targetId,
      powerup_type: "freeze",
    });
  }, [player, session]);

  const usePowerupShield = useCallback(async () => {
    if (!player) return;
    await supabase
      .from("players")
      .update({ score: player.score - COST_SHIELD, has_shield: true, shield_used: true })
      .eq("id", player.id);
  }, [player]);

  const usePowerupSkip = useCallback(async () => {
    if (!player || !session) return;
    // Deduct cost, record skip
    await supabase
      .from("players")
      .update({ score: player.score - COST_SKIP, skip_count: player.skip_count + 1 })
      .eq("id", player.id);

    // Record a skip answer
    await supabase.from("player_answers").insert({
      player_id: player.id,
      question_index: session.current_question_index,
      selected_option: null,
      is_correct: null,
      points_awarded: 0,
    });

    setAnsweredCurrent(-1); // -1 = skipped
  }, [player, session]);

  return (
    <GameContext.Provider
      value={{
        session,
        player,
        players,
        joinGame,
        submitAnswer,
        usePowerupFreeze,
        selectFreezeTarget,
        usePowerupShield,
        usePowerupSkip,
        showTargetPicker,
        cancelFreeze,
        answeredCurrent,
        showResult,
        isFrozen,
        frozenRemaining,
        loading,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}
