from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator, model_validator
from typing import List
import json
import warnings

_DEFAULT_SECRET = "change_this_to_a_long_random_string_min_32_chars"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db_name: str = "event_horizon"
    admin_secret_token: str = _DEFAULT_SECRET
    cors_origins: List[str] = ["http://localhost:5173"]
    host: str = "0.0.0.0"
    port: int = 7860
    seed_test_accounts: bool = False

    # Base game constants (tier-0 defaults)
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

    # Streak tiers — tier 0 uses base values above
    streak_tier1_threshold: int = 3
    streak_tier1_points_correct: int = 40
    streak_tier1_points_wrong: int = -30
    streak_tier1_powerup_discount: int = 0

    streak_tier2_threshold: int = 7
    streak_tier2_points_correct: int = 50
    streak_tier2_points_wrong: int = -20
    streak_tier2_powerup_discount: int = 10

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value):
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            if raw.startswith("["):
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, list):
                        return [str(item).strip() for item in parsed if str(item).strip()]
                except json.JSONDecodeError:
                    pass
            return [item.strip() for item in raw.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def _check_admin_secret(self):
        if self.admin_secret_token == _DEFAULT_SECRET:
            warnings.warn(
                "⚠️  ADMIN_SECRET_TOKEN is using the default value! "
                "Set a secure value in your .env before deploying to production.",
                stacklevel=2,
            )
        if self.mongo_uri == "mongodb://localhost:27017":
            warnings.warn(
                "⚠️  MONGO_URI is using localhost. Set a hosted MongoDB URI before deploying.",
                stacklevel=2,
            )
        return self

settings = Settings()
