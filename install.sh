#!/usr/bin/env bash
# ============================================================
# install.sh — sLLM 프로젝트 시스템 의존성 설치
# 다른 시스템에서 처음 클론한 뒤 한 번만 실행
# Debian/Ubuntu/Raspberry Pi OS 계열 지원
# ============================================================
set -e

echo "=========================================="
echo "   sLLM 시스템 의존성 설치"
echo "=========================================="

# ────────────────────────────────────────────────
# [1/5] OS 패키지 매니저 감지
# ────────────────────────────────────────────────
if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG_MGR="yum"
elif command -v brew >/dev/null 2>&1; then
  PKG_MGR="brew"
else
  echo "✗ 지원하지 않는 OS — apt/dnf/yum/brew 없음"
  echo "   수동 설치 필요: curl, python3 (3.11+), python3-venv, python3-pip"
  exit 1
fi
echo "[1/5] 패키지 매니저: $PKG_MGR"

# ────────────────────────────────────────────────
# [2/5] 필수 패키지 설치
# ────────────────────────────────────────────────
echo
echo "[2/5] 필수 패키지 설치 중..."

case "$PKG_MGR" in
  apt)
    sudo apt-get update -qq
    sudo apt-get install -y curl python3 python3-venv python3-pip ca-certificates
    ;;
  dnf|yum)
    sudo $PKG_MGR install -y curl python3 python3-pip ca-certificates
    ;;
  brew)
    brew install curl python@3 || true
    ;;
esac

# ────────────────────────────────────────────────
# [3/5] Python 버전 확인
# ────────────────────────────────────────────────
echo
echo "[3/5] Python 검증..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ python3 설치 실패"
  exit 1
fi
PYV=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "   Python: $PYV"
MAJ=${PYV%.*}; MIN=${PYV#*.}
if [ "$MAJ" -lt 3 ] || { [ "$MAJ" -eq 3 ] && [ "$MIN" -lt 11 ]; }; then
  echo "   ⚠️ Python 3.11+ 권장 (현재 $PYV) — 동작은 가능하나 호환성 이슈 가능"
fi
python3 -c "import venv" 2>/dev/null || { echo "✗ python3-venv 모듈 없음"; exit 1; }
echo "   ✓ venv 모듈 OK"

# ────────────────────────────────────────────────
# [4/5] Ollama 설치 (선택 — build.sh에서도 시도하나 미리 깔아두면 빌드 빨라짐)
# ────────────────────────────────────────────────
echo
echo "[4/5] Ollama 설치 확인..."
if command -v ollama >/dev/null 2>&1; then
  echo "   ✓ Ollama 이미 설치됨: $(ollama --version 2>&1 | head -1)"
else
  echo "   → Ollama 미설치. 설치 시도..."
  if [ "$(uname -s)" = "Linux" ]; then
    curl -fsSL https://ollama.com/install.sh | sh
  elif [ "$(uname -s)" = "Darwin" ]; then
    echo "   macOS는 https://ollama.com/download 에서 수동 설치 후 다시 실행하세요"
    echo "   또는: brew install ollama"
    exit 1
  else
    echo "   수동 설치 필요: https://ollama.com"
    exit 1
  fi
fi

# ────────────────────────────────────────────────
# [5/5] ngrok 설치 (선택 — 외부 접근 터널)
# ────────────────────────────────────────────────
echo
echo "[5/5] ngrok 설치 확인..."
if command -v ngrok >/dev/null 2>&1; then
  echo "   ✓ ngrok 이미 설치됨: $(ngrok version 2>&1 | head -1)"
else
  echo "   → ngrok 미설치. 설치 시도..."
  if [ "$(uname -s)" = "Linux" ]; then
    ARCH=$(uname -m)
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
      NGROK_ARCH="arm64"
    elif [ "$ARCH" = "x86_64" ]; then
      NGROK_ARCH="amd64"
    else
      echo "   ⚠️ 미지원 아키텍처: $ARCH — 수동 설치 필요: https://ngrok.com/download"
      NGROK_ARCH=""
    fi
    if [ -n "$NGROK_ARCH" ]; then
      curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${NGROK_ARCH}.tgz" \
        | sudo tar xz -C /usr/local/bin
      echo "   ✓ ngrok 설치 완료: $(ngrok version 2>&1 | head -1)"
    fi
  elif [ "$(uname -s)" = "Darwin" ]; then
    echo "   macOS: brew install ngrok 으로 설치하세요"
  else
    echo "   수동 설치 필요: https://ngrok.com/download"
  fi
fi

echo
echo "=========================================="
echo "   ✅ 시스템 의존성 설치 완료"
echo
echo "   다음 단계: bash build.sh"
echo "=========================================="
