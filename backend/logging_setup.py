"""로깅 기본 설정. 주요 프로세스 추적용."""
import logging
import sys
from pathlib import Path

from config import DATA_DIR


def setup_logging(level: str = "INFO") -> None:
    log_path = DATA_DIR / "sllm.log"
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    datefmt = "%H:%M:%S"

    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    root.handlers.clear()

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(logging.Formatter(fmt, datefmt))
    root.addHandler(console)

    file_h = logging.FileHandler(log_path, encoding="utf-8")
    file_h.setFormatter(logging.Formatter(fmt, datefmt))
    root.addHandler(file_h)

    # uvicorn access 로그는 반복 호출(/api/system/status 1초 폴링)이 많아서 WARNING으로 낮춤
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    logging.getLogger(__name__).info(f"로깅 초기화 완료 (file={log_path})")
