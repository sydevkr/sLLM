#!/usr/bin/env bash
# 시스템 사양 점검 - RPi5 환경에서 sLLM 구동 가능성 확인
set -e

echo "=== sLLM 시스템 체크 ==="

if [ -f /proc/device-tree/model ]; then
  MODEL=$(tr -d '\0' < /proc/device-tree/model)
  echo "HW: $MODEL"
else
  echo "HW: (unknown) - RPi5 아님"
fi

RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
RAM_GB=$(( (RAM_KB + 524287) / 1048576 ))
echo "RAM: ${RAM_GB}GB"
if [ "$RAM_GB" -lt 8 ]; then
  echo "⚠️ 경고: RAM 8GB 미만 환경 — 1-2B 초경량 모델만 권장"
elif [ "$RAM_GB" -lt 16 ]; then
  echo "✓ 8GB 환경 — 3B 이하 모델 권장"
  export SLLM_MODE=8gb
else
  echo "✓ 16GB 환경 — 7B급 모델까지 지원"
  export SLLM_MODE=16gb
fi

DISK_FREE=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
echo "Disk free: ${DISK_FREE}GB"
if [ "$DISK_FREE" -lt 20 ]; then
  echo "⚠️ 경고: 여유 디스크 20GB 미만"
fi

if command -v python3 >/dev/null 2>&1; then
  PYV=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  echo "Python: $PYV"
  MAJ=${PYV%.*}; MIN=${PYV#*.}
  if [ "$MAJ" -lt 3 ] || { [ "$MAJ" -eq 3 ] && [ "$MIN" -lt 11 ]; }; then
    echo "⚠️ Python 3.11+ 권장"
  fi
else
  echo "✗ Python3 미설치"
  exit 1
fi

if command -v ollama >/dev/null 2>&1; then
  echo "Ollama: $(ollama --version 2>&1 | head -1)"
else
  echo "Ollama: 미설치 (build.sh 에서 설치 예정)"
fi

echo "=== 체크 완료 ==="
