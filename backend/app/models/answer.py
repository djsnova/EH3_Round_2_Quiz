from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AnswerSubmit(BaseModel):
    question_id: str
    selected_option: int


class AnswerTimeout(BaseModel):
    question_id: str


class AnswerResult(BaseModel):
    is_correct: bool
    correct_option: int
    points_awarded: int
    new_score: int


class PlayerAnswerOut(BaseModel):
    id: str
    player_id: str
    question_id: str
    question_index: int
    selected_option: Optional[int] = None
    is_correct: Optional[bool] = None
    points_awarded: int = 0
    answered_at: Optional[datetime] = None
