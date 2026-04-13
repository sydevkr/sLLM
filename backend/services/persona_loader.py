"""personas/*.json 로더. 고정 프리셋만 제공."""
import json
from functools import lru_cache

from config import PERSONAS_DIR


@lru_cache(maxsize=1)
def load_all() -> list[dict]:
    personas = []
    for f in sorted(PERSONAS_DIR.glob("*.json")):
        try:
            with open(f, "r", encoding="utf-8") as fp:
                personas.append(json.load(fp))
        except Exception:
            continue
    return personas


def get(persona_id: str) -> dict | None:
    for p in load_all():
        if p.get("id") == persona_id:
            return p
    return None
