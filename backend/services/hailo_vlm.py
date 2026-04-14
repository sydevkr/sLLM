"""Hailo-10H VLM 서비스.

AI HAT+ 2 (Hailo-10H) NPU를 통한 Vision Language Model 추론.
Qwen2-VL-2B-Instruct로 이미지 분석(영어) → exaone3.5:2.4b로 한국어 번역.

  Hailo NPU (전용 8GB)        RPi5 CPU (시스템 8GB)
  Qwen2-VL-2B 이미지분석  →   exaone3.5 한국어 번역
"""
import asyncio
import json
import logging
import os
import subprocess
import time
from pathlib import Path
from typing import Optional

import httpx

from config import OLLAMA_URL

log = logging.getLogger("sllm.hailo_vlm")

HAILO_DEVICE_PATH = "/dev/hailo0"
HEF_MODEL_PATH = Path("/usr/local/hailo/resources/models/hailo10h/Qwen2-VL-2B-Instruct.hef")
VLM_IMAGE_SIZE = 336  # Qwen2-VL 입력 해상도
TRANSLATE_MODEL = "exaone3.5:2.4b"

# Hailo SDK — 런타임에 없을 수 있으므로 지연 임포트
_hailo_available = False
try:
    from hailo_platform import VDevice
    from hailo_platform.genai import VLM
    import cv2
    import numpy as np
    _hailo_available = True
except ImportError:
    pass


def _check_device() -> bool:
    return os.path.exists(HAILO_DEVICE_PATH)


def _check_firmware() -> Optional[str]:
    try:
        r = subprocess.run(
            ["hailortcli", "fw-control", "identify"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0:
            for line in r.stdout.splitlines():
                if "Firmware Version" in line:
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return None


def _check_python_sdk() -> Optional[str]:
    try:
        import hailo_platform
        return hailo_platform.__version__
    except ImportError:
        return None


class HailoVLMService:
    """Hailo-10H VLM 추론 서비스.

    VDevice와 VLM 모델을 최초 요청 시 한 번만 초기화하고 유지한다 (lazy init).
    추론은 동기 함수이므로 thread pool에서 실행한다.
    """

    def __init__(self):
        self._vdevice = None
        self._vlm = None
        self._initialized = False
        self._init_error: Optional[str] = None

    # ── 상태 조회 ──

    def get_status(self) -> dict:
        device_ok = _check_device()
        firmware = _check_firmware() if device_ok else None
        sdk_version = _check_python_sdk()
        hef_exists = HEF_MODEL_PATH.exists()

        ready = device_ok and _hailo_available and hef_exists

        status = {
            "device_detected": device_ok,
            "device_path": HAILO_DEVICE_PATH,
            "firmware_version": firmware,
            "sdk_version": sdk_version,
            "hailo_sdk_importable": _hailo_available,
            "hef_model": str(HEF_MODEL_PATH) if hef_exists else None,
            "vlm_ready": ready,
            "model_loaded": self._initialized,
        }

        if not device_ok:
            status["message"] = "Hailo NPU 디바이스가 감지되지 않았습니다."
        elif not _hailo_available:
            status["message"] = (
                "Python SDK(hailo_platform, cv2, numpy)를 불러올 수 없습니다.\n"
                "venv를 --system-site-packages 옵션으로 재생성하세요."
            )
        elif not hef_exists:
            status["message"] = (
                f"VLM 모델 파일이 없습니다: {HEF_MODEL_PATH}\n"
                "다운로드: hailo-download-resources --group vlm_chat --arch hailo10h"
            )
        else:
            status["message"] = "VLM 준비 완료 (Qwen2-VL-2B)"

        log.info(f"Hailo 상태: device={device_ok} sdk={_hailo_available} hef={hef_exists} ready={ready}")
        return status

    # ── 디바이스 초기화 (동기, 최초 1회) ──

    def _ensure_initialized(self):
        """VDevice + VLM 모델 로드. 이미 초기화됐으면 스킵."""
        if self._initialized:
            return
        if self._init_error:
            raise RuntimeError(self._init_error)

        if not _hailo_available:
            self._init_error = "Hailo SDK를 불러올 수 없습니다."
            raise RuntimeError(self._init_error)
        if not HEF_MODEL_PATH.exists():
            self._init_error = f"HEF 모델 파일 없음: {HEF_MODEL_PATH}"
            raise RuntimeError(self._init_error)

        t0 = time.time()
        log.info("→ [hailo_vlm] VDevice + VLM 초기화 시작...")
        try:
            params = VDevice.create_params()
            self._vdevice = VDevice(params)
            self._vlm = VLM(self._vdevice, str(HEF_MODEL_PATH))
            self._initialized = True
            log.info(f"← [hailo_vlm] 초기화 완료 ({time.time() - t0:.2f}s)")
        except Exception as e:
            self._init_error = f"Hailo 초기화 실패: {e}"
            log.error(self._init_error, exc_info=True)
            self._cleanup()
            raise RuntimeError(self._init_error)

    # ── 동기 추론 (thread pool에서 호출) ──

    def _run_inference(self, image_bytes: bytes, prompt_text: str) -> str:
        """이미지 바이트 + 프롬프트 → VLM 응답 텍스트."""
        self._ensure_initialized()

        # 이미지 디코딩 (JPEG/PNG bytes → numpy)
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("이미지를 디코딩할 수 없습니다.")

        orig_h, orig_w = image.shape[:2]
        log.info(f"  [hailo_vlm] 이미지: {orig_w}x{orig_h} → {VLM_IMAGE_SIZE}x{VLM_IMAGE_SIZE}")

        # BGR → RGB, 리사이즈
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        image = cv2.resize(image, (VLM_IMAGE_SIZE, VLM_IMAGE_SIZE), interpolation=cv2.INTER_LINEAR)
        image = image.astype(np.uint8)

        # 프롬프트 구성 — Qwen2-VL-2B는 영어/중국어 모델이므로 영어로 응답받음
        prompt = [
            {
                "role": "system",
                "content": [{"type": "text", "text": "You are a concise image analysis assistant. Describe what you see briefly in English. Be specific and factual."}],
            },
            {
                "role": "user",
                "content": [
                    {"type": "image"},
                    {"type": "text", "text": prompt_text},
                ],
            },
        ]

        t0 = time.time()
        log.info(f"→ [hailo_vlm] 추론 시작: prompt='{prompt_text[:50]}...'")
        response = self._vlm.generate_all(
            prompt=prompt,
            frames=[image],
            temperature=0.1,
            seed=42,
            max_generated_tokens=150,
        )
        elapsed = time.time() - t0
        # 응답 정리 (불필요한 suffix 제거)
        response = response.split("<|im_end|>")[0].strip()
        log.info(f"← [hailo_vlm] 추론 완료 ({elapsed:.2f}s) 응답길이={len(response)}")

        return response

    # ── 번역 (ollama exaone, CPU에서 실행) ──

    async def _translate_to_korean(self, english_text: str) -> str:
        """영어 텍스트를 exaone3.5:2.4b로 한국어 번역."""
        payload = {
            "model": TRANSLATE_MODEL,
            "prompt": f"Translate to Korean:\n{english_text}",
            "system": "You are a translator. Output ONLY the Korean translation, nothing else.",
            "stream": False,
            "keep_alive": -1,
        }
        t0 = time.time()
        log.info(f"→ [hailo_vlm.translate] 번역 시작 (영어 {len(english_text)}자)")
        try:
            async with httpx.AsyncClient(timeout=120.0) as c:
                r = await c.post(f"{OLLAMA_URL}/api/generate", json=payload)
                r.raise_for_status()
                result = r.json().get("response", "").strip()
                elapsed = time.time() - t0
                log.info(f"← [hailo_vlm.translate] 번역 완료 ({elapsed:.2f}s) 한국어 {len(result)}자")
                return result
        except Exception as e:
            log.warning(f"✗ [hailo_vlm.translate] 번역 실패: {e} — 영어 원문 반환")
            return english_text

    # ── 비동기 API (라우터에서 호출) ──

    async def analyze_image_en(
        self,
        image_bytes: bytes,
        prompt: str,
        image_filename: str = "image.jpg",
    ) -> dict:
        """1단계: Hailo VLM 이미지 분석 (영어 결과)."""
        if not _check_device():
            return {"error": True, "message": "Hailo NPU 디바이스가 감지되지 않습니다."}
        if not _hailo_available:
            return {"error": True, "message": "Hailo SDK를 불러올 수 없습니다. venv 설정을 확인하세요."}
        if not HEF_MODEL_PATH.exists():
            return {"error": True, "message": f"VLM 모델 파일이 없습니다: {HEF_MODEL_PATH}"}

        image_size_kb = len(image_bytes) / 1024
        log.info(f"→ [hailo_vlm.analyze] file={image_filename} size={image_size_kb:.1f}KB prompt_len={len(prompt)}")

        t0 = time.time()
        try:
            loop = asyncio.get_event_loop()
            english_response = await loop.run_in_executor(None, self._run_inference, image_bytes, prompt)
            vlm_ms = (time.time() - t0) * 1000
            return {"error": False, "content_en": english_response, "vlm_ms": round(vlm_ms, 1)}
        except Exception as e:
            log.error(f"✗ [hailo_vlm.analyze] 오류: {e}", exc_info=True)
            return {"error": True, "message": f"분석 오류: {e}"}

    async def translate_to_korean(self, english_text: str) -> dict:
        """2단계: exaone3.5로 한국어 번역 (CPU)."""
        t0 = time.time()
        korean = await self._translate_to_korean(english_text)
        translate_ms = (time.time() - t0) * 1000
        return {"content_kr": korean, "translate_ms": round(translate_ms, 1)}

    # ── 모델 프리로드 / 언로드 ──

    async def preload_all(self) -> dict:
        """VLM(Hailo) + 번역모델(ollama) 모두 프리로드."""
        results = {}

        # 1) Hailo VLM
        if _hailo_available and HEF_MODEL_PATH.exists():
            try:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, self._ensure_initialized)
                results["vlm"] = "loaded"
            except Exception as e:
                results["vlm"] = f"error: {e}"
        else:
            results["vlm"] = "unavailable"

        # 2) ollama exaone — keep_alive=-1 로 언로드 방지
        try:
            async with httpx.AsyncClient(timeout=120.0) as c:
                r = await c.post(f"{OLLAMA_URL}/api/generate", json={
                    "model": TRANSLATE_MODEL,
                    "prompt": "",
                    "keep_alive": -1,
                })
                results["translate"] = "loaded" if r.status_code == 200 else f"error: {r.status_code}"
                log.info(f"← [hailo_vlm.preload] 번역 모델 프리로드 완료 (keep_alive=-1)")
        except Exception as e:
            results["translate"] = f"error: {e}"

        log.info(f"모델 프리로드 결과: {results}")
        return results

    async def unload_all(self) -> dict:
        """VLM(Hailo) + 번역모델(ollama) 모두 언로드."""
        results = {}

        # 1) Hailo VLM
        self._cleanup()
        results["vlm"] = "unloaded"

        # 2) ollama exaone — keep_alive=0 으로 즉시 언로드
        try:
            async with httpx.AsyncClient(timeout=30.0) as c:
                r = await c.post(f"{OLLAMA_URL}/api/generate", json={
                    "model": TRANSLATE_MODEL,
                    "prompt": "",
                    "keep_alive": 0,
                })
                results["translate"] = "unloaded" if r.status_code == 200 else f"error: {r.status_code}"
                log.info(f"← [hailo_vlm.unload] 번역 모델 언로드 완료")
        except Exception as e:
            results["translate"] = f"error: {e}"

        log.info(f"모델 언로드 결과: {results}")
        return results

    # ── 정리 ──

    def _cleanup(self):
        if self._vlm:
            try:
                self._vlm.clear_context()
                self._vlm.release()
            except Exception:
                pass
            self._vlm = None
        if self._vdevice:
            try:
                self._vdevice.release()
            except Exception:
                pass
            self._vdevice = None
        self._initialized = False
        self._init_error = None

    def shutdown(self):
        log.info("→ [hailo_vlm] 셧다운...")
        self._cleanup()


# 싱글턴
hailo_vlm = HailoVLMService()
