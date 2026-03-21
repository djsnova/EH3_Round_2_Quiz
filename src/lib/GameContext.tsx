import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  questions, TIMER_DURATION, POINTS_CORRECT, POINTS_WRONG,
  COST_FREEZE, COST_SHIELD, COST_SKIP, MAX_SKIPS,
  FREEZE_DURATION_SECONDS, FREEZE_COOLDOWN_SECONDS,
  SHIELD_DURATION_SECONDS, SHIELD_COOLDOWN_SECONDS,
} from "@/lib/questions";

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
  submitAnswer: (optionIndex: number, questionIndex: number) => Promise<void>;
  usePowerupFreeze: () => void;
  selectFreezeTarget: (targetId: string) => Promise<void>;
  usePowerupShield: () => Promise<void>;
  usePowerupSkip: (questionIndex: number) => Promise<void>;
  showTargetPicker: boolean;
  cancelFreeze: () => void;
  isFrozen: boolean;
  frozenRemaining: number;
  loading: boolean;
  freezeCooldownRemaining: number;
  shieldCooldownRemaining: number;
  shieldActiveRemaining: number;
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
  const [showTargetPicker, setShowTargetPicker] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [frozenRemaining, setFrozenRemaining] = useState(0);
  const [loading, setLoading] = useState(false);

  // Cooldown tracking (local, per-client)
  const [freezeCooldownUntil, setFreezeCooldownUntil] = useState<number>(0);
  const [shieldCooldownUntil, setShieldCooldownUntil] = useState<number>(0);
  const [shieldActiveUntil, setShieldActiveUntil] = useState<number>(0);
  const [freezeCooldownRemaining, setFreezeCooldownRemaining] = useState(0);
  const [shieldCooldownRemaining, setShieldCooldownRemaining] = useState(0);
  const [shieldActiveRemaining, setShieldActiveRemaining] = useState(0);

  const sessionIdRef = useRef<string | null>(null);
  const playerIdRef = useRef<string | null>(null);

  // Cooldown tick
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setFreezeCooldownRemaining(Math.max(0, (freezeCooldownUntil - now) / 1000));
      setShieldCooldownRemaining(Math.max(0, (shieldCooldownUntil - now) / 1000));
      const sr = Math.max(0, (shieldActiveUntil - now) / 1000);
      setShieldActiveRemaining(sr);
      // If shield expired, remove it
      if (sr <= 0 && shieldActiveUntil > 0) {
        setShieldActiveUntil(0);
        if (playerIdRef.current) {
          supabase.from("players").update({ has_shield: false }).eq("id", playerIdRef.current).then(() => {});
        }
      }
    }, 200);
    return () => clearInterval(interval);
  }, [freezeCooldownUntil, shieldCooldownUntil, shieldActiveUntil]);

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
            setSession(payload.new as unknown as GameSession);
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
          if (event.powerup_type === "freeze" && event.target_player_id === playerIdRef.current) {
            setPlayer((prev) => {
              if (!prev) return prev;
              if (prev.has_shield) {
                supabase.from("players").update({ has_shield: false }).eq("id", prev.id).then(() => {});
                setShieldActiveUntil(0);
                return prev;
              }
              const frozenUntil = new Date(Date.now() + FREEZE_DURATION_SECONDS * 1000).toISOString();
              supabase.from("players").update({ is_frozen: true, frozen_until: frozenUntil }).eq("id", prev.id).then(() => {});
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
  const submitAnswer = useCallback(async (optionIndex: number, questionIndex: number) => {
    if (!player || !session) return;

    // -1 = timeout (no answer, 0 points) — legacy, kept for skip
    if (optionIndex === -1) {
      await supabase.from("player_answers").insert({
        player_id: player.id,
        question_index: questionIndex,
        selected_option: null,
        is_correct: null,
        points_awarded: 0,
      });
      return;
    }

    // -2 = timeout counted as wrong answer
    if (optionIndex === -2) {
      await supabase.from("player_answers").insert({
        player_id: player.id,
        question_index: questionIndex,
        selected_option: null,
        is_correct: false,
        points_awarded: POINTS_WRONG,
      });
      await supabase
        .from("players")
        .update({ score: player.score + POINTS_WRONG })
        .eq("id", player.id);
      return;
    }

    const q = questions[questionIndex];
    const isCorrect = optionIndex === q.correct;
    const points = isCorrect ? POINTS_CORRECT : POINTS_WRONG;

    await supabase.from("player_answers").insert({
      player_id: player.id,
      question_index: questionIndex,
      selected_option: optionIndex,
      is_correct: isCorrect,
      points_awarded: points,
    });

    await supabase
      .from("players")
      .update({ score: player.score + points })
      .eq("id", player.id);
  }, [player, session]);

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

    await supabase
      .from("players")
      .update({ score: player.score - COST_FREEZE })
      .eq("id", player.id);

    await supabase.from("powerup_events").insert({
      session_id: session.id,
      source_player_id: player.id,
      target_player_id: targetId,
      powerup_type: "freeze",
    });

    // Start cooldown
    setFreezeCooldownUntil(Date.now() + FREEZE_COOLDOWN_SECONDS * 1000);
  }, [player, session]);

  const usePowerupShield = useCallback(async () => {
    if (!player) return;
    await supabase
      .from("players")
      .update({ score: player.score - COST_SHIELD, has_shield: true, shield_used: true })
      .eq("id", player.id);

    // Shield active for SHIELD_DURATION_SECONDS
    setShieldActiveUntil(Date.now() + SHIELD_DURATION_SECONDS * 1000);
    // Start cooldown
    setShieldCooldownUntil(Date.now() + SHIELD_COOLDOWN_SECONDS * 1000);
  }, [player]);

  const usePowerupSkip = useCallback(async (questionIndex: number) => {
    if (!player || !session) return;
    // Skip is free (0 cost) but limited to MAX_SKIPS
    await supabase
      .from("players")
      .update({ skip_count: player.skip_count + 1 })
      .eq("id", player.id);

    await supabase.from("player_answers").insert({
      player_id: player.id,
      question_index: questionIndex,
      selected_option: null,
      is_correct: null,
      points_awarded: 0,
    });
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
        isFrozen,
        frozenRemaining,
        loading,
        freezeCooldownRemaining,
        shieldCooldownRemaining,
        shieldActiveRemaining,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

