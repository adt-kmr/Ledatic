from pydantic_settings import BaseSettings
from pydantic import field_validator, model_validator
from typing import List
import json
import logging
import os

logger = logging.getLogger(__name__)

# Sentinel values that indicate a secret was never actually configured. Any
# secret still set to one of these is treated as "unset".
_SECRET_SENTINELS = {"change-this", "change-this-to-a-secure-jwt-secret",
                     "change-this-to-a-secure-random-64-char-hex-string"}


class Settings(BaseSettings):
    app_name: str = "Citadel"
    app_env: str = "development"
    debug: bool = False
    cors_origins: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors(cls, v):
        if isinstance(v, str):
            # Handle JSON array format from Render: '["a","b"]'
            v = v.strip()
            if v.startswith("["):
                try:
                    return json.loads(v)
                except json.JSONDecodeError:
                    pass
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    # Database
    database_url: str = "postgresql+asyncpg://citadel:citadel_dev@postgres:5432/citadel"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # ML Service — Render's fromService.host gives a bare hostname; ensure protocol.
    ml_service_url: str = "http://ml:8001"

    @field_validator("ml_service_url", mode="after")
    @classmethod
    def _ensure_protocol(cls, v: str) -> str:
        if v and not v.startswith(("http://", "https://")):
            v = "https://" + v
        return v
    ml_risk_threshold_approve: int = 299
    ml_risk_threshold_stepup: int = 599
    ml_risk_threshold_block: int = 600

    # Security
    # Both secrets MUST be set to strong random values in .env. The app refuses
    # to boot if either still holds its placeholder sentinel — there is no safe
    # default for a banking-auth secret. Generate with:
    #   python3 -c "import secrets; print(secrets.token_hex(32))"
    imei_hmac_secret: str = "change-this"
    jwt_secret: str = "change-this"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 1 day — customer session survives refresh until then
    # Admin/analyst tokens are far more sensitive than customer tokens, so they
    # get a much shorter lifetime (re-login enforced sooner).
    jwt_admin_expire_minutes: int = 45

    # Internal service-to-service token. The ML service (:8001) requires this
    # header (X-Internal-Token) on /score, /enroll, /score-transaction(s).
    # Empty in dev → ML service allows through with a warning.
    internal_api_token: str = ""

    # AI — Groq (primary) + Anthropic (fallback)
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "llama-3.3-70b-versatile"
    anthropic_api_key: str = ""

    # Razorpay — set in .env; never inline credentials in this committed file.
    # Empty → payment flows run in simulated mode.
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""

    # VirusTotal — QR Code Fraud Scanner
    virustotal_api_key: str = ""

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    # Public frontend origin for OAuth redirect-mode callbacks. Google's POST to
    # /api/auth/google/callback does not send a trustworthy Referer (it's
    # accounts.google.com), so set this in production instead of inferring it.
    frontend_url: str = ""
    # Where to land the browser after OAuth — must match the SPA route that
    # completes login (ZipPay bank demo).
    frontend_oauth_return_path: str = "/demo/bank"
    # Mock Google OAuth (demo only). Set ALLOW_MOCK_OAUTH=true in .env for hackathon demos.
    allow_mock_oauth: bool = False

    # Fabric
    fabric_peer_endpoint: str = "grpc://localhost:7051"
    fabric_channel_name: str = "citadel-channel"
    fabric_chaincode_name: str = "citadel-cc"
    fabric_msp_id: str = "Org1MSP"
    fabric_tls_cert_path: str = "./blockchain/crypto-config/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem"
    fabric_admin_cert_path: str = "./blockchain/crypto-config/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/signcerts/Admin@org1.example.com-cert.pem"
    fabric_admin_key_path: str = "./blockchain/crypto-config/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/keystore/priv_sk"

    # CAMARA
    camara_api_url: str = "http://localhost:8002/mock"
    camara_mock_enabled: bool = True

    # Notifications (admin block → email/SMS to the customer).
    # Zero-config default = SIMULATED: the exact message is recorded and shown
    # in the panel, but nothing leaves the server. The moment SMTP creds are set
    # (e.g. a Gmail app-password), email sends flip to real; SMS routes through
    # the CAMARA telecom mock (/mock/sms) when camara_mock_enabled. So the
    # feature is genuinely functional, not faked.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""           # From: address; defaults to smtp_user when empty
    notification_sender_name: str = "Citadel Fraud-Ops"

    # Demo accounts — loaded from env var, not hardcoded in source.
    # Format: JSON array of {id, password, name, bank_id} objects.
    demo_accounts_json: str = "[]"

    # Admin/analyst accounts for the FIU fraud-ops panel — separate store from
    # customer demo accounts so a customer can never hold a privileged role.
    # Format: JSON array of {id, password, name, bank_id, role} objects,
    # role ∈ {"admin","analyst"}. Empty by default (no admin access until set).
    admin_accounts_json: str = "[]"

    # Coercion
    coercion_hesitation_threshold_sigma: float = 3.0
    coercion_probability_stepup_threshold: float = 0.65

    # Twilio — set in .env; never inline credentials in this committed file.
    # Empty → WhatsApp/SMS notifications run in simulated mode.
    vite_twilio_account_sid: str = ""
    vite_twilio_auth_token: str = ""
    vite_twilio_from_number: str = ""
    vite_twilio_to_number: str = ""

    # ── Voice MFA (Vapi) ──────────────────────────────────────────────────
    # Set these in .env — never inline them here; this file is committed.
    #   vapi_private_key   server-side key, authorises outbound calls
    #   vapi_public_key    client/web SDK key (not needed for outbound)
    #   vapi_phone_number_id  the Vapi number calls originate FROM
    #   vapi_webhook_secret   shared secret Vapi signs server events with
    #   vapi_server_url    public URL Vapi posts call results back to
    # With no private key or phone number id the service runs in SIMULATED
    # mode: the full flow works end to end without placing a billable call.
    vapi_private_key: str = ""
    vapi_public_key: str = ""
    vapi_phone_number_id: str = ""
    vapi_webhook_secret: str = ""
    vapi_server_url: str = ""
    vapi_enabled: bool = True
    # Seconds the registration flow waits for a verdict before treating the
    # call as unanswered (step-up rather than block — see voice_mfa service).
    vapi_call_timeout_s: int = 90

    # Duress PIN Emergency Mode
    # Generate with: python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # If empty, contact data is base64-encoded (not encrypted) — set a real key before production.
    duress_encryption_key: str = ""

    # Ethereum Bridge (Sepolia proof registry)
    sepolia_rpc_url: str = ""
    sepolia_private_key: str = ""
    proof_registry_address: str = ""
    ethereum_bridge_enabled: bool = False
    batch_interval_seconds: int = 300

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"

    @model_validator(mode="after")
    def _validate_secrets(self):
        """Fail fast on placeholder secrets in production; auto-generate fallback in dev.

        Dev-generated secrets are persisted to a gitignored .dev_secrets.json so
        a restart does not rotate them. Rotating IMEI_HMAC_SECRET orphans every
        registered user (their unique customer_hash stops matching) and rotating
        JWT_SECRET invalidates every outstanding session — both used to happen
        on every boot, which is why "registered yesterday, can't log in today".
        """
        import secrets
        insecure = []

        def _dev_secret(name: str) -> str:
            path = os.path.join(os.path.dirname(__file__), "..", "..", ".dev_secrets.json")
            path = os.path.abspath(path)
            store = {}
            try:
                with open(path, "r", encoding="utf-8") as f:
                    store = json.load(f)
            except (OSError, json.JSONDecodeError):
                pass
            if not store.get(name):
                store[name] = secrets.token_hex(32)
                try:
                    with open(path, "w", encoding="utf-8") as f:
                        json.dump(store, f, indent=2)
                except OSError:
                    logger.warning("Could not persist %s to %s — it will rotate on restart", name, path)
            return store[name]

        if self.jwt_secret in _SECRET_SENTINELS or self.jwt_secret.startswith("change-this"):
            insecure.append("JWT_SECRET")
            if self.app_env != "production":
                self.jwt_secret = _dev_secret("JWT_SECRET")
        if self.imei_hmac_secret in _SECRET_SENTINELS or self.imei_hmac_secret.startswith("change-this"):
            insecure.append("IMEI_HMAC_SECRET")
            if self.app_env != "production":
                self.imei_hmac_secret = _dev_secret("IMEI_HMAC_SECRET")

        if insecure and self.app_env == "production":
            msg = (f"FATAL: {', '.join(insecure)} still set to a placeholder. "
                   f"Generate a strong value: python3 -c \"import secrets; print(secrets.token_hex(32))\"")
            raise RuntimeError(msg)

        # Mock OAuth: disabled in production unless explicitly enabled; auto-on in dev
        # when ALLOW_MOCK_OAUTH is unset (hackathon demo Google sign-in).
        if "ALLOW_MOCK_OAUTH" not in os.environ and self.app_env != "production":
            self.allow_mock_oauth = True

        return self



settings = Settings()
