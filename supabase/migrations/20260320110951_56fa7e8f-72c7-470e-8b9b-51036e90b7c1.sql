
-- Game sessions table
CREATE TABLE public.game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'paused', 'finished')),
  current_question_index INTEGER NOT NULL DEFAULT 0,
  timer_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Players table
CREATE TABLE public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.game_sessions(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  is_frozen BOOLEAN NOT NULL DEFAULT false,
  frozen_until TIMESTAMPTZ,
  has_shield BOOLEAN NOT NULL DEFAULT false,
  freeze_used BOOLEAN NOT NULL DEFAULT false,
  shield_used BOOLEAN NOT NULL DEFAULT false,
  skip_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Player answers table
CREATE TABLE public.player_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES public.players(id) ON DELETE CASCADE NOT NULL,
  question_index INTEGER NOT NULL,
  selected_option INTEGER,
  is_correct BOOLEAN,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_id, question_index)
);

-- Powerup events table (for real-time freeze/shield events)
CREATE TABLE public.powerup_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.game_sessions(id) ON DELETE CASCADE NOT NULL,
  source_player_id UUID REFERENCES public.players(id) ON DELETE CASCADE NOT NULL,
  target_player_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
  powerup_type TEXT NOT NULL CHECK (powerup_type IN ('freeze', 'shield', 'skip')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.powerup_events ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (quiz app, no auth required)
CREATE POLICY "Allow all on game_sessions" ON public.game_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on players" ON public.players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on player_answers" ON public.player_answers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on powerup_events" ON public.powerup_events FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime on all tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.player_answers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.powerup_events;
