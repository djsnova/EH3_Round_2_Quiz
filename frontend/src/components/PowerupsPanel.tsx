import { Snowflake, Shield, SkipForward } from "lucide-react";
import type { GameConstants } from "@/lib/GameContext";

interface PowerupsPanelProps {
  score: number;
  skipCount: number;
  shieldActive: boolean;
  onFreeze: () => void;
  onShield: () => void;
  onSkip: () => void;
  players?: { id: string; name: string }[];
  onSelectFreezeTarget?: (playerId: string) => void;
  showTargetPicker?: boolean;
  onCancelFreeze?: () => void;
  freezeCooldownRemaining: number;
  shieldCooldownRemaining: number;
  shieldActiveRemaining: number;
  constants: GameConstants;
}

export function PowerupsPanel({
  score,
  skipCount,
  shieldActive,
  onFreeze,
  onShield,
  onSkip,
  players,
  onSelectFreezeTarget,
  showTargetPicker,
  onCancelFreeze,
  freezeCooldownRemaining,
  shieldCooldownRemaining,
  shieldActiveRemaining,
  constants,
}: PowerupsPanelProps) {
  const freezeOnCooldown = freezeCooldownRemaining > 0;
  const shieldOnCooldown = shieldCooldownRemaining > 0;
  const skipsRemaining = constants.max_skips - skipCount;

  const powerups = [
    {
      id: "freeze",
      icon: Snowflake,
      label: "Freeze",
      cost: constants.cost_freeze,
      disabled: freezeOnCooldown || score < constants.cost_freeze,
      onClick: onFreeze,
      color: "text-accent",
      glowClass: "glow-accent",
      subtitle: freezeOnCooldown
        ? `${Math.ceil(freezeCooldownRemaining)}s`
        : `-${constants.cost_freeze}`,
    },
    {
      id: "shield",
      icon: Shield,
      label: "Shield",
      cost: constants.cost_shield,
      disabled: shieldOnCooldown || shieldActive || score < constants.cost_shield,
      onClick: onShield,
      color: "text-secondary",
      glowClass: "glow-secondary",
      active: shieldActive,
      subtitle: shieldActive
        ? `${Math.ceil(shieldActiveRemaining)}s`
        : shieldOnCooldown
        ? `${Math.ceil(shieldCooldownRemaining)}s`
        : `-${constants.cost_shield}`,
    },
    {
      id: "skip",
      icon: SkipForward,
      label: "Skip",
      cost: 0,
      disabled: skipsRemaining <= 0,
      onClick: onSkip,
      color: "text-primary",
      glowClass: "glow-primary",
      subtitle: `${skipsRemaining}/${constants.max_skips}`,
    },
  ];

  return (
    <div className="glass-panel p-4 animate-fade-in">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2 font-mono">
        Powerups
      </h3>

      {showTargetPicker && players && (
        <div className="mb-3 p-3 rounded-lg bg-accent/10 border border-accent/20">
          <p className="text-xs text-accent mb-2">Select target to freeze:</p>
          <div className="grid gap-1">
            {players.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelectFreezeTarget?.(p.id)}
                className="text-left text-sm px-3 py-2 rounded-md hover:bg-accent/20 transition-colors"
              >
                {p.name}
              </button>
            ))}
          </div>
          <button
            onClick={onCancelFreeze}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex gap-2">
        {powerups.map((p) => (
          <button
            key={p.id}
            onClick={p.onClick}
            disabled={p.disabled}
            className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all duration-200 active:scale-[0.96] ${
              p.active
                ? `border-secondary/60 bg-secondary/15 ${p.glowClass}`
                : p.disabled
                ? "border-border/20 bg-muted/5 opacity-40 cursor-not-allowed"
                : "border-border/30 bg-muted/10 hover:border-primary/30 hover:bg-primary/5"
            }`}
          >
            <p.icon className={`w-6 h-6 md:w-5 md:h-5 ${p.active ? "text-secondary animate-pulse-glow" : p.disabled ? "text-muted-foreground" : p.color}`} />
            <span className="text-[11px] md:text-[10px] font-medium uppercase tracking-wider">
              {p.label}
            </span>
            <span className="font-mono text-[11px] md:text-[10px] text-muted-foreground">
              {p.subtitle}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
