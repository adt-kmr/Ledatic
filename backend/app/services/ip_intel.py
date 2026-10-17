"""
Citadel — IP Intelligence & VPN Detection Service

Performs real-time IP geolocation and VPN/proxy/datacenter detection.
Used at registration (to record baseline) and login (to detect anomalies).

Free tier: ip-api.com (150 requests/min, no API key required).
"""
import math
import logging
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── VPN / Datacenter / Hosting ASN and ISP keyword blocklist ─────────────────
VPN_KEYWORDS = [
    # Generic / Common VPN Protocols & Tunnels
    "vpn", "tunnel", "warp", "wireguard", "openvpn", "tailscale", "zerotier", "globalprotect", "anyconnect",
    # VPN Providers
    "nordvpn", "expressvpn", "surfshark", "protonvpn", "mullvad",
    "privateinternetaccess", "cyberghost", "ipvanish", "hotspotshield",
    "tunnelbear", "windscribe", "purevpn", "strongvpn", "astrill",
    "hide.me", "hidemyass", "zenmate", "vpnsecure",
    # Tor
    "tor exit", "tor-exit", "tor relay", "torproject",
    # Datacenters / Cloud hosting used to proxy/mask real IPs
    "digitalocean", "linode", "vultr", "hetzner", "ovh", "contabo",
    "choopa", "psychz", "serverius", "frantech", "buyvm",
    "m247", "datacamp", "quadranet", "sharktech",
    # Proxies / Anonymizers
    "proxy", "anonymizer", "anonymous", "hide my ip",
    "socks", "squid", "privoxy", "luminati", "bright data",
]

HOSTING_KEYWORDS = [
    "amazon", "aws", "google cloud", "microsoft azure", "cloudflare",
    "akamai", "fastly", "incapsula",
]


@dataclass
class IPIntelResult:
    ip: str
    country: str = ""
    country_code: str = ""
    region: str = ""
    city: str = ""
    latitude: float = 0.0
    longitude: float = 0.0
    isp: str = ""
    org: str = ""
    asn: str = ""
    is_vpn: bool = False
    is_hosting: bool = False
    is_tor: bool = False
    vpn_reason: str = ""
    risk_score: int = 0
    geo_distance_km: float = 0.0
    lookup_success: bool = False
    raw: dict = field(default_factory=dict)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance between two lat/lon points in kilometres."""
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _vpn_check(org: str, isp: str, asn_name: str) -> tuple[bool, bool, bool, str]:
    combined = (org + " " + isp + " " + asn_name).lower()
    for kw in VPN_KEYWORDS:
        if kw in combined:
            is_tor = "tor" in kw
            return True, False, is_tor, f"Matched VPN/proxy keyword: '{kw}'"
    for kw in HOSTING_KEYWORDS:
        if kw in combined:
            return False, True, False, f"Matched hosting/cloud keyword: '{kw}'"
    return False, False, False, ""


async def lookup(
    ip: str,
    baseline_lat: Optional[float] = None,
    baseline_lon: Optional[float] = None,
) -> IPIntelResult:
    """
    Perform a full IP intelligence lookup.

    Args:
        ip:            The IP address to analyze.
        baseline_lat:  Registered baseline latitude (for geo distance calculation).
        baseline_lon:  Registered baseline longitude.
    """
    result = IPIntelResult(ip=ip)

    # Skip loopback / private ranges — treat as safe local network
    is_local = False
    if not ip or ip in ("localhost", "::1"):
        is_local = True
    else:
        import ipaddress
        try:
            ip_obj = ipaddress.ip_address(ip)
            if ip_obj.is_private or ip_obj.is_loopback:
                is_local = True
        except ValueError:
            is_local = True

    if is_local:
        result.lookup_success = True
        result.country = "Local"
        result.city = "Localhost"
        result.isp = "Private Network"
        return result

    fields = "status,country,countryCode,region,regionName,city,lat,lon,isp,org,as,query"
    url = f"http://ip-api.com/json/{ip}?fields={fields}"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.warning("ip-api.com returned status %d for IP %s", resp.status_code, ip)
                return result

            data = resp.json()
            result.raw = data

            if data.get("status") != "success":
                logger.warning("ip-api.com failed for IP %s: %s", ip, data.get("message"))
                return result

            result.country = data.get("country", "")
            result.country_code = data.get("countryCode", "")
            result.region = data.get("regionName", "")
            result.city = data.get("city", "")
            result.latitude = data.get("lat", 0.0)
            result.longitude = data.get("lon", 0.0)
            result.isp = data.get("isp", "")
            result.org = data.get("org", "")
            result.asn = data.get("as", "")
            result.lookup_success = True

            # VPN / hosting detection
            is_vpn, is_hosting, is_tor, reason = _vpn_check(result.org, result.isp, result.asn)
            result.is_vpn = is_vpn
            result.is_hosting = is_hosting
            result.is_tor = is_tor
            result.vpn_reason = reason

            # Risk score calculation (0-100)
            score = 0
            if is_vpn or is_tor:
                score += 60
            if is_hosting:
                score += 25
            if baseline_lat is not None and baseline_lon is not None:
                dist = _haversine_km(baseline_lat, baseline_lon, result.latitude, result.longitude)
                result.geo_distance_km = round(dist, 1)
                if dist > 2000:
                    score += 30
                elif dist > 1000:
                    score += 20
                elif dist > 500:
                    score += 10

            result.risk_score = min(score, 100)

    except httpx.TimeoutException:
        logger.warning("ip-api.com timeout for IP %s", ip)
    except Exception as exc:
        logger.warning("IP intel lookup failed for %s: %s", ip, exc)

    return result
