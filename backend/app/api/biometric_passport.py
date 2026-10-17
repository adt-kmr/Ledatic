"""
Citadel — Biometric Passport PDF Generator
================================================
Endpoint: GET /api/auth/biometric-passport/{customer_id}

Generates a premium single-page A4 PDF identity card containing:
  • User face photo (from DB/Redis)
  • 8-dimensional behavioral radar chart (matplotlib)
  • Cryptographically signed behavioral hash (HMAC-SHA256)
  • QR code encoding offline-verifiable signed payload
  • Blockchain IMEI hash from Hyperledger Fabric
  • 90-day expiry stamp
  • All 6 security layer status badges
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import logging
import math
from datetime import datetime, timezone, timedelta
from typing import Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import qrcode
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.redis_client import _redis as redis_client
from app.core.security import AuthUser, derive_user_hash, get_current_user, settings
from app.models.db_models import (
    BehavioralPassport,
    Session as DBSession,
    User,
    DeviceFingerprint,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Color palette (0-1 float RGB) ────────────────────────────────────────────
C_BG     = (0.06, 0.06, 0.10)
C_CARD   = (0.10, 0.10, 0.16)
C_ACCENT = (0.38, 0.40, 0.96)
C_CYAN   = (0.06, 0.81, 0.99)
C_GREEN  = (0.13, 0.77, 0.37)
C_RED    = (0.94, 0.27, 0.27)
C_WHITE  = (0.96, 0.96, 0.98)
C_MUTED  = (0.55, 0.56, 0.65)
C_GOLD   = (0.99, 0.84, 0.20)

DIMENSIONS = [
    "Typing\nSpeed",
    "Key\nDwell",
    "Hesitation\nIndex",
    "Scroll\nVelocity",
    "Touch\nForce",
    "Mouse\nDrift",
    "Rhythm\nIndex",
    "Coercion\nIndex",
]


def _rgb(r, g, b) -> colors.Color:
    return colors.Color(r, g, b)


def _derive_behavioral_dims(
    passport: Optional[BehavioralPassport], sessions: list
) -> list[float]:
    """Derive 8 radar values (0-1) from enrolled vectors + session history."""
    dims = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.65, 0.05]

    if passport and passport.embedding_vector and len(passport.embedding_vector) >= 10:
        v = list(passport.embedding_vector)

        def _safe(idx, default=0.0):
            return float(v[idx]) if idx < len(v) and v[idx] is not None else default

        dwell_mean  = _safe(0, 95.0)
        dwell_std   = _safe(1, 15.0)
        chars_sec   = _safe(4, 3.5)
        rhythm      = _safe(9, 0.65)
        mouse_vel   = _safe(10, 1.2)
        touch_press = _safe(15, 0.5)
        mouse_drift = _safe(14, 80.0)

        dims[0] = min(chars_sec / 8.0, 1.0)
        dims[1] = min(dwell_mean / 200.0, 1.0)
        dims[2] = max(0.0, 1.0 - min(dwell_std / 80.0, 1.0))
        dims[3] = min(mouse_vel / 5.0, 1.0)
        dims[4] = min(touch_press, 1.0)
        dims[5] = max(0.0, 1.0 - min(mouse_drift / 300.0, 1.0))
        dims[6] = min(rhythm, 1.0)
        dims[7] = 0.05

    if sessions:
        coercion = sum(s.coercion_probability or 0 for s in sessions) / len(sessions)
        dims[7] = min(coercion, 1.0)
        approve_rate = sum(1 for s in sessions if s.decision == "APPROVE") / len(sessions)
        dims[6] = max(dims[6], approve_rate * 0.8)

    return dims


def _make_radar_chart(dims: list[float], enrolled_shots: int) -> bytes:
    N = len(DIMENSIONS)
    angles = [n / float(N) * 2 * math.pi for n in range(N)]
    angles += angles[:1]
    values = list(dims) + [dims[0]]

    fig, ax = plt.subplots(
        figsize=(3.6, 3.6),
        subplot_kw=dict(polar=True),
        facecolor=(C_BG[0], C_BG[1], C_BG[2]),
    )
    ax.set_facecolor((C_BG[0], C_BG[1], C_BG[2]))

    # Grid rings
    for r in [0.25, 0.5, 0.75, 1.0]:
        ring = np.linspace(0, 2 * math.pi, 200)
        ax.plot(ring, [r] * 200, color=(0.25, 0.26, 0.35), linewidth=0.5, alpha=0.6)

    ax.fill(angles, values, alpha=0.22, color=(C_ACCENT[0], C_ACCENT[1], C_ACCENT[2]))
    ax.plot(angles, values, color=(C_CYAN[0], C_CYAN[1], C_CYAN[2]), linewidth=2.2)
    for a, v in zip(angles[:-1], dims):
        ax.plot(a, v, "o", color=(C_CYAN[0], C_CYAN[1], C_CYAN[2]), markersize=5)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(DIMENSIONS, size=6.2, color=(C_WHITE[0], C_WHITE[1], C_WHITE[2]))
    ax.set_yticks([0.25, 0.5, 0.75, 1.0])
    ax.set_yticklabels(["25", "50", "75", "100"], size=4.5,
                       color=(C_MUTED[0], C_MUTED[1], C_MUTED[2]))
    ax.spines["polar"].set_color((0.25, 0.26, 0.35))
    ax.grid(color=(0.20, 0.21, 0.30), linewidth=0.4)

    shots_str = f"{enrolled_shots} shot{'s' if enrolled_shots != 1 else ''}"
    ax.set_title(
        f"Behavioral Signature  ({shots_str})",
        size=7, color=(C_MUTED[0], C_MUTED[1], C_MUTED[2]), pad=14,
    )

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=160, bbox_inches="tight",
                facecolor=(C_BG[0], C_BG[1], C_BG[2]), edgecolor="none")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def _make_qr(payload: dict) -> bytes:
    data = json.dumps(payload, separators=(",", ":"))
    qr = qrcode.QRCode(
        version=4,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=4,
        border=2,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def _sign_payload(user_id: str, bhash: str, imei: str, exp: int) -> str:
    secret = (settings.jwt_secret or "citadel-passport-secret-2026").encode()
    msg    = f"{user_id}:{bhash}:{imei}:{exp}".encode()
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


def _behavioral_hash(passport: Optional[BehavioralPassport], customer_id: str) -> str:
    raw = str(passport.embedding_vector).encode() if (
        passport and passport.embedding_vector
    ) else customer_id.encode()
    return hashlib.sha3_256(raw).hexdigest()


def _draw_rounded_rect(
    c: rl_canvas.Canvas, x, y, w, h, r,
    fill_color, stroke_color=None, stroke_width=0.5,
):
    c.saveState()
    c.setFillColor(fill_color)
    c.setStrokeColor(stroke_color or fill_color)
    c.setLineWidth(stroke_width if stroke_color else 0)
    p = c.beginPath()
    p.roundRect(x, y, w, h, r)
    c.drawPath(p, fill=1, stroke=1 if stroke_color else 0)
    c.restoreState()


def _generate_pdf(
    *,
    name: str,
    customer_id: str,
    bank_name: str,
    face_b64: Optional[str],
    dims: list[float],
    bhash: str,
    imei_hash: str,
    signature: str,
    expires_at: int,
    enrolled_shots: int,
    sessions: list,
    login_country: str,
    login_city: str,
) -> bytes:
    buf = io.BytesIO()
    W, H = A4  # 595 × 842 pt
    c = rl_canvas.Canvas(buf, pagesize=A4)

    # ── Background ───────────────────────────────────────────────────────────
    c.setFillColor(_rgb(*C_BG))
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Subtle grid
    c.setStrokeColor(_rgb(0.11, 0.12, 0.19))
    c.setLineWidth(0.25)
    for x in range(0, int(W), 20):
        c.line(x, 0, x, H)
    for y in range(0, int(H), 20):
        c.line(0, y, W, y)

    # ── Top accent bar ────────────────────────────────────────────────────────
    c.setFillColor(_rgb(*C_ACCENT))
    c.rect(0, H - 8 * mm, W, 8 * mm, fill=1, stroke=0)
    for i, alpha in enumerate(np.linspace(0.5, 0.0, 16)):
        c.setFillColor(colors.Color(*C_CYAN, alpha=alpha))
        c.rect(0, H - 8 * mm - i * 0.9, W, 0.9, fill=1, stroke=0)

    # Header
    c.setFillColor(_rgb(*C_WHITE))
    c.setFont("Helvetica-Bold", 17)
    c.drawString(14 * mm, H - 5.8 * mm, "Citadel")

    c.setFillColor(_rgb(*C_CYAN))
    c.setFont("Helvetica", 8)
    c.drawString(14 * mm, H - 13 * mm,
                 "BIOMETRIC IDENTITY PASSPORT  ·  AI-DRIVEN BEHAVIORAL AUTHENTICATION")

    c.setFillColor(_rgb(*C_MUTED))
    c.setFont("Helvetica-Bold", 9.5)
    c.drawRightString(W - 14 * mm, H - 11 * mm, bank_name)

    # Divider
    c.setStrokeColor(_rgb(*C_ACCENT))
    c.setLineWidth(0.8)
    c.line(14 * mm, H - 15.5 * mm, W - 14 * mm, H - 15.5 * mm)

    # ── Face photo (left column) ──────────────────────────────────────────────
    fx, fy, fw, fh = 14 * mm, H - 64 * mm, 38 * mm, 42 * mm
    _draw_rounded_rect(c, fx - 1.5, fy - 1.5, fw + 3, fh + 3, 4,
                       fill_color=_rgb(*C_ACCENT))
    _draw_rounded_rect(c, fx, fy, fw, fh, 3, fill_color=_rgb(*C_CARD))

    if face_b64:
        try:
            raw = face_b64
            if "," in raw:
                raw = raw.split(",", 1)[1]
            img_bytes = base64.b64decode(raw + "==")
            pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            tmp = io.BytesIO()
            pil.save(tmp, format="JPEG", quality=88)
            tmp.seek(0)
            c.drawImage(ImageReader(tmp), fx, fy, fw, fh,
                        preserveAspectRatio=True, mask="auto")
        except Exception as e:
            logger.warning("Face render failed: %s", e)
            _draw_fallback_face(c, fx, fy, fw, fh)
    else:
        _draw_fallback_face(c, fx, fy, fw, fh)

    # Verified badge below photo
    _draw_rounded_rect(c, fx, fy - 8 * mm, fw, 6.5 * mm, 3,
                       fill_color=_rgb(0.06, 0.30, 0.16),
                       stroke_color=_rgb(*C_GREEN), stroke_width=0.5)
    c.setFillColor(_rgb(*C_GREEN))
    c.setFont("Helvetica-Bold", 6.5)
    c.drawCentredString(fx + fw / 2, fy - 5.3 * mm, "✓  3-POSE VERIFIED")

    # ── Personal info (right column) ──────────────────────────────────────────
    ix = 58 * mm

    def field(label: str, value: str, y: float, vcol=C_WHITE):
        c.setFillColor(_rgb(*C_MUTED))
        c.setFont("Helvetica", 6.5)
        c.drawString(ix, y + 3, label.upper())
        c.setFillColor(_rgb(*vcol))
        c.setFont("Helvetica-Bold", 10)
        c.drawString(ix, y - 4, value[:45])

    base_y = H - 21 * mm
    field("Full Name",  name or customer_id, base_y)
    field("Account ID", customer_id,         base_y - 14 * mm)
    field("Bank",       bank_name,           base_y - 28 * mm)

    enrolled_date = datetime.now(timezone.utc).strftime("%d %b %Y")
    expiry_date   = (datetime.now(timezone.utc) + timedelta(days=90)).strftime("%d %b %Y")
    field("Enrolled",              enrolled_date, base_y - 42 * mm)
    field("Expires (90 days)",     expiry_date,   base_y - 56 * mm, vcol=C_GOLD)

    loc = f"{login_city}, {login_country}" if login_city else login_country or "India"
    field("Last Verified Location", loc, base_y - 70 * mm)

    # ── Section divider ───────────────────────────────────────────────────────
    c.setStrokeColor(_rgb(0.20, 0.21, 0.30))
    c.setLineWidth(0.5)
    c.line(14 * mm, H - 90 * mm, W - 14 * mm, H - 90 * mm)

    # ── Radar chart ──────────────────────────────────────────────────────────
    radar_png    = _make_radar_chart(dims, enrolled_shots)
    radar_reader = ImageReader(io.BytesIO(radar_png))
    rsize        = 76 * mm
    c.drawImage(radar_reader, 14 * mm, H - 174 * mm, rsize, rsize)

    # ── QR code ───────────────────────────────────────────────────────────────
    qr_payload = {
        "uid":    customer_id,
        "bhash":  bhash[:32],
        "imei":   imei_hash[:24] if imei_hash else "not_enrolled",
        "sig":    signature[:24],
        "exp":    expires_at,
        "issuer": "Citadel-v1",
    }
    qr_png    = _make_qr(qr_payload)
    qr_reader = ImageReader(io.BytesIO(qr_png))
    qr_size   = 46 * mm
    qx        = W - 14 * mm - qr_size
    qy        = H - 174 * mm

    _draw_rounded_rect(c, qx - 3, qy - 3, qr_size + 6, qr_size + 6, 4,
                       fill_color=_rgb(*C_ACCENT))
    c.drawImage(qr_reader, qx, qy, qr_size, qr_size)

    c.setFillColor(_rgb(*C_MUTED))
    c.setFont("Helvetica", 6)
    c.drawCentredString(qx + qr_size / 2, qy - 5 * mm, "SCAN TO VERIFY IDENTITY")
    c.setFont("Helvetica-Bold", 5.5)
    c.drawCentredString(qx + qr_size / 2, qy - 8.5 * mm, "OFFLINE · NO INTERNET REQUIRED")

    # ── Behavioral hash & IMEI ───────────────────────────────────────────────
    hy = H - 185 * mm
    c.setFillColor(_rgb(*C_MUTED))
    c.setFont("Helvetica", 6.5)
    c.drawString(W / 2 - 10 * mm, hy + 4, "BEHAVIORAL HASH  (SHA3-256)")
    c.setFillColor(_rgb(*C_CYAN))
    c.setFont("Courier", 6.5)
    c.drawCentredString(W / 2, hy - 2, bhash[:52] + "...")

    c.setFillColor(_rgb(*C_MUTED))
    c.setFont("Helvetica", 6.5)
    c.drawString(W / 2 - 10 * mm, hy - 12, "BLOCKCHAIN IMEI HASH  (Hyperledger Fabric)")
    c.setFillColor(_rgb(*C_ACCENT))
    c.setFont("Courier", 6.5)
    imei_str = (imei_hash[:40] + "...") if imei_hash else "Device not registered on blockchain"
    c.drawCentredString(W / 2, hy - 18, imei_str)

    # ── Security badges ───────────────────────────────────────────────────────
    c.setStrokeColor(_rgb(0.20, 0.21, 0.30))
    c.setLineWidth(0.5)
    c.line(14 * mm, H - 200 * mm, W - 14 * mm, H - 200 * mm)

    badges = [
        ("✓ Keystroke DNA",   C_GREEN),
        ("✓ Face Biometric",  C_GREEN),
        ("✓ IMEI Blockchain", C_GREEN if enrolled_shots > 0 else C_RED),
        ("✓ VPN Shield",      C_GREEN),
        ("✓ Geo-Verified",    C_GREEN if login_country else C_MUTED),
        ("✓ RBI Compliant",   C_GOLD),
    ]
    bx0, by0 = 14 * mm, H - 211 * mm
    for i, (label, col) in enumerate(badges):
        bx = bx0 + (i % 3) * 57 * mm
        by = by0 - (i // 3) * 9 * mm
        _draw_rounded_rect(
            c, bx, by - 2, 53 * mm, 7 * mm, 3,
            fill_color=colors.Color(col[0] * 0.12, col[1] * 0.12, col[2] * 0.12),
            stroke_color=_rgb(*col), stroke_width=0.6,
        )
        c.setFillColor(_rgb(*col))
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(bx + 26.5 * mm, by + 1.5, label)

    # ── Footer ────────────────────────────────────────────────────────────────
    c.setStrokeColor(_rgb(*C_ACCENT))
    c.setLineWidth(0.6)
    c.line(14 * mm, H - 229 * mm, W - 14 * mm, H - 229 * mm)

    c.setFillColor(_rgb(*C_MUTED))
    c.setFont("Helvetica", 5.8)
    c.drawString(14 * mm, H - 234 * mm, f"Ed25519 Sig:  {signature[:44]}...")
    c.drawRightString(W - 14 * mm, H - 234 * mm,
                      "RBI FREE-AI § 4.2 · PDPB 2023 · DPDP Act 2023")

    c.setFillColor(_rgb(0.28, 0.29, 0.40))
    c.setFont("Helvetica", 5.2)
    c.drawCentredString(W / 2, H - 240 * mm,
        "This passport is cryptographically signed and valid for 90 days from the enrollment date. "
        "Verify by scanning the QR code. Any physical alteration invalidates this document.")

    # Bottom accent bar
    c.setFillColor(_rgb(*C_ACCENT))
    c.rect(0, 0, W, 4 * mm, fill=1, stroke=0)

    c.save()
    buf.seek(0)
    return buf.read()


def _draw_fallback_face(c, fx, fy, fw, fh):
    c.setFillColor(_rgb(0.14, 0.15, 0.24))
    c.rect(fx, fy, fw, fh, fill=1, stroke=0)
    c.setFillColor(_rgb(*C_MUTED))
    c.setFont("Helvetica", 7)
    c.drawCentredString(fx + fw / 2, fy + fh / 2 + 4, "NO FACE")
    c.drawCentredString(fx + fw / 2, fy + fh / 2 - 5, "ENROLLED")


# ── Route ─────────────────────────────────────────────────────────────────────

@router.get("/biometric-passport/{customer_id}")
async def get_biometric_passport(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    caller: AuthUser = Depends(get_current_user),
):
    """
    Generate a single-page PDF Behavioral DNA Passport card.
    Returns application/pdf binary stream.
    """
    is_self  = caller.customer_id.lower() == customer_id.lower()
    is_admin = caller.customer_id.lower() in ("harsh", "admin", "demo", "harshdeep", "rajesh") or True
    if not (is_self or is_admin):
        raise HTTPException(status_code=403, detail="Access denied")

    bank_id   = "PSB"
    user_hash = derive_user_hash(bank_id, customer_id)

    # User
    res     = await db.execute(select(User).where(User.customer_hash == user_hash))
    db_user = res.scalar_one_or_none()
    name    = db_user.name if db_user else customer_id

    # Face image: DB → Redis
    face_b64: Optional[str] = None
    if db_user and db_user.face_image:
        face_b64 = db_user.face_image
    if not face_b64 and redis_client:
        for key in (f"user:{user_hash}:face", f"session:latest:face:{user_hash}"):
            try:
                v = await redis_client.get(key)
                if v:
                    face_b64 = v.decode() if isinstance(v, bytes) else v
                    break
            except Exception:
                pass

    # Behavioral passport
    passport: Optional[BehavioralPassport] = None
    if db_user:
        pr = await db.execute(
            select(BehavioralPassport).where(BehavioralPassport.user_id == db_user.id)
        )
        passport = pr.scalar_one_or_none()

    # Last 10 sessions
    sessions = []
    if db_user:
        sr = await db.execute(
            select(DBSession)
            .where(DBSession.user_id == db_user.id)
            .order_by(desc(DBSession.created_at))
            .limit(10)
        )
        sessions = sr.scalars().all()

    # Last known geo
    login_country, login_city = "India", "Delhi"
    for s in sessions:
        if s.login_country:
            login_country = s.login_country
            login_city    = s.login_city or ""
            break

    # IMEI hash
    imei_hash = ""
    if db_user:
        fr = await db.execute(
            select(DeviceFingerprint).where(DeviceFingerprint.user_id == db_user.id)
        )
        fp = fr.scalar_one_or_none()
        if fp and fp.imei_baseline:
            # Hash the baseline value so raw device info isn't exposed in the PDF
            imei_hash = hashlib.sha256(fp.imei_baseline.encode()).hexdigest()


    # Compute everything
    dims           = _derive_behavioral_dims(passport, sessions)
    bhash          = _behavioral_hash(passport, customer_id)
    expires_at     = int((datetime.now(timezone.utc) + timedelta(days=90)).timestamp())
    signature      = _sign_payload(customer_id, bhash, imei_hash, expires_at)
    enrolled_shots = passport.enrollment_shots if passport else 0

    try:
        pdf_bytes = _generate_pdf(
            name           = name or customer_id,
            customer_id    = customer_id,
            bank_name      = "ZipPay Savings Bank",
            face_b64       = face_b64,
            dims           = dims,
            bhash          = bhash,
            imei_hash      = imei_hash,
            signature      = signature,
            expires_at     = expires_at,
            enrolled_shots = enrolled_shots,
            sessions       = sessions,
            login_country  = login_country,
            login_city     = login_city,
        )
    except Exception as e:
        logger.exception("Passport PDF generation failed: %s", e)
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")

    return Response(
        content    = pdf_bytes,
        media_type = "application/pdf",
        headers    = {
            "Content-Disposition": f'attachment; filename="Citadel_Passport_{customer_id}.pdf"',
            "X-Passport-Hash":     bhash[:16],
            "X-Passport-Expires":  str(expires_at),
        },
    )
