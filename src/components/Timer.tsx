import { useEffect, useRef, useState } from "react";

interface TimerProps {
  duration: number;
  startedAt: string | null;
  onTimeout?: () => void;
}

export function Timer({ duration, startedAt, onTimeout }: TimerProps) {
  const [remaining, setRemaining] = useState(duration);
  const calledTimeout = useRef(false);

  useEffect(() => {
    calledTimeout.current = false;
    if (!startedAt) {
      setRemaining(duration);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
      const left = Math.max(0, duration - elapsed);
      setRemaining(left);
      if (left <= 0 && !calledTimeout.current) {
        calledTimeout.current = true;
        onTimeout?.();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [startedAt, duration, onTimeout]);

  const progress = remaining / duration;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  const isUrgent = remaining <= 10;
  const strokeColor = isUrgent
    ? "hsl(var(--destructive))"
    : remaining <= 20
    ? "hsl(45 90% 55%)"
    : "hsl(var(--primary))";

  return (
    <div className="relative flex items-center justify-center w-28 h-28">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke="hsla(var(--border) / 0.3)"
          strokeWidth="4"
        />
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-[stroke] duration-300"
          style={{ filter: isUrgent ? `drop-shadow(0 0 8px ${strokeColor})` : undefined }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono text-2xl font-semibold tabular-nums ${isUrgent ? "text-destructive" : "text-foreground"}`}>
          {Math.ceil(remaining)}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">sec</span>
      </div>
    </div>
  );
}
