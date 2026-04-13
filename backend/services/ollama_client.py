"""Ollama REST API 클라이언트 래퍼.

Single-shot Q&A 용도라 /api/generate 엔드포인트만 사용한다.
요청당 {model, prompt, system}을 보내고 스트리밍 응답을 yield한다.
"""
import asyncio
import json
import logging
import time
from typing import AsyncIterator, Optional

import httpx

from config import OLLAMA_URL

log = logging.getLogger("sllm.ollama")


class ModelNotFoundError(Exception):
    """Ollama 404 — 모델 미설치."""


class OllamaClient:
    def __init__(self, base_url: str = OLLAMA_URL):
        self.base_url = base_url.rstrip("/")

    async def is_alive(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as c:
                r = await c.get(f"{self.base_url}/api/tags")
                alive = r.status_code == 200
                if not alive:
                    log.warning(f"Ollama 응답 비정상: status={r.status_code}")
                return alive
        except Exception as e:
            log.warning(f"Ollama 연결 실패: {e}")
            return False

    async def list_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(f"{self.base_url}/api/tags")
            r.raise_for_status()
            models = r.json().get("models", [])
            log.debug(f"설치된 ollama 모델 {len(models)}종")
            return models

    async def generate_stream(
        self,
        model: str,
        prompt: str,
        system: Optional[str] = None,
    ) -> AsyncIterator[dict]:
        """Single-shot 생성. 각 호출은 완전히 독립.

        ModelNotFoundError 발생 시 호출자는 사용자에게 모델 미설치를 안내해야 한다.
        """
        payload: dict = {"model": model, "prompt": prompt, "stream": True}
        if system:
            payload["system"] = system

        t_start = time.time()
        log.info(f"→ [ollama.generate] model={model} prompt_len={len(prompt)} system={'Y' if system else 'N'}")

        first_token_time: Optional[float] = None
        try:
            async with httpx.AsyncClient(timeout=None) as c:
                async with c.stream("POST", f"{self.base_url}/api/generate", json=payload) as r:
                    if r.status_code == 404:
                        body = await r.aread()
                        try:
                            msg = json.loads(body).get("error", body.decode("utf-8", "replace"))
                        except Exception:
                            msg = body.decode("utf-8", "replace")
                        log.warning(f"✗ [ollama.generate] 모델 미설치: {model} — {msg}")
                        raise ModelNotFoundError(f"모델 '{model}'이(가) 설치되어 있지 않습니다. 'ollama pull {model}' 실행 필요")
                    r.raise_for_status()
                    async for line in r.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if first_token_time is None and chunk.get("response"):
                            first_token_time = time.time()
                            log.info(f"  [ollama.generate] 첫 토큰 수신 (TTFT={first_token_time - t_start:.2f}s)")
                        yield chunk
                        if chunk.get("done"):
                            elapsed = time.time() - t_start
                            eval_count = chunk.get("eval_count", 0)
                            eval_ns = chunk.get("eval_duration", 1) or 1
                            tps = eval_count / (eval_ns / 1e9) if eval_ns > 0 else 0
                            log.info(
                                f"← [ollama.generate] 완료 model={model} "
                                f"eval_count={eval_count} tok/s={tps:.2f} elapsed={elapsed:.2f}s"
                            )
        except ModelNotFoundError:
            raise
        except asyncio.CancelledError:
            elapsed = time.time() - t_start
            log.info(f"⏹️ [ollama.generate] 중단: model={model} elapsed={elapsed:.2f}s (httpx stream 자동 close)")
            raise
        except httpx.HTTPError as e:
            log.error(f"✗ [ollama.generate] HTTP 오류: {e}")
            raise

    async def pull_stream(self, model: str) -> AsyncIterator[dict]:
        payload = {"model": model, "stream": True}
        log.info(f"→ [ollama.pull] model={model} 시작")
        async with httpx.AsyncClient(timeout=None) as c:
            async with c.stream("POST", f"{self.base_url}/api/pull", json=payload) as r:
                r.raise_for_status()
                last_status = ""
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    status = chunk.get("status", "")
                    # 같은 status 반복은 로그에서 생략
                    if status and status != last_status:
                        log.info(f"  [ollama.pull] {model}: {status}")
                        last_status = status
                    yield chunk
        log.info(f"← [ollama.pull] model={model} 완료")

    async def delete_model(self, model: str) -> bool:
        log.info(f"→ [ollama.delete] model={model}")
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.request("DELETE", f"{self.base_url}/api/delete", json={"model": model})
            ok = r.status_code == 200
            log.info(f"← [ollama.delete] model={model} ok={ok}")
            return ok


ollama = OllamaClient()
