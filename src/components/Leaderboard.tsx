interface Player {
  id: string;
  name: string;
  score: number;
}

interface LeaderboardProps {
  players: Player[];
  currentPlayerId?: string;
}

export function Leaderboard({ players, currentPlayerId }: LeaderboardProps) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <div className="glass-panel p-4 animate-fade-in">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3 font-mono">
        Leaderboard
      </h3>
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {sorted.map((player, idx) => {
          const isMe = player.id === currentPlayerId;
          const rankColors = [
            "text-accent text-glow-accent",
            "text-primary text-glow-primary",
            "text-secondary",
          ];

          return (
            <div
              key={player.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-500 ${
                isMe
                  ? "bg-primary/10 border border-primary/20"
                  : "hover:bg-muted/20"
              }`}
            >
              <span
                className={`font-mono text-sm font-bold w-6 text-center ${
                  idx < 3 ? rankColors[idx] : "text-muted-foreground"
                }`}
              >
                {idx + 1}
              </span>
              <span className={`flex-1 text-sm truncate ${isMe ? "font-semibold" : ""}`}>
                {player.name}
                {isMe && (
                  <span className="ml-1.5 text-[10px] text-primary uppercase tracking-wider">
                    you
                  </span>
                )}
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {player.score}
              </span>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No players yet
          </p>
        )}
      </div>
    </div>
  );
}
