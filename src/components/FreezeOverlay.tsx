import { Snowflake } from "lucide-react";

interface FreezeOverlayProps {
  active: boolean;
  remainingSeconds?: number;
}

export function FreezeOverlay({ active, remainingSeconds }: FreezeOverlayProps) {
  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center frozen-overlay pointer-events-auto">
      {/* Dark blur backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-lg" />

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 30%, hsla(200 80% 20% / 0.4) 100%)",
        }}
      />

      {/* Content */}
      <div className="relative flex flex-col items-center gap-6 animate-scale-in">
        <Snowflake className="w-20 h-20 text-accent animate-float" style={{ filter: "drop-shadow(0 0 20px hsl(185 80% 50% / 0.6))" }} />
        <h1 className="text-5xl font-bold tracking-wider uppercase text-accent text-glow-accent">
          Frozen
        </h1>
        {remainingSeconds !== undefined && (
          <p className="font-mono text-lg text-muted-foreground tabular-nums">
            {Math.ceil(remainingSeconds)}s remaining
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Your screen has been frozen by another player
        </p>
      </div>
    </div>
  );
}
