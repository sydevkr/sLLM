# 02ENVIRONMENT.md

## 문서 역할
- 이 문서는 현재 개발환경, 개발 스펙, 설계 구조를 설명하는 문서다.

## 개발 환경 및 스펙
- 라즈베리파이5
- 웹페이지에서 사용할 수 있는 사용자 GUI

## 발드 
- 빌드는 build.sh 에서 빌드할 수 있도록 스크립트 파일 생성 

## 실행 
- 실행은 빌드 후 start.sh 를 통해 실행할 수 있도록 스크립트 파일 생성 

## ngrok 외부 접근 (선택)

### Authtoken
- `3BcBA7fLH1ixUNQkQaPl388xYiP_7wHZsfjhorTXYDqujQbCZ`

### 사용법

```bash
# ngrok 설치 (최초 1회 — install.sh에 포함)
bash install.sh

# 외부 접근 모드로 서버 시작
NGROK=1 NGROK_AUTHTOKEN=3BcBA7fLH1ixUNQkQaPl388xYiP_7wHZsfjhorTXYDqujQbCZ bash start.sh

# 서버 + ngrok 종료
bash stop.sh
```

### 무료 플랜 제약 (2026년 기준)
- 월 1GB 대역폭 / 20,000 HTTP 요청
- 온라인 엔드포인트 3개까지
- 자동 할당 도메인 1개 (예: `xxx.ngrok-free.app`)
- 커스텀 도메인 불가
- 브라우저 첫 접속 시 ngrok 인터스티셜(경고) 페이지 표시
  - 방문자가 "Visit" 클릭 후 7일간 재표시 안 됨
  - API 호출 시 `ngrok-skip-browser-warning` 헤더로 우회 가능
- 세션 타임아웃 없음 (계속 실행 가능)
- 분당 4,000 요청 레이트 리밋

### 비용 분석
sLLM은 단일 사용자 채팅 도구이므로 **무료 플랜으로 충분**:
- 채팅 1회 = SSE 스트림 1요청 + 소량 데이터
- 하루 100회 대화 x 30일 = 3,000 요청 (한도 20,000의 15%)
- 응답 평균 2KB x 3,000 = ~6MB/월 (한도 1GB의 0.6%)
- **결론: 비용 이슈 없음**
