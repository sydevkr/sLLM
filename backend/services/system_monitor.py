"""시스템 리소스 모니터. 응답 중 폴링용이라 호출당 1회 psutil 수준의 가벼운 동작만."""
import math
import psutil

# 모듈 임포트 시 cpu_percent baseline 설정 (첫 호출은 항상 0.0이므로 미리 한 번 호출)
psutil.cpu_percent(interval=None)


def _read_soc_temp() -> float | None:
    """Raspberry Pi SoC 온도를 섭씨로 반환. 실패 시 None."""
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
            return int(f.read().strip()) / 1000.0
    except Exception:
        return None


def snapshot() -> dict:
    vm = psutil.virtual_memory()
    # interval=0.1: 100ms blocking 측정으로 정확한 CPU 사용률 산출
    # (interval=0.0은 호출 간격이 짧으면 0 또는 부정확한 값을 반환)
    return {
        "cpu_percent": psutil.cpu_percent(interval=0.1),
        "ram_used_mb": round((vm.total - vm.available) / (1024 * 1024), 1),
        "ram_total_mb": round(vm.total / (1024 * 1024), 1),
        "temp_c": _read_soc_temp(),
    }


def info() -> dict:
    vm = psutil.virtual_memory()
    model = "unknown"
    try:
        with open("/proc/device-tree/model", "r") as f:
            model = f.read().strip().rstrip("\x00")
    except Exception:
        pass
    disk = psutil.disk_usage("/")
    # OS는 시스템 예약 메모리를 제외해서 16GB → 15.8GB로 보고함.
    # 모델 호환성 판단(min_hw_gb)을 위해 ceil로 올림 (15.8 → 16, 7.8 → 8)
    return {
        "hw_model": model,
        "cpu_count": psutil.cpu_count(logical=True),
        "ram_total_gb": math.ceil(vm.total / (1024**3)),
        "ram_actual_gb": round(vm.total / (1024**3), 1),
        "disk_free_gb": round(disk.free / (1024**3), 1),
        "disk_total_gb": round(disk.total / (1024**3), 1),
    }
