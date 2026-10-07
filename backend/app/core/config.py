from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_ENV_PATH, ".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    COOKIE_SECURE: bool = False  # True in prod
    REFRESH_COOKIE_NAME: str = "refresh_token"


settings = Settings()  # pyright: ignore[reportCallIssue]  # fields populated from env
