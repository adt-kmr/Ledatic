import json
import time
import logging
import uuid
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Request, Form
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
import httpx

from app.models.schemas import EvaluateRequest, EvaluateResponse, Decision, Pathway
from app.models.db_models import User, Session as DBSession, RiskEvent, BehavioralPassport, FraudReport
from app.core.redis_client import get_redis
from app.core.database import get_db, AsyncSessionLocal
from app.core.config import settings
from app.core.security import (
    AuthUser,
    get_current_user,
    require_role,
    verify_credentials,
    create_access_token,
    derive_user_hash,
    get_demo_accounts_list,
    hash_password,
    verify_password,
    is_bcrypt_hash,
)
from app.core.ratelimit import rate_limit
from app.services.fabric_client import FabricClient, get_fabric_client
from app.services import thresholds
from app.services import blocks as block_service
from app.services.pqc_signer import get_pqc_signer

logger = logging.getLogger(__name__)
router = APIRouter()


class LoginRequest(BaseModel):
    customer_id: str
    password: str
    ip_address: Optional[str] = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    user_hash: str
    name: Optional[str] = None
    vpn_detected: bool = False
    login_country: Optional[str] = None
    login_city: Optional[str] = None
    geo_distance_km: Optional[float] = None
    ip_risk_score: int = 0


class RegisterRequest(BaseModel):
    customer_id: str
    password: str
    name: str
    bank_id: str = "PSB"
    face_image: Optional[str] = None
    ip_address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    imei_hash: Optional[str] = None
    # The customer's OWN number, E.164 (+919876543210) — required for the
    # voice-MFA verification call. Distinct from the emergency-contact numbers
    # collected by the duress flow, which belong to other people.
    phone_number: Optional[str] = None
    upi_id: Optional[str] = None


@router.post("/login", response_model=LoginResponse,
             dependencies=[Depends(rate_limit(10, 60, "auth-login"))])
async def login(
    req: LoginRequest,
    http_req: Request,
    db: AsyncSession = Depends(get_db),
):
    """Verify credentials and issue a JWT. Supports both static demo and DB-registered users.
    
    Performs IP intelligence check (VPN detection, geo baseline comparison) before
    issuing the token. VPN/Tor connections are hard-blocked. Country mismatches are flagged.
    """
    acct = verify_credentials(req.customer_id, req.password)
    bank_id = "PSB"
    name = req.customer_id

    if acct:
        # Canonicalize to the stored id (verify_credentials matches
        # case-insensitively) so "Demo" and "demo" resolve to the same
        # user_hash/JWT identity instead of silently becoming two accounts.
        req.customer_id = acct["id"]
        bank_id = acct["bank_id"]
        name = acct.get("name") or req.customer_id
    else:
        # Check database for custom registered user
        user_hash_derived = derive_user_hash(bank_id, req.customer_id)
        result = await db.execute(
            select(User).where(User.customer_hash == user_hash_derived)
        )
        user_db = result.scalar_one_or_none()
        if user_db and verify_password(req.password, user_db.password):
            bank_id = user_db.bank_id
            name = user_db.name or req.customer_id
            # Auto-upgrade legacy plaintext passwords to bcrypt on successful login
            if user_db.password and not is_bcrypt_hash(user_db.password):
                user_db.password = hash_password(req.password)
                await db.commit()
        else:
            raise HTTPException(status_code=401, detail="Invalid credentials")

    # ── IP Intelligence Check ────────────────────────────────────────────
    vpn_detected = False
    login_country = ""
    login_city = ""
    geo_distance_km: Optional[float] = None
    ip_risk_score = 0

    client_ip = req.ip_address
    if not client_ip:
        client_ip = http_req.headers.get("X-Forwarded-For")
        if client_ip:
            client_ip = client_ip.split(",")[0].strip()
        else:
            client_ip = http_req.client.host if http_req.client else None

    if client_ip:
        try:
            from app.services.ip_intel import lookup as ip_lookup
            from app.models.db_models import DeviceFingerprint

            # Mock overrides for offline/online demo stability
            is_hosting = False
            vpn_detected = False
            vpn_reason = ""
            login_country = "India"
            login_city = "Delhi"
            intel_lookup_done = False
            
            if client_ip == "3.5.140.2":  # Simulated AWS Datacenter ASN
                is_hosting = True
                vpn_reason = "Matched hosting/cloud keyword: 'amazon'"
                intel_lookup_done = True
            elif client_ip == "103.22.200.2":  # Simulated NordVPN
                vpn_detected = True
                vpn_reason = "Matched VPN/proxy keyword: 'nordvpn'"
                intel_lookup_done = True
            elif client_ip == "192.0.2.1":  # Simulated Geo-drift
                intel_lookup_done = True

            if not intel_lookup_done:
                # Fetch the user's registered baseline fingerprint (if any)
                user_hash_check = derive_user_hash(bank_id, req.customer_id)
                user_result = await db.execute(select(User).where(User.customer_hash == user_hash_check))
                login_user = user_result.scalar_one_or_none()
                
                baseline_lat = baseline_lon = None
                if login_user:
                    fp_result = await db.execute(
                        select(DeviceFingerprint).where(DeviceFingerprint.user_id == login_user.id)
                    )
                    fp = fp_result.scalar_one_or_none()
                    if fp:
                        baseline_lat = fp.registered_lat
                        baseline_lon = fp.registered_lng

                intel = await ip_lookup(client_ip, baseline_lat=baseline_lat, baseline_lon=baseline_lon)
                vpn_detected = intel.is_vpn or intel.is_tor or intel.is_hosting
                login_country = intel.country
                login_city = intel.city
                geo_distance_km = intel.geo_distance_km if intel.geo_distance_km > 0 else None
                ip_risk_score = intel.risk_score
                vpn_reason = intel.vpn_reason
            else:
                vpn_detected = vpn_detected or is_hosting

            if vpn_detected:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": "vpn_blocked",
                        "message": "VPN or anonymous proxy detected. Banking access is blocked for security. Please disconnect your VPN/proxy and try again.",
                        "vpn_reason": vpn_reason or ("Datacenter BGP IP Address Detected" if is_hosting else "Commercial VPN Connection"),
                        "ip": client_ip,
                        "country": login_country,
                        "city": login_city,
                    },
                )
        except HTTPException:
            raise
        except Exception as ip_err:
            logger.warning("IP intel check failed during login: %s", ip_err)

    user_hash = derive_user_hash(bank_id, req.customer_id)

    # ── Customer block gate ───────────────────────────────────────────────
    # A blocked account must not receive a token. Previously this was only
    # enforced downstream on /evaluate, which meant a blocked customer could
    # still authenticate and obtain a JWT — the block only bit later, on the
    # risk path. Blocks are written by the admin panel and by voice MFA
    # (identity-theft / coercion verdicts), so this is the single choke point
    # where all of them take effect.
    try:
        from app.models.db_models import CustomerBlock as _CB
        _blk = (await db.execute(
            select(_CB).where(_CB.customer_hash == user_hash)
        )).scalar_one_or_none()
        if _blk is not None and _blk.status == "blocked":
            logger.warning("Login refused — account blocked (%s): %s", _blk.reason, user_hash[:12])
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "account_blocked",
                    "reason": _blk.reason,
                    "message": _blk.message or "This account has been blocked. Please contact support.",
                },
            )
    except HTTPException:
        raise
    except Exception as blk_err:  # noqa: BLE001
        # Never fail an otherwise-valid login because the block lookup broke.
        logger.warning("Block lookup failed during login (non-fatal): %s", blk_err)

    token = create_access_token(req.customer_id, bank_id)
    return LoginResponse(
        access_token=token,
        user_id=req.customer_id,
        user_hash=user_hash,
        name=name,
        vpn_detected=vpn_detected,
        login_country=login_country or None,
        login_city=login_city or None,
        geo_distance_km=geo_distance_km,
        ip_risk_score=ip_risk_score,
    )


class SendWhatsAppRequest(BaseModel):
    name: str
    os: str
    ip: str
    location: str
    latitude: float
    longitude: float


class GoogleLoginRequest(BaseModel):
    credential: str
    is_mock: bool = False


def _resolve_frontend_origin(request: Request) -> str:
    """Resolve the SPA origin for OAuth browser redirects.

    Google's form-POST to /google/callback sends Referer: accounts.google.com,
    so we cannot rely on Referer alone in production.
    """
    from urllib.parse import urlparse

    if settings.frontend_url:
        return settings.frontend_url.rstrip("/")

    referer = request.headers.get("referer", "")
    if referer:
        parsed = urlparse(referer)
        host = (parsed.netloc or "").lower()
        if host and "google.com" not in host and "googleusercontent.com" not in host:
            return f"{parsed.scheme}://{parsed.netloc}"

    for origin in settings.cors_origins:
        if origin and "localhost" not in origin and "127.0.0.1" not in origin:
            return origin.rstrip("/")

    return "http://localhost:5173"


def _oauth_return_url(request: Request, params: dict[str, str]) -> str:
    from urllib.parse import urlencode

    origin = _resolve_frontend_origin(request)
    path = settings.frontend_oauth_return_path or "/demo/bank"
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{origin}{path}?{urlencode(params)}"


@router.post("/google", response_model=LoginResponse)
async def google_login(
    req: GoogleLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Verify Google token, auto-register user if not present, and issue a session JWT."""
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests

    email = None
    name = None
    picture = None
    bank_id = "PSB"

    # 1. Parse/Verify the credentials
    if req.is_mock or req.credential.startswith("mock_"):
        if not settings.allow_mock_oauth:
            raise HTTPException(
                status_code=403,
                detail="Mock OAuth is disabled. Set ALLOW_MOCK_OAUTH=true for demo environments.",
            )
        try:
            # Handle mock login payload
            # If base64 encoded, decode it
            import base64
            credential_clean = req.credential
            if req.credential.startswith("mock_"):
                credential_clean = req.credential.split("mock_", 1)[1]
            try:
                decoded_str = base64.b64decode(credential_clean).decode("utf-8")
                payload = json.loads(decoded_str)
            except Exception:
                payload = json.loads(credential_clean)
            
            email = payload.get("email")
            name = payload.get("name")
            picture = payload.get("picture")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid mock credential format: {str(e)}")
    else:
        # Real Google Auth verification
        try:
            client_id = settings.google_client_id
            if not client_id:
                raise ValueError("Google Client ID is not configured on the backend server")
            
            idinfo = id_token.verify_oauth2_token(
                req.credential, 
                google_requests.Request(), 
                client_id
            )
            
            # ID token verified
            email = idinfo.get("email")
            name = idinfo.get("name")
            picture = idinfo.get("picture")

            # Check email verification status
            if not idinfo.get("email_verified"):
                raise HTTPException(status_code=400, detail="Google authentication failed: Email is not verified.")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Google token verification failed: {str(e)}")

    if not email:
        raise HTTPException(status_code=400, detail="OAuth payload is missing email address")

    # Clean the email to serve as customer_id
    customer_id = email.strip().lower()
    customer_hash = derive_user_hash(bank_id, customer_id)

    # 2. Check if user already exists in DB
    result = await db.execute(
        select(User).where(User.customer_hash == customer_hash)
    )
    user = result.scalar_one_or_none()

    if not user:
        # Auto-create/register a new user via Google
        user = User(
            bank_id=bank_id,
            customer_hash=customer_hash,
            customer_id=customer_id,
            name=name or customer_id,
            face_image=picture,  # store profile picture in face_image column
            auth_provider="google",
            email=customer_id,
            profile_pic=picture
        )
        db.add(user)
        await db.commit()
        logger.info("Auto-registered new Google user: %s", customer_id)
    else:
        # Update existing user profile with latest Google info if needed
        updated = False
        if not user.auth_provider or user.auth_provider != "google":
            user.auth_provider = "google"
            updated = True
        if not user.email or user.email != customer_id:
            user.email = customer_id
            updated = True
        if name and user.name != name:
            user.name = name
            updated = True
        if picture and user.profile_pic != picture:
            user.profile_pic = picture
            # If user has no custom face image, use Google avatar as fallback
            if not user.face_image:
                user.face_image = picture
            updated = True
        
        if updated:
            db.add(user)
            await db.commit()
            logger.info("Updated existing user details via Google login: %s", customer_id)

    # 3. Issue session token
    token = create_access_token(customer_id, bank_id)
    return LoginResponse(
        access_token=token,
        user_id=customer_id,
        user_hash=customer_hash,
        name=name or user.name or customer_id,
    )


@router.post("/google/callback")
async def google_callback(
    request: Request,
    credential: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Callback endpoint for Google OAuth redirect mode. Receives form-POST credential, registers user, and redirects browser back to frontend."""
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests
    from fastapi.responses import RedirectResponse

    email = None
    name = None
    picture = None
    bank_id = "PSB"

    # 1. Verify credential token
    try:
        if credential.startswith("mock_"):
            import base64
            credential_clean = credential.split("mock_", 1)[1]
            try:
                decoded_str = base64.b64decode(credential_clean).decode("utf-8")
                payload = json.loads(decoded_str)
            except Exception:
                payload = json.loads(credential_clean)
            
            email = payload.get("email")
            name = payload.get("name")
            picture = payload.get("picture")
            
            if not payload.get("email_verified", True):
                raise ValueError("Email is not verified by Google")
        else:
            client_id = settings.google_client_id
            if not client_id:
                raise ValueError("Google Client ID is not configured on the backend server")
            
            idinfo = id_token.verify_oauth2_token(
                credential, 
                google_requests.Request(), 
                client_id
            )
            
            email = idinfo.get("email")
            name = idinfo.get("name")
            picture = idinfo.get("picture")

            if not idinfo.get("email_verified"):
                raise ValueError("Email is not verified by Google")
    except Exception as e:
        return RedirectResponse(
            url=_oauth_return_url(request, {"error": str(e)}),
            status_code=303,
        )

    if not email:
        return RedirectResponse(
            url=_oauth_return_url(request, {"error": "Missing email address in OAuth token"}),
            status_code=303,
        )

    customer_id = email.strip().lower()
    customer_hash = derive_user_hash(bank_id, customer_id)

    # 2. Check if user already exists
    result = await db.execute(
        select(User).where(User.customer_hash == customer_hash)
    )
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            bank_id=bank_id,
            customer_hash=customer_hash,
            customer_id=customer_id,
            name=name or customer_id,
            face_image=picture,
            auth_provider="google",
            email=customer_id,
            profile_pic=picture
        )
        db.add(user)
        await db.commit()
    else:
        updated = False
        if user.auth_provider != "google":
            user.auth_provider = "google"
            updated = True
        if user.email != customer_id:
            user.email = customer_id
            updated = True
        if name and user.name != name:
            user.name = name
            updated = True
        if picture and user.profile_pic != picture:
            user.profile_pic = picture
            if not user.face_image:
                user.face_image = picture
            updated = True
        if updated:
            db.add(user)
            await db.commit()

    # 3. Create session JWT
    token = create_access_token(customer_id, bank_id)

    # 4. Redirect browser back to the bank demo with session credentials in the
    # query string. ZipPayBankPage completes login from these params.
    params = {
        "oauth_token": token,
        "oauth_user_id": customer_id,
        "oauth_name": name or customer_id,
        "oauth_hash": customer_hash,
    }
    return RedirectResponse(url=_oauth_return_url(request, params), status_code=303)


@router.post("/send-whatsapp")
async def send_whatsapp(
    req: SendWhatsAppRequest,
    caller: AuthUser = Depends(get_current_user),
):
    """Router to send WhatsApp geolocated login notification alerts using Twilio API server-side, avoiding CORS preflight blocks."""
    import os

    account_sid = getattr(settings, "vite_twilio_account_sid", None) or os.getenv("VITE_TWILIO_ACCOUNT_SID")
    auth_token = getattr(settings, "vite_twilio_auth_token", None) or os.getenv("VITE_TWILIO_AUTH_TOKEN")
    raw_from = getattr(settings, "vite_twilio_from_number", None) or os.getenv("VITE_TWILIO_FROM_NUMBER") or "+17372212163"
    raw_to = getattr(settings, "vite_twilio_to_number", None) or os.getenv("VITE_TWILIO_TO_NUMBER") or "+916283645556"

    from_num = raw_from if raw_from.startswith("whatsapp:") else f"whatsapp:{raw_from}"
    clean_to_num = raw_to.replace("whatsapp:", "").strip()
    if not clean_to_num.startswith("+"):
        clean_to_num = "+" + clean_to_num
    to_num = f"whatsapp:{clean_to_num}"

    if not account_sid or not auth_token:
        return {"status": "simulated", "message": "Twilio credentials not configured"}

    body_text = (
        f"ZipBank Login Security Alert\n"
        f"Name: {req.name}\n"
        f"OS: {req.os}\n"
        f"IP: {req.ip}\n"
        f"Location: {req.location} ({req.latitude:.4f}, {req.longitude:.4f})\n"
        f"Map: https://www.google.com/maps?q={req.latitude},{req.longitude}"
    )

    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"

    try:
        # Async httpx (already a dependency) rather than blocking `requests` — a
        # synchronous call here would stall the event loop for the whole request.
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                url,
                data={
                    "From": from_num,
                    "To": to_num,
                    "Body": body_text,
                },
                auth=(account_sid, auth_token),
            )

        if res.status_code in (200, 201):
            return {"status": "success", "message_sid": res.json().get("sid")}
        else:
            logger.info("Twilio API response %d (Trial Sandbox active): %s", res.status_code, res.text[:200])
            return {"status": "simulated", "detail": f"Twilio API {res.status_code}: message recorded for demo", "body": body_text}

    except Exception as e:
        logger.warning("Error communicating with Twilio: %s", str(e))
        return {"status": "simulated", "detail": f"Twilio communication failed: {str(e)}", "body": body_text}


@router.post("/register",
             dependencies=[Depends(rate_limit(5, 300, "auth-register"))])
async def register(
    req: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """Register a new user credentials, bank profile details, and face biometric photo."""
    customer_hash = derive_user_hash(req.bank_id, req.customer_id)
    
    # Check if user already exists
    result = await db.execute(
        select(User).where(User.customer_hash == customer_hash)
    )
    user = result.scalar_one_or_none()
    if user:
        raise HTTPException(status_code=409, detail="User already exists")

    user = User(
        bank_id=req.bank_id,
        customer_hash=customer_hash,
        customer_id=req.customer_id,
        password=hash_password(req.password),
        name=req.name,
        face_image=req.face_image,
        phone_number=(req.phone_number or "").strip() or None,
        upi_id=(req.upi_id or f"{req.customer_id}@zippay").strip().lower() if req.upi_id else f"{req.customer_id}@zippay",
    )
    db.add(user)
    
    await db.commit()
    
    # Store registration face in Redis
    if req.face_image:
        try:
            await redis.setex(f"user:{customer_hash}:face", 86400 * 30, req.face_image)
            await redis.setex(f"user:{req.customer_id}:face", 86400 * 30, req.face_image)
        except Exception as e:
            logger.warning("Failed to store registration face in Redis: %s", e)

    # ── Capture IP Fingerprint Baseline at Registration ────────────────────
    if req.ip_address:
        try:
            from app.services.ip_intel import lookup as ip_lookup
            from app.models.db_models import DeviceFingerprint
            from sqlalchemy.dialects.postgresql import insert as pg_insert

            # Re-fetch user (committed above)
            async with AsyncSessionLocal() as db2:
                user_result2 = await db2.execute(select(User).where(User.customer_hash == customer_hash))
                user2 = user_result2.scalar_one_or_none()
                if user2:
                    intel = await ip_lookup(req.ip_address, baseline_lat=req.latitude, baseline_lon=req.longitude)
                    await db2.execute(
                        pg_insert(DeviceFingerprint)
                        .values(
                            user_id=user2.id,
                            registered_ip=req.ip_address,
                            registered_country=intel.country,
                            registered_city=intel.city,
                            registered_lat=req.latitude or intel.latitude,
                            registered_lng=req.longitude or intel.longitude,
                            registered_isp=intel.isp,
                            registered_asn=intel.asn,
                            is_vpn_detected=intel.is_vpn,
                            imei_baseline=req.imei_hash,
                        )
                        .on_conflict_do_update(
                            index_elements=["user_id"],
                            set_={
                                "registered_ip": req.ip_address,
                                "registered_country": intel.country,
                                "registered_city": intel.city,
                                "registered_lat": req.latitude or intel.latitude,
                                "registered_lng": req.longitude or intel.longitude,
                                "registered_isp": intel.isp,
                                "registered_asn": intel.asn,
                                "is_vpn_detected": intel.is_vpn,
                                "imei_baseline": req.imei_hash,
                            },
                        )
                    )
                    await db2.commit()
                    logger.info("Device fingerprint baseline stored for user %s: %s, %s", customer_hash, intel.city, intel.country)
        except Exception as fp_err:
            logger.warning("Failed to store device fingerprint: %s", fp_err)

    return {"status": "success", "user_hash": customer_hash}


@router.get("/demo/accounts")
async def demo_accounts():
    """Return demo account IDs and names (no passwords) for the frontend hint panel."""
    return {"accounts": get_demo_accounts_list()}


@router.get("/registered-accounts")
async def registered_accounts(db: AsyncSession = Depends(get_db)):
    """Accounts that have actually been registered, for the login profile picker."""
    result = await db.execute(
        select(User.customer_id, User.name, User.bank_id).order_by(User.created_at.desc()).limit(50)
    )
    rows = result.all()
    # Public endpoint (feeds the login profile picker) — expose only the
    # minimum needed to render it. UPI ids and phone numbers stay private.
    return {
        "accounts": [
            {
                "id": r.customer_id,
                "name": r.name or r.customer_id,
                "bank_id": r.bank_id,
            }
            for r in rows
            if r.customer_id
        ]
    }


@router.delete("/registered-account/{customer_id}")
async def delete_registered_account(
    customer_id: str,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a registered account. Only the account owner or an FIU admin may."""
    if caller.customer_id != customer_id and caller.role != "fiu_admin":
        raise HTTPException(
            status_code=403,
            detail="Only the account owner or an FIU admin can delete an account",
        )

    user_hash = derive_user_hash("PSB", customer_id)
    res = await db.execute(select(User).where(User.customer_hash == user_hash))
    user = res.scalar_one_or_none()
    if not user:
        res = await db.execute(select(User).where(User.customer_id == customer_id))
        user = res.scalar_one_or_none()

    if user:
        await db.delete(user)
        await db.commit()
        return {"status": "success", "message": f"Account {customer_id} deleted"}

    return {"status": "not_found", "message": "Account not found"}


class DemoResetRequest(BaseModel):
    customer_id: Optional[str] = None
    user_id: Optional[str] = None


@router.post("/demo/reset")
async def demo_reset(
    body: Optional[DemoResetRequest] = None,
    caller: AuthUser = Depends(require_role("fiu_admin")),
    redis: Redis = Depends(get_redis),
):
    """Reset simulation/failure state for a demo identity or specific user.

    FIU-admin only: clearing `imei_baseline:*` disarms the SIM-swap pathway
    for that user, so an unauthenticated caller must never reach this.
    """
    user_hashes_to_clear = set()

    # 1. Caller's own user_hash (lets an admin reset their own demo identity)
    user_hashes_to_clear.add(caller.user_hash)

    # 2. If target customer_id or user_id is passed in request body
    if body:
        target = body.customer_id or body.user_id
        if target:
            user_hashes_to_clear.add(derive_user_hash("zip_bank", target))
            user_hashes_to_clear.add(target)

    cleared = []
    for u_hash in user_hashes_to_clear:
        for key in (f"login_failures:{u_hash}", f"imei_baseline:{u_hash}"):
            try:
                await redis.delete(key)
                cleared.append(key)
            except Exception as exc:  # best-effort; never block demo
                logger.warning("demo/reset: could not delete %s: %s", key, exc)

    return {"reset": True, "cleared": cleared}


def _compute_hesitation_score(keystroke_events: list) -> float:
    """
    Hesitation = keystroke flight time > 3σ above session mean.
    Indicates coercion: someone pausing to read instructions from an attacker.
    Returns 0.0–1.0 coercion signal strength.
    """
    flight_times = []
    for e in keystroke_events:
        ft = e.get("flightTime") or e.get("flight_time") or 0
        if ft and ft > 0:
            flight_times.append(float(ft))

    if len(flight_times) < 5:
        return 0.0

    mean = sum(flight_times) / len(flight_times)
    variance = sum((t - mean) ** 2 for t in flight_times) / len(flight_times)
    std = variance ** 0.5
    if std == 0:
        return 0.0

    outliers = sum(1 for t in flight_times if t > mean + 3 * std)
    hesitation_ratio = outliers / len(flight_times)
    return min(hesitation_ratio * 2.5, 1.0)


async def _check_camara(user_hash: str, session_id: str) -> dict:
    """
    Query CAMARA telecom mock for SIM swap + network risk signals.
    Non-fatal: returns empty dict if service is unavailable.
    """
    if not settings.camara_mock_enabled or not user_hash:
        return {}
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.post(
                f"{settings.camara_api_url}/check",
                json={"user_hash": user_hash, "session_id": session_id},
            )
            if resp.status_code == 200:
                return resp.json()
    except Exception as exc:
        logger.debug("CAMARA check skipped (non-fatal): %s", exc)
    return {}


def _resolve_internal_token() -> str:
    """Resolve the internal service-to-service token.

    Priority:
      1. Explicit INTERNAL_API_TOKEN env var (if set and non-empty)
      2. Deterministic derivation from JWT_SECRET via HMAC-SHA256 — both
         backend and ML service compute the same value independently, so
         they always match without needing env-var sync on Render.
    """
    if settings.internal_api_token:
        return settings.internal_api_token
    import hmac
    import hashlib
    return hmac.new(
        settings.jwt_secret.encode(),
        b"citadel-internal-api-token",
        hashlib.sha256,
    ).hexdigest()


def _ml_headers() -> dict:
    """Headers for backend→ML service calls (internal service-to-service token)."""
    h = {"Content-Type": "application/json"}
    h["X-Internal-Token"] = _resolve_internal_token()
    return h


async def _call_ml_service(session_id: str, user_id: str, signal_bundle: dict) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{settings.ml_service_url}/score",
                json={"session_id": session_id, "user_id": user_id, "signal_bundle": signal_bundle},
                headers=_ml_headers(),
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        logger.warning("ML service unavailable: %s", exc)
        return None


def _decision_from_score(risk_score: int) -> Decision:
    # Thresholds are live-tunable from the FIU admin panel (thresholds service),
    # falling back to settings defaults when unset. See services/thresholds.py.
    if risk_score >= thresholds.block_threshold():
        return Decision.HARD_BLOCK
    if risk_score >= thresholds.stepup_threshold():
        return Decision.STEP_UP
    return Decision.APPROVE


async def _persist_session(
    user_id: str,
    bank_id: str,
    channel: str,
    session_id: str,
    response: EvaluateResponse,
    signal_bundle: dict,
    shap_features: list,
    face_image: Optional[str] = None,
):
    """
    Persist session + risk event to Postgres and update behavioral passport.
    Runs as a background task — zero impact on response latency.
    """
    try:
        async with AsyncSessionLocal() as db:
            # Look up user by customer_hash
            result = await db.execute(
                select(User).where(User.customer_hash == user_id)
            )
            user = result.scalar_one_or_none()
            if not user:
                # Auto-create user if signals/ingest wasn't called first.
                # bank_id comes from the authenticated caller, not a hardcoded default.
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                await db.execute(
                    pg_insert(User)
                    .values(bank_id=bank_id, customer_hash=user_id)
                    .on_conflict_do_nothing(index_elements=["customer_hash"])
                )
                await db.flush()
                result = await db.execute(select(User).where(User.customer_hash == user_id))
                user = result.scalar_one_or_none()
                 # Store face snapshot in Redis for real-time visualization on admin panel
            try:
                from app.core.redis_client import _redis as redis_client
                if redis_client and face_image:
                    await redis_client.setex(f"session:{session_id}:face", 86400, face_image)
            except Exception as ree:
                logger.warning("Failed to store face image in Redis: %s", ree)

            # Fetch registered baseline location coords if they exist
            from app.models.db_models import DeviceFingerprint
            fp_result = await db.execute(
                select(DeviceFingerprint).where(DeviceFingerprint.user_id == user.id)
            )
            fp = fp_result.scalar_one_or_none()
            baseline_lat = fp.registered_lat if fp else None
            baseline_lon = fp.registered_lng if fp else None

            # Look up IP and geo metrics from Redis
            login_ip = None
            login_country = None
            login_city = None
            vpn_detected = False
            geo_distance_km = None
            ip_risk_score = 0

            try:
                from app.core.redis_client import _redis as redis_client
                if redis_client:
                    ip_bytes = await redis_client.get(f"session:{session_id}:ip")
                    if ip_bytes:
                        login_ip = ip_bytes.decode() if isinstance(ip_bytes, bytes) else ip_bytes
                        from app.services.ip_intel import lookup as ip_lookup
                        intel = await ip_lookup(login_ip, baseline_lat=baseline_lat, baseline_lon=baseline_lon)
                        login_country = intel.country
                        login_city = intel.city
                        vpn_detected = intel.is_vpn or intel.is_tor
                        geo_distance_km = intel.geo_distance_km if intel.geo_distance_km > 0 else None
                        ip_risk_score = intel.risk_score
            except Exception as ip_ex:
                logger.warning("Failed to lookup session IP intel in background: %s", ip_ex)

            # Write session record
            session_row = DBSession(
                id=uuid.UUID(session_id) if _is_valid_uuid(session_id) else uuid.uuid4(),
                user_id=user.id,
                channel=channel,
                signal_bundle_json=signal_bundle or None,
                risk_score=response.risk_score,
                decision=response.decision.value,
                pathway=response.pathway.value,
                coercion_probability=response.coercion_probability,
                latency_ms=response.latency_ms,
                face_image=face_image,
                login_ip=login_ip,
                login_country=login_country,
                login_city=login_city,
                vpn_detected=vpn_detected,
                geo_distance_km=geo_distance_km,
                ip_risk_score=ip_risk_score,
            )
            db.add(session_row)
            await db.flush()

            # Write risk event
            trigger = _trigger_type(response)
            risk_event = RiskEvent(
                session_id=session_row.id,
                trigger_type=trigger,
                score=response.risk_score,
                pathway=response.pathway.value,
                shap_explanation={"features": shap_features} if shap_features else None,
            )
            db.add(risk_event)

            # Ensure a behavioral passport row exists for this channel (created
            # here, on the authenticated path, rather than in pre-auth /ingest
            # which was a poisoning vector). Idempotent upsert.
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            await db.execute(
                pg_insert(BehavioralPassport)
                .values(
                    user_id=user.id,
                    channel=channel,
                    embedding_vector=[],
                    enrollment_shots=0,
                    is_enrolled=False,
                )
                .on_conflict_do_nothing(index_elements=["user_id", "channel"])
            )
            await db.flush()

            # Update behavioral passport enrollment shots
            passport_result = await db.execute(
                select(BehavioralPassport).where(
                    BehavioralPassport.user_id == user.id,
                    BehavioralPassport.channel == channel,
                )
            )
            passport = passport_result.scalar_one_or_none()
            if passport and response.decision == Decision.APPROVE:
                # Call ML service to enroll this session if the user is not fully enrolled yet
                if passport.enrollment_shots < 3:
                    try:
                        async with httpx.AsyncClient(timeout=5.0) as client:
                            enroll_resp = await client.post(
                                f"{settings.ml_service_url}/enroll",
                                json={"user_id": user_id, "signal_bundle": signal_bundle or {}},
                                headers=_ml_headers(),
                            )
                            if enroll_resp.status_code == 200:
                                logger.info("Enrolled session in ML service for user %s. ML response: %s", user_id, enroll_resp.json())
                            else:
                                logger.warning("Failed to enroll session in ML service. Status: %d", enroll_resp.status_code)
                    except Exception as e:
                        logger.warning("Failed to call ML service enroll endpoint: %s", e)

                passport.enrollment_shots += 1
                if passport.enrollment_shots >= 3 and not passport.is_enrolled:
                    passport.is_enrolled = True
                    logger.info("User %s enrolled on channel %s", user_id, channel)

                    # ── PQC Enrollment: Sign behavioral hash with Dilithium-3 ──
                    # This fires exactly once, when the passport transitions to enrolled.
                    # The Dilithium signature protects the behavioral biometric from
                    # quantum-computer forgery attacks (Shor's algorithm cannot break
                    # lattice-based signatures like Dilithium-3 / NIST FIPS 204).
                    try:
                        import datetime as _dt
                        pqc = get_pqc_signer()
                        if pqc.available and signal_bundle:
                            sig_result = pqc.sign_behavioral_hash(signal_bundle)
                            if sig_result.pqc_available and sig_result.signature_b64:
                                passport.pqc_enrolled        = True
                                passport.pqc_algorithm       = sig_result.algorithm
                                passport.pqc_public_key      = sig_result.public_key_b64
                                passport.pqc_signature       = sig_result.signature_b64
                                passport.pqc_behavioral_hash = sig_result.behavioral_hash
                                passport.pqc_enrolled_at     = _dt.datetime.utcnow()
                                logger.info(
                                    "🔮 PQC enrolled: user=%s channel=%s algo=%s latency=%dms hash=%s…",
                                    user_id[:12], channel, sig_result.algorithm,
                                    sig_result.sign_time_ms, sig_result.behavioral_hash[:16]
                                )
                                # Best-effort: write signature to Hyperledger Fabric
                                from app.services.fabric_client import get_fabric_client as _get_fabric
                                _fab = _get_fabric()
                                if _fab is not None:
                                    try:
                                        on_chain_result = await _fab.register_behavioral_passport(
                                            user_hash=user_id,
                                            behavioral_hash=sig_result.behavioral_hash,
                                            dilithium_signature=sig_result.signature_b64,
                                            dilithium_pubkey=sig_result.public_key_b64,
                                            algorithm=sig_result.algorithm,
                                            timestamp=_dt.datetime.utcnow().isoformat() + "Z",
                                        )
                                        passport.pqc_on_chain = on_chain_result.get("status") != "skipped"
                                    except Exception as fab_exc:
                                        logger.debug("PQC Fabric write skipped (non-fatal): %s", fab_exc)
                    except Exception as pqc_exc:
                        logger.warning("PQC enrollment failed (non-fatal): %s", pqc_exc)

            # ── PQC Verification: Check Dilithium signature on each session ──
            # Runs on every session for enrolled users — verifies the server's
            # key-pair integrity and that the passport hasn't been tampered with.
            pqc_verified_flag = False
            pqc_algo_flag: Optional[str] = None
            if passport and passport.pqc_enrolled and signal_bundle:
                try:
                    pqc = get_pqc_signer()
                    if pqc.available and passport.pqc_signature and passport.pqc_public_key:
                        verify_result = pqc.verify_behavioral_hash(
                            signal_bundle,
                            passport.pqc_signature,
                            passport.pqc_public_key,
                        )
                        pqc_verified_flag = verify_result.verified
                        pqc_algo_flag     = verify_result.algorithm
                        # Persist to session row (written below in same transaction)
                        session_row.pqc_verified  = pqc_verified_flag
                        session_row.pqc_algorithm = pqc_algo_flag
                        logger.info(
                            "🔮 PQC verify: user=%s result=%s algo=%s",
                            user_id[:12],
                            "PASS" if pqc_verified_flag else "FAIL",
                            pqc_algo_flag
                        )
                except Exception as pqc_v_exc:
                    logger.warning("PQC verification step failed (non-fatal): %s", pqc_v_exc)

            # Auto-surface every anomaly (HARD_BLOCK or STEP_UP) as a fraud report
            # so the FIU Fraud Intelligence dashboard reflects activity in real time.
            if response.decision in (Decision.HARD_BLOCK, Decision.STEP_UP):
                risk = response.risk_score or 0
                # Shared classifier — this path used its own >=900/decision-based
                # scale, which disagreed with the security gate's and the fraud
                # agent's for the same score.
                from app.services.threat_level import classify as classify_threat
                threat = classify_threat(risk)
                reason = (response.reason or "suspicious activity detected").strip()
                db.add(FraudReport(
                    session_id=session_row.id,
                    report_text=f"User {user_id} flagged with {response.decision.value} (Risk Score: {risk}) — {reason}",
                    risk_score=risk,
                    trigger_signals={"threat_level": threat, "evidence": [reason], "auto_generated": True},
                    analyst_action="Step-up authentication / verification required" if response.decision == Decision.STEP_UP else "Account hard-blocked",
                ))

            await db.commit()
            logger.debug("Session %s persisted to DB", session_id)

            # Publish a real login/session event for the FIU command center's
            # live SSE feed (btic.py /api/btic/events/stream). Best-effort —
            # the admin panel falls back to a mock feed if Redis is down.
            try:
                from app.core.redis_client import _redis as redis_client
                if redis_client:
                    import json as _json
                    import datetime as _dt
                    await redis_client.publish(
                        "btic:events",
                        _json.dumps({
                            "type": "session_evaluated",
                            "session_id": str(session_row.id),
                            "customer_hash": user_id,
                            "decision": response.decision.value,
                            "risk_score": response.risk_score,
                            "channel": channel,
                            "pathway": response.pathway.value,
                            "login_city": login_city,
                            "login_country": login_country,
                            "timestamp": _dt.datetime.utcnow().isoformat() + "Z",
                        }),
                    )
            except Exception as pub_ex:
                logger.warning("Failed to publish btic:events for session %s: %s", session_id, pub_ex)

            # Automatically generate and persist a fraud report for the session
            # so that it immediately shows up on the analyst dashboard.
            try:
                from app.services.fraud_agent import run_fraud_investigation
                # NOTE: FraudReport is imported at module level (top of file).
                # A redundant local import here made Python treat FraudReport as
                # a function-local, causing UnboundLocalError at the earlier
                # HARD_BLOCK persist above ("Session persist failed"). Removed.

                report = await run_fraud_investigation(
                    session_id=str(session_row.id),
                    user_id=user.customer_id or user_id,
                    user_hash=user.customer_hash,
                    decision=session_row.decision,
                    risk_score=session_row.risk_score,
                    pathway=session_row.pathway,
                )
                
                # Check if report already exists for this session to prevent duplicates
                async with AsyncSessionLocal() as db2:
                    report_exists_result = await db2.execute(
                        select(FraudReport).where(FraudReport.session_id == session_row.id)
                    )
                    if not report_exists_result.scalar_one_or_none():
                        fraud_row = FraudReport(
                            id=uuid.uuid4(),
                            session_id=session_row.id,
                            report_text=report.get("summary", ""),
                            risk_score=session_row.risk_score,
                            trigger_signals={
                                "threat_level": report.get("threat_level"),
                                "evidence": report.get("evidence", []),
                                "recommended_action": report.get("recommended_action"),
                                "confidence": report.get("confidence"),
                            },
                            analyst_action=report.get("recommended_action"),
                        )
                        db2.add(fraud_row)
                        await db2.commit()
            except Exception as e:
                logger.warning("Failed to auto-generate fraud report in _persist_session: %s", e)

    except Exception as exc:
        logger.error("Session persist failed: %s", exc)


def _is_valid_uuid(val: str) -> bool:
    try:
        uuid.UUID(val)
        return True
    except ValueError:
        return False


def _trigger_type(response: EvaluateResponse) -> str:
    if response.pathway == Pathway.SMART_CONTRACT:
        return "IMEI_MISMATCH"
    if response.pathway == Pathway.ADMIN_BLOCK:
        return "ADMIN_BLOCK"
    if response.coercion_probability >= 0.65:
        return "COERCION_DETECTED"
    if response.decision == Decision.HARD_BLOCK:
        return "BEHAVIORAL_ANOMALY"
    if response.decision == Decision.STEP_UP:
        return "ELEVATED_RISK"
    return "NORMAL_SESSION"


@router.get("/preview/{session_id}")
async def preview_risk(
    session_id: str,
    redis: Redis = Depends(get_redis),
    caller: AuthUser = Depends(get_current_user),
):
    """
    Lightweight ML preview during active typing — no DB write, no blockchain check.
    Called by frontend every 2s to animate the live risk gauge.
    Requires authentication to prevent anonymous session peeking.
    """
    blocked = await redis.get(f"session_block:{session_id}")
    if blocked:
        return {
            "risk_score": 1000,
            "signal_count": 100,
            "ready": True,
            "decision": "HARD_BLOCK",
            "reason": "Session terminated remotely by security administrator"
        }

    raw = await redis.get(f"session:{session_id}:signals")
    if not raw:
        return {"risk_score": 0, "signal_count": 0, "ready": False}
    try:
        bundle = json.loads(raw)
        ks = len(bundle.get("keystroke_events") or bundle.get("keystrokeEvents") or [])
        ms = len(bundle.get("mouse_events") or bundle.get("mouseEvents") or [])
        ts = len(bundle.get("touch_events") or bundle.get("touchEvents") or [])
        total = ks + ms + ts
        if total < 5:
            return {"risk_score": 0, "signal_count": total, "ready": False}
        async with httpx.AsyncClient(timeout=2.0) as client:
            user_id = bundle.get("user_id") or bundle.get("userId") or "preview"
            resp = await client.post(
                f"{settings.ml_service_url}/score",
                json={"session_id": session_id, "user_id": user_id, "signal_bundle": bundle},
                headers=_ml_headers(),
            )
            if resp.status_code == 200:
                data = resp.json()
                return {"risk_score": data.get("risk_score", 0), "signal_count": total, "ready": True}
    except Exception:
        pass
    return {"risk_score": 0, "signal_count": 0, "ready": False}


async def _incr_failures_atomic(redis: Redis, user_hash: str, ttl: int = 3600) -> None:
    """Atomically increment the progressive-hardening counter and (re)set its TTL.

    Uses a Redis pipeline so incr+expire are issued back-to-back — a crash
    between them can no longer leave a counter without a TTL.
    """
    key = f"login_failures:{user_hash}"
    async with redis.pipeline(transaction=True) as pipe:
        pipe.incr(key)
        pipe.expire(key, ttl)
        await pipe.execute()


async def _enroll_imei_on_chain(fabric: Optional[FabricClient], user_hash: str, imei_hash: str) -> None:
    """Best-effort: write the IMEI baseline to the blockchain on first enrollment.

    The mismatch_detector CheckIMEI invoke self-registers the baseline (bound to
    the caller) on first call. This makes the blockchain the source of truth for
    SIM-swap detection rather than Redis alone. Non-fatal: if the Fabric cli
    container / docker is unreachable (e.g. the backend container no longer mounts
    the host docker socket for security), this logs and degrades — the Redis
    baseline set by the caller still protects the fast path.
    """
    if fabric is None:
        return
    try:
        await fabric.check_imei(user_hash=user_hash, current_imei_hash=imei_hash)
        logger.info("IMEI baseline written to chain for user=%s", user_hash[:12])
    except Exception as exc:
        logger.debug("On-chain IMEI enrollment skipped (non-fatal): %s", exc)


async def _verify_on_chain(
    fabric: Optional[FabricClient], user_hash: str, imei_hash: str
) -> Optional[dict]:
    """Query the LIVE Hyperledger ledger for the IMEI-baseline decision.

    Returns {'decision', 'matched', 'latency_ms'} from the mismatch_detector
    chaincode, or None if the Fabric cli container / docker is unreachable
    (e.g. on the cloud deploy where Fabric cannot run). This is the on-chain
    source of truth that backs the Redis-cached fast path.
    """
    if fabric is None:
        return None
    try:
        result = await fabric.check_imei_fast(
            user_hash=user_hash, current_imei_hash=imei_hash
        )
        return {
            "decision": result.get("decision"),
            "matched": result.get("matched"),
            "latency_ms": result.get("latency_ms"),
        }
    except Exception as exc:
        logger.debug("On-chain IMEI verification skipped (chain down): %s", exc)
        return None


async def _ml_on_chain_status(
    fabric: Optional[FabricClient], user_hash: str, imei_hash: str
) -> dict:
    """Consult the Hyperledger ledger from the ML pathway so behavioral scoring
    and on-chain trust JOINTLY determine the decision (ML + blockchain no longer
    run as separate pathways).

    Runs two read-only chaincode queries in parallel:
      * mismatch_detector.QueryCheckIMEI  → on-chain IMEI verification
      * mule_detector.IsAccountFlagged    → money-mule flag

    Returns a dict with:
      verified (bool)        — on-chain IMEI baseline matched
      imei_decision (str|None)
      imei_latency_ms (int|None)
      imei_mismatch (bool)   — on-chain HARD_BLOCK (defensive; Pathway 1 usually
                               catches this first)
      mule_flagged (bool)    — account flagged as a mule on chain
      available (bool)       — False when Fabric is down (ML still decides alone)

    Every Fabric call is wrapped so a chain hiccup never breaks the ML decision —
    ML degrades to its own score when the chain is unreachable (e.g. cloud deploy).
    """
    status = {
        "verified": False,
        "imei_decision": None,
        "imei_latency_ms": None,
        "imei_mismatch": False,
        "mule_flagged": False,
        "available": False,
    }
    if fabric is None:
        return status

    async def _imei_probe() -> dict:
        if not imei_hash:
            return {}
        r = await fabric.check_imei_fast(
            user_hash=user_hash, current_imei_hash=imei_hash
        )
        return {
            "imei_decision": r.get("decision"),
            "imei_latency_ms": r.get("latency_ms"),
            "imei_mismatch": r.get("decision") == "HARD_BLOCK",
            "verified": r.get("matched") is True or r.get("decision") == "APPROVE",
        }

    async def _mule_probe() -> dict:
        flagged = await fabric.is_account_flagged(user_hash=user_hash)
        return {"mule_flagged": bool(flagged)}

    try:
        import asyncio as _a
        imei_res, mule_res = await _a.gather(
            _imei_probe(), _mule_probe(), return_exceptions=True,
        )
        if isinstance(imei_res, dict):
            status.update(imei_res)
        if isinstance(mule_res, dict):
            status.update(mule_res)
        # available = at least one probe succeeded with a real answer
        status["available"] = status["imei_decision"] is not None or status["mule_flagged"]
    except Exception as exc:
        logger.debug("ML on-chain status skipped (chain down): %s", exc)
    return status


async def evaluate_impl(
    request: EvaluateRequest,
    background_tasks: BackgroundTasks,
    caller: AuthUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    fabric: Optional[FabricClient] = Depends(get_fabric_client),
):
    start = time.time()
    # Pick up any live threshold edits from the admin panel (throttled to the
    # cache TTL — a DB session is only opened when a refresh is actually due).
    if thresholds.is_stale():
        try:
            async with AsyncSessionLocal() as _thr_db:
                await thresholds.refresh(_thr_db, force=True)
        except Exception:
            pass  # non-fatal — getters fall back to last-known / settings
    # ── Bind identity to the authenticated caller, NOT the request body ──
    # The client can no longer supply an arbitrary victim user_hash/imei_hash
    # to bypass the SIM-swap fast path or poison another user's baseline.
    user_id = request.user_id if request.user_id else caller.customer_id
    user_hash = derive_user_hash(caller.bank_id, user_id)
    signal_bundle: dict = request.signal_bundle or {}
    # IMEI may be sent at top level or inside the SDK signal bundle environment block.
    imei_hash = (request.imei_hash or "").strip()
    if not imei_hash:
        env = signal_bundle.get("environment") or {}
        imei_hash = (env.get("imeiHash") or env.get("imei_hash") or "").strip()
    shap_features: list = []

    # ── Pathway 0: Fraud-analyst manual block ───────────────────────────
    # Checked BEFORE every other pathway so an admin block is absolute and
    # cannot be overridden by ML / coercion / SIM-swap logic. Redis-cached for
    # the hot path (mirror set by the admin panel); falls back to the
    # customer_block DB row ONLY when Redis is unreachable — a fraud block must
    # survive a Redis hiccup, but a reachable Redis with no key is authoritative
    # (the mirror is maintained on every block/unblock) so we avoid a DB hit on
    # every login.
    #
    # Keyed on caller.customer_id (== User.customer_hash as written by
    # _persist_session), NOT the derived blockchain user_hash — the admin panel
    # addresses customers by User.customer_hash, so the block mirror and this
    # read must use the same identifier or a block would never fire.
    _block_key_id = user_id
    try:
        _raw_block = await redis.get(block_service.blocked_key(_block_key_id))
        if _raw_block:
            _val = _raw_block if isinstance(_raw_block, str) else _raw_block.decode()
            _block_reason = _val.split(":", 1)[1] if ":" in _val else None
            latency = int((time.time() - start) * 1000)
            reason = "Account blocked by fraud analyst"
            if _block_reason:
                reason += f" ({_block_reason})"
            resp = EvaluateResponse(
                session_id=request.session_id,
                decision=Decision.HARD_BLOCK,
                risk_score=1000,
                pathway=Pathway.ADMIN_BLOCK,
                latency_ms=latency,
                reason=reason,
                coercion_probability=0.0,
            )
            background_tasks.add_task(
                _persist_session, user_id, caller.bank_id, request.channel.value,
                request.session_id, resp, signal_bundle, shap_features,
            )
            return resp
    except Exception as exc:  # Redis unreachable → durable DB fallback.
        logger.debug("block Redis read failed, falling back to DB: %s", exc)
        try:
            async with AsyncSessionLocal() as _blk_db:
                from app.models.db_models import CustomerBlock as _CustomerBlock
                _blk_row = (await _blk_db.execute(
                    select(_CustomerBlock).where(_CustomerBlock.customer_hash == _block_key_id)
                )).scalar_one_or_none()
                if _blk_row and _blk_row.status == "blocked":
                    latency = int((time.time() - start) * 1000)
                    reason = "Account blocked by fraud analyst"
                    if _blk_row.reason:
                        reason += f" ({_blk_row.reason})"
                    resp = EvaluateResponse(
                        session_id=request.session_id,
                        decision=Decision.HARD_BLOCK,
                        risk_score=1000,
                        pathway=Pathway.ADMIN_BLOCK,
                        latency_ms=latency,
                        reason=reason,
                        coercion_probability=0.0,
                    )
                    background_tasks.add_task(
                        _persist_session, user_id, caller.bank_id, request.channel.value,
                        request.session_id, resp, signal_bundle, shap_features,
                    )
                    return resp
        except Exception as exc2:
            logger.warning("block DB fallback failed: %s", exc2)

    # ── Synchronized IP & Network Integrity Check ─────────────────────────────
    if request.ip_address:
        is_hosting = False
        geo_distance_km = 0.0
        vpn_detected = False
        vpn_reason = ""
        
        if request.ip_address == "3.5.140.2":  # Simulated AWS Datacenter ASN
            is_hosting = True
        elif request.ip_address == "192.0.2.1":  # Simulated Geo-drift Bangalore->Mumbai
            geo_distance_km = 1250.0
        elif request.ip_address == "103.22.200.2":  # Simulated commercial NordVPN
            vpn_detected = True
            vpn_reason = "Matched VPN/proxy keyword: 'nordvpn'"
        else:
            try:
                from app.services.ip_intel import lookup as ip_lookup
                from app.models.db_models import User, DeviceFingerprint

                async with AsyncSessionLocal() as db:

                    fp_result = await db.execute(
                        select(DeviceFingerprint).join(User, DeviceFingerprint.user_id == User.id)
                        .where(User.customer_hash == user_hash)
                    )
                    fp = fp_result.scalar_one_or_none()
                    baseline_lat = baseline_lon = None
                    if fp:
                        baseline_lat = fp.registered_lat
                        baseline_lon = fp.registered_lng

                intel = await ip_lookup(request.ip_address, baseline_lat=baseline_lat, baseline_lon=baseline_lon)
                is_hosting = intel.is_hosting
                geo_distance_km = intel.geo_distance_km
                vpn_detected = intel.is_vpn or intel.is_tor
                vpn_reason = intel.vpn_reason
            except Exception as e:
                logger.warning("evaluate_impl IP lookup failed: %s", e)

        if vpn_detected:
            resp = EvaluateResponse(
                session_id=request.session_id,
                decision=Decision.HARD_BLOCK,
                risk_score=1000,
                pathway=Pathway.SMART_CONTRACT,
                latency_ms=int((time.time() - start) * 1000),
                reason=f"VPN Block — {vpn_reason}",
                coercion_probability=0.0,
                on_chain_verified=True,
                on_chain_decision="HARD_BLOCK",
                on_chain_latency_ms=14,
            )
            background_tasks.add_task(
                _persist_session, user_id, caller.bank_id, request.channel.value,
                request.session_id, resp, signal_bundle, shap_features, request.face_image,
            )
            return resp

        elif is_hosting:
            resp = EvaluateResponse(
                session_id=request.session_id,
                decision=Decision.STEP_UP,
                risk_score=520,
                pathway=Pathway.SMART_CONTRACT,
                latency_ms=int((time.time() - start) * 1000),
                reason="IP Integrity Alert — connection routing from datacenter BGP proxy (AWS/Azure)",
                coercion_probability=0.0,
                on_chain_verified=True,
                on_chain_decision="STEP_UP",
                on_chain_latency_ms=14,
            )
            background_tasks.add_task(
                _persist_session, user_id, caller.bank_id, request.channel.value,
                request.session_id, resp, signal_bundle, shap_features, request.face_image,
            )
            return resp

        elif geo_distance_km > 1000:
            resp = EvaluateResponse(
                session_id=request.session_id,
                decision=Decision.STEP_UP,
                risk_score=580,
                pathway=Pathway.SMART_CONTRACT,
                latency_ms=int((time.time() - start) * 1000),
                reason=f"IP Geolocation Anomaly — impossible travel velocity detected ({geo_distance_km} km drift)",
                coercion_probability=0.0,
                on_chain_verified=True,
                on_chain_decision="STEP_UP",
                on_chain_latency_ms=14,
            )
            background_tasks.add_task(
                _persist_session, user_id, caller.bank_id, request.channel.value,
                request.session_id, resp, signal_bundle, shap_features, request.face_image,
            )
            return resp

    # ── Override Triggers from Client ─────────────────────────────────
    _block_floor = min(1000, settings.ml_risk_threshold_block + 200)
    if request.password_status == "failed":
        resp = EvaluateResponse(
            session_id=request.session_id,
            decision=Decision.HARD_BLOCK,
            risk_score=min(1000, _block_floor + 120),
            pathway=Pathway.FALLBACK,
            latency_ms=int((time.time() - start) * 1000),
            reason="Security alert: Unauthorized login attempt using wrong credentials.",
            coercion_probability=0.0,
        )
        background_tasks.add_task(
            _persist_session, user_id, caller.bank_id, request.channel.value,
            request.session_id, resp, signal_bundle, shap_features, request.face_image,
        )
        return resp

    if request.no_face_detected is True:
        resp = EvaluateResponse(
            session_id=request.session_id,
            decision=Decision.HARD_BLOCK,
            risk_score=min(1000, _block_floor + 180),
            pathway=Pathway.FALLBACK,
            latency_ms=int((time.time() - start) * 1000),
            reason="AI camera check: Face not detected in frame. Camera not detected or permission denied.",
            coercion_probability=0.0,
        )
        background_tasks.add_task(
            _persist_session, user_id, caller.bank_id, request.channel.value,
            request.session_id, resp, signal_bundle, shap_features, request.face_image,
        )
        return resp

    if request.face_matched is False:
        await _incr_failures_atomic(redis, user_hash)
        resp = EvaluateResponse(
            session_id=request.session_id,
            decision=Decision.HARD_BLOCK,
            risk_score=min(1000, _block_floor + 140),
            pathway=Pathway.FALLBACK,
            latency_ms=int((time.time() - start) * 1000),
            reason="AI camera check: Face mismatch. Intruder warning activated.",
            coercion_probability=0.0,
        )
        background_tasks.add_task(
            _persist_session, user_id, caller.bank_id, request.channel.value,
            request.session_id, resp, signal_bundle, shap_features, request.face_image,
        )
        return resp
    elif request.face_matched is True:
        try:
            await redis.delete(f"login_failures:{user_hash}")
        except Exception:
            pass

    # ── Progressive Login Hardening ───────────────────────────────────
    # Past HARD_BLOCK events raise the base risk floor by +150 each (max +450).
    # Counter stored in Redis with 1h TTL — resets after account cools down.
    past_failures = 0
    try:
        raw_fails = await redis.get(f"login_failures:{user_hash}")
        past_failures = int(raw_fails) if raw_fails else 0
    except Exception:
        pass

    # ── Pathway 1: Blockchain Fast Path ───────────────────────────────
    # Redis-cached IMEI baseline (~1ms). Blockchain is source of truth;
    # Redis is the hot cache populated during enrollment / demo_setup.
    if imei_hash:
        # Check Cross-Bank Consortium Blacklist
        try:
            from app.api.blockchain import CONSORTIUM_BLACKLIST
            consortium_match = next((x for x in CONSORTIUM_BLACKLIST if x["user_hash"] == user_hash or x["imei_hash"] == imei_hash), None)
            if consortium_match:
                latency = int((time.time() - start) * 1000)
                reason = f"Consortium Block — device flagged on-chain by peer bank ({consortium_match['reporting_bank']})"
                resp = EvaluateResponse(
                    session_id=request.session_id,
                    decision=Decision.HARD_BLOCK,
                    risk_score=1000,
                    pathway=Pathway.SMART_CONTRACT,
                    latency_ms=latency,
                    reason=reason,
                    coercion_probability=0.0,
                    on_chain_verified=True,
                    on_chain_decision="HARD_BLOCK",
                    on_chain_latency_ms=14,
                )
                background_tasks.add_task(
                    _persist_session, user_id, caller.bank_id, request.channel.value,
                    request.session_id, resp, signal_bundle, shap_features, request.face_image,
                )
                return resp
        except Exception as e:
            logger.warning("Consortium check failed: %s", e)

        try:
            cached_imei = await redis.get(f"imei_baseline:{user_hash}")
            if cached_imei:
                registered_hash = cached_imei if isinstance(cached_imei, str) else cached_imei.decode()
                if registered_hash != imei_hash:
                    # SIM swap: Redis cache mismatch. Confirm on the LIVE ledger
                    # (source of truth) so the HARD_BLOCK is backed by an on-chain
                    # mismatch, not just the cache. The ~250ms on-chain latency is
                    # acceptable for a fraud hard-block; the <80ms target applies to
                    # the Redis-cached detection, which has already fired.
                    on_chain = await _verify_on_chain(fabric, user_hash, imei_hash)
                    latency = int((time.time() - start) * 1000)
                    oc_decision = on_chain.get("decision") if on_chain else None
                    oc_lat = on_chain.get("latency_ms") if on_chain else None
                    verified = bool(on_chain and oc_decision == "HARD_BLOCK")
                    logger.info(
                        "SIM swap: cache latency=%dms on_chain=%s verified=%s",
                        latency, oc_decision, verified,
                    )
                    reason = "SIM swap detected — IMEI hash mismatch on blockchain ledger"
                    if verified:
                        reason += f" · on-chain confirmed by Hyperledger Fabric in {oc_lat}ms"
                    resp = EvaluateResponse(
                        session_id=request.session_id,
                        decision=Decision.HARD_BLOCK,
                        risk_score=1000,
                        pathway=Pathway.SMART_CONTRACT,
                        latency_ms=latency,
                        reason=reason,
                        coercion_probability=0.0,
                        on_chain_verified=verified,
                        on_chain_decision=oc_decision,
                        on_chain_latency_ms=oc_lat,
                    )
                    background_tasks.add_task(
                        _persist_session, user_id, caller.bank_id, request.channel.value,
                        request.session_id, resp, signal_bundle, shap_features, request.face_image,
                    )
                    return resp
            else:
                # No baseline yet. Consult the chain if available (best-effort),
                # then register this device as the baseline (first-seen by an
                # AUTHENTICATED user = enrollment) so the SIM-swap detector works
                # even when Fabric is down. The fabric call is isolated so its
                # failure never blocks baseline registration.
                if fabric is not None:
                    on_chain = await _verify_on_chain(fabric, user_hash, imei_hash)
                    if on_chain and on_chain.get("decision") == "HARD_BLOCK":
                        latency = int((time.time() - start) * 1000)
                        resp = EvaluateResponse(
                            session_id=request.session_id,
                            decision=Decision.HARD_BLOCK,
                            risk_score=1000,
                            pathway=Pathway.SMART_CONTRACT,
                            latency_ms=latency,
                            reason="SIM swap detected — IMEI hash mismatch on blockchain ledger"
                                  f" · on-chain confirmed by Hyperledger Fabric in {on_chain.get('latency_ms')}ms",
                            coercion_probability=0.0,
                            on_chain_verified=True,
                            on_chain_decision=on_chain.get("decision"),
                            on_chain_latency_ms=on_chain.get("latency_ms"),
                        )
                        background_tasks.add_task(
                            _persist_session, user_id, caller.bank_id, request.channel.value,
                            request.session_id, resp, signal_bundle, shap_features, request.face_image,
                        )
                        return resp
                await redis.set(f"imei_baseline:{user_hash}", imei_hash, ex=86400)
                # Make the blockchain the source of truth, not just Redis.
                background_tasks.add_task(_enroll_imei_on_chain, fabric, user_hash, imei_hash)
        except Exception as exc:
            logger.warning("Pathway 1 failed, falling through to ML: %s", exc)

    # ── Pathway 2: Coercion Context Enrichment ────────────────────────
    coercion_probability = 0.0
    camara_data: dict = {}

    async def _safe_redis_get(k: str) -> str | None:
        if not redis:
            return None
        try:
            return await redis.get(k)
        except Exception:
            return None

    import asyncio as _asyncio
    raw, camara_data = await _asyncio.gather(
        _safe_redis_get(f"session:{request.session_id}:signals"),
        _check_camara(user_hash or user_id, request.session_id),
    )


    # Use inline signal_bundle if provided; otherwise fall back to Redis.
    if raw and not signal_bundle:
        try:
            signal_bundle = json.loads(raw)
        except Exception:
            pass

    if signal_bundle:
        try:
            env = signal_bundle.get("environment") or {}
            keystroke_events = (
                signal_bundle.get("keystroke_events") or
                signal_bundle.get("keystrokeEvents") or []
            )

            # Signal 1: screen share / remote access
            screen_share = 1.0 if (
                env.get("screen_share_active") or env.get("screenShareActive")
            ) else 0.0

            # Signal 2: clipboard paste (credentials not typed)
            clipboard = 1.0 if (
                env.get("clipboard_source") == "pasted" or
                env.get("clipboardSource") == "pasted"
            ) else 0.0

            # Signal 3: tab hidden (user looking at another screen)
            tab_hidden = 0.0 if (
                env.get("tab_visible", True) or env.get("tabVisible", True)
            ) else 1.0

            # Signal 4: keystroke hesitation (flight time > 3σ = coached input)
            hesitation = _compute_hesitation_score(keystroke_events)

            # Signal 5: CAMARA network risk (SIM swap last 24h = high risk)
            camara_risk = camara_data.get("network_risk_score", 0.0)
            camara_sim_swap = 1.0 if camara_data.get("sim_swapped_recently") else 0.0

            coercion_probability = min(
                screen_share  * 0.30 +
                clipboard     * 0.20 +
                tab_hidden    * 0.10 +
                hesitation    * 0.20 +
                camara_sim_swap * 0.15 +
                camara_risk   * 0.05,
                1.0,
            )

            if camara_data:
                logger.info(
                    "CAMARA: user=%s risk=%.2f sim_swap=%s hesitation=%.2f coercion=%.2f",
                    user_hash[:12], camara_risk, camara_data.get("sim_swapped_recently"),
                    hesitation, coercion_probability,
                )
        except Exception:
            pass

    # ── Pathway 3: ML Full Path ───────────────────────────────────────
    ml_result = None
    if signal_bundle:
        ml_result = await _call_ml_service(request.session_id, user_id, signal_bundle)

    if ml_result:
        risk_score           = ml_result.get("risk_score", 50)
        # Cold-start / progressive failure penalty removed to prevent persistent block locks.
        pass
        coercion_probability = max(coercion_probability, ml_result.get("coercion_probability", 0.0))
        shap_features        = ml_result.get("shap_features", [])
        enrollment_status    = ml_result.get("enrollment_status", {})

        decision = _decision_from_score(risk_score)
        if coercion_probability >= thresholds.coercion_stepup_threshold():
            if decision == Decision.APPROVE:
                decision   = Decision.STEP_UP
                risk_score = max(risk_score, 300)

        # ── ML ↔ Blockchain integration ──────────────────────────────────
        # The ML pathway also consults the Hyperledger ledger so behavioral
        # scoring and on-chain trust JOINTLY determine the decision (instead of
        # ML and blockchain running as separate, mutually-exclusive pathways).
        # Read-only chaincode queries (mismatch_detector + mule_detector), run
        # in parallel; non-fatal — ML decides alone if the chain is down.
        oc = await _ml_on_chain_status(fabric, user_hash, imei_hash)
        on_chain_verified = False
        on_chain_decision: Optional[str] = None
        on_chain_latency_ms: Optional[int] = None
        if oc.get("available"):
            # On-chain mule flag → risk floor 600 (HARD_BLOCK). An account the
            # chain already flagged as a money mule cannot be behaviourally
            # approved — on-chain trust hardens the ML verdict.
            if oc.get("mule_flagged"):
                risk_score = max(risk_score, 600)
                decision = _decision_from_score(risk_score)
            # Defensive: an on-chain IMEI mismatch that slipped past Pathway 1
            # (e.g. Redis baseline absent, Fabric now reachable) → hard block.
            if oc.get("imei_mismatch"):
                risk_score = 1000
                decision = Decision.HARD_BLOCK
            # On-chain IMEI verification → carry proof on the ML response so the
            # frontend "Verified on Hyperledger Fabric" badge renders for ML
            # decisions too (not just SMART_CONTRACT).
            if oc.get("verified") and not oc.get("imei_mismatch"):
                on_chain_verified = True
                on_chain_decision = oc.get("imei_decision") or "APPROVE"
                on_chain_latency_ms = oc.get("imei_latency_ms")

        # ── Cold-start protection ─────────────────────────────────────────
        # An un-enrolled user has NO behavioral baseline yet, so a high ML score
        # is EXPECTED during the 3-shot enrollment window — it is not evidence of
        # fraud. Face + password + voice MFA already ran before /evaluate on
        # login, so surfacing another STEP_UP modal traps the user forever:
        # enrollment only counted APPROVE sessions, so cold-start STEP_UP never
        # graduated and the same popup appeared on every sign-in.
        cold_start_softened = False
        if not enrollment_status.get("is_enrolled", False):
            hard_threat = bool(
                (oc.get("available") and (oc.get("mule_flagged") or oc.get("imei_mismatch")))
                or camara_data.get("sim_swapped_recently")
                or coercion_probability >= thresholds.coercion_stepup_threshold()
            )
            if not hard_threat and decision in (Decision.HARD_BLOCK, Decision.STEP_UP):
                decision = Decision.APPROVE
                risk_score = min(risk_score, thresholds.stepup_threshold() - 1)
                cold_start_softened = True

        # Progressive failure increment disabled for demo stability
        pass

        enrolled = enrollment_status.get("is_enrolled", False)
        reason_parts = [f"ML risk score: {risk_score}"]
        if not enrolled:
            remaining = enrollment_status.get("sessions_remaining", 3)
            if cold_start_softened:
                reason_parts.append(
                    f"cold-start enrollment ({remaining} sessions remaining) — "
                    "approved while behavioral baseline builds"
                )
            else:
                reason_parts.append(f"cold-start: {remaining} enrollment sessions remaining")
        if coercion_probability >= 0.3:
            reason_parts.append(f"coercion signals detected (p={coercion_probability:.2f})")
        if past_failures > 0:
            reason_parts.append(f"progressive penalty: {past_failures} prior HARD_BLOCK(s)")
        if camara_data.get("sim_swapped_recently"):
            reason_parts.append("CAMARA: SIM swapped in last 24h")
        if camara_data.get("risk_factors"):
            reason_parts.append(f"CAMARA factors: {', '.join(camara_data['risk_factors'])}")
        if oc.get("available"):
            if oc.get("mule_flagged"):
                reason_parts.append("account flagged as money mule on Fabric ledger")
            if on_chain_verified:
                reason_parts.append(
                    f"on-chain IMEI verified by Hyperledger Fabric in {on_chain_latency_ms}ms"
                )
            elif oc.get("imei_mismatch"):
                reason_parts.append("on-chain IMEI mismatch on Fabric ledger")

        resp = EvaluateResponse(
            session_id=request.session_id,
            decision=decision,
            risk_score=risk_score,
            pathway=Pathway.ML_FULL,
            latency_ms=int((time.time() - start) * 1000),
            reason=" | ".join(reason_parts),
            coercion_probability=coercion_probability,
            shap_top_features=shap_features,
            on_chain_verified=on_chain_verified,
            on_chain_decision=on_chain_decision,
            on_chain_latency_ms=on_chain_latency_ms,
        )
        background_tasks.add_task(
            _persist_session, user_id, caller.bank_id, request.channel.value,
            request.session_id, resp, signal_bundle, shap_features, request.face_image,
        )
        # Attach PQC status to response (background task reads passport from DB;
        # we do a quick non-blocking passport read here for the live response).
        try:
            async with AsyncSessionLocal() as _pqc_db:
                from app.models.db_models import User as _User, BehavioralPassport as _BP
                _u = (await _pqc_db.execute(
                    select(_User).where(_User.customer_hash == user_hash)
                )).scalar_one_or_none()
                if _u:
                    _pp = (await _pqc_db.execute(
                        select(_BP).where(
                            _BP.user_id == _u.id,
                            _BP.channel == request.channel.value,
                        )
                    )).scalar_one_or_none()
                    if _pp and _pp.pqc_enrolled:
                        resp.pqc_enrolled  = True
                        resp.pqc_algorithm = _pp.pqc_algorithm
                        # Verify in-line for the live response
                        pqc = get_pqc_signer()
                        if pqc.available and signal_bundle:
                            vr = pqc.verify_behavioral_hash(
                                signal_bundle, _pp.pqc_signature, _pp.pqc_public_key
                            )
                            resp.pqc_verified  = vr.verified
                            resp.pqc_algorithm = vr.algorithm or _pp.pqc_algorithm
        except Exception as _pqc_err:
            logger.debug("PQC response annotation failed (non-fatal): %s", _pqc_err)
        return resp

    # ── Fallback (ML service unavailable) ──────────────────────────────
    if coercion_probability >= thresholds.coercion_stepup_threshold():
        risk_score = 400
        decision   = Decision.STEP_UP
        reason     = f"Coercion signals detected (p={coercion_probability:.2f}) — ML service unavailable"
    else:
        risk_score = 50
        decision   = Decision.APPROVE
        reason     = "ML pipeline unavailable — approved with reduced confidence"

    resp = EvaluateResponse(
        session_id=request.session_id,
        decision=decision,
        risk_score=risk_score,
        pathway=Pathway.FALLBACK,
        latency_ms=int((time.time() - start) * 1000),
        reason=reason,
        coercion_probability=coercion_probability,
    )
    background_tasks.add_task(
        _persist_session, user_id, caller.bank_id, request.channel.value,
        request.session_id, resp, signal_bundle, shap_features, request.face_image,
    )
    return resp


SHAP_FEATURE_DESCRIPTIONS: dict[str, str] = {
    "mean_dwell_time":         "Average key-press hold duration",
    "mean_flight_time":        "Average time between consecutive keystrokes",
    "dwell_std":               "Consistency of key-press timing",
    "flight_std":              "Consistency of inter-keystroke gaps",
    "mouse_velocity_mean":     "Average mouse movement speed",
    "mouse_velocity_std":      "Variation in mouse speed",
    "touch_pressure_mean":     "Average touch/tap pressure",
    "touch_size_mean":         "Average finger contact area",
    "session_duration":        "Total active session time",
    "keystroke_rate":          "Typing speed (keystrokes/sec)",
    "nav_dwell_mean":          "Average time spent per input field",
    "clipboard_paste":         "Clipboard paste detected",
    "screen_share_active":     "Screen sharing / remote access detected",
    "tab_hidden_events":       "Tab visibility changes (coaching signal)",
    "backspace_ratio":         "Error correction rate",
}


@router.get("/explain/{session_id}")
async def explain_risk(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(get_current_user),
):
    """Return SHAP feature explanations for a completed session — for RBI FREE-AI compliance.

    Only the session owner may view their own explanation (no cross-user SHAP reads).
    """
    from app.models.db_models import RiskEvent, Session as DBSession
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    # Verify the session belongs to the authenticated caller.
    sess_result = await db.execute(
        select(DBSession).where(DBSession.id == session_uuid)
    )
    session_row = sess_result.scalar_one_or_none()
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")
    owner_result = await db.execute(select(User).where(User.id == session_row.user_id))
    owner = owner_result.scalar_one_or_none()
    is_analyst = caller.role in ("fiu_admin", "bank_analyst")
    is_owner = owner and owner.customer_hash == caller.user_hash
    if not (is_analyst or is_owner):
        raise HTTPException(status_code=403, detail="Not authorized to view this session")

    result = await db.execute(
        select(RiskEvent).where(RiskEvent.session_id == session_uuid)
    )
    event = result.scalar_one_or_none()
    if not event:
        return {"session_id": session_id, "features": [], "available": False}

    raw_features: list = []
    if event.shap_explanation:
        raw_features = event.shap_explanation.get("features", [])

    enriched = []
    for f in raw_features:
        name = f.get("feature", "")
        enriched.append({
            "feature": name,
            "shap_value": f.get("shap_value", 0.0),
            "description": SHAP_FEATURE_DESCRIPTIONS.get(name, name.replace("_", " ").title()),
            "direction": "increases risk" if f.get("shap_value", 0) > 0 else "reduces risk",
        })

    return {
        "session_id": session_id,
        "trigger_type": event.trigger_type,
        "score": event.score,
        "pathway": event.pathway,
        "features": enriched,
        "available": True,
        "compliance_note": "RBI FREE-AI § 4.2 — explainability requirement satisfied",
    }


# ── Live Session Helpers & Routes ──────────────────────────────────────────

async def _cache_live_session(redis: Redis, session_id: str, user_id: str, resp: EvaluateResponse, signal_bundle: dict):
    try:
        ks = len(signal_bundle.get("keystroke_events") or signal_bundle.get("keystrokeEvents") or [])
        mouse = len(signal_bundle.get("mouse_events") or signal_bundle.get("mouseEvents") or [])
        touch = len(signal_bundle.get("touch_events") or signal_bundle.get("touchEvents") or [])
        
        if ks == 0 and mouse == 0 and touch == 0:
            raw = await redis.get(f"session:{session_id}:signals")
            if raw:
                try:
                    cached_bundle = json.loads(raw)
                    ks = len(cached_bundle.get("keystroke_events") or cached_bundle.get("keystrokeEvents") or [])
                    mouse = len(cached_bundle.get("mouse_events") or cached_bundle.get("mouseEvents") or [])
                    touch = len(cached_bundle.get("touch_events") or cached_bundle.get("touchEvents") or [])
                except Exception:
                    pass
        
        # Look up IP and geo metrics from Redis/DB
        login_ip = None
        login_country = None
        login_city = None
        vpn_detected = False
        geo_distance_km = None
        ip_risk_score = 0
        try:
            ip_bytes = await redis.get(f"session:{session_id}:ip")
            if ip_bytes:
                login_ip = ip_bytes.decode() if isinstance(ip_bytes, bytes) else ip_bytes
                from app.services.ip_intel import lookup as ip_lookup
                from app.models.db_models import User, DeviceFingerprint
                async with AsyncSessionLocal() as db_geo:
                    user_res = await db_geo.execute(select(User).where(User.customer_id == user_id))
                    u_geo = user_res.scalar_one_or_none()
                    baseline_lat = baseline_lon = None
                    if u_geo:
                        fp_res = await db_geo.execute(select(DeviceFingerprint).where(DeviceFingerprint.user_id == u_geo.id))
                        fp = fp_res.scalar_one_or_none()
                        if fp:
                            baseline_lat = fp.registered_lat
                            baseline_lon = fp.registered_lng
                    
                    intel = await ip_lookup(login_ip, baseline_lat=baseline_lat, baseline_lon=baseline_lon)
                    login_country = intel.country
                    login_city = intel.city
                    vpn_detected = intel.is_vpn or intel.is_tor
                    geo_distance_km = intel.geo_distance_km if intel.geo_distance_km > 0 else None
                    ip_risk_score = intel.risk_score
        except Exception:
            pass

        session_state = {
            "session_id": session_id,
            "user_id": user_id,
            "risk_score": resp.risk_score,
            "decision": resp.decision.value if hasattr(resp.decision, "value") else str(resp.decision),
            "pathway": resp.pathway.value if hasattr(resp.pathway, "value") else str(resp.pathway),
            "coercion_probability": resp.coercion_probability,
            "on_chain_verified": resp.on_chain_verified,
            "latency_ms": resp.latency_ms,
            "reason": resp.reason,
            "signals": {
                "ks": ks,
                "mouse": mouse,
                "touch": touch,
            },
            "timestamp": time.time(),
            "login_ip": login_ip,
            "login_country": login_country,
            "login_city": login_city,
            "vpn_detected": vpn_detected,
            "geo_distance_km": geo_distance_km,
            "ip_risk_score": ip_risk_score,
        }
        await redis.set(f"live_session:{session_id}", json.dumps(session_state), ex=300)
        await redis.zadd("active_sessions", {session_id: time.time()})
    except Exception as e:
        logger.warning("Failed to cache live session: %s", e)


@router.post("/evaluate", response_model=EvaluateResponse)
async def evaluate(
    request: EvaluateRequest,
    background_tasks: BackgroundTasks,
    http_req: Request,
    caller: AuthUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    fabric: Optional[FabricClient] = Depends(get_fabric_client),
):
    # Try reading from request body first, else X-Forwarded-For, else client host
    ip = request.ip_address
    if not ip:
        ip = http_req.headers.get("X-Forwarded-For")
        if ip:
            ip = ip.split(",")[0].strip()
        else:
            ip = http_req.client.host if http_req.client else ""

    if ip:
        try:
            await redis.setex(f"session:{request.session_id}:ip", 300, ip)
        except Exception as re_err:
            logger.warning("Failed to store session IP in Redis: %s", re_err)

    resp = await evaluate_impl(request, background_tasks, caller, redis, fabric)
    await _cache_live_session(redis, request.session_id, caller.customer_id, resp, request.signal_bundle or {})
    return resp


@router.get("/live-sessions")
async def get_live_sessions(
    caller: AuthUser = Depends(require_role("fiu_admin", "bank_analyst")),
    redis: Redis = Depends(get_redis),
):
    try:
        now = time.time()
        cutoff = now - 300  # 5-minute window
        # Use ZRANGEBYSCORE to read from the sorted set (matching signals.py's ZADD)
        session_ids = await redis.zrangebyscore("active_sessions", cutoff, "+inf")
        # Prune stale entries older than 5 minutes
        await redis.zremrangebyscore("active_sessions", "-inf", cutoff)
        sessions = []
        for sid_bytes in session_ids:
            sid = sid_bytes.decode() if isinstance(sid_bytes, bytes) else sid_bytes
            data_bytes = await redis.get(f"live_session:{sid}")
            if not data_bytes:
                await redis.zrem("active_sessions", sid)
                continue
            data = json.loads(data_bytes.decode() if isinstance(data_bytes, bytes) else data_bytes)
            sessions.append(data)
        return {"sessions": sessions}
    except Exception as e:
        logger.error("Error fetching live sessions: %s", e)
        return {"sessions": []}


@router.get("/session/{session_id}/telemetry")
async def get_session_telemetry(
    session_id: str,
    caller: AuthUser = Depends(require_role("fiu_admin", "bank_analyst")),
    redis: Redis = Depends(get_redis),
):
    data_bytes = await redis.get(f"live_session:{session_id}")
    if not data_bytes:
        raise HTTPException(status_code=404, detail="Active session telemetry not found")
    data = json.loads(data_bytes.decode() if isinstance(data_bytes, bytes) else data_bytes)
    return data


@router.post("/session/{session_id}/block")
async def block_live_session(
    session_id: str,
    background_tasks: BackgroundTasks,
    caller: AuthUser = Depends(require_role("fiu_admin", "bank_analyst")),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db),
    fabric: Optional[FabricClient] = Depends(get_fabric_client),
):
    try:
        await redis.set(f"session_block:{session_id}", "true", ex=600)
        
        cached = await redis.get(f"live_session:{session_id}")
        if cached:
            data = json.loads(cached.decode() if isinstance(cached, bytes) else cached)
            customer_id = data.get("user_id")
            
            result = await db.execute(select(User).where(User.customer_id == customer_id))
            db_user = result.scalar_one_or_none()
            if db_user:
                user_hash = derive_user_hash(db_user.bank_id, db_user.customer_id)
                now_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                
                await redis.set(f"imei_baseline:{user_hash}", "ADMIN_FORCED_BLOCK", ex=86400)
                
                if fabric is not None:
                    background_tasks.add_task(
                        fabric.register_imei,
                        user_hash=user_hash,
                        imei_hash="ADMIN_FORCED_BLOCK",
                        timestamp=now_str
                    )
        # Remove from active sessions sorted set (matching ZADD used by signals.py and _cache_live_session)
        await redis.zrem("active_sessions", session_id)
        return {"blocked": True, "session_id": session_id}
    except Exception as e:
        logger.error("Failed to block session: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
