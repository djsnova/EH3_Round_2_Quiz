import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Starfield } from "@/components/Starfield";
import { useGame } from "@/lib/GameContext";
import djsNovaLogo from "@/assets/djs_nova_logo.jpg";

export default function Index() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { loginAndJoin, loading, error } = useGame();
  const navigate = useNavigate();

  const handleLogin = async () => {
    if (!username.trim() || !password) return;
    try {
      await loginAndJoin(username.trim(), password);
      navigate("/quiz");
    } catch {
      // error is set in context
    }
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

        {/* Login Card */}
        <div className="glass-panel-strong p-8">
          <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-2">
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && document.getElementById("pwd-input")?.focus()}
            placeholder="Enter username..."
            maxLength={20}
            autoComplete="username"
            className="w-full bg-muted/20 border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200"
          />

          <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-2 mt-4">
            Password
          </label>
          <input
            id="pwd-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Enter password..."
            autoComplete="current-password"
            className="w-full bg-muted/20 border border-border/40 rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200"
          />

          {error && (
            <p className="text-xs text-destructive mt-3 text-center">{error}</p>
          )}

          <button
            onClick={handleLogin}
            disabled={!username.trim() || !password || loading}
            className="w-full mt-4 bg-primary text-primary-foreground py-3 rounded-lg font-semibold text-sm uppercase tracking-wider transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed glow-primary"
          >
            {loading ? "Authenticating..." : "Launch"}
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          25 questions · 30s each · Powerups enabled · Streak bonuses active
        </p>
      </div>
    </div>
  );
}
