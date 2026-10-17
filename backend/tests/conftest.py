import os
from dotenv import load_dotenv

# Load local environment file
load_dotenv()

import pytest

# Override database and redis paths specifically for the test suite runner
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["REDIS_URL"] = "redis://localhost:6380/15"
os.environ["IMEI_HMAC_SECRET"] = "test-secret-for-unit-tests-only"
os.environ["JWT_SECRET"] = "test-jwt-secret-for-unit-tests-only"



@pytest.fixture(autouse=True, scope="session")
async def setup_test_db():
    from app.core.database import init_db
    try:
        await init_db()
    except Exception as exc:
        import logging
        logging.warning("test_db init skipped or failed: %s", exc)

