import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Starfield } from "@/components/Starfield";
import { QuizCard } from "@/components/QuizCard";
import { Timer } from "@/components/Timer";
import { ScoreDisplay } from "@/components/ScoreDisplay";
import { PowerupsPanel } from "@/components/PowerupsPanel";
import { FreezeOverlay } from "@/components/FreezeOverlay";
import { useGame } from "@/lib/GameContext";
import { Trophy, Zap, Clock, Shield, SkipForward, Snowflake, Target, ChevronRight } from "lucide-react";
import djsNovaLogo from "@/assets/djs_nova_logo.jpg";

const FEEDBACK_DELAY = 1500;

type Phase = "lobby" | "instructions" | "quiz" | "finished";

export default function Quiz() {
  const {
    session,
    player,
    players,
    currentQuestion,
    answerResult,
    quizCompleted,
    finalScore,
    finalFormulaScore,
    attemptedCount,
    totalQuestions,
    completionElapsedSeconds,
    constants,
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
    freezeCooldownRemaining,
    shieldCooldownRemaining,
    shieldActiveRemaining,
    streak,
    error,
  } = useGame();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("lobby");
  const [answered, setAnswered] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [correctOption, setCorrectOption] = useState<number | null>(null);
  const [timerKey, setTimerKey] = useState(0);
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // FIX 12b: Collapsible powerups drawer state
  const [powerupsOpen, setPowerupsOpen] = useState(false);
  // FIX 19: Synchronous ref guard against double-tap
  const answerLockedRef = useRef(false);

  const isFinished = phase === "finished" || quizCompleted;
  const QUESTION_TIMER = constants.timer_duration;

  useEffect(() => {
    if (!player) navigate("/");
  }, [player, navigate]);

  useEffect(() => {
    if (phase === "lobby" && session?.status === "active") {
      setPhase("instructions");
    }
  }, [session?.status, phase]);

  useEffect(() => {
    if (session?.status === "active") return;
    setPhase("lobby");
    setAnswered(null);
    setShowResult(false);
    setCorrectOption(null);
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    answerLockedRef.current = false;
  }, [session?.status]);

  useEffect(() => {
    if (quizCompleted && phase === "quiz") {
      setPhase("finished");
    }
  }, [quizCompleted, phase]);

  // FIX 19: Reset answerLockedRef when question changes
  useEffect(() => {
    answerLockedRef.current = false;
  }, [currentQuestion?.id]);

  const startQuiz = useCallback(async () => {
    setPhase("quiz");
    await fetchCurrentQuestion();
    setTimerStartedAt(new Date().toISOString());
    setTimerKey(0);
  }, [fetchCurrentQuestion]);

  const advanceQuestion = useCallback(async () => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setAnswered(null);
    setShowResult(false);
    setCorrectOption(null);
    // FIX 19: Reset the ref guard
    answerLockedRef.current = false;

    await fetchCurrentQuestion();

    // FIX 20: Only restart timer if quiz is not done
    setTimeout(() => {
      setTimerKey((k) => k + 1);
      setTimerStartedAt(new Date().toISOString());
    }, 0);
  }, [fetchCurrentQuestion]);

  const handleAnswer = useCallback(
    async (optionIndex: number) => {
      // FIX 19: Use ref guard instead of state for synchronous double-tap prevention
      if (answerLockedRef.current || isFinished || !currentQuestion) return;
      answerLockedRef.current = true;
      setAnswered(optionIndex);

      const result = await submitAnswer(currentQuestion.id, optionIndex);
      if (result) {
        setCorrectOption(result.correct_option);
        setTimeout(() => setShowResult(true), 300);
      }
      advanceTimerRef.current = setTimeout(advanceQuestion, FEEDBACK_DELAY);
    },
    [isFinished, currentQuestion, submitAnswer, advanceQuestion]
  );

  const handleTimeout = useCallback(async () => {
    if (answered !== null || !currentQuestion) return;
    setAnswered(-1);

    const result = await submitTimeout(currentQuestion.id);
    if (result) {
      setCorrectOption(result.correct_option);
    }
    advanceTimerRef.current = setTimeout(advanceQuestion, FEEDBACK_DELAY);
  }, [answered, currentQuestion, submitTimeout, advanceQuestion]);

  const handleSkip = useCallback(async () => {
    if (answered !== null || isFinished || !player || !currentQuestion) return;
    if (player.skip_count >= constants.max_skips) return;
    await skipQuestion(currentQuestion.id);
    setTimerKey((k) => k + 1);
    setTimerStartedAt(new Date().toISOString());
  }, [answered, isFinished, skipQuestion, currentQuestion, player, constants.max_skips]);

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
    constants,
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

      {/* FIX 15: Redesigned header for mobile readability */}
      <header className="relative z-10 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <img src={djsNovaLogo} alt="DJS Nova" className="w-6 h-6 md:w-7 md:h-7 rounded-full object-cover" style={{ filter: "drop-shadow(0 0 16px hsl(220 90% 56% / 0.4))" }} />
          <span className="font-semibold text-sm tracking-tight hidden sm:inline">DJS Nova</span>
        </div>
        <div className="flex items-center gap-2">
          {phase === "quiz" && streak >= 3 && (
            <span className="text-xs font-mono px-2 py-1 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30 animate-pulse">
              🔥 {streak}
            </span>
          )}
          {phase === "quiz" && (
            <div className="glass-panel px-3 py-1.5 flex items-center gap-2">
              <ScoreDisplay score={player.score} />
            </div>
          )}
        </div>
      </header>

      {/* FIX 17: Main content wrapper — scrollable on mobile */}
      <div className="relative z-10 flex gap-6 px-3 md:px-6 pb-6 max-w-7xl mx-auto w-full overflow-y-auto quiz-scroll-container" style={{ minHeight: "calc(100vh - 56px)" }}>
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
                {error && (
                  <p className="text-xs text-primary mt-3">{error}</p>
                )}
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
                      <p className="text-xs text-muted-foreground">{constants.timer_duration} seconds per question. If time runs out, it counts as a wrong answer ({constants.points_wrong}).</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/10">
                    <Target className="w-5 h-5 text-success shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Scoring & Streaks</p>
                      <p className="text-xs text-muted-foreground">Base: <span className="text-success">+{constants.points_correct}</span> / <span className="text-destructive">{constants.points_wrong}</span> · 3+ streak: <span className="text-orange-400">+40/−30</span> · 7+ streak: <span className="text-orange-400">+50/−20 & powerup discount</span></p>
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
                        <p className="text-xs font-medium">Freeze ({constants.cost_freeze}pts)</p>
                        <p className="text-[11px] text-muted-foreground">Freeze a player for {constants.freeze_duration_seconds}s · {constants.freeze_cooldown_seconds}s cooldown</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/10">
                      <Shield className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium">Shield ({constants.cost_shield}pts)</p>
                        <p className="text-[11px] text-muted-foreground">Block one freeze · lasts {constants.shield_duration_seconds}s · {constants.shield_cooldown_seconds}s cooldown</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/10">
                      <SkipForward className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium">Skip (free)</p>
                        <p className="text-[11px] text-muted-foreground">Skip question · {constants.max_skips} total</p>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-6">
                  Each player progresses at their own pace
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

          {/* FIX 12c: Redesigned mobile-first quiz layout — no fixed powerups */}
          {phase === "quiz" && currentQuestion && (
            <div className="w-full flex flex-col items-center gap-3 pb-4">

              {/* Timer — compact on mobile */}
              <div className="flex items-center justify-center w-full">
                <Timer
                  key={timerKey}
                  duration={QUESTION_TIMER}
                  startedAt={timerStartedAt}
                  onTimeout={handleTimeout}
                />
              </div>

              {/* Question card — full width, no bottom padding eaten by fixed bar */}
              <div className="w-full px-0">
                <QuizCard
                  question={currentQuestion}
                  questionIndex={currentQuestion.question_index}
                  totalQuestions={currentQuestion.total_questions}
                  onAnswer={handleAnswer}
                  disabled={answered !== null || isFrozen}
                  answered={answered}
                  showResult={showResult}
                  correctOption={correctOption}
                />
              </div>

              {/* Feedback text */}
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

              {/* FIX 12c: Mobile collapsible powerups drawer — IN FLOW, not fixed */}
              <div className="w-full lg:hidden">
                <button
                  onClick={() => setPowerupsOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-2.5 glass-panel text-sm font-medium"
                >
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    Powerups
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="text-foreground font-mono">{player.score} pts</span>
                    <span>{powerupsOpen ? "▲" : "▼"}</span>
                  </span>
                </button>
                {powerupsOpen && (
                  <div className="mt-1">
                    <PowerupsPanel {...powerupsPanelProps} />
                  </div>
                )}
              </div>

            </div>
          )}

          {isFinished && (
            <div className="text-center animate-fade-in">
              <div className="glass-panel p-10">
                <Trophy className="w-12 h-12 text-accent mx-auto mb-4" style={{ filter: "drop-shadow(0 0 20px hsl(185 80% 50% / 0.5))" }} />
                <h2 className="text-3xl font-bold mb-2">Quiz Complete</h2>
                <p className="text-muted-foreground mb-1">Final Formula Score</p>
                <span className="font-mono text-5xl font-bold text-accent text-glow-accent">
                  {Math.round(quizCompleted ? finalFormulaScore : player.score)}
                </span>
                <p className="text-xs text-muted-foreground mt-4">Raw Points: {quizCompleted ? finalScore : player.score}</p>
                <p className="text-xs text-muted-foreground mt-1">Attempted: {attemptedCount}/{totalQuestions}</p>
                <p className="text-xs text-muted-foreground mt-1">Completion Time: {completionElapsedSeconds != null ? `${Math.round(completionElapsedSeconds)}s` : "-"}</p>
              </div>
            </div>
          )}
        </div>

        {phase === "quiz" && (
          <div className="hidden lg:flex flex-col gap-4 w-72 shrink-0">
            <PowerupsPanel {...powerupsPanelProps} />
          </div>
        )}
      </div>

      {/* FIX 12a: Removed the old fixed-bottom mobile powerups panel entirely */}
    </div>
  );
}
