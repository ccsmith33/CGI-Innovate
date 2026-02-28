from fastapi import APIRouter

from app.config import settings
from app.schemas.resource import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(status="ok", version=settings.APP_VERSION)
