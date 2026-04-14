import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from services.ollama_client import ollama, ModelNotFoundError
from services import model_registry

router = APIRouter()
log = logging.getLogger("sllm.models")


@router.get("/models")
async def list_models():
    catalog = model_registry.load_catalog()
    try:
        installed = await ollama.list_models()
        installed_ids = {m.get("name") or m.get("model") for m in installed}
    except Exception as e:
        log.warning(f"ollama 모델 목록 조회 실패: {e}")
        installed_ids = set()

    result = []
    for m in catalog:
        result.append({**m, "is_installed": m["id"] in installed_ids})

    # 카탈로그에 없지만 ollama에 있는 모델도 보조로 표시
    for mid in installed_ids:
        if not any(m["id"] == mid for m in catalog):
            result.append({
                "id": mid,
                "display_name": mid,
                "is_installed": True,
                "vendor": "unknown",
                "korean_level": 0,
                "parameters_b": 0,
                "tier": 3,
            })
    log.debug(f"/api/models 응답: total={len(result)} installed={len(installed_ids)}")
    return result


@router.get("/models/{model_id:path}")
async def get_model(model_id: str):
    m = model_registry.get(model_id)
    if not m:
        return {"id": model_id, "display_name": model_id}
    return m


@router.post("/models/{model_id:path}/pull")
async def pull_model(model_id: str):
    """모델 다운로드 (SSE 진행률 스트리밍)."""
    log.info(f"━━ /api/models/{model_id}/pull 요청 수신")

    async def event_stream():
        try:
            async for chunk in ollama.pull_stream(model_id):
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"
        except Exception as e:
            log.exception(f"✗ pull 실패: {model_id}: {e}")
            err = {"type": "error", "message": str(e)}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/models/{model_id:path}/load")
async def load_model(model_id: str):
    """모델을 메모리에 미리 로드."""
    log.info(f"━━ /api/models/{model_id}/load 요청 수신")
    try:
        result = await ollama.load_model(model_id)
        return result
    except ModelNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
