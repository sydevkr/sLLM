#!/usr/bin/env bash
# sLLM 서버 중지 (uvicorn + ngrok 프로세스 종료)
pkill -f "uvicorn backend.main:app" && echo "✓ uvicorn 종료" || echo "(uvicorn 프로세스 없음)"
pkill -f "ngrok http" && echo "✓ ngrok 종료" || echo "(ngrok 프로세스 없음)"
