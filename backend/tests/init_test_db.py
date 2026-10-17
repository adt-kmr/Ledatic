import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio

# Set the environment variables first
os.environ["DATABASE_URL"] = "postgresql+asyncpg://citadel:citadel_dev@localhost:5435/citadel"
os.environ["REDIS_URL"] = "redis://localhost:6380/15"
os.environ["IMEI_HMAC_SECRET"] = "test-secret-for-unit-tests-only"
os.environ["JWT_SECRET"] = "test-jwt-secret-for-unit-tests-only"

async def main():
    from app.core.database import init_db
    await init_db()
    print("Database initialized successfully!")

if __name__ == "__main__":
    asyncio.run(main())
