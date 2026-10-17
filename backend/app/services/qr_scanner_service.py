"""
Citadel — QR Code Fraud Scanner Service

Detects fake/malicious UPI QR codes by:
1. Parsing the decoded UPI URL string (upi://pay?pa=vpa&...)
2. Checking the UPI VPA handle domain against a known-safe whitelist
3. Scanning the domain URL via VirusTotal API v3 (70+ antivirus engines)
4. Returning a structured verdict: SAFE / SUSPICIOUS / MALICIOUS

Free tier: VirusTotal (4 req/min, 500/day — sufficient for demo)
"""
import logging
import base64
from dataclasses import dataclass, field
from urllib.parse import urlparse, parse_qs

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Known-safe UPI VPA handle domains ────────────────────────────────────────
# These are official PSP (Payment Service Provider) domains used by NPCI-authorized UPI apps
SAFE_UPI_HANDLES = {
    # PhonePe
    "ybl", "ibl", "axl",
    # Google Pay
    "okicici", "oksbi", "okhdfc", "okhdfcbank", "okaxis",
    # Paytm
    "paytm",
    # Amazon Pay
    "apl",
    # BHIM
    "upi",
    # Bank-specific
    "sbi", "icici", "hdfc", "axis", "kotak", "pnb", "bob", "canara",
    "idbi", "indusind", "rbl", "federal", "yes", "bandhan",
    # Popular wallets
    "freecharge", "mobikwik", "airtel",
    # ZipPay (demo bank)
    "zippay",
}

# ── Suspicious patterns in UPI URLs ──────────────────────────────────────────
SUSPICIOUS_PATTERNS = [
    "ngrok", "localhost", "127.0.0.1", "0.0.0.0",
    "free", "prize", "winner", "lottery", "reward", "bonus",
    "verify", "kyc", "refund", "cashback-offer",
]


@dataclass
class QRScanResult:
    """Structured result of a QR code fraud scan."""
    upi_url: str
    vpa: str = ""               # Full UPI VPA e.g. merchant@paytm
    vpa_handle: str = ""        # Handle after @, e.g. paytm
    vpa_domain: str = ""        # Resolved domain for VT scan, e.g. paytm.com
    payee_name: str = ""        # &pn= field from UPI URL
    amount: str = ""            # &am= field from UPI URL
    verdict: str = "UNKNOWN"    # SAFE | SUSPICIOUS | MALICIOUS
    risk_score: int = 0         # 0–100
    flags: list = field(default_factory=list)   # Human-readable warnings
    vt_stats: dict = field(default_factory=dict)    # VirusTotal engine stats
    vt_scan_id: str = ""        # VT scan ID for audit trail
    vt_permalink: str = ""      # VT report URL
    scan_source: str = "virustotal"  # virustotal | heuristic | whitelist
    error: str = ""


def _extract_upi_fields(upi_url: str) -> dict:
    """
    Parse a UPI deep-link URL and extract key fields.
    Handles both: upi://pay?pa=... and upi://pay/?pa=...
    Also handles raw VPA strings like 'merchant@paytm'
    """
    result = {
        "pa": "",   # Payee address (VPA)
        "pn": "",   # Payee name
        "am": "",   # Amount
        "cu": "",   # Currency
        "tn": "",   # Transaction note
        "mc": "",   # Merchant code
    }

    url = upi_url.strip()

    # Handle raw VPA (no scheme)
    if "@" in url and not url.startswith("upi://") and not url.startswith("http"):
        result["pa"] = url
        return result

    # Handle upi:// scheme
    if url.startswith("upi://"):
        try:
            parsed = urlparse(url)
            params = parse_qs(parsed.query)
            for key in result:
                vals = params.get(key, [])
                result[key] = vals[0] if vals else ""
        except Exception as exc:
            logger.warning("Failed to parse UPI URL '%s': %s", url, exc)

    # Handle plain HTTP/HTTPS links (sometimes QR codes embed these)
    elif url.startswith("http"):
        try:
            parsed = urlparse(url)
            params = parse_qs(parsed.query)
            for key in result:
                vals = params.get(key, [])
                result[key] = vals[0] if vals else ""
            # If no pa, use the domain itself
            if not result["pa"]:
                result["pa"] = f"unknown@{parsed.netloc}"
        except Exception as exc:
            logger.warning("Failed to parse HTTP URL '%s': %s", url, exc)

    return result


def _check_heuristics(vpa: str, upi_url: str) -> tuple[str, list[str], int]:
    """
    Apply rule-based heuristics to quickly flag obvious fraud before VT scan.
    Returns (preliminary_verdict, flags, risk_score_contribution).
    """
    flags = []
    risk = 0

    url_lower = upi_url.lower()

    # 1. Non-UPI scheme (HTTP link instead of upi://)
    if upi_url.startswith("http") and "pa=" not in url_lower:
        flags.append("QR encodes HTTP link without UPI payment parameter — likely phishing")
        risk += 60

    # 2. No payee address at all
    if not vpa or "@" not in vpa:
        flags.append("QR code missing valid UPI VPA (payee address)")
        risk += 40

    # 3. Suspicious keywords in URL
    for pattern in SUSPICIOUS_PATTERNS:
        if pattern in url_lower:
            flags.append(f"Suspicious keyword detected in QR data: '{pattern}'")
            risk += 25
            break

    # 4. VPA handle check (only if we have a valid VPA)
    if "@" in vpa:
        handle = vpa.split("@")[-1].lower().strip()
        if handle not in SAFE_UPI_HANDLES:
            flags.append(f"UPI handle '@{handle}' is not from a recognized bank/PSP")
            risk += 30
        else:
            flags.append(f"✓ UPI handle '@{handle}' is a known authorized PSP")

    # 5. Amount is 0 or missing (some QR scams request ₹0 to verify then redirect)
    # Not adding risk for this — just informational

    preliminary_verdict = "SAFE"
    if risk >= 60:
        preliminary_verdict = "MALICIOUS"
    elif risk >= 25:
        preliminary_verdict = "SUSPICIOUS"

    return preliminary_verdict, flags, min(risk, 100)


def _vpa_to_domain(vpa: str) -> str:
    """
    Convert UPI VPA handle to a domain name for VirusTotal lookup.
    'merchant@paytm' → 'paytm.com'
    'user@okicici'   → 'icicibank.com'
    'user@ybl'       → 'phonepe.com'
    """
    HANDLE_TO_DOMAIN = {
        "paytm": "paytm.com",
        "ybl": "phonepe.com",
        "ibl": "phonepe.com",
        "axl": "phonepe.com",
        "okicici": "icicibank.com",
        "oksbi": "onlinesbi.com",
        "okhdfcbank": "hdfcbank.com",
        "okhdfc": "hdfcbank.com",
        "okaxis": "axisbank.com",
        "apl": "amazon.in",
        "upi": "bhimupi.org.in",
        "freecharge": "freecharge.in",
        "zippay": "zippay.demo",
    }

    if "@" not in vpa:
        return vpa

    handle = vpa.split("@")[-1].lower().strip()

    if handle in HANDLE_TO_DOMAIN:
        return HANDLE_TO_DOMAIN[handle]

    # Generic mapping: treat handle as domain fragment
    # 'sbi' → 'sbi.co.in', etc.
    bank_tld_map = {
        "sbi": "sbi.co.in", "icici": "icicibank.com", "hdfc": "hdfcbank.com",
        "axis": "axisbank.com", "kotak": "kotak.com", "pnb": "pnb.co.in",
        "bob": "bankofbaroda.in", "canara": "canarabank.in",
    }
    if handle in bank_tld_map:
        return bank_tld_map[handle]

    # Unknown handle — use directly as domain (will be scanned by VT)
    return f"{handle}.com"


async def _scan_domain_virustotal(domain: str) -> dict:
    """
    Submit a domain URL scan to VirusTotal API v3.
    Returns parsed stats dict.
    """
    if not settings.virustotal_api_key:
        logger.warning("VIRUSTOTAL_API_KEY not set — skipping VT scan")
        return {"error": "api_key_not_configured", "stats": {}}

    api_key = settings.virustotal_api_key
    headers = {
        "x-apikey": api_key,
        "Accept": "application/json",
    }

    # VT uses base64url-encoded URL (no padding) as URL ID
    url_to_scan = f"https://{domain}" if not domain.startswith("http") else domain
    url_id = base64.urlsafe_b64encode(url_to_scan.encode()).decode().rstrip("=")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # First try GET to check if URL is already in VT database
            get_resp = await client.get(
                f"https://www.virustotal.com/api/v3/urls/{url_id}",
                headers=headers,
            )

            if get_resp.status_code == 200:
                data = get_resp.json()
                attrs = data.get("data", {}).get("attributes", {})
                stats = attrs.get("last_analysis_stats", {})
                scan_id = data.get("data", {}).get("id", "")
                return {
                    "stats": stats,
                    "scan_id": scan_id,
                    "permalink": f"https://www.virustotal.com/gui/url/{url_id}",
                    "source": "cached",
                }

            # Not found — submit for fresh scan
            scan_resp = await client.post(
                "https://www.virustotal.com/api/v3/urls",
                headers=headers,
                data={"url": url_to_scan},
            )

            if scan_resp.status_code in (200, 201):
                scan_data = scan_resp.json()
                scan_id = scan_data.get("data", {}).get("id", "")

                # Poll once for analysis result (up to 8s)
                import asyncio
                for _ in range(4):
                    await asyncio.sleep(2)
                    analysis_resp = await client.get(
                        f"https://www.virustotal.com/api/v3/analyses/{scan_id}",
                        headers=headers,
                    )
                    if analysis_resp.status_code == 200:
                        analysis = analysis_resp.json()
                        status = analysis.get("data", {}).get("attributes", {}).get("status", "")
                        if status == "completed":
                            stats = analysis.get("data", {}).get("attributes", {}).get("stats", {})
                            return {
                                "stats": stats,
                                "scan_id": scan_id,
                                "permalink": f"https://www.virustotal.com/gui/url/{url_id}",
                                "source": "fresh_scan",
                            }

                # Return partial result if scan didn't complete
                return {
                    "stats": {},
                    "scan_id": scan_id,
                    "permalink": f"https://www.virustotal.com/gui/url/{url_id}",
                    "source": "scan_pending",
                    "note": "Scan submitted but not yet complete",
                }

            logger.error("VirusTotal scan submission failed: %d %s", scan_resp.status_code, scan_resp.text[:200])
            return {"error": f"vt_api_error_{scan_resp.status_code}", "stats": {}}

    except httpx.TimeoutException:
        logger.warning("VirusTotal API timeout for domain: %s", domain)
        return {"error": "timeout", "stats": {}}
    except Exception as exc:
        logger.error("VirusTotal API error for %s: %s", domain, exc)
        return {"error": str(exc), "stats": {}}


def _compute_final_verdict(
    heuristic_verdict: str,
    heuristic_risk: int,
    vt_result: dict,
    flags: list[str],
) -> tuple[str, int, list[str]]:
    """
    Combine heuristic results + VirusTotal stats into a final verdict.
    """
    stats = vt_result.get("stats", {})
    malicious_count = stats.get("malicious", 0)
    suspicious_count = stats.get("suspicious", 0)
    harmless_count = stats.get("harmless", 0)
    total_engines = malicious_count + suspicious_count + harmless_count + stats.get("undetected", 0)

    vt_risk = 0

    if malicious_count > 0:
        flags.append(f"🔴 VirusTotal: {malicious_count}/{total_engines} engines flagged as MALICIOUS")
        vt_risk += min(malicious_count * 15, 70)
    if suspicious_count > 0:
        flags.append(f"🟡 VirusTotal: {suspicious_count}/{total_engines} engines flagged as SUSPICIOUS")
        vt_risk += min(suspicious_count * 8, 30)
    if harmless_count > 0 and malicious_count == 0 and suspicious_count == 0:
        flags.append(f"✅ VirusTotal: {harmless_count}/{total_engines} engines confirmed safe")

    if vt_result.get("error"):
        flags.append(f"⚠️ VirusTotal scan unavailable: {vt_result['error']}")

    combined_risk = min(heuristic_risk + vt_risk, 100)

    # Final verdict logic
    if malicious_count >= 2 or combined_risk >= 60:
        final_verdict = "MALICIOUS"
    elif malicious_count >= 1 or suspicious_count >= 2 or combined_risk >= 25:
        final_verdict = "SUSPICIOUS"
    elif heuristic_verdict == "MALICIOUS" and not stats:
        # Heuristics say malicious but VT unavailable
        final_verdict = "SUSPICIOUS"
    else:
        final_verdict = "SAFE"

    return final_verdict, combined_risk, flags


async def scan_qr_code(upi_url: str) -> QRScanResult:
    """
    Main entry point — scan a decoded QR code string for fraud.

    Args:
        upi_url: The full decoded QR content (upi:// URL, HTTP URL, or raw VPA)

    Returns:
        QRScanResult with verdict, risk score, flags, and VT details.
    """
    result = QRScanResult(upi_url=upi_url)

    if not upi_url or not upi_url.strip():
        result.verdict = "MALICIOUS"
        result.risk_score = 100
        result.flags = ["QR code contains no data"]
        result.error = "empty_qr"
        return result

    # Step 1: Parse UPI fields
    fields = _extract_upi_fields(upi_url)
    result.vpa = fields.get("pa", "")
    result.payee_name = fields.get("pn", "")
    result.amount = fields.get("am", "")

    if "@" in result.vpa:
        result.vpa_handle = result.vpa.split("@")[-1].lower().strip()
        result.vpa_domain = _vpa_to_domain(result.vpa)

    # Step 2: Apply heuristics
    h_verdict, h_flags, h_risk = _check_heuristics(result.vpa, upi_url)
    flags = h_flags.copy()

    # Step 3: VirusTotal scan (skip for known-safe handles to save API quota)
    vt_result = {}
    if result.vpa_handle in SAFE_UPI_HANDLES and h_verdict == "SAFE":
        # Trusted handle AND no heuristic flags — skip VT scan
        result.verdict = "SAFE"
        result.risk_score = 0
        result.flags = flags
        result.scan_source = "whitelist"
        logger.info("QR scan WHITELIST SAFE: vpa=%s", result.vpa)
        return result

    # Scan the domain
    if result.vpa_domain:
        vt_result = await _scan_domain_virustotal(result.vpa_domain)
        result.vt_stats = vt_result.get("stats", {})
        result.vt_scan_id = vt_result.get("scan_id", "")
        result.vt_permalink = vt_result.get("permalink", "")
        result.scan_source = "virustotal"

    # Step 4: Final verdict
    final_verdict, final_risk, final_flags = _compute_final_verdict(h_verdict, h_risk, vt_result, flags)
    result.verdict = final_verdict
    result.risk_score = final_risk
    result.flags = final_flags

    logger.info(
        "QR scan complete: vpa=%s domain=%s verdict=%s risk=%d vt_malicious=%d",
        result.vpa, result.vpa_domain, result.verdict, result.risk_score,
        result.vt_stats.get("malicious", 0),
    )

    return result
