import pytest
from datetime import datetime, timezone

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db, set_session_factory
from app.main import app
from app.models.resource_log import ResourceLog

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def test_engine():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Override the global session factory so background tasks use the test DB
    factory = async_sessionmaker(engine, expire_on_commit=False)
    set_session_factory(factory)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db_session(test_engine):
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest.fixture
async def seeded_session(test_engine):
    """A DB session pre-seeded with resource test data."""
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        resources = [
            ResourceLog(
                timestamp=datetime(2026, 1, 1, i, tzinfo=timezone.utc),
                sector_id="Wakanda",
                resource_type="Vibranium (kg)",
                stock_level=1000.0 - i * 10,
                usage_rate_hourly=5.0,
                snap_event_detected=False,
            )
            for i in range(5)
        ] + [
            ResourceLog(
                timestamp=datetime(2026, 1, 1, i, tzinfo=timezone.utc),
                sector_id="New Asgard",
                resource_type="Arc Reactor Cores",
                stock_level=500.0 - i * 5,
                usage_rate_hourly=3.0,
                snap_event_detected=(i == 2),
            )
            for i in range(5)
        ]
        session.add_all(resources)
        await session.commit()
        yield session


@pytest.fixture
async def client(seeded_session):
    async def override_get_db():
        yield seeded_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def clean_session(test_engine):
    """A clean DB session (no seeded data, but tables exist)."""
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest.fixture
async def clean_client(clean_session):
    """Client with a clean DB session (no seeded data)."""

    async def override_get_db():
        yield clean_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
    app.dependency_overrides.clear()
