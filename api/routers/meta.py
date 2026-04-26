from fastapi import APIRouter

router = APIRouter()


@router.get("/weights")
async def get_weights():
    return {}


@router.get("/sources")
async def get_sources():
    return []