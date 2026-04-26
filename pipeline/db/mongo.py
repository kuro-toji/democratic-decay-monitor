import os
from datetime import datetime
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pydantic import BaseModel
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    MONGO_URI: str
    MONGO_DB_NAME: str = "ddm"
    LOG_LEVEL: str = "INFO"

    class Config:
        env_file = ".env"


settings = Settings()

_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.MONGO_URI)
    return _client


def get_db() -> AsyncIOMotorDatabase:
    global _db
    if _db is None:
        _db = get_client()[settings.MONGO_DB_NAME]
    return _db


async def init_indexes():
    db = get_db()

    await db.countries.create_index("iso3", unique=True)

    await db.snapshots.create_index(
        [("iso3", 1), ("source", 1), ("dimension", 1), ("year", 1)],
        unique=True,
    )

    await db.ddi_scores.create_index([("iso3", 1), ("computed_at", -1)])

    await db.alerts.create_index([("triggered_at", -1), ("iso3", 1)])


async def close():
    global _client, _db
    if _client:
        _client.close()
        _client = None
        _db = None