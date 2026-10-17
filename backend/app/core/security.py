"""
Citadel authentication & identity.

- /api/auth/login verifies demo credentials and issues a JWT.
- get_current_user is a FastAPI dependency applied to every protected endpoint.
- user_hash is derived SERVER-SIDE as HMAC-SHA256(IMEI_HMAC_SECRET, bank_id:customer_id)
  so the client can never supply an arbitrary victim's blockchain identity (fixes
  the trust-the-client IMEI/user_hash bypass). The same keyed HMAC is what the
  chaincode expects (see mismatch_detector.go IMEIBaseline comment).

Demo accounts are loaded from DEMO_ACCOUNTS_JSON env var, not hardcoded in source.
In a real deployment this would verify against hashed passwords in the user store.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from typing import Optional, Dict, List, Tuple

import bcrypt

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


# ── Demo account store ───────────────────────────────────────────────
# Loaded from DEMO_ACCOUNTS_JSON env var (JSON array of objects).
# bank_id is folded into user_hash (never stored as cleartext on-chain).
# Demo fallback customers — used ONLY when DEMO_ACCOUNTS_JSON is empty/unset,
# exactly mirroring the admin-store fallback below. Without this, a bare
# deployment had a working admin login but NO working customer login (the
# admin store fell back, the customer store returned {}), which presented as
# "admin login works, client login is broken".
_DEMO_FALLBACK_CUSTOMERS = {
    "demo": {"password": "Demo@2026", "name": "Demo Customer", "bank_id": "PSB"},
    "priya": {"password": "Priya@2026", "name": "Priya Sharma", "bank_id": "PSB"},
}


def _load_demo_accounts() -> Dict[str, Dict]:
    try:
        raw = json.loads(settings.demo_accounts_json)
        out = {a["id"]: {"password": a["password"], "name": a["name"], "bank_id": a.get("bank_id", "PSB")} for a in raw}
    except (json.JSONDecodeError, KeyError, TypeError):
        out = {}
    if not out:
        logger.warning(
            "DEMO_ACCOUNTS_JSON is empty/unset — enabling the demo fallback "
            "customers (demo / priya). Set DEMO_ACCOUNTS_JSON for any non-demo "
            "deployment."
        )
        return dict(_DEMO_FALLBACK_CUSTOMERS)
    return out


DEMO_ACCOUNTS = _load_demo_accounts()


# ── Admin / analyst account store (FIU fraud-ops panel) ──────────────
# Separate from DEMO_ACCOUNTS so a customer account can never carry a
# privileged role. Loaded from ADMIN_ACCOUNTS_JSON. Each record's role is
# validated against ALLOWED_ROLES; anything unknown is coerced to "analyst"
# (least privilege) rather than silently trusted.
# Three-tier RBAC: customer (end user) < bank_analyst (bank fraud-ops: view +
# warn) < fiu_admin (FIU department: full authority — warn, block, thresholds).
# Legacy tokens/records with "admin"/"analyst" are transparently mapped so an
# in-flight session doesn't break across the rename.
ALLOWED_ADMIN_ROLES = {"fiu_admin", "bank_analyst"}
_ROLE_ALIASES = {"admin": "fiu_admin", "analyst": "bank_analyst"}


def normalize_role(role: str) -> str:
    return _ROLE_ALIASES.get(role, role)


# Demo fallback admin — used ONLY when no ADMIN_ACCOUNTS_JSON is configured
# (e.g. the Render service has the env var unset). Keeps the FIU panel usable
# out-of-the-box for the hackathon demo. For any real deployment, set
# ADMIN_ACCOUNTS_JSON with a strong password and this fallback never triggers.
_DEMO_FALLBACK_ADMIN = {
    "ADMIN": {"password": "Citadel@Ops#2026", "name": "FIU Administrator", "bank_id": "FIU", "role": "fiu_admin"},
}


def _load_admin_accounts() -> Dict[str, Dict]:
    try:
        raw = json.loads(settings.admin_accounts_json)
    except (json.JSONDecodeError, TypeError):
        raw = []
    out: Dict[str, Dict] = {}
    for a in raw:
        try:
            role = normalize_role(a.get("role", "bank_analyst"))
            if role not in ALLOWED_ADMIN_ROLES:
                logger.warning("Admin account %s has unknown role %r — coercing to 'bank_analyst'", a.get("id"), role)
                role = "bank_analyst"
            out[a["id"]] = {
                "password": a["password"],
                "name": a.get("name", a["id"]),
                "bank_id": a.get("bank_id", "FIU"),
                "role": role,
            }
        except (KeyError, TypeError):
            logger.warning("Skipping malformed admin account record")
    if not out:
        logger.warning(
            "ADMIN_ACCOUNTS_JSON is empty/unset — enabling the demo fallback admin "
            "(ADMIN/ADMIN). Set ADMIN_ACCOUNTS_JSON with a strong password for any "
            "non-demo deployment."
        )
        return dict(_DEMO_FALLBACK_ADMIN)
    return out


ADMIN_ACCOUNTS = _load_admin_accounts()


def get_demo_accounts_list() -> List[Dict[str, str]]:
    """Return demo accounts without passwords for the frontend hint panel."""
    return [{"id": k, "name": v["name"]} for k, v in DEMO_ACCOUNTS.items()]


@dataclass
class AuthUser:
    """The authenticated caller, derived from the JWT — never from the request body."""
    customer_id: str
    bank_id: str
    user_hash: str  # server-derived blockchain identity
    role: str = "customer"  # "customer" | "analyst" | "admin"


def derive_user_hash(bank_id: str, customer_id: str) -> str:
    """
    Keyed HMAC over (bank_id, customer_id) using the server-side IMEI secret.
    This is the salted identifier the chaincode requires — unsalted SHA-256 is
    NOT acceptable (re-identifiable over the small customer_id space).
    """
    msg = f"{bank_id}:{customer_id}".encode()
    return hmac.new(
        settings.imei_hmac_secret.encode(), msg, hashlib.sha256
    ).hexdigest()


def is_bcrypt_hash(stored: str) -> bool:
    """True when `stored` looks like a bcrypt hash (not legacy plaintext)."""
    return stored.startswith("$2")


def hash_password(password: str) -> str:
    """Hash a password with bcrypt (cost 12)."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(plain: str, stored: Optional[str]) -> bool:
    """
    Verify a password against a stored value.
    Supports bcrypt hashes and legacy plaintext (auto-upgraded on successful login).
    """
    if not stored:
        return False
    if is_bcrypt_hash(stored):
        return bcrypt.checkpw(plain.encode(), stored.encode())
    return hmac.compare_digest(stored, plain)


def _ci_lookup(accounts: Dict[str, Dict], raw_id: str) -> Optional[Tuple[str, Dict]]:
    """Case/whitespace-insensitive id lookup.

    Login ids like "ADMIN" are easy to type in the natural lowercase, and a
    customer may type "Demo" instead of "demo" — both should still resolve to
    the same account. Passwords are NOT touched here; they stay exact-case via
    hmac.compare_digest in the callers below. Returns the canonical (stored)
    id alongside the account so callers derive user_hash/JWT sub from the
    canonical form, not whatever case the caller happened to type — otherwise
    "Demo" and "demo" would silently become two different blockchain
    identities for the same account.
    """
    key = raw_id.strip()
    if key in accounts:
        return key, accounts[key]
    key_ci = key.casefold()
    for stored_id, stored_acct in accounts.items():
        if stored_id.casefold() == key_ci:
            return stored_id, stored_acct
    return None


def verify_credentials(customer_id: str, password: str) -> Optional[dict]:
    hit = _ci_lookup(DEMO_ACCOUNTS, customer_id)
    if hit and hmac.compare_digest(hit[1]["password"], password):
        canonical_id, acct = hit
        return {**acct, "id": canonical_id}
    return None


def verify_admin_credentials(admin_id: str, password: str) -> Optional[dict]:
    """Verify an admin/analyst login. Returns the account (incl. role) or None."""
    hit = _ci_lookup(ADMIN_ACCOUNTS, admin_id)
    if hit and hmac.compare_digest(hit[1]["password"], password):
        canonical_id, acct = hit
        return {**acct, "id": canonical_id}
    return None


def create_access_token(
    customer_id: str,
    bank_id: str,
    role: str = "customer",
    expire_minutes: Optional[int] = None,
) -> str:
    now = int(time.time())
    ttl = settings.jwt_expire_minutes if expire_minutes is None else expire_minutes
    payload = {
        "sub": customer_id,
        "bank_id": bank_id,
        "role": role,
        "iat": now,
        "exp": now + ttl * 60,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    # Algorithm list is hard-pinned: tokens are always HS256-signed with the
    # server secret, and pinning here means a misconfigured JWT_ALGORITHM env
    # (e.g. "none") can never disable signature verification.
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> AuthUser:
    """FastAPI dependency: require a valid Bearer JWT and return the caller identity."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated — Bearer token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        claims = decode_token(token)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    customer_id = claims.get("sub")
    bank_id = claims.get("bank_id")
    if not customer_id or not bank_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed token")
    # Older tokens (issued before RBAC) carry no role → default to "customer".
    # normalize_role maps legacy "admin"/"analyst" → "fiu_admin"/"bank_analyst".
    role = normalize_role(claims.get("role", "customer"))
    return AuthUser(
        customer_id=customer_id,
        bank_id=bank_id,
        user_hash=derive_user_hash(bank_id, customer_id),
        role=role,
    )


def require_role(*allowed_roles: str):
    """
    Dependency factory: require the caller's JWT role ∈ allowed_roles.

    Enforced SERVER-SIDE on every admin endpoint — the frontend route guard is
    only UX; this is the actual security boundary. A customer token (or a
    missing role) hitting an admin route gets 403, not 401 (they are
    authenticated, just not authorized).
    """
    allowed = set(allowed_roles)

    async def _guard(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role in {sorted(allowed)}; caller role is '{user.role}'",
            )
        return user

    return _guard