from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, text, func, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy import TIMESTAMP
import uuid

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bank_id       = Column(String, nullable=False)
    customer_hash = Column(String, nullable=False, unique=True)
    customer_id   = Column(String, nullable=True)
    password      = Column(String, nullable=True)
    name          = Column(String, nullable=True)
    face_image    = Column(String, nullable=True)
    created_at    = Column(TIMESTAMP(timezone=True), server_default=func.now())
    
    # Google OAuth fields
    auth_provider = Column(String, nullable=True, server_default=text("'local'"))
    email         = Column(String, nullable=True)
    profile_pic   = Column(String, nullable=True)

    # The customer's OWN number, E.164 (+911234567890), used for voice MFA.
    # Distinct from emergency_contact_*_phone below, which are next-of-kin.
    phone_number  = Column(String, nullable=True)
    upi_id        = Column(String, nullable=True)

    # ── Duress PIN Emergency Mode ──────────────────────────────────────
    duress_pin_hash             = Column(String, nullable=True)
    emergency_contact_1_name    = Column(String, nullable=True)  # encrypted
    emergency_contact_1_phone   = Column(String, nullable=True)  # encrypted
    emergency_contact_2_name    = Column(String, nullable=True)  # encrypted
    emergency_contact_2_phone   = Column(String, nullable=True)  # encrypted

    sessions           = relationship("Session", back_populates="user", lazy="select")
    passports          = relationship("BehavioralPassport", back_populates="user", lazy="select")
    device_fingerprint = relationship("DeviceFingerprint", back_populates="user", uselist=False, lazy="select")
    brq_answer         = relationship("BRQAnswer", back_populates="user", uselist=False, lazy="select")
    emergency_incidents = relationship("EmergencyIncident", back_populates="user", lazy="select")


class BehavioralPassport(Base):
    __tablename__ = "behavioral_passport"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id          = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    channel          = Column(String, nullable=False)
    embedding_vector = Column(ARRAY(Float), nullable=False, server_default=text("'{}'"))
    enrollment_shots = Column(Integer, default=0, nullable=False)
    is_enrolled      = Column(Boolean, default=False, nullable=False)
    updated_at       = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # ── Post-Quantum Cryptography (CRYSTALS-Dilithium-3 / NIST FIPS 204) ──────
    # Columns are nullable — added non-breakingly; existing rows = not enrolled in PQC
    pqc_enrolled        = Column(Boolean, default=False, nullable=False, server_default=text("false"))
    pqc_algorithm       = Column(String, nullable=True)   # "Dilithium-3"
    pqc_public_key      = Column(Text, nullable=True)     # base64 Dilithium-3 public key (~1.3 KB)
    pqc_signature       = Column(Text, nullable=True)     # base64 Dilithium-3 signature (~3.3 KB)
    pqc_behavioral_hash = Column(String, nullable=True)   # hex SHA3-256 of enrolled canonical bundle
    pqc_enrolled_at     = Column(TIMESTAMP(timezone=True), nullable=True)
    pqc_on_chain        = Column(Boolean, default=False, nullable=True)  # True if signature also on Fabric

    user = relationship("User", back_populates="passports")


class Session(Base):
    __tablename__ = "sessions"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id              = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    channel              = Column(String, nullable=False)
    signal_bundle_json   = Column(JSONB)
    risk_score           = Column(Integer)
    decision             = Column(String)
    pathway              = Column(String)
    coercion_probability = Column(Float, default=0.0)
    latency_ms           = Column(Integer)
    face_image           = Column(String, nullable=True)
    created_at           = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # IP Intelligence columns (added for zero-backdoor security layer)
    login_ip             = Column(String, nullable=True)
    login_country        = Column(String, nullable=True)
    login_city           = Column(String, nullable=True)
    vpn_detected         = Column(Boolean, default=False, nullable=True)
    geo_distance_km      = Column(Float, nullable=True)
    ip_risk_score        = Column(Integer, default=0, nullable=True)

    # ── Post-Quantum Cryptography — per-session verification result ──────────
    pqc_verified         = Column(Boolean, default=False, nullable=True)  # True = Dilithium sig verified
    pqc_algorithm        = Column(String, nullable=True)                  # "Dilithium-3"

    user          = relationship("User", back_populates="sessions")
    risk_events   = relationship("RiskEvent", back_populates="session", lazy="select")
    fraud_reports = relationship("FraudReport", back_populates="session", lazy="select")


class RiskEvent(Base):
    __tablename__ = "risk_events"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id       = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    trigger_type     = Column(String, nullable=False)
    score            = Column(Integer)
    pathway          = Column(String)
    shap_explanation = Column(JSONB)
    timestamp        = Column(TIMESTAMP(timezone=True), server_default=func.now())

    session = relationship("Session", back_populates="risk_events")


class ThresholdConfig(Base):
    """Singleton row holding the live-tunable risk thresholds for the FIU panel.

    Absence of the row (fresh DB) means the engine falls back to the static
    settings defaults — so this is purely an override layer, never a hard
    dependency. Edited only via the admin panel (audited).
    """
    __tablename__ = "threshold_config"

    id                        = Column(Integer, primary_key=True, default=1)
    stepup_threshold          = Column(Integer, nullable=False)   # score ≥ this → STEP_UP
    block_threshold           = Column(Integer, nullable=False)   # score ≥ this → HARD_BLOCK
    coercion_stepup_threshold = Column(Float, nullable=False)     # coercion prob ≥ this → STEP_UP
    updated_by                = Column(String)
    updated_at                = Column(TIMESTAMP(timezone=True), server_default=func.now())


class AdminAuditLog(Base):
    """Append-only audit trail of privileged admin actions (governance/compliance)."""
    __tablename__ = "admin_audit_log"

    id       = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor    = Column(String, nullable=False)   # admin_id from the JWT
    action   = Column(String, nullable=False)   # e.g. "update_thresholds"
    target   = Column(String)                   # what was acted on
    before   = Column(JSONB)                     # state before the change
    after    = Column(JSONB)                     # state after the change
    ts       = Column(TIMESTAMP(timezone=True), server_default=func.now())


class FraudReport(Base):
    __tablename__ = "fraud_reports"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id      = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    report_text     = Column(String)
    risk_score      = Column(Integer)
    trigger_signals = Column(JSONB)
    analyst_action  = Column(String)
    created_at      = Column(TIMESTAMP(timezone=True), server_default=func.now())

    session = relationship("Session", back_populates="fraud_reports")


class CustomerBlock(Base):
    """Durable fraud-analyst block on a customer account.

    The DB row is the source of truth (survives Redis flushes); a Redis mirror
    `blocked:{user_hash}` drives the hot /evaluate path so enforcement adds no DB
    round-trip to login. One row per customer_hash (upserted on block/unblock).
    `status` ∈ {"blocked","unblocked"}; the row is kept on unblock so the audit
    trail of *when* it was blocked/unblocked + by whom is preserved.
    """
    __tablename__ = "customer_block"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_hash = Column(String, nullable=False, unique=True)
    status        = Column(String, nullable=False)   # "blocked" | "unblocked"
    reason        = Column(String)                    # sim_swap / coercion / behavioral_anomaly / manual / ...
    message       = Column(String)                    # free-text note the analyst may add
    actor         = Column(String, nullable=False)    # admin_id from the JWT
    created_at    = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at    = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())


class CustomerContact(Base):
    """Optional contact channel for a customer, used by the notify-on-block flow.

    Citadel deliberately stores only a hashed customer_hash for privacy; this
    table holds the analyst-maintained contact (email/phone) so a block can be
    communicated. Editable from the Customer 360 panel; never written to logs.
    One row per customer_hash (upserted).
    """
    __tablename__ = "customer_contact"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_hash = Column(String, nullable=False, unique=True)
    email         = Column(String)
    phone         = Column(String)
    updated_by    = Column(String)
    updated_at    = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())


class Notification(Base):
    """Append-only log of every message sent to a customer from the panel.

    `status` ∈ {"sent","simulated","failed"} — "simulated" is the zero-config
    default (no SMTP/CAMARA creds): the exact message is still recorded and shown
    in the UI, so the demo works with zero setup while real sends flip on the
    moment creds are added. `provider` records which path actually ran.
    """
    __tablename__ = "notification"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_hash = Column(String, nullable=False)
    channel       = Column(String, nullable=False)   # "email" | "sms"
    to_address    = Column(String)                    # the email/phone it went to
    subject       = Column(String)                    # email only
    body          = Column(String, nullable=False)
    reason        = Column(String)                    # the block reason that triggered it
    status        = Column(String, nullable=False)    # sent | simulated | failed
    provider      = Column(String)                    # smtp | camara | simulated | failed
    actor         = Column(String)                    # admin_id that sent it
    created_at    = Column(TIMESTAMP(timezone=True), server_default=func.now())


class DeviceFingerprint(Base):
    """Stores the baseline IP / location / IMEI fingerprint captured at registration."""
    __tablename__ = "device_fingerprints"

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id             = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    registered_ip       = Column(String, nullable=True)
    registered_country  = Column(String, nullable=True)
    registered_city     = Column(String, nullable=True)
    registered_lat      = Column(Float, nullable=True)
    registered_lng      = Column(Float, nullable=True)
    registered_isp      = Column(String, nullable=True)
    registered_asn      = Column(String, nullable=True)
    is_vpn_detected     = Column(Boolean, default=False)
    imei_baseline       = Column(String, nullable=True)
    created_at          = Column(TIMESTAMP(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="device_fingerprint")


class BRQAnswer(Base):
    """Stores Behavioral Registration Questionnaire answers and computed risk profile."""
    __tablename__ = "brq_answers"

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id             = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    answers             = Column(JSONB, nullable=False)
    risk_profile        = Column(String, nullable=True)   # 'low' | 'medium' | 'high'
    risk_score_computed = Column(Integer, default=0)
    created_at          = Column(TIMESTAMP(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="brq_answer")


class EmergencyIncident(Base):
    """
    Duress PIN Emergency Mode — one row per activated emergency.

    STATUS values:
        ACTIVE      — emergency is ongoing, live location updates arriving
        RESOLVED    — bank/admin confirmed the user is safe
        FALSE_ALARM — user cancelled within the 30-second window
    """
    __tablename__ = "emergency_incidents"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    incident_id = Column(String, nullable=False, unique=True)   # human-readable e.g. DURESS-20260715-A3F2
    latitude    = Column(Float, nullable=True)
    longitude   = Column(Float, nullable=True)
    timestamp   = Column(TIMESTAMP(timezone=True), server_default=func.now())
    status      = Column(String, nullable=False, default="ACTIVE")  # ACTIVE | RESOLVED | FALSE_ALARM
    device_info = Column(JSONB, nullable=True)
    resolved_at = Column(TIMESTAMP(timezone=True), nullable=True)
    # Store encrypted; contacts are decrypted only by the service layer
    contact_1_name  = Column(String, nullable=True)
    contact_2_name  = Column(String, nullable=True)
    cancellation_token = Column(String, nullable=True)  # 30-second cancel UUID
    payment_amount = Column(Float, nullable=True)       # Held funds simulation
    payment_recipient = Column(String, nullable=True)    # Target recipient/attacker

    user             = relationship("User", back_populates="emergency_incidents")
    location_updates = relationship("EmergencyLocationUpdate", back_populates="incident", lazy="select")


class EmergencyLocationUpdate(Base):
    """Live GPS updates pushed every 30 seconds during an active emergency."""
    __tablename__ = "emergency_location_updates"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    incident_id = Column(String, ForeignKey("emergency_incidents.incident_id", ondelete="CASCADE"), nullable=False)
    latitude    = Column(Float, nullable=False)
    longitude   = Column(Float, nullable=False)
    timestamp   = Column(TIMESTAMP(timezone=True), server_default=func.now())
    accuracy_m  = Column(Float, nullable=True)  # GPS accuracy in metres

    incident = relationship("EmergencyIncident", back_populates="location_updates")


class VoiceMfaVerification(Base):
    """
    One row per voice-MFA attempt (Vapi outbound call at registration).

    The row is created BEFORE the call is placed, so a provider outage still
    leaves an auditable record rather than a silent gap.

    For all three answers, TRUE is the safe response:
        q1_registered     — "did you just register?"      FALSE ⇒ identity theft
        q2_not_coerced    — "acting on your own?"          FALSE ⇒ coercion
        q3_location_match — "are you in <city>?"           FALSE ⇒ geo mismatch
    NULL means the question was never reached (call dropped, no answer).
    """
    __tablename__ = "voice_mfa_verification"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id       = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    customer_hash = Column(String, nullable=False)
    call_id       = Column(String, unique=True, nullable=True)   # Vapi call id
    phone_number  = Column(String, nullable=True)

    status        = Column(String, nullable=False, default="PENDING")  # PENDING|VERIFIED|FAILED|NO_ANSWER|ERROR

    q1_registered     = Column(Boolean, nullable=True)
    q2_not_coerced    = Column(Boolean, nullable=True)
    q3_location_match = Column(Boolean, nullable=True)

    # 'registration' | 'login'. The login variant asks a device question whose
    # answer is cross-checked against usual_device below.
    purpose      = Column(String, nullable=True, server_default=text("'registration'"))
    # What the SENSORS saw (device fingerprint matched). q3_location_match is
    # what the CALLER said. Storing both is what lets a contradiction verdict
    # be justified after the fact.
    usual_device = Column(Boolean, nullable=True)

    risk_score      = Column(Integer, default=0)
    decision        = Column(String, nullable=True)   # APPROVE | STEP_UP | HARD_BLOCK
    failure_reason  = Column(String, nullable=True)
    transcript      = Column(Text, nullable=True)
    recording_url   = Column(String, nullable=True)
    structured_data = Column(JSONB, nullable=True)
    expected_city   = Column(String, nullable=True)

    created_at   = Column(TIMESTAMP(timezone=True), server_default=func.now())
    completed_at = Column(TIMESTAMP(timezone=True), nullable=True)


class QRScan(Base):
    """
    Stores every QR code fraud scan attempt — displayed in the Admin Portal.

    verdict values: SAFE | SUSPICIOUS | MALICIOUS
    scan_source:    virustotal | heuristic | whitelist
    """
    __tablename__ = "qr_scans"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id         = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    customer_id     = Column(String, nullable=True)     # Human-readable user ID
    customer_name   = Column(String, nullable=True)     # User's display name

    # QR content
    upi_url         = Column(Text, nullable=True)       # Full decoded QR string
    vpa             = Column(String, nullable=True)     # UPI VPA e.g. scammer@fakebank
    vpa_handle      = Column(String, nullable=True)     # e.g. fakebank
    vpa_domain      = Column(String, nullable=True)     # e.g. fakebank.com
    payee_name      = Column(String, nullable=True)     # Merchant name from QR
    amount          = Column(String, nullable=True)     # Amount from QR

    # Scan verdict
    verdict         = Column(String, nullable=False, default="UNKNOWN")  # SAFE | SUSPICIOUS | MALICIOUS
    risk_score      = Column(Integer, default=0)
    flags           = Column(JSONB, nullable=True)          # List of warning strings
    scan_source     = Column(String, nullable=True)         # virustotal | heuristic | whitelist

    # VirusTotal details
    vt_stats        = Column(JSONB, nullable=True)          # {malicious:N, suspicious:N, harmless:N, ...}
    vt_scan_id      = Column(String, nullable=True)
    vt_permalink    = Column(String, nullable=True)

    # QR Image thumbnail (base64-encoded PNG — stored for admin review)
    qr_image_b64    = Column(Text, nullable=True)           # "data:image/png;base64,..."

    # Payment outcome
    payment_attempted = Column(Boolean, default=False)      # Did user proceed to pay?
    payment_blocked   = Column(Boolean, default=False)      # Was payment hard-blocked?

    created_at      = Column(TIMESTAMP(timezone=True), server_default=func.now())
