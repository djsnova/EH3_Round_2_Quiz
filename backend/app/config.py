from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db_name: str = "event_horizon"
    admin_secret_token: str = "change_this_to_a_long_random_string_min_32_chars"
    cors_origins: List[str] = ["http://localhost:5173"]
    host: str = "0.0.0.0"
    port: int = 8000

    # Game constants
    timer_duration: int = 30
    points_correct: int = 30
    points_wrong: int = -40
    cost_freeze: int = 40
    cost_shield: int = 30
    max_skips: int = 5
    freeze_duration_seconds: int = 45
    freeze_cooldown_seconds: int = 90
    shield_duration_seconds: int = 30
    shield_cooldown_seconds: int = 45

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
