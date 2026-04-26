from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    MONGO_URI: str
    MONGO_DB_NAME: str = "ddm"
    LOG_LEVEL: str = "INFO"

    class Config:
        env_file = ".env"