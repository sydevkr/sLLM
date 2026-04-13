#!/usr/bin/env bash
# sLLM 서버 기동
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ ! -d .venv ]; then
  echo "✗ .venv 없음. 먼저 'bash build.sh' 실행 필요"
  exit 1
fi

# ollama 확인
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

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
PORT=${PORT:-8000}
echo "=========================================="
echo "  sLLM Chat 서버 시작"
echo "  접속: http://${IP:-localhost}:${PORT}"
echo "  API 문서: http://${IP:-localhost}:${PORT}/docs"
echo "=========================================="

exec ./.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port "$PORT" --app-dir .
