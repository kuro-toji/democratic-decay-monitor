"""FastAPI application for Democratic Decay Monitor API - Production hardened."""
import hashlib
import hmac
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime
from functools import lru_cache
from typing import Optional

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware

# Try to import optional dependencies
try:
    import redis.asyncio as redis
    from upstash_redis.asyncio import Redis as UpstashRedis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    redis = None

try:
    import sentry_sdk
    SENTRY_AVAILABLE = True
except ImportError:
    SENTRY_AVAILABLE = False

# Structured logging setup
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

# Rate limiter with fallback
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/hour"],
    storage_uri=os.getenv("REDIS_URL", "memory://"),  # Fall back to in-memory if no Redis
    strategy="fixed-window",
)


def get_redis_client():
    """Get Redis client for distributed rate limiting."""
    if not REDIS_AVAILABLE:
        return None
    
    redis_url = os.getenv("REDIS_URL", os.getenv("UPSTASH_REDIS_URL"))
    if not redis_url:
        return None
    
    try:
        return redis.from_url(redis_url, decode_responses=True)
    except Exception:
        logger.warning("Redis connection failed, falling back to in-memory rate limiting")
        return None


def hash_ip(ip: str) -> str:
    """Hash IP addresses for privacy (truncated SHA256)."""
    return hashlib.sha256(ip.encode()).hexdigest()[:8]


class LogMiddleware(BaseHTTPMiddleware):
    """Structured logging middleware."""
    
    async def dispatch(self, request: Request, call_next):
        start = datetime.utcnow()
        request_id = hashlib.sha256(str(time.time()).encode()).hexdigest()[:16]
        
        # Process request
        response = await call_next(request)
        
        # Calculate duration
        duration = (datetime.utcnow() - start).total_seconds()
        
        # Extract ISO3 from path if present
        iso3 = None
        path_parts = request.url.path.split("/")
        if "countries" in path_parts:
            for part in path_parts:
                if len(part) == 3 and part.isalpha():
                    iso3 = part.upper()
                    break
        
        # Log request (with hashed IP)
        log_data = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": round(duration * 1000, 2),
            "ip_hash": hash_ip(request.client.host if request.client else "unknown"),
            "user_agent": request.headers.get("user-agent", "")[:100],
        }
        
        if iso3:
            log_data["iso3"] = iso3
        
        if response.status_code >= 400:
            logger.error("request_failed", **log_data)
        else:
            logger.info("request_completed", **log_data)
        
        # Add request ID to response
        response.headers["X-Request-ID"] = request_id
        
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        
        return response


def verify_admin_key(request: Request) -> bool:
    """Verify admin key using constant-time comparison."""
    admin_key = os.getenv("ADMIN_API_KEY", "")
    provided_key = request.headers.get("X-Admin-Key", "")
    
    if not admin_key or not provided_key:
        return False
    
    return hmac.compare_digest(admin_key, provided_key)


def check_research_key(request: Request) -> bool:
    """Check for research key that bypasses rate limiting."""
    research_key = os.getenv("RESEARCH_API_KEY", "")
    provided_key = request.headers.get("X-DDM-Research-Key", "")
    
    if not research_key or not provided_key:
        return False
    
    return hmac.compare_digest(research_key, provided_key)


@lru_cache
def get_github_token() -> Optional[str]:
    """Get GitHub token for admin operations."""
    return os.getenv("GITHUB_TOKEN")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Initialize Sentry if DSN is provided
    sentry_dsn = os.getenv("SENTRY_DSN")
    if SENTRY_AVAILABLE and sentry_dsn:
        sentry_sdk.init(
            dsn=sentry_dsn,
            traces_sample_rate=0.1,
            send_default_pii=False,
            environment=os.getenv("ENVIRONMENT", "production"),
        )
        logger.info("sentry_initialized")
    
    yield
    
    # Cleanup
    if SENTRY_AVAILABLE and sentry_dsn:
        sentry_sdk.flush()


# Create FastAPI app
app = FastAPI(
    title="Democratic Decay Monitor API",
    version="1.0.0",
    description="API for monitoring democratic backsliding using DDI scores",
    lifespan=lifespan,
)

# Add rate limiter state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Add middleware
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(LogMiddleware)

# CORS configuration
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

@app.after_request
async def add_cors_headers(request: Request, response: Response):
    """Add CORS headers based on request method and origin."""
    origin = request.headers.get("origin", "*")
    
    # Allow all origins for safe methods, otherwise check whitelist
    if request.method in ("GET", "HEAD", "OPTIONS"):
        response.headers["Access-Control-Allow-Origin"] = origin if origin in ALLOWED_ORIGINS or "*" in ALLOWED_ORIGINS else ""
    else:
        # Write operations - strict origin checking
        if "*" in ALLOWED_ORIGINS:
            response.headers["Access-Control-Allow-Origin"] = origin
        else:
            response.headers["Access-Control-Allow-Origin"] = origin if origin in ALLOWED_ORIGINS else ""
    
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Admin-Key, X-DDM-Research-Key"
    
    return response


# Custom rate limit exceeded handler
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    """Return JSON error for rate limit exceeded."""
    retry_after = getattr(exc, "retry_after", 3600)
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limit_exceeded",
            "message": "Too many requests. Please try again later.",
            "retry_after": retry_after,
        },
        headers={"Retry-After": str(retry_after)},
    )


# Include routers
from api.routers import countries, scores, alerts, history, meta, admin

app.include_router(countries.router, prefix="/v1/countries", tags=["countries"])
app.include_router(scores.router, prefix="/v1/scores", tags=["scores"])
app.include_router(alerts.router, prefix="/v1/alerts", tags=["alerts"])
app.include_router(history.router, prefix="/v1/history", tags=["history"])
app.include_router(meta.router, prefix="/v1/meta", tags=["meta"])
app.include_router(admin.router, prefix="/v1/admin", tags=["admin"])


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "name": "DDM API",
        "version": "1.0.0",
        "docs": "/docs",
        "status": "ok",
    }


@app.get("/health")
async def health():
    """Detailed health check."""
    status = {"status": "ok", "components": {"api": "up", "db": "unknown"}}
    
    try:
        client = get_client()
        await client.admin.command("ping")
        status["components"]["db"] = "up"
    except Exception as e:
        status["status"] = "degraded"
        status["components"]["db"] = "disconnected"
        logger.error("health_check_db_failed", error=str(e))
    
    return status


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle unhandled exceptions with Sentry."""
    logger.error(
        "unhandled_exception",
        path=request.url.path,
        method=request.method,
        error=str(exc),
        error_type=type(exc).__name__,
    )
    
    if SENTRY_AVAILABLE:
        try:
            sentry_sdk.capture_exception(exc)
        except Exception:
            pass
    
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "message": "An unexpected error occurred.",
        },
    )
