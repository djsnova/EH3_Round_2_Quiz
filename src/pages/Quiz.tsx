import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Starfield } from "@/components/Starfield";
import { QuizCard } from "@/components/QuizCard";
import { Timer } from "@/components/Timer";
import { ScoreDisplay } from "@/components/ScoreDisplay";
import { PowerupsPanel } from "@/components/PowerupsPanel";
import { Leaderboard } from "@/components/Leaderboard";
import { FreezeOverlay } from "@/components/FreezeOverlay";
import { useGame } from "@/lib/GameContext";
import { questions, TIMER_DURATION } from "@/lib/questions";
import { Rocket, Trophy } from "lucide-react";

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
    answeredCurrent,
    showResult,
    isFrozen,
    frozenRemaining,
  } = useGame();
  const navigate = useNavigate();

  // Redirect if no player
  useEffect(() => {
    if (!player) navigate("/");
  }, [player, navigate]);

  if (!session || !player) return null;

  const isActive = session.status === "active";
  const isWaiting = session.status === "waiting" || session.status === "paused";
  const isFinished = session.status === "finished" || session.current_question_index >= questions.length;
  const currentQ = questions[session.current_question_index];

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
          <Rocket className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm tracking-tight">DJS Nova</span>
        </div>
        <ScoreDisplay score={player.score} />
      </header>

      <div className="relative z-10 flex gap-6 px-6 pb-6 max-w-7xl mx-auto" style={{ minHeight: "calc(100vh - 72px)" }}>
        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {isWaiting && (
            <div className="text-center animate-fade-in">
              <div className="glass-panel p-10">
                <h2 className="text-2xl font-bold mb-2">Waiting for Host</h2>
                <p className="text-muted-foreground text-sm">
                  {players.length} player{players.length !== 1 ? "s" : ""} connected
                </p>
                <div className="mt-6 flex gap-2 flex-wrap justify-center">
                  {players.map((p) => (
                    <span key={p.id} className="glass-panel px-3 py-1.5 text-xs font-medium">
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isActive && currentQ && (
            <div className="w-full flex flex-col items-center gap-6">
              <Timer
                duration={TIMER_DURATION}
                startedAt={session.timer_started_at}
              />
              <QuizCard
                question={currentQ}
                questionIndex={session.current_question_index}
                totalQuestions={questions.length}
                onAnswer={submitAnswer}
                disabled={answeredCurrent !== null || isFrozen}
                answered={answeredCurrent}
                showResult={showResult}
              />
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
            onSkip={usePowerupSkip}
            players={otherPlayers}
            onSelectFreezeTarget={selectFreezeTarget}
            showTargetPicker={showTargetPicker}
            onCancelFreeze={cancelFreeze}
          />
          <Leaderboard players={players} currentPlayerId={player.id} />
        </div>
      </div>

      {/* Mobile powerups + leaderboard (bottom sheet) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-20 p-4 space-y-3">
        <PowerupsPanel
          score={player.score}
          freezeUsed={player.freeze_used}
          shieldUsed={player.shield_used}
          shieldActive={player.has_shield}
          onFreeze={usePowerupFreeze}
          onShield={usePowerupShield}
          onSkip={usePowerupSkip}
          players={otherPlayers}
          onSelectFreezeTarget={selectFreezeTarget}
          showTargetPicker={showTargetPicker}
          onCancelFreeze={cancelFreeze}
        />
      </div>
    </div>
  );
}
