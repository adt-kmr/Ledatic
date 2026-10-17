from pydantic import BaseModel, Field, ConfigDict
from pydantic.alias_generators import to_camel
from typing import Optional, Any
from enum import Enum
import uuid


class Channel(str, Enum):
    UPI = "upi"
    MOBILE = "mobile_banking"
    INTERNET = "internet_banking"


class Decision(str, Enum):
    APPROVE = "APPROVE"
    STEP_UP = "STEP_UP"
    HARD_BLOCK = "HARD_BLOCK"


class Pathway(str, Enum):
    SMART_CONTRACT = "SMART_CONTRACT"
    COERCION_ENRICHMENT = "COERCION_ENRICHMENT"
    ML_FULL = "ML_FULL"
    FALLBACK = "FALLBACK"  # degraded path when the ML service is unavailable
    ADMIN_BLOCK = "ADMIN_BLOCK"  # fraud-analyst manual block — checked before all other pathways


# ── Signal Ingest ─────────────────────────────────────────────────────
class SignalBundle(BaseModel):
    # Accepts both camelCase from SDK (sessionId) and snake_case internally
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    channel: Channel
    imei_hash: str
    keystroke_events: list[dict[str, Any]] = []
    mouse_events: list[dict[str, Any]] = []
    touch_events: list[dict[str, Any]] = []
    navigation_events: list[dict[str, Any]] = []
    environment: dict[str, Any] = {}
    timestamp_ms: int = 0


class SignalIngestResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    session_id: str
    status: str = "queued"


# ── Auth Evaluate ─────────────────────────────────────────────────────
class EvaluateRequest(BaseModel):
    session_id: str
    user_id: str = ""
    user_hash: str = ""       # SHA-256(bank_id + customer_id) — for Fabric lookup
    imei_hash: str = ""       # current session IMEI hash — for MismatchDetector
    channel: Channel
    transaction_amount: Optional[float] = None
    signal_bundle: Optional[dict] = None  # inline signals (else fetched from Redis)
    face_image: Optional[str] = None      # base64 encoded snapshot
    face_matched: Optional[bool] = None
    no_face_detected: Optional[bool] = None
    password_status: Optional[str] = None
    ip_address: Optional[str] = None


class EvaluateResponse(BaseModel):
    session_id: str
    decision: Decision
    risk_score: int
    pathway: Pathway
    latency_ms: int
    reason: str
    coercion_probability: float = 0.0
    shap_top_features: Optional[list[dict]] = None
    # On-chain (Hyperledger Fabric) verification of the IMEI decision. The Redis
    # cache drives the fast (<80ms) decision; the chain is the source of truth.
    # on_chain_verified=True means the live ledger was consulted and agreed.
    on_chain_verified: bool = False
    on_chain_decision: Optional[str] = None
    on_chain_latency_ms: Optional[int] = None
    # Post-Quantum Cryptography — CRYSTALS-Dilithium-3 (NIST FIPS 204)
    # pqc_verified=True means the Dilithium signature on the enrolled behavioral
    # passport was cryptographically verified against the current session's hash.
    pqc_verified: bool = False
    pqc_algorithm: Optional[str] = None   # "Dilithium-3" when active
    pqc_enrolled: bool = False            # True when user has a PQC-signed passport


# ── Passport ──────────────────────────────────────────────────────────
class PassportChannel(BaseModel):
    channel: Channel
    is_enrolled: bool
    enrollment_shots: int
    updated_at: Optional[str] = None


class PassportResponse(BaseModel):
    user_id: str
    channels: list[PassportChannel]
    total_sessions: int = 0
    last_seen: Optional[str] = None
    recent_decisions: list[dict] = []


# ── Fraud Report ──────────────────────────────────────────────────────
class FraudReportRequest(BaseModel):
    session_id: str
    user_hash: str = ""   # optional blockchain identity for mule/IMEI checks


class FraudReportResponse(BaseModel):
    report_id: str
    session_id: str
    report_text: str
    risk_score: int
    latency_ms: int
    threat_level: Optional[str] = None
    evidence: Optional[list[str]] = None
    recommended_action: Optional[str] = None
    confidence: Optional[float] = None
    session_context: Optional[dict] = None


# ── Duress PIN Emergency Mode ──────────────────────────────────────────

class DuressSetupRequest(BaseModel):
    """Configure or update a user's Duress PIN and emergency contacts."""
    duress_pin: str = Field(..., min_length=4, max_length=20, description="The secondary duress PIN")
    confirm_duress_pin: str = Field(..., description="Must match duress_pin")
    emergency_contact_1_name: str = Field(..., min_length=1, max_length=100)
    emergency_contact_1_phone: str = Field(..., min_length=7, max_length=20)
    emergency_contact_2_name: Optional[str] = None
    emergency_contact_2_phone: Optional[str] = None


class DuressSetupResponse(BaseModel):
    status: str  # "configured" | "updated"
    has_contact_1: bool
    has_contact_2: bool


class DuressActivateRequest(BaseModel):
    """Sent when the user enters their Duress PIN at payment time."""
    duress_pin: str = Field(..., description="PIN entered by user — checked against duress_pin_hash")
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy_m: Optional[float] = None
    device_info: Optional[dict] = None
    # Payment context (for the incident record)
    payment_amount: Optional[float] = None
    payment_recipient: Optional[str] = None


class DuressActivateResponse(BaseModel):
    activated: bool
    incident_id: Optional[str] = None
    cancellation_token: Optional[str] = None  # UUID used to cancel within 30s
    cancellation_expires_in: int = 30          # seconds
    message: str


class DuressCancelRequest(BaseModel):
    """Cancel the emergency within the 30-second biometric window."""
    cancellation_token: str


class LocationUpdateRequest(BaseModel):
    """Live GPS coordinate pushed every 30 seconds by the frontend."""
    incident_id: str
    latitude: float
    longitude: float
    accuracy_m: Optional[float] = None


class EmergencyLocationOut(BaseModel):
    latitude: float
    longitude: float
    timestamp: str
    accuracy_m: Optional[float] = None


class EmergencyIncidentOut(BaseModel):
    incident_id: str
    user_id: str
    user_name: Optional[str] = None
    customer_id: Optional[str] = None
    status: str                      # ACTIVE | RESOLVED | FALSE_ALARM
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timestamp: str
    resolved_at: Optional[str] = None
    device_info: Optional[dict] = None
    contact_1_name: Optional[str] = None
    contact_2_name: Optional[str] = None
    location_timeline: list[EmergencyLocationOut] = []
    maps_url: Optional[str] = None
    risk_priority: str = "HIGH"      # always HIGH for any emergency
    payment_amount: Optional[float] = None
    payment_recipient: Optional[str] = None


class DuressStatusResponse(BaseModel):
    """Quick poll: is there an active emergency for the current user?"""
    has_active: bool
    incident_id: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    activated_at: Optional[str] = None

