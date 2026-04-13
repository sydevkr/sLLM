"""FastAPI 앱 진입점."""
import logging
import sys
from pathlib import Path

# backend/ 를 module path 최상단으로 (router들이 services/config을 top-level로 import)
sys.path.insert(0, str(Path(__file__).resolve().parent))

from logging_setup import setup_logging
setup_logging()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import FRONTEND_DIR, HOST, PORT, OLLAMA_URL
from routers import chat, models, personas, system

log = logging.getLogger("sllm.main")
log.info("=" * 50)
log.info("sLLM Chat 앱 초기화 시작")
log.info(f"  Host={HOST} Port={PORT}")
log.info(f"  Ollama URL={OLLAMA_URL}")
log.info(f"  Frontend={FRONTEND_DIR}")

app = FastAPI(title="sLLM Chat", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(personas.router, prefix="/api")
app.include_router(system.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.on_event("startup")
async def on_startup():
    log.info("FastAPI 앱 시작 완료")


@app.on_event("shutdown")
async def on_shutdown():
    log.info("FastAPI 앱 종료")


# Frontend 정적 파일 서빙 (마지막에 마운트 — API 라우트와 충돌 방지)
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
    log.info(f"프론트엔드 정적 서빙 활성화: {FRONTEND_DIR}")
else:
    log.warning(f"프론트엔드 디렉토리 없음: {FRONTEND_DIR}")
