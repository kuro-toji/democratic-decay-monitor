from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from api.db.client import get_client, get_db


class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start = datetime.utcnow()
        response = await call_next(request)
        process_time = (datetime.utcnow() - start).total_seconds()
        response.headers["X-Process-Time"] = str(round(process_time, 4))
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = get_client()
    await client.admin.command("ping")
    yield
    client.close()


app = FastAPI(
    title="Democratic Decay Monitor API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TimingMiddleware)

from api.routers import countries, scores, alerts, history, meta

app.include_router(countries.router, prefix="/v1/countries", tags=["countries"])
app.include_router(scores.router, prefix="/v1/scores", tags=["scores"])
app.include_router(alerts.router, prefix="/v1/alerts", tags=["alerts"])
app.include_router(history.router, prefix="/v1/history", tags=["history"])
app.include_router(meta.router, prefix="/v1/meta", tags=["meta"])


@app.get("/")
async def root():
    return {
        "name": "DDM API",
        "version": "1.0.0",
        "docs": "/docs",
        "status": "ok",
    }


@app.get("/health")
async def health():
    try:
        client = get_client()
        await client.admin.command("ping")
        return {"status": "ok", "db": "connected"}
    except Exception:
        return {"status": "degraded", "db": "disconnected"}