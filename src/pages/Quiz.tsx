import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Starfield } from "@/components/Starfield";
import { QuizCard } from "@/components/QuizCard";
import { Timer } from "@/components/Timer";
import { ScoreDisplay } from "@/components/ScoreDisplay";
import { PowerupsPanel } from "@/components/PowerupsPanel";
import { Leaderboard } from "@/components/Leaderboard";
import { FreezeOverlay } from "@/components/FreezeOverlay";
import { useGame } from "@/lib/GameContext";
import {
  questions, TIMER_DURATION, POINTS_CORRECT, POINTS_WRONG,
  MAX_SKIPS, FREEZE_DURATION_SECONDS, SHIELD_DURATION_SECONDS,
} from "@/lib/questions";
import { Trophy, Zap, Clock, Shield, SkipForward, Snowflake, Target, ChevronRight } from "lucide-react";
import djsNovaLogo from "@/assets/djs_nova_logo.jpg";

const QUESTION_TIMER = TIMER_DURATION;
const FEEDBACK_DELAY = 1500;

type Phase = "lobby" | "instructions" | "quiz" | "finished";

export default function Quiz() {
  const {
    session,
    player,
    players,
    submitAnswer,
    usePowerupFreeze,
    selectFreezeTarget,
    usePowerupShield,
    usePowerupSkip,
    showTargetPicker,
    cancelFreeze,
    isFrozen,
    frozenRemaining,
    freezeCooldownRemaining,
    shieldCooldownRemaining,
    shieldActiveRemaining,
  } = useGame();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("lobby");
  const [localIndex, setLocalIndex] = useState(0);
  const [answered, setAnswered] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [timerKey, setTimerKey] = useState(0);
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFinished = phase === "finished";
  const currentQ = phase === "quiz" && localIndex < questions.length ? questions[localIndex] : null;

  useEffect(() => {
    if (!player) navigate("/");
  }, [player, navigate]);

  useEffect(() => {
    if (phase === "lobby" && session?.status === "active") {
      setPhase("instructions");
    }
  }, [session?.status, phase]);

  const startQuiz = useCallback(() => {
    setPhase("quiz");
    setLocalIndex(0);
    setTimerStartedAt(new Date().toISOString());
    setTimerKey(0);
  }, []);

  const advanceQuestion = useCallback(() => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setAnswered(null);
    setShowResult(false);
    setLocalIndex((prev) => {
      const next = prev + 1;
      if (next >= questions.length) {
        setPhase("finished");
        return prev;
      }
      return next;
    });
    setTimerKey((k) => k + 1);
    setTimerStartedAt(new Date().toISOString());
  }, []);

  const handleAnswer = useCallback(
    async (optionIndex: number) => {
      if (answered !== null || isFinished) return;
      setAnswered(optionIndex);
      setTimeout(() => setShowResult(true), 300);
      await submitAnswer(optionIndex, localIndex);
      advanceTimerRef.current = setTimeout(advanceQuestion, FEEDBACK_DELAY);
    },
    [answered, isFinished, submitAnswer, localIndex, advanceQuestion]
  );

  const handleTimeout = useCallback(() => {
    if (answered !== null) return;
    setAnswered(-1);
    submitAnswer(-1, localIndex);
    advanceTimerRef.current = setTimeout(advanceQuestion, FEEDBACK_DELAY);
  }, [answered, submitAnswer, localIndex, advanceQuestion]);

  const handleSkip = useCallback(async () => {
    if (answered !== null || isFinished || !player) return;
    if (player.skip_count >= MAX_SKIPS) return;
    await usePowerupSkip(localIndex);
    advanceQuestion();
  }, [answered, isFinished, usePowerupSkip, localIndex, advanceQuestion, player]);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  if (!session || !player) return null;

  const otherPlayers = players.filter((p) => p.id !== player.id);

  const powerupsPanelProps = {
    score: player.score,
    skipCount: player.skip_count,
    shieldActive: player.has_shield,
    onFreeze: usePowerupFreeze,
    onShield: usePowerupShield,
    onSkip: handleSkip,
    players: otherPlayers,
    onSelectFreezeTarget: selectFreezeTarget,
    showTargetPicker,
    onCancelFreeze: cancelFreeze,
    freezeCooldownRemaining,
    shieldCooldownRemaining,
    shieldActiveRemaining,
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <Starfield />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 20% 30%, hsla(270 60% 30% / 0.1) 0%, transparent 50%), radial-gradient(ellipse at 80% 70%, hsla(220 80% 30% / 0.08) 0%, transparent 50%)",
        }}
      />
      <FreezeOverlay active={isFrozen} remainingSeconds={frozenRemaining} />

      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <img src={djsNovaLogo} alt="DJS Nova" className="w-7 h-7 rounded-full object-cover" />
          <span className="font-semibold text-sm tracking-tight">DJS Nova</span>
        </div>
        {phase === "quiz" && <ScoreDisplay score={player.score} />}
      </header>

      <div className="relative z-10 flex gap-6 px-6 pb-6 max-w-7xl mx-auto" style={{ minHeight: "calc(100vh - 72px)" }}>
        <div className="flex-1 flex flex-col items-center justify-center">

          {phase === "lobby" && (
            <div className="text-center animate-fade-in w-full max-w-lg">
              <div className="glass-panel p-10">
                <img src={djsNovaLogo} alt="DJS Nova" className="w-20 h-20 rounded-full mx-auto mb-6 object-cover" style={{ filter: "drop-shadow(0 0 16px hsl(220 90% 56% / 0.4))" }} />
                <h2 className="text-2xl font-bold mb-1">Waiting for Host</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  The quiz will begin when the admin starts the game
                </p>
                <div className="flex gap-2 flex-wrap justify-center mb-4">
                  {players.map((p) => (
                    <span key={p.id} className={`glass-panel px-3 py-1.5 text-xs font-medium ${p.id === player.id ? "border-primary/40 text-primary" : ""}`}>
                      {p.name} {p.id === player.id && "(you)"}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {players.length} player{players.length !== 1 ? "s" : ""} connected
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-xs text-muted-foreground">Waiting...</span>
                </div>
              </div>
            </div>
          )}

          {phase === "instructions" && (
            <div className="text-center animate-fade-in w-full max-w-2xl">
              <div className="glass-panel p-8 md:p-10">
                <h2 className="text-2xl font-bold mb-6">How to Play</h2>
                <div className="grid gap-4 text-left mb-8">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/10">
                    <Clock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Timer</p>
                      <p className="text-xs text-muted-foreground">{TIMER_DURATION} seconds per question. If time runs out, it's marked as unanswered.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/10">
                    <Target className="w-5 h-5 text-success shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Scoring</p>
                      <p className="text-xs text-muted-foreground">Correct: <span className="text-success">+{POINTS_CORRECT}</span> · Wrong: <span className="text-destructive">{POINTS_WRONG}</span> · Skip: free ({MAX_SKIPS} max)</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/10">
                    <Zap className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Powerups</p>
                      <p className="text-xs text-muted-foreground">Use your score to buy powerups. Freeze and Shield have cooldowns.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/10">
                      <Snowflake className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium">Freeze (40pts)</p>
                        <p className="text-[11px] text-muted-foreground">Freeze a player for {FREEZE_DURATION_SECONDS}s · 90s cooldown</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/10">
                      <Shield className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium">Shield (30pts)</p>
                        <p className="text-[11px] text-muted-foreground">Block one freeze · lasts {SHIELD_DURATION_SECONDS}s · 45s cooldown</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/10">
                      <SkipForward className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium">Skip (free)</p>
                        <p className="text-[11px] text-muted-foreground">Skip question · {MAX_SKIPS} total</p>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-6">
                  {questions.length} questions · Each player progresses at their own pace
                </p>
                <button
                  onClick={startQuiz}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 rounded-lg font-semibold text-sm uppercase tracking-wider transition-all duration-200 hover:brightness-110 active:scale-[0.98] glow-primary"
                >
                  Begin Quiz <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {phase === "quiz" && currentQ && (
            <div className="w-full flex flex-col items-center gap-6">
              <Timer
                key={timerKey}
                duration={QUESTION_TIMER}
                startedAt={timerStartedAt}
                onTimeout={handleTimeout}
              />
              <QuizCard
                question={currentQ}
                questionIndex={localIndex}
                totalQuestions={questions.length}
                onAnswer={handleAnswer}
                disabled={answered !== null || isFrozen}
                answered={answered}
                showResult={showResult}
              />
              {answered !== null && answered !== -1 && !showResult && (
                <span className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">
                  Answer locked
                </span>
              )}
              {answered === -1 && (
                <span className="text-xs uppercase tracking-widest text-destructive animate-pulse">
                  Time's up!
                </span>
              )}
            </div>
          )}

          {isFinished && (
            <div className="text-center animate-fade-in">
              <div className="glass-panel p-10">
                <Trophy className="w-12 h-12 text-accent mx-auto mb-4" style={{ filter: "drop-shadow(0 0 20px hsl(185 80% 50% / 0.5))" }} />
                <h2 className="text-3xl font-bold mb-2">Quiz Complete</h2>
                <p className="text-muted-foreground mb-4">Final Score</p>
                <span className="font-mono text-5xl font-bold text-accent text-glow-accent">
                  {player.score}
                </span>
              </div>
            </div>
          )}
        </div>

        {phase === "quiz" && (
          <div className="hidden lg:flex flex-col gap-4 w-72 shrink-0">
            <PowerupsPanel {...powerupsPanelProps} />
            <Leaderboard players={players} currentPlayerId={player.id} />
          </div>
        )}
      </div>

      {phase === "quiz" && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-20 p-4 space-y-3">
          <PowerupsPanel {...powerupsPanelProps} />
        </div>
      )}
    </div>
  );
}
