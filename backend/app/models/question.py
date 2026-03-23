from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class QuestionCreate(BaseModel):
    question: str
    options: List[str] = Field(..., min_length=4, max_length=4)
    correct: int = Field(..., ge=0, le=3)
    category: Optional[str] = "General"
    difficulty: Optional[str] = "medium"
    active: bool = True


class QuestionOut(BaseModel):
    """Player-facing question — NEVER includes 'correct' field."""
    id: str
    question: str
    options: List[str]
    category: Optional[str] = None
    difficulty: Optional[str] = None


class QuestionWithAnswer(QuestionOut):
    """Admin-only — includes correct answer index."""
    correct: int
    active: bool = True
    order: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
