from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_alerts():
    return []


@router.get("/{iso3}")
async def get_alerts(iso3: str):
    return []