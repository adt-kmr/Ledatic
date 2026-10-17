"""Tests for backend API endpoints — auth, signals, fraud."""
import pytest
from httpx import AsyncClient, ASGITransport
from app.core.security import create_access_token, derive_user_hash
from app.core.redis_client import init_redis


@pytest.fixture(autouse=True, scope="session")
async def setup_redis():
    await init_redis()


@pytest.fixture
def auth_headers():
    token = create_access_token("demo", "PSB")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def user_hash():
    return derive_user_hash("PSB", "TEST001")


class TestHealthEndpoint:
    @pytest.mark.anyio
    async def test_health_returns_ok(self):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ok"


class TestLoginEndpoint:
    @pytest.mark.anyio
    async def test_valid_login(self):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/auth/login", json={"customer_id": "demo", "password": "Demo@2026"})
            assert resp.status_code == 200
            data = resp.json()
            assert "access_token" in data
            assert data["user_id"] == "demo"

    @pytest.mark.anyio
    async def test_invalid_password(self):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/auth/login", json={"customer_id": "demo", "password": "wrong"})
            assert resp.status_code == 401

    @pytest.mark.anyio
    async def test_unknown_user(self):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/auth/login", json={"customer_id": "UNKNOWN", "password": "***"})
            assert resp.status_code == 401


class TestDemoAccountsEndpoint:
    @pytest.mark.anyio
    async def test_returns_accounts(self):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/auth/demo/accounts")
            assert resp.status_code == 200
            data = resp.json()
            assert "accounts" in data
            assert len(data["accounts"]) > 0
            # Should NOT contain passwords
            for acct in data["accounts"]:
                assert "password" not in acct


class TestEvaluateEndpoint:
    @pytest.mark.anyio
    async def test_evaluate_requires_auth(self):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/auth/evaluate", json={
                "session_id": "00000000-0000-0000-0000-000000000001",
                "user_id": "test",
                "user_hash": "test",
                "imei_hash": "abc123",
                "channel": "internet_banking",
            })
            assert resp.status_code in (401, 403)

    @pytest.mark.anyio
    async def test_evaluate_with_auth(self, auth_headers):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/auth/evaluate", json={
                "session_id": "00000000-0000-0000-0000-000000000002",
                "user_id": "demo",
                "user_hash": "test-hash",
                "imei_hash": "abc123def456",
                "channel": "internet_banking",
                "signal_bundle": {
                    "keystrokeEvents": [
                        {"eventType": "keydown", "timestamp": 1000 + i * 100, "key": "A", "dwellTime": 95, "flightTime": 145}
                        for i in range(10)
                    ],
                    "mouseEvents": [],
                    "environment": {"screenShareActive": False, "tabVisible": True},
                },
            }, headers=auth_headers)
            # May be 200 (ML available) or 503 (ML unavailable) — both valid
            assert resp.status_code in (200, 503)
