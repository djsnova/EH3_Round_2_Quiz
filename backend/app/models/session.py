from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class GameSessionOut(BaseModel):
    id: str
    status: str  # waiting | active | paused | finished
    timer_started_at: Optional[datetime] = None
    player_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class GameSessionUpdate(BaseModel):
    status: str
