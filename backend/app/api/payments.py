import logging
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.config import settings
from app.core.security import AuthUser, get_current_user
from app.core.database import get_db
from app.models.db_models import QRScan, User
from app.services.qr_scanner_service import scan_qr_code

logger = logging.getLogger(__name__)
router = APIRouter()


class OrderRequest(BaseModel):
    amount: int  # Amount in whole rupees


class QRScanRequest(BaseModel):
    upi_url: str            # Full decoded QR content (upi:// or HTTP URL)
    qr_image_b64: Optional[str] = None   # Base64 PNG thumbnail of the QR image


class PaymentOutcomeRequest(BaseModel):
    scan_id: str
    payment_attempted: bool
    payment_blocked: bool


@router.post("/create-order")
async def create_razorpay_order(
    request: OrderRequest,
    caller: AuthUser = Depends(get_current_user),
):
    """Create a Razorpay order required for checkout in test mode."""
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise HTTPException(status_code=500, detail="Razorpay keys not configured")
        
    auth = (settings.razorpay_key_id, settings.razorpay_key_secret)
    # Razorpay expects amount in smaller units (paise)
    payload = {
        "amount": request.amount * 100,
        "currency": "INR",
        "receipt": f"rcpt_{caller.customer_id[:8]}"
    }
    
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                "https://api.razorpay.com/v1/orders",
                json=payload,
                auth=auth
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(f"Razorpay order failed: {exc.response.text}")
        raise HTTPException(status_code=exc.response.status_code, detail="Failed to create Razorpay order")
    except Exception as exc:
        logger.error(f"Razorpay order error: {exc}")
        raise HTTPException(status_code=503, detail="Payment gateway unavailable")


@router.post("/scan-qr")
async def scan_upi_qr_code(
    request: QRScanRequest,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Scan a decoded UPI QR code for fraud using VirusTotal + heuristics.

    Flow:
    1. Parse UPI URL → extract VPA, domain, amount
    2. Check heuristics (scheme, handle whitelist, suspicious keywords)
    3. Scan domain via VirusTotal API v3 (70+ engines)
    4. Persist scan record to DB (with QR thumbnail for admin review)
    5. Return verdict: SAFE | SUSPICIOUS | MALICIOUS
    """
    if not request.upi_url or not request.upi_url.strip():
        raise HTTPException(status_code=400, detail="upi_url is required")

    # Run the scan
    scan_result = await scan_qr_code(request.upi_url)

    # Fetch user details for audit trail
    customer_name = caller.customer_id  # fallback
    try:
        user_result = await db.execute(select(User).where(User.customer_id == caller.customer_id))
        user_obj = user_result.scalar_one_or_none()
        if user_obj and user_obj.name:
            customer_name = user_obj.name
    except Exception as exc:
        logger.warning("Could not fetch user name for QR scan audit: %s", exc)

    # Persist to database
    db_scan = QRScan(
        customer_id=caller.customer_id,
        customer_name=customer_name,
        upi_url=request.upi_url[:2000],        # truncate for safety
        vpa=scan_result.vpa,
        vpa_handle=scan_result.vpa_handle,
        vpa_domain=scan_result.vpa_domain,
        payee_name=scan_result.payee_name,
        amount=scan_result.amount,
        verdict=scan_result.verdict,
        risk_score=scan_result.risk_score,
        flags=scan_result.flags,
        scan_source=scan_result.scan_source,
        vt_stats=scan_result.vt_stats,
        vt_scan_id=scan_result.vt_scan_id,
        vt_permalink=scan_result.vt_permalink,
        qr_image_b64=request.qr_image_b64,     # store thumbnail for admin view
        payment_blocked=(scan_result.verdict == "MALICIOUS"),
    )

    try:
        db.add(db_scan)
        await db.commit()
        await db.refresh(db_scan)
        scan_db_id = str(db_scan.id)
    except Exception as exc:
        logger.error("Failed to persist QR scan to DB: %s", exc)
        await db.rollback()
        scan_db_id = ""

    response = {
        "scan_id": scan_db_id,
        "verdict": scan_result.verdict,
        "risk_score": scan_result.risk_score,
        "vpa": scan_result.vpa,
        "vpa_handle": scan_result.vpa_handle,
        "payee_name": scan_result.payee_name,
        "amount": scan_result.amount,
        "flags": scan_result.flags,
        "vt_stats": scan_result.vt_stats,
        "vt_permalink": scan_result.vt_permalink,
        "scan_source": scan_result.scan_source,
        "payment_blocked": scan_result.verdict == "MALICIOUS",
    }

    logger.info(
        "QR scan API: user=%s vpa=%s verdict=%s risk=%d",
        caller.customer_id, scan_result.vpa, scan_result.verdict, scan_result.risk_score,
    )

    return response


@router.post("/scan-qr/{scan_id}/outcome")
async def update_qr_payment_outcome(
    scan_id: str,
    request: PaymentOutcomeRequest,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a QR scan record with the final payment outcome (did user pay?)."""
    try:
        import uuid as _uuid
        result = await db.execute(select(QRScan).where(QRScan.id == _uuid.UUID(scan_id)))
        scan = result.scalar_one_or_none()
        if scan and scan.customer_id == caller.customer_id:
            scan.payment_attempted = request.payment_attempted
            scan.payment_blocked = request.payment_blocked
            await db.commit()
    except Exception as exc:
        logger.warning("Failed to update QR scan outcome: %s", exc)

    return {"ok": True}


@router.get("/qr-scans")
async def list_qr_scans(
    limit: int = 50,
    caller: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin endpoint — list all QR code scan records, newest first.
    Includes QR thumbnail image and full audit details.
    """
    try:
        result = await db.execute(
            select(QRScan).order_by(desc(QRScan.created_at)).limit(min(limit, 200))
        )
        scans = result.scalars().all()

        return {
            "scans": [
                {
                    "id": str(s.id),
                    "customer_id": s.customer_id,
                    "customer_name": s.customer_name,
                    "vpa": s.vpa,
                    "vpa_handle": s.vpa_handle,
                    "payee_name": s.payee_name,
                    "amount": s.amount,
                    "verdict": s.verdict,
                    "risk_score": s.risk_score,
                    "flags": s.flags or [],
                    "scan_source": s.scan_source,
                    "vt_stats": s.vt_stats or {},
                    "vt_permalink": s.vt_permalink,
                    "qr_image_b64": s.qr_image_b64,
                    "payment_attempted": s.payment_attempted,
                    "payment_blocked": s.payment_blocked,
                    "created_at": s.created_at.isoformat() if s.created_at else "",
                }
                for s in scans
            ],
            "total": len(scans),
        }
    except Exception as exc:
        logger.error("Failed to fetch QR scan list: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to fetch QR scan records")
