"""
Request logging middleware — logs every endpoint call to DB and disk for audit trail.
Captures: timestamp, user, endpoint, method, status, duration, IP, user-agent.
"""
import json
import re
import time
import logging
from pathlib import Path
from datetime import datetime
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.security import decode_token

logger = logging.getLogger("request_logger")

# Ensure logs directory exists
LOGS_DIR = Path("logs")
LOGS_DIR.mkdir(exist_ok=True)

# The user id becomes a directory name — restrict it to a safe charset so a
# crafted JWT subject can't traverse out of the logs tree.
_SAFE_USER_RE = re.compile(r"^(?=.*[A-Za-z0-9_-])[A-Za-z0-9_.-]{1,64}$")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()
        user_id = "anonymous"

        # Try to extract user from JWT token
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                token = auth_header[7:]
                claims = decode_token(token)
                # The subject claim is "sub" (see create_access_token).
                candidate = claims.get("sub") or "anonymous"
                user_id = candidate if _SAFE_USER_RE.fullmatch(str(candidate)) else "anonymous"
            except Exception:
                pass

        # Call the endpoint
        response = await call_next(request)
        duration = time.time() - start

        # Log the request
        log_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": user_id,
            "method": request.method,
            "path": request.url.path,
            "query": dict(request.query_params),
            "status_code": response.status_code,
            "duration_ms": round(duration * 1000, 2),
            "client_ip": request.client.host if request.client else "unknown",
            "user_agent": request.headers.get("user-agent", "unknown"),
        }

        # Write to per-user log folder
        user_logs_dir = LOGS_DIR / user_id
        user_logs_dir.mkdir(exist_ok=True)

        log_file = user_logs_dir / f"{datetime.utcnow().strftime('%Y-%m-%d')}.jsonl"
        try:
            with open(log_file, "a") as f:
                f.write(json.dumps(log_entry) + "\n")
        except Exception as e:
            logger.error(f"Failed to write log: {e}")

        # Log suspicious activity (failed auth, high latency, etc)
        if response.status_code in [401, 403]:
            logger.warning(f"SUSPICIOUS: {user_id} got {response.status_code} on {request.method} {request.url.path} from {request.client.host}")

        return response
