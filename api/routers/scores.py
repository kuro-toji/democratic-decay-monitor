from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_scores():
    return []


@router.get("/{iso3}")
async def get_score(iso3: str):
    return {}