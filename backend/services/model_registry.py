"""모델 카탈로그 로더. AI-SLLM-MODELS.md 기반의 정적 JSON."""
import json
from functools import lru_cache

from config import MODELS_REGISTRY_PATH


@lru_cache(maxsize=1)
def load_catalog() -> list[dict]:
    try:
        with open(MODELS_REGISTRY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def get(model_id: str) -> dict | None:
    for m in load_catalog():
        if m.get("id") == model_id:
            return m
    return None
