import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Starfield } from "@/components/Starfield";
import { useGame } from "@/lib/GameContext";
import djsNovaLogo from "@/assets/djs_nova_logo.jpg";

export default function Index() {
  const [name, setName] = useState("");
  const { joinGame, loading } = useGame();
  const navigate = useNavigate();

  const handleJoin = async () => {
    if (!name.trim()) return;
    await joinGame(name.trim());
    navigate("/quiz");
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <Starfield />

      {/* Nebula gradient */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 30% 20%, hsla(270 60% 30% / 0.15) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, hsla(220 80% 30% / 0.12) 0%, transparent 50%)",
        }}
      />

      <div className="relative z-10 w-full max-w-md px-6 animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-12">
          <img src={djsNovaLogo} alt="DJS Nova" className="w-24 h-24 rounded-full mx-auto mb-4 object-cover" style={{ filter: "drop-shadow(0 0 16px hsl(220 90% 56% / 0.4))" }} />
          <h1 className="text-3xl font-bold tracking-tight mb-1">DJS Nova</h1>
          <p className="text-sm text-muted-foreground uppercase tracking-[0.3em]">
            Event Horizon 3.0 — Round 2
          </p>
          <p className="text-xs text-muted-foreground mt-1">Space Quiz</p>
        </div>

        {/* Join Card */}
        <div className="glass-panel-strong p-8">
          <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-2">
            Enter your name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="Commander..."
            maxLength={20}
            className="w-full bg-muted/20 border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200"
          />
          <button
            onClick={handleJoin}
            disabled={!name.trim() || loading}
            className="w-full mt-4 bg-primary text-primary-foreground py-3 rounded-lg font-semibold text-sm uppercase tracking-wider transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed glow-primary"
          >
            {loading ? "Joining..." : "Launch"}
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          25 questions · 30s each · Powerups enabled
        </p>
      </div>
    </div>
  );
}
