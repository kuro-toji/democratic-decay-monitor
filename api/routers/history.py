from fastapi import APIRouter

router = APIRouter()


@router.get("/{iso3}")
async def get_history(iso3: str):
    return []