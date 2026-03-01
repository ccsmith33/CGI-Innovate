from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+aiosqlite:///./sentinel.db"
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    APP_VERSION: str = "1.0.0"
    FEED_SERVICE_URL: str = "http://localhost:8001"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
