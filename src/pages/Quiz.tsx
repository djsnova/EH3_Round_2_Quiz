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
import { questions } from "@/lib/questions";
import { Trophy } from "lucide-react";
import djsNovaLogo from "@/assets/djs_nova_logo.jpg";

const QUESTION_TIMER = 25; // seconds per question
const FEEDBACK_DELAY = 1500; // ms before auto-advance

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
  } = useGame();
  const navigate = useNavigate();

  // Local per-user question progression
  const [localIndex, setLocalIndex] = useState(0);
  const [answered, setAnswered] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [timerKey, setTimerKey] = useState(0); // reset timer on new question
  const [timerStartedAt, setTimerStartedAt] = useState<string>(new Date().toISOString());
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFinished = localIndex >= questions.length;
  const currentQ = !isFinished ? questions[localIndex] : null;

  // Redirect if no player
  useEffect(() => {
    if (!player) navigate("/");
  }, [player, navigate]);

  // Advance to next question
  const advanceQuestion = useCallback(() => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setAnswered(null);
    setShowResult(false);
    setLocalIndex((prev) => prev + 1);
    setTimerKey((k) => k + 1);
    setTimerStartedAt(new Date().toISOString());
  }, []);

  // Handle answer selection
  const handleAnswer = useCallback(
    async (optionIndex: number) => {
      if (answered !== null || isFinished) return;
      setAnswered(optionIndex);
      setTimeout(() => setShowResult(true), 300);

      // Submit to backend
      await submitAnswer(optionIndex, localIndex);

      // Auto-advance after feedback
      advanceTimerRef.current = setTimeout(advanceQuestion, FEEDBACK_DELAY);
    },
    [answered, isFinished, submitAnswer, localIndex, advanceQuestion]
  );

  // Handle timer timeout
  const handleTimeout = useCallback(() => {
    if (answered !== null) return; // already answered
    // Mark as skipped
    setAnswered(-1);
    setShowResult(true);
    submitAnswer(-1, localIndex); // -1 = timeout/skipped
    advanceTimerRef.current = setTimeout(advanceQuestion, FEEDBACK_DELAY);
  }, [answered, submitAnswer, localIndex, advanceQuestion]);

  // Handle skip powerup
  const handleSkip = useCallback(async () => {
    if (answered !== null || isFinished) return;
    await usePowerupSkip(localIndex);
    advanceQuestion();
  }, [answered, isFinished, usePowerupSkip, localIndex, advanceQuestion]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  if (!session || !player) return null;

  const otherPlayers = players.filter((p) => p.id !== player.id);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <Starfield />

      {/* Nebula gradient */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 20% 30%, hsla(270 60% 30% / 0.1) 0%, transparent 50%), radial-gradient(ellipse at 80% 70%, hsla(220 80% 30% / 0.08) 0%, transparent 50%)",
        }}
      />

      {/* Freeze overlay */}
      <FreezeOverlay active={isFrozen} remainingSeconds={frozenRemaining} />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <img src={djsNovaLogo} alt="DJS Nova" className="w-7 h-7 rounded-full object-cover" />
          <span className="font-semibold text-sm tracking-tight">DJS Nova</span>
        </div>
        <ScoreDisplay score={player.score} />
      </header>

      <div className="relative z-10 flex gap-6 px-6 pb-6 max-w-7xl mx-auto" style={{ minHeight: "calc(100vh - 72px)" }}>
        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {!isFinished && currentQ && (
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
              {answered !== null && !showResult && (
                <span className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">
                  Answer locked
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

        {/* Sidebar */}
        <div className="hidden lg:flex flex-col gap-4 w-72 shrink-0">
          <PowerupsPanel
            score={player.score}
            freezeUsed={player.freeze_used}
            shieldUsed={player.shield_used}
            shieldActive={player.has_shield}
            onFreeze={usePowerupFreeze}
            onShield={usePowerupShield}
            onSkip={handleSkip}
            players={otherPlayers}
            onSelectFreezeTarget={selectFreezeTarget}
            showTargetPicker={showTargetPicker}
            onCancelFreeze={cancelFreeze}
          />
          <Leaderboard players={players} currentPlayerId={player.id} />
        </div>
      </div>

      {/* Mobile powerups */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-20 p-4 space-y-3">
        <PowerupsPanel
          score={player.score}
          freezeUsed={player.freeze_used}
          shieldUsed={player.shield_used}
          shieldActive={player.has_shield}
          onFreeze={usePowerupFreeze}
          onShield={usePowerupShield}
          onSkip={handleSkip}
          players={otherPlayers}
          onSelectFreezeTarget={selectFreezeTarget}
          showTargetPicker={showTargetPicker}
          onCancelFreeze={cancelFreeze}
        />
      </div>
    </div>
  );
}
