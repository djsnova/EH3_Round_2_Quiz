from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class PlayerCreate(BaseModel):
    name: str
    session_id: Optional[str] = None


class PlayerOut(BaseModel):
    id: str
    session_id: str
    name: str
    score: int = 0
    attempted_count: int = 0
    final_formula_score: float = 0.0
    elapsed_seconds: Optional[float] = None
    current_question_index: int = 0
    is_frozen: bool = False
    frozen_until: Optional[datetime] = None
    has_shield: bool = False
    skip_count: int = 0


class PlayerAdmin(PlayerOut):
    """Admin view — includes token."""
    token: str
    freeze_used_at: Optional[datetime] = None
    shield_used_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class PlayerLeaderboard(BaseModel):
    id: str
    name: str
    score: int
    attempted_count: int = 0
    final_formula_score: float = 0.0
    elapsed_seconds: Optional[float] = None
    is_frozen: bool = False
    has_shield: bool = False
