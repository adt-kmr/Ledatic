from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.middleware import RequestLoggingMiddleware, DeceptionMiddleware
from app.core.database import init_db
from app.core.redis_client import init_redis
from app.services.fabric_client import init_fabric_client
from app.services.ethereum_bridge import init_ethereum_bridge, shutdown_ethereum_bridge
from app.services.pqc_signer import init_pqc_signer
from app.services.pqc_kem import init_pqc_kem
from app.api import (
    signals, auth, passport, fraud, blockchain, admin, btic,
    payments, reports, brq, duress, gravity, biometric_passport,
    security, phishing_demo, voice_mfa,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await init_redis()
    init_fabric_client()   # non-fatal — logs warning if Fabric not running
    await init_ethereum_bridge()  # non-fatal — skips if bridge disabled
    init_pqc_signer()     # Dilithium-3 keypair generation (~50ms) — non-fatal
    init_pqc_kem()        # ML-KEM-768 keypair generation — non-fatal
    yield
    await shutdown_ethereum_bridge()

app = FastAPI(
    title="Citadel API",
    version="1.0.0",
    description="AI-Driven Behavioral Authentication for Digital Banking",
    lifespan=lifespan,
)

# Middleware order matters for CORS. In Starlette the *last* add_middleware call is
# the outermost layer, so it sees every response — including short-circuit 403s from
# deception/blacklist that never reach route handlers. When CORS was innermost,
# those 403s lacked Access-Control-Allow-Origin and the browser reported a CORS
# error instead of the real block (admin login looked broken on blacklisted IPs).
app.add_middleware(RequestLoggingMiddleware)

# Active Deception — blocks blacklisted IPs and springs decoy "honey" endpoints.
app.add_middleware(DeceptionMiddleware)

# CORS outermost so every response (including deception 403s) gets ACAO headers.
# Exact origins from CORS_ORIGINS; regex covers local dev, all nio-hack-2026
# Vercel deploy URLs, and the Derby Hackathon site (derby-hack.vercel.app plus
# its per-commit preview hosts, which Vercel scopes to the owner's team).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=(
        r"http://(localhost|127\.0\.0\.1|172\.18\.\d+\.\d+)(:\d+)?"
        r"|https://nio-hack-2026[\w-]*\.vercel\.app"
        r"|https://derby-hack(-[\w-]+-harshdeep-athawales-projects)?\.vercel\.app"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(signals.router, prefix="/api/signals", tags=["Signals"])
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(passport.router, prefix="/api/passport", tags=["Passport"])
app.include_router(fraud.router, prefix="/api/fraud", tags=["Fraud"])
app.include_router(blockchain.router, prefix="/api/blockchain", tags=["Blockchain"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(btic.router)  # prefix already set in btic.py
app.include_router(payments.router, prefix="/api/payments", tags=["Payments"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
app.include_router(brq.router, prefix="/api/brq", tags=["BRQ"])
app.include_router(duress.router, prefix="/api/duress", tags=["Duress Emergency"])
app.include_router(gravity.router, prefix="/api/gravity", tags=["Financial Gravity"])
app.include_router(biometric_passport.router, prefix="/api/auth", tags=["Biometric Passport"])
app.include_router(security.router)  # prefix "/api/security" set in security.py
app.include_router(phishing_demo.router, prefix="/api/phishing/demo", tags=["Phishing Demo"])
app.include_router(voice_mfa.router)  # prefix "/api/voice-mfa" set in voice_mfa.py


@app.get("/health")
async def health():
    return {"status": "ok", "service": "Citadel Backend"}
