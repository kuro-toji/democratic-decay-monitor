from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_countries():
    return []


@router.get("/{iso3}")
async def get_country(iso3: str):
    return {}