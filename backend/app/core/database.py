import logging

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


# _build_connect_args: builds asyncpg connect_args for all supported DB providers.
#
#  - Neon direct (neon.tech, no "-pooler"): SSL required.
#    asyncpg does NOT read ?ssl=require from the URL automatically.
#
#  - Neon pooler ("-pooler" in host): SSL required + prepared statements MUST
#    be disabled. Neon's connection pooler (like PgBouncer) does not support
#    the PostgreSQL extended query protocol used for prepared statements.
#    Without disabling them you get "prepared statement already exists" errors.
#    Also drops unsupported URL params (channel_binding, sslmode) that asyncpg
#    cannot parse.
#
#  - Supabase pooler (PgBouncer, port 6543): same — disable prepared stmts.
#
#  - Local Postgres / direct connection: no special args needed.
def _build_connect_args(url: str) -> dict:
    args: dict = {}
    if "sqlite" in url:
        return args

    # Any Neon database — SSL is mandatory

    if "neon.tech" in url:
        import ssl as _ssl
        ctx = _ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = _ssl.CERT_NONE
        args["ssl"] = ctx

    # Disable prepared statements for EVERY remote Postgres, not just the two
    # hostname patterns that used to be matched here (Neon "-pooler" and
    # Supabase :6543).
    #
    # Why the broad rule: the previous host-sniffing missed the pooler actually
    # in front of production, so asyncpg kept caching prepared statements and
    # the connection was recycled to a different backend mid-session. That
    # surfaced as "prepared statement __asyncpg_stmt_N__ already exists
    # (NOTE: pgbouncer)" on *arbitrary* queries — it broke create_all at
    # startup and returned intermittent 500s from registration and
    # /fraud/reports afterwards. A connection pooler is invisible in the URL in
    # the general case, so matching known hostnames can only ever be a
    # best-effort guess.
    #
    # The cost of being wrong in this direction is one extra parse per query;
    # the cost of being wrong in the other direction is random 500s in
    # production. Local/test databases are exempted since they are never
    # pooled and the test suite benefits from the cache.
    is_local = "localhost" in url or "127.0.0.1" in url
    if not is_local:
        args["statement_cache_size"] = 0
        args["prepared_statement_cache_size"] = 0

    return args


def _clean_database_url(url: str) -> str:
    """Strip asyncpg-incompatible query params from the DATABASE_URL.

    asyncpg parses the connection URL itself and chokes on params it doesn't
    know: 'channel_binding', 'sslmode' (it expects 'ssl'). Strip them here
    so the URL is clean before SQLAlchemy/asyncpg sees it. The ssl requirement
    is already enforced via connect_args above.

    Hosted providers (Render, Heroku) hand out plain postgres:// or
    postgresql:// URLs, which SQLAlchemy maps to the sync psycopg2 driver that
    isn't installed — pin them to asyncpg.

    Values pasted into a dashboard often arrive with surrounding quotes or
    whitespace, or with the "postgresql:" prefix clipped off ("//user:pw@host");
    repair those instead of crashing at import.
    """
    url = url.strip().strip('"').strip("'").strip()
    if url.startswith("//"):
        url = "postgresql:" + url
    if not url.startswith("postgres") and not url.startswith("postgresql"):
        return url
    from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
    parsed = urlparse(url)
    if parsed.scheme in ("postgres", "postgresql"):
        parsed = parsed._replace(scheme="postgresql+asyncpg")
    # Parse existing query params, drop the incompatible ones
    params = parse_qs(parsed.query, keep_blank_values=True)
    # pgbouncer=true is a Prisma flag (Supabase docs include it); asyncpg would
    # forward it to Postgres as an unknown server setting.
    for bad in ("sslmode", "channel_binding", "ssl", "pgbouncer"):
        params.pop(bad, None)
    clean_query = urlencode(params, doseq=True)
    return urlunparse(parsed._replace(query=clean_query))


_DB_URL = _clean_database_url(settings.database_url)

is_test = "localhost" in settings.database_url or "127.0.0.1" in settings.database_url or "test" in settings.database_url

engine = create_async_engine(
    _DB_URL,
    echo=False,
    connect_args=_build_connect_args(settings.database_url),  # uses original URL for detection
    poolclass=NullPool if is_test else None,
)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


_db_initialized = False


async def init_db():
    global _db_initialized
    if _db_initialized:
        return
    _db_initialized = True
    import app.models.db_models  # noqa: F401
    # Schema bootstrap.
    #
    # Every DDL statement runs in its OWN transaction. This is not stylistic:
    # PostgreSQL aborts the *entire* transaction on the first failed statement,
    # and every later statement then fails with "current transaction is
    # aborted" — a per-statement try/except swallows the error but does NOT
    # recover the transaction. When all of this shared one transaction, a single
    # failing ALTER silently skipped every migration after it. That is exactly
    # how production ended up without users.phone_number while the code that
    # adds it was deployed and running.
    report = await repair_schema()
    if report["failed"]:
        logger.warning(
            "schema repair finished with %d failed statement(s): %s",
            len(report["failed"]), report["failed"],
        )


async def repair_schema() -> dict:
    """Bring an existing database up to the current schema.

    Split out of init_db so it can also be triggered at runtime by
    POST /api/admin/schema-repair — a deployment whose startup repair failed
    can then be fixed without a redeploy, and the returned report says exactly
    which statement failed instead of leaving a bare 500.
    """
    from sqlalchemy import text

    ok: list[str] = []
    failed: list[dict] = []

    async def ddl(sql: str) -> bool:
        """Run one DDL statement in isolation. Returns False if it failed."""
        try:
            async with engine.begin() as c:
                await c.execute(text(sql))
            ok.append(sql[:80])
            return True
        except Exception as exc:                      # noqa: BLE001
            # WARNING, not DEBUG: every statement here uses IF NOT EXISTS or is
            # idempotent, so a failure is always worth surfacing in the logs
            # rather than being silently swallowed.
            logger.warning("schema repair FAILED: %s — %s", sql[:80], exc)
            failed.append({"sql": sql[:120], "error": str(exc)[:200]})
            return False

    # The dialect is read from the engine, NOT from inside the create_all
    # transaction — the ALTERs below must still run when create_all fails.
    dialect = engine.dialect.name

    try:
        async with engine.begin() as conn:
            # Creates MISSING TABLES only — it never adds a column to a table
            # that already exists, which is why the ALTERs below are needed.
            await conn.run_sync(Base.metadata.create_all)
    except Exception as exc:                          # noqa: BLE001
        # Deliberately NOT a return. create_all is the statement most likely to
        # fail on an *existing* deployment (schema drift, a leftover index, a
        # type conflict), and an existing deployment is precisely the one whose
        # columns are missing. Returning here skipped every ALTER below and is
        # why production kept 500ing on users.phone_number even after the
        # per-statement transaction fix — the repair code was never reached.
        logger.warning("create_all failed (continuing to column repair): %s", exc)

    if dialect == "sqlite":
        return {"dialect": dialect, "ok": ok, "failed": failed, "skipped": "sqlite"}

    # Add every column the models declare that the database is missing.
    #
    # This used to be a hand-maintained list of (table, column) pairs, which
    # only ever covered the columns someone remembered to add to it. users
    # gained auth_provider/email/profile_pic for Google sign-in and none of
    # them were on that list, so production had a users table that the User
    # model could not INSERT into or SELECT from — every registration and
    # every /fraud/reports read returned 500, and the hand-written list looked
    # like it was passing because the columns it did know about were fine.
    #
    # Deriving the list from Base.metadata instead means a new model column can
    # never again be missed here: whatever the models declare, the repair adds.
    #
    # Columns are always added NULLable and without constraints, even when the
    # model marks them NOT NULL — ADD COLUMN ... NOT NULL fails outright on a
    # table that already has rows. A nullable column that the ORM can write is
    # strictly better than a missing one; tightening it is a migration's job,
    # not a self-heal's.
    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            if col.primary_key:
                continue  # part of the table definition; exists or the table doesn't
            try:
                coltype = col.type.compile(engine.dialect)
            except Exception:                             # noqa: BLE001
                # A type that cannot be rendered standalone (rare, e.g. some
                # custom types) is skipped rather than emitting broken SQL.
                continue
            stmt = f'ALTER TABLE "{table.name}" ADD COLUMN IF NOT EXISTS "{col.name}" {coltype}'
            if col.server_default is not None and hasattr(col.server_default, "arg"):
                stmt += f" DEFAULT {col.server_default.arg}"
            await ddl(stmt)

    # sessions.pathway is a CHECK constraint, not an enum type, so a new value
    # must be added by rewriting the constraint (migration 003). Without it
    # every SECURITY_GATE write — advanced-security verdicts and voice MFA —
    # fails on an existing deployment while working fine on a fresh one.
    #
    # Dropped and re-added as two separate statements: if the ADD fails because
    # existing rows violate it, the DROP must still stand rather than being
    # rolled back with it.
    await ddl("ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_pathway_check")
    await ddl(
        "ALTER TABLE sessions ADD CONSTRAINT sessions_pathway_check "
        "CHECK (pathway IN ('SMART_CONTRACT','COERCION_ENRICHMENT','ML_FULL',"
        "'FALLBACK','ADMIN_BLOCK','SECURITY_GATE'))"
    )

    return {"dialect": dialect, "ok": ok, "failed": failed}


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
