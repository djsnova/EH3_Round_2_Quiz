import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useGame } from "@/lib/GameContext";

interface ProtectedQuizRouteProps {
  children: ReactNode;
}

export function ProtectedQuizRoute({ children }: ProtectedQuizRouteProps) {
  const { isLoggedIn, isRestoring, player } = useGame();

  if (isRestoring) {
    return null;
  }

  if (!isLoggedIn || !player) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
