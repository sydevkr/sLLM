import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"
PERSONAS_DIR = ROOT_DIR / "personas"
DATA_DIR = ROOT_DIR / "data"

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
DB_PATH = DATA_DIR / "sllm.db"
MODELS_REGISTRY_PATH = BACKEND_DIR / "data" / "models_registry.json"

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

DATA_DIR.mkdir(parents=True, exist_ok=True)
