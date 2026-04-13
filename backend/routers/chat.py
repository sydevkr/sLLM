"""채팅 엔드포인트 — Single-shot Q&A."""
import asyncio
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.ollama_client import ollama, ModelNotFoundError
from services import persona_loader

router = APIRouter()
log = logging.getLogger("sllm.chat")


class ChatRequest(BaseModel):
    model: str
    prompt: str
    persona_id: Optional[str] = None


@router.post("/chat")
async def chat(req: ChatRequest):
    system_prompt = None
    persona_name = None
    if req.persona_id:
        p = persona_loader.get(req.persona_id)
        if p:
            system_prompt = p.get("system_prompt")
            persona_name = p.get("name")
        else:
            log.warning(f"요청한 persona_id 미존재: {req.persona_id}")

    # Qwen 3 계열은 thinking mode가 기본 ON이라 응답이 5~10배 길고 느림.
    # /no_think 지시자를 프롬프트 앞에 자동 주입해 thinking을 건너뛰고 바로 답변하게 한다.
    # (Qwen 3 dense 모델 공식 지원 기능, Qwen 2.5/EXAONE/Gemma 등엔 영향 없음)
    effective_prompt = req.prompt
    no_think_applied = False
    if req.model.startswith("qwen3:"):
        effective_prompt = f"/no_think {req.prompt}"
        no_think_applied = True

    # 요청 요약 로그 (전체 prompt는 너무 길 수 있으므로 앞 40자만)
    preview = req.prompt[:40].replace("\n", " ")
    nt_tag = " [no_think]" if no_think_applied else ""
    log.info(
        f"━━ /api/chat 요청 수신: model={req.model}{nt_tag} "
        f"persona={persona_name or '(없음)'} prompt_len={len(req.prompt)} preview='{preview}…'"
    )

    t_req_start = time.time()

    async def event_stream():
        nonlocal t_req_start
        try:
            token_count = 0
            async for chunk in ollama.generate_stream(req.model, effective_prompt, system_prompt):
                if chunk.get("done"):
                    eval_count = chunk.get("eval_count", 0)
                    eval_ns = chunk.get("eval_duration", 1) or 1
                    prompt_eval_count = chunk.get("prompt_eval_count", 0)
                    total_ns = chunk.get("total_duration", 1) or 1
                    load_ns = chunk.get("load_duration", 0) or 0
                    prompt_eval_ns = chunk.get("prompt_eval_duration", 0) or 0
                    tokens_sec = (eval_count / (eval_ns / 1e9)) if eval_ns > 0 else 0
                    meta = {
                        "type": "done",
                        "tokens_sec": round(tokens_sec, 2),
                        "total_ms": round(total_ns / 1e6, 1),
                        "load_ms": round(load_ns / 1e6, 1),
                        "prompt_eval_ms": round(prompt_eval_ns / 1e6, 1),
                        "eval_ms": round(eval_ns / 1e6, 1),
                        "eval_count": eval_count,
                        "prompt_eval_count": prompt_eval_count,
                    }
                    req_elapsed = time.time() - t_req_start
                    log.info(
                        f"━━ /api/chat 응답 완료: model={req.model} "
                        f"tok/s={tokens_sec:.2f} eval={eval_count} "
                        f"req_elapsed={req_elapsed:.2f}s"
                    )
                    yield f"data: {json.dumps(meta, ensure_ascii=False)}\n\n"
                else:
                    token = chunk.get("response", "")
                    if token:
                        token_count += 1
                        yield f"data: {json.dumps({'type': 'token', 'content': token}, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            # 클라이언트가 fetch abort → ollama 호출도 함께 종료됨 (httpx async stream 자동 close)
            req_elapsed = time.time() - t_req_start
            log.info(
                f"⏹️ /api/chat 클라이언트 중단 감지: model={req.model} "
                f"req_elapsed={req_elapsed:.2f}s (백엔드/ollama 정리 즉시 수행)"
            )
            raise
        except ModelNotFoundError as e:
            log.warning(f"✗ /api/chat 모델 미설치: {req.model}")
            err = {
                "type": "error",
                "code": "model_not_found",
                "message": str(e),
                "model": req.model,
            }
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"
        except Exception as e:
            log.exception(f"✗ /api/chat 예외 발생: {e}")
            err = {
                "type": "error",
                "code": "internal",
                "message": f"오류: {e}",
            }
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
