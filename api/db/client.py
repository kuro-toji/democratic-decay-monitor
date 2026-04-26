import os
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg

_pool: Optional[asyncpg.Pool] = None


def parse_db_url(url: str) -> dict:
    """Parse DATABASE_URL into connection parameters."""
    defaults = {
        "host": "localhost",
        "port": 5432,
        "user": "postgres",
        "password": "postgres",
        "database": "ddm",
    }
    
    if not url:
        return defaults
    
    if "://" in url:
        parts = url.split("://", 1)
        auth_host = parts[1].split("/", 1)
        user_pass = auth_host[0].split("@")
        
        if len(user_pass) == 2:
            user_creds = user_pass[0].split(":")
            defaults["user"] = user_creds[0]
            defaults["password"] = user_creds[1] if len(user_creds) > 1 else ""
            host_port = user_pass[1].split(":")
        else:
            host_port = user_pass[0].split(":")
        
        defaults["host"] = host_port[0]
        if len(host_port) > 1:
            defaults["port"] = int(host_port[1].split("/")[0].split("?")[0])
        
        if "/" in auth_host[1]:
            db_part = auth_host[1].split("/", 1)
            defaults["database"] = db_part[0]
    else:
        defaults["database"] = url
    
    return defaults


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        database_url = os.getenv("DATABASE_URL", "")
        params = parse_db_url(database_url)
        
        _pool = await asyncpg.create_pool(
            host=params["host"],
            port=params["port"],
            user=params["user"],
            password=params["password"],
            database=params["database"],
            min_size=5,
            max_size=20,
        )
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def get_connection():
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


async def get_db():
    return get_connection()
