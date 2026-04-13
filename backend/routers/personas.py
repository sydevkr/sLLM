from fastapi import APIRouter, HTTPException

from services import persona_loader

router = APIRouter()


@router.get("/personas")
async def list_personas():
    return persona_loader.load_all()


@router.get("/personas/{persona_id}")
async def get_persona(persona_id: str):
    p = persona_loader.get(persona_id)
    if not p:
        raise HTTPException(status_code=404, detail="persona not found")
    return p
