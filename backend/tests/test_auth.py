"""Tests for backend authentication, JWT, and HMAC identity derivation."""
import hashlib
import hmac
import time
import os
import pytest

from app.core.security import (
    create_access_token,
    decode_token,
    derive_user_hash,
    verify_credentials,
    get_demo_accounts_list,
    DEMO_ACCOUNTS,
)


def _admin_headers():
    token = create_access_token("ADMIN", "FIU", role="fiu_admin")
    return {"Authorization": f"Bearer {token}"}


class TestDeriveUserHash:
    def test_deterministic(self):
        h1 = derive_user_hash("PSB", "CUST001")
        h2 = derive_user_hash("PSB", "CUST001")
        assert h1 == h2

    def test_different_inputs_differ(self):
        h1 = derive_user_hash("PSB", "CUST001")
        h2 = derive_user_hash("PSB", "CUST002")
        assert h1 != h2

    def test_different_bank_differ(self):
        h1 = derive_user_hash("PSB", "CUST001")
        h2 = derive_user_hash("HDFC", "CUST001")
        assert h1 != h2

    def test_is_hex_64_chars(self):
        h = derive_user_hash("PSB", "CUST001")
        assert len(h) == 64
        int(h, 16)  # raises if not valid hex

    def test_matches_manual_hmac(self):
        secret = os.environ["IMEI_HMAC_SECRET"]
        expected = hmac.new(secret.encode(), b"PSB:CUST001", hashlib.sha256).hexdigest()
        assert derive_user_hash("PSB", "CUST001") == expected


class TestVerifyCredentials:
    def test_valid_credentials(self):
        result = verify_credentials("demo", "Demo@2026")
        assert result is not None
        assert result["name"] == "Demo Customer"
        assert result["bank_id"] == "PSB"

    def test_wrong_password(self):
        result = verify_credentials("demo", "wrong_password")
        assert result is None

    def test_unknown_user(self):
        result = verify_credentials("UNKNOWN", "pass123")
        assert result is None


class TestJWTTokens:
    def test_create_and_decode(self):
        token = create_access_token("CUST001", "PSB")
        claims = decode_token(token)
        assert claims["sub"] == "CUST001"
        assert claims["bank_id"] == "PSB"
        assert "exp" in claims
        assert "iat" in claims

    def test_token_expiry(self):
        token = create_access_token("CUST001", "PSB")
        claims = decode_token(token)
        assert claims["exp"] > time.time()

    def test_invalid_token_raises(self):
        with pytest.raises(Exception):
            decode_token("invalid.token.here")


class TestDemoAccountsList:
    def test_returns_without_passwords(self):
        accounts = get_demo_accounts_list()
        assert len(accounts) > 0
        for acct in accounts:
            assert "id" in acct
            assert "name" in acct
            assert "password" not in acct

    def test_loaded_from_config(self):
        assert "demo" in DEMO_ACCOUNTS


class TestDemoResetTargeted:
    @pytest.mark.anyio
    async def test_reset_targeted_user(self):
        from main import app
        from httpx import AsyncClient, ASGITransport
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post(
                "/api/auth/demo/reset",
                json={"customer_id": "Ananya", "user_id": "Ananya"},
                headers=_admin_headers(),
            )
            assert res.status_code == 200
            data = res.json()
            assert data.get("reset") is True
            assert "cleared" in data
