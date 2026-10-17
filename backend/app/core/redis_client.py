import redis.asyncio as redis
from app.core.config import settings

_redis: redis.Redis | None = None
# Alias used by fraud_agent tools which import the singleton directly
_redis_client: redis.Redis | None = None


async def init_redis():
    global _redis, _redis_client
    _redis = redis.from_url(settings.redis_url, decode_responses=True)
    _redis_client = _redis


def get_redis() -> redis.Redis | None:
    return _redis

