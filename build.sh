#!/usr/bin/env bash
# ============================================================
# build.sh — sLLM 프로젝트 빌드
#   1) 시스템 의존성 (install.sh 호출)
#   2) Python 가상환경 + 패키지
#   3) Ollama 서비스 시작 확인
#   4) (옵션) 기본 모델 다운로드
#   5) 설치 검증
#
# 환경변수:
#   SLLM_PULL_BASIC=1  → 기본 3종 모델 자동 다운로드
#   SLLM_PULL_LARGE=1  → 7B+ 모델까지 다운로드 (16GB RAM 환경)
#   기본은 모델 다운로드 없음 (UI에서 사용자가 직접 선택)
# ============================================================
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=========================================="
echo "   sLLM 웹 테스트 에이전트 — 빌드"
echo "=========================================="

# ────────────────────────────────────────────────
# [1/5] 시스템 체크
# ────────────────────────────────────────────────
bash scripts/check_system.sh

# ────────────────────────────────────────────────
# [2/5] 시스템 의존성 (install.sh 위임)
# ────────────────────────────────────────────────
echo
echo "[2/5] 시스템 의존성 확인..."
NEED_INSTALL=0
for cmd in curl python3 ollama; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "   ✗ $cmd 없음"
    NEED_INSTALL=1
  fi
done
python3 -c "import venv" 2>/dev/null || NEED_INSTALL=1

if [ "$NEED_INSTALL" = "1" ]; then
  echo "   → install.sh 실행 (시스템 패키지 + ollama 설치)"
  bash install.sh
else
  echo "   ✓ 시스템 의존성 모두 설치됨"
fi

# ────────────────────────────────────────────────
# [3/5] Python 가상환경
# ────────────────────────────────────────────────
echo
echo "[3/5] Python 가상환경 구성..."
if [ ! -d .venv ]; then
  python3 -m venv .venv
  echo "   → .venv 생성됨"
fi
./.venv/bin/pip install --upgrade pip --quiet
./.venv/bin/pip install -r backend/requirements.txt --quiet
echo "   ✓ Python 패키지 설치 완료"

# ────────────────────────────────────────────────
# [4/5] Ollama 서비스 기동 (모델 다운로드 전 필요)
# ────────────────────────────────────────────────
echo
echo "[4/5] Ollama 서비스 확인..."
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "   → ollama 서비스 시작 시도..."
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q ollama; then
    sudo systemctl start ollama 2>/dev/null || nohup ollama serve >/tmp/ollama.log 2>&1 &
  else
    nohup ollama serve >/tmp/ollama.log 2>&1 &
  fi
  for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      echo "   ✓ ollama 응답 확인"
      break
    fi
    sleep 1
  done
else
  echo "   ✓ ollama 이미 실행 중"
fi

# ────────────────────────────────────────────────
# [5/5] 기본 모델 다운로드 (옵션)
# ────────────────────────────────────────────────
echo
echo "[5/5] 모델 다운로드..."
MODELS=()
if [ "${SLLM_PULL_BASIC:-0}" = "1" ]; then
  MODELS+=("exaone3.5:2.4b" "qwen3:1.7b" "gemma3:1b")
  echo "   (SLLM_PULL_BASIC=1 — 기본 3종 다운로드)"
fi
if [ "${SLLM_PULL_LARGE:-0}" = "1" ]; then
  MODELS+=("exaone3.5:7.8b" "qwen3:8b")
  echo "   (SLLM_PULL_LARGE=1 — 7B급 추가)"
fi

if [ ${#MODELS[@]} -eq 0 ]; then
  echo "   (모델 자동 다운로드 안 함 — 웹 UI에서 직접 선택해 받으세요)"
  echo "   필요 시: SLLM_PULL_BASIC=1 bash build.sh"
else
  for m in "${MODELS[@]}"; do
    echo "   → pull $m"
    ollama pull "$m" || echo "   ⚠️ $m pull 실패"
  done

  # 검증
  echo
  echo "   설치 검증:"
  INSTALLED=$(ollama list 2>/dev/null | awk 'NR>1 {print $1}')
  for m in "${MODELS[@]}"; do
    if echo "$INSTALLED" | grep -qx "$m"; then
      echo "     ✓ $m"
    else
      echo "     ✗ $m (실패)"
    fi
  done
fi

# ────────────────────────────────────────────────
# 완료 리포트
# ────────────────────────────────────────────────
DISK_FREE=$(df --output=avail -BG / 2>/dev/null | tail -1 | tr -dc '0-9' || echo "?")
RAM_GB=$(( ($(grep MemTotal /proc/meminfo | awk '{print $2}') + 524287) / 1048576 )) 2>/dev/null || RAM_GB="?"
echo
echo "=========================================="
echo "   ✅ 빌드 완료"
echo "   HW: RAM ${RAM_GB}GB · 디스크 여유 ${DISK_FREE}GB"
echo
echo "   실행: bash start.sh"
echo "   접속: http://<IP>:8000"
echo "=========================================="
