import { useEffect, useRef, useState } from "react";

interface ScoreDisplayProps {
  score: number;
  label?: string;
}

export function ScoreDisplay({ score, label = "Score" }: ScoreDisplayProps) {
  const [displayScore, setDisplayScore] = useState(score);
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const prevScore = useRef(score);

  useEffect(() => {
    if (score !== prevScore.current) {
      const diff = score - prevScore.current;
      setFlash(diff > 0 ? "correct" : "wrong");
      // Animate count
      const start = prevScore.current;
      const end = score;
      const steps = 15;
      const stepTime = 300 / steps;
      let step = 0;
      const interval = setInterval(() => {
        step++;
        setDisplayScore(Math.round(start + (end - start) * (step / steps)));
        if (step >= steps) {
          clearInterval(interval);
          setDisplayScore(end);
        }
      }, stepTime);
      prevScore.current = score;
      setTimeout(() => setFlash(null), 600);
      return () => clearInterval(interval);
    }
  }, [score]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span
        className={`font-mono text-xl md:text-2xl font-bold tabular-nums transition-transform duration-200 ${
          flash === "correct" ? "score-flash-correct" : flash === "wrong" ? "score-flash-wrong" : ""
        }`}
      >
        {displayScore}
      </span>
    </div>
  );
}
