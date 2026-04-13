from fastapi import APIRouter

from services import system_monitor
from services.ollama_client import ollama

router = APIRouter()


@router.get("/system/status")
async def status():
    return system_monitor.snapshot()


@router.get("/system/info")
async def info():
    data = system_monitor.info()
    data["ollama_alive"] = await ollama.is_alive()
    return data
