"""VLM 에이전트 엔드포인트 — Hailo-10H 기반 이미지 분석."""
import asyncio
import json
import logging
import time

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse

from services.hailo_vlm import hailo_vlm
from services import system_monitor

router = APIRouter()
log = logging.getLogger("sllm.vlm")

MAX_IMAGE_SIZE = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@router.get("/vlm/status")
async def vlm_status():
    status = hailo_vlm.get_status()
    sys_info = system_monitor.info()
    status["system"] = sys_info
    return status


@router.post("/vlm/preload")
async def vlm_preload():
    """VLM + 번역 모델 프리로드. 페이지 오픈 시 호출."""
    result = await hailo_vlm.preload_all()
    return result


@router.post("/vlm/unload")
async def vlm_unload():
    """VLM + 번역 모델 언로드. 페이지 닫기 시 호출."""
    result = await hailo_vlm.unload_all()
    return result


@router.post("/vlm/analyze")
async def vlm_analyze(
    image: UploadFile = File(...),
    prompt: str = Form(default="Describe this image."),
):
    """이미지 분석 SSE 스트리밍.

    흐름: 영어 분석 출력 → 번역 중 표시 → 한국어 번역 추가
    """
    content_type = image.content_type or ""
    if content_type not in ALLOWED_TYPES:
        async def error_stream():
            yield f"data: {json.dumps({'type': 'error', 'code': 'invalid_type', 'message': f'지원하지 않는 형식: {content_type}'}, ensure_ascii=False)}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    image_bytes = await image.read()
    if len(image_bytes) > MAX_IMAGE_SIZE:
        async def error_stream():
            yield f"data: {json.dumps({'type': 'error', 'code': 'too_large', 'message': f'이미지 최대 10MB'}, ensure_ascii=False)}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    filename = image.filename or "image.jpg"
    size_kb = len(image_bytes) / 1024
    log.info(f"━━ /api/vlm/analyze 요청: file={filename} size={size_kb:.1f}KB")

    t_start = time.time()

    async def event_stream():
        # ── 1단계: VLM 이미지 분석 (Hailo NPU) ──
        vlm_task = asyncio.create_task(
            hailo_vlm.analyze_image_en(image_bytes, prompt, filename)
        )
        while not vlm_task.done():
            await asyncio.sleep(2)
            if vlm_task.done():
                break
            elapsed = time.time() - t_start
            yield f"data: {json.dumps({'type': 'progress', 'step': 'vlm', 'message': f'이미지 분석 중... ({elapsed:.0f}초 경과)'}, ensure_ascii=False)}\n\n"

        vlm_result = vlm_task.result()
        if vlm_result.get("error"):
            yield f"data: {json.dumps({'type': 'error', 'code': 'vlm_error', 'message': vlm_result['message']}, ensure_ascii=False)}\n\n"
            return

        english_text = vlm_result["content_en"]
        vlm_ms = vlm_result["vlm_ms"]

        # 영어 분석 결과 즉시 전송
        yield f"data: {json.dumps({'type': 'token_en', 'content': english_text}, ensure_ascii=False)}\n\n"

        # ── 2단계: 한국어 번역 (CPU/ollama) ──
        yield f"data: {json.dumps({'type': 'progress', 'step': 'translate', 'message': '한국어 번역 중... (exaone3.5)'}, ensure_ascii=False)}\n\n"

        tr_task = asyncio.create_task(
            hailo_vlm.translate_to_korean(english_text)
        )
        while not tr_task.done():
            await asyncio.sleep(2)
            if tr_task.done():
                break
            elapsed = time.time() - t_start
            yield f"data: {json.dumps({'type': 'progress', 'step': 'translate', 'message': f'한국어 번역 중... ({elapsed:.0f}초 경과)'}, ensure_ascii=False)}\n\n"

        tr_result = tr_task.result()
        korean_text = tr_result["content_kr"]
        translate_ms = tr_result["translate_ms"]

        # 한국어 번역 결과 전송
        yield f"data: {json.dumps({'type': 'token_kr', 'content': korean_text}, ensure_ascii=False)}\n\n"

        # 완료
        total_ms = (time.time() - t_start) * 1000
        meta = {
            "type": "done",
            "total_ms": round(total_ms, 1),
            "vlm_ms": round(vlm_ms, 1),
            "translate_ms": round(translate_ms, 1),
            "image_size_kb": round(size_kb, 1),
        }
        log.info(f"━━ /api/vlm/analyze 완료: vlm={vlm_ms:.0f}ms tr={translate_ms:.0f}ms total={total_ms:.0f}ms")
        yield f"data: {json.dumps(meta, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
