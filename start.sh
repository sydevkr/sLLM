#!/usr/bin/env bash
# sLLM 서버 기동
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# 기존 프로세스 정리
pkill -f "uvicorn backend.main:app" 2>/dev/null && echo "→ 기존 uvicorn 종료" && sleep 1 || true
pkill -f "ngrok http" 2>/dev/null && echo "→ 기존 ngrok 종료" && sleep 1 || true

if [ ! -d .venv ]; then
  echo "✗ .venv 없음. 먼저 'bash build.sh' 실행 필요"
  exit 1
fi

# ollama 확인 (미설치 시 스킵 — VLM 전용 모드에서는 불필요)
if command -v ollama >/dev/null 2>&1; then
  if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "→ ollama 서비스 시작..."
    if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q ollama; then
      sudo systemctl start ollama 2>/dev/null || nohup ollama serve >/tmp/ollama.log 2>&1 &
    else
      nohup ollama serve >/tmp/ollama.log 2>&1 &
    fi
    for i in $(seq 1 20); do
      if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then break; fi
      sleep 1
    done
  fi
else
  echo "ℹ️  ollama 미설치 — LLM 채팅은 ollama 설치 후 사용 가능"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
PORT=${PORT:-8000}
NGROK=${NGROK:-0}
NGROK_AUTHTOKEN=${NGROK_AUTHTOKEN:-3BcBA7fLH1ixUNQkQaPl388xYiP_7wHZsfjhorTXYDqujQbCZ}

# ── ngrok 터널 (NGROK=0 으로 끌 수 있음, 기본 ON) ──
NGROK_URL=""
if [ "${NGROK}" = "1" ]; then
  if ! command -v ngrok >/dev/null 2>&1; then
    echo "⚠️  ngrok 미설치. 'bash install.sh' 실행 후 다시 시도하세요."
    echo "   (ngrok 없이 로컬 모드로 시작합니다)"
  elif [ -z "$NGROK_AUTHTOKEN" ]; then
    echo "⚠️  NGROK_AUTHTOKEN 미설정. 예:"
    echo "   NGROK=1 NGROK_AUTHTOKEN=<토큰> bash start.sh"
    echo "   (ngrok 없이 로컬 모드로 시작합니다)"
  else
    # authtoken 설정
    ngrok config add-authtoken "$NGROK_AUTHTOKEN" >/dev/null 2>&1

    # 기존 ngrok 프로세스 정리
    pkill -f "ngrok http" 2>/dev/null || true
    sleep 1

    # ngrok 백그라운드 시작
    nohup ngrok http "$PORT" --log=stdout --log-format=json > /tmp/ngrok.log 2>&1 &

    # ngrok API 준비 대기 (최대 10초)
    echo "→ ngrok 터널 시작 중..."
    for i in $(seq 1 10); do
      NGROK_URL=$(curl -sf http://127.0.0.1:4040/api/tunnels 2>/dev/null \
        | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print(t[0]['public_url'] if t else '')" 2>/dev/null) || true
      if [ -n "$NGROK_URL" ]; then break; fi
      sleep 1
    done

    if [ -z "$NGROK_URL" ]; then
      echo "⚠️  ngrok URL 추출 실패. /tmp/ngrok.log 확인."
      echo "   (로컬 모드로 계속합니다)"
    fi
  fi
fi

echo "=========================================="
echo "  sLLM Chat 서버 시작"
echo "  LLM 채팅: http://${IP:-localhost}:${PORT}"
echo "  VLM 분석: http://${IP:-localhost}:${PORT}/vlm"
echo "  API 문서: http://${IP:-localhost}:${PORT}/docs"
if [ -n "$NGROK_URL" ]; then
  echo "  외부:     ${NGROK_URL}"
  echo "  외부 VLM: ${NGROK_URL}/vlm"
  echo ""
  echo "  ⚠️ ngrok 무료 플랜: 월 1GB / 20,000 요청 제한"
fi
echo "=========================================="

exec ./.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port "$PORT" --app-dir .
