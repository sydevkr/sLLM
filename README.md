# RS sLLM Chat

라즈베리파이5에서 다양한 한국어 sLLM(Small LLM)을 **쉽게 선택하고 채팅으로 써 볼 수 있는** 미니멀 웹 도구.

- **단일 사용자 / 단일 모델 / Single-shot Q&A** 구조 — RPi5 성능 최적화
- 한국어 특화 모델(EXAONE) + 다국어(Qwen, Gemma) + 비교 기준선(Llama)
- 페르소나 5종, 응답별 시스템 정보(CPU/RAM/온도) 실시간 표시

---

## 🚀 빠른 시작 (다른 시스템에서)

### 요구사항

- **OS**: Linux (Debian/Ubuntu/Raspberry Pi OS 권장), macOS 일부 지원
- **HW**: Raspberry Pi 5 (8GB 또는 16GB) 또는 동급 이상
- **디스크**: 모델 다운로드용 최소 20GB 여유 공간
- **네트워크**: 모델 다운로드 시 인터넷 필요 (운영은 100% 로컬)

### 설치 3단계

```bash
git clone <REPO_URL> sLLM
cd sLLM

# 1) 시스템 패키지 + ollama 설치 (1회만)
bash install.sh

# 2) 빌드 (Python 가상환경 + 패키지 설치)
bash build.sh

# 3) 서버 기동
bash start.sh
```

브라우저에서 `http://<RPi_IP>:8000` 접속.

> 첫 실행 시 **설치된 모델이 없으므로 모델 관리 화면**으로 자동 이동합니다. 원하는 모델 카드의 **"다운로드 후 대화"** 버튼을 누르면 바로 받아서 채팅 시작할 수 있습니다.

---

## 📦 모델 자동 다운로드 (선택)

빌드 시점에 기본 모델을 미리 받고 싶다면:

```bash
# 기본 3종 (한국어 주력 + 경량) — 약 4GB
SLLM_PULL_BASIC=1 bash build.sh

# + 7B급 추가 (16GB RAM 환경 전용) — 추가 ~10GB
SLLM_PULL_LARGE=1 bash build.sh
```

기본 3종:
- `exaone3.5:2.4b` (한국어 ★★★★★, 1.6GB)
- `gemma3:1b` (초경량 빠른 응답, 815MB)
- `qwen2.5:1.5b` (다국어 경량, 1.0GB)

---

## 🖥️ 시스템별 호환 모델

UI에서 자동으로 시스템 RAM에 맞는 모델만 표시합니다:

| RPi5 RAM | 사용 가능 모델 | 사용 불가 |
|---------|--------------|---------|
| **8GB** | 0.5B ~ 4B 모델 | 7B+ 자동 숨김 |
| **16GB** | 0.5B ~ 8B 모델 | 12B+ 빠듯 |

---

## 🎯 주요 기능

- **상단 모델 드롭다운**: 즉시 다른 모델로 전환 (대화는 클리어)
- **응답별 모니터 바**: 응답속도/토큰수/CPU/RAM/온도 실시간 표시
- **중단 버튼**: 긴 응답 중간에 즉시 취소 (백엔드 ollama까지 cancellation 전파)
- **페르소나 5종**: 기본/한국어 선생님/코드 튜터/요리사/역사 전문가
- **모델 관리 화면**: 미설치 모델 카드 클릭 → 자동 다운로드

---

## 📂 디렉토리 구조

```
sLLM/
├── install.sh         # 시스템 패키지 + ollama 설치 (1회)
├── build.sh           # Python 환경 구성 + (선택) 모델 다운로드
├── start.sh           # 서버 기동
├── stop.sh            # 서버 중지
├── backend/           # FastAPI 백엔드
│   ├── main.py
│   ├── routers/       # /api/chat, /api/models, /api/personas, /api/system
│   ├── services/      # ollama_client, system_monitor, model_registry
│   └── data/models_registry.json   # 모델 카탈로그
├── frontend/          # 단일 페이지 SPA
│   ├── index.html
│   ├── css/app.css
│   └── js/            # api, chat, models, personas, monitor, app
├── personas/          # 페르소나 프리셋 5종 (JSON)
├── scripts/check_system.sh
├── data/              # 런타임 (DB, 로그) — gitignore
└── docs/              # 설계 문서 (AI_PLAN.md, AI-SLLM-MODELS.md 등)
```

---

## 🛠️ 관리 명령

```bash
# 서버 중지
bash stop.sh

# 로그 실시간 확인
tail -f data/sllm.log

# 설치된 모델 목록
ollama list

# 특정 모델 수동 다운로드
ollama pull exaone3.5:2.4b

# 특정 모델 삭제 (디스크 회수)
ollama rm <모델명>
```

---

## 🐛 문제 해결

| 증상 | 해결 |
|------|-----|
| 첫 응답이 30~75초 걸림 | 모델 콜드 로딩(디스크→메모리). 두번째부터 빠름 |
| 7B 모델 안 보임 | RAM 부족 — 8GB 환경에선 7B+ 자동 숨김 |
| 모델 다운로드 실패 | 인터넷 확인, `ollama pull <모델명>` 수동 시도 |
| `/api/system/status` 응답 없음 | 서버 죽었을 가능성. `bash stop.sh && bash start.sh` |
| Qwen 3가 너무 느림 | thinking mode 자동 비활성화됨 (`/no_think`) — 그래도 느리면 Qwen 2.5 사용 |

---

## 📄 문서

- [docs/AI_PLAN.md](docs/AI_PLAN.md) — 전체 설계 계획
- [docs/AI-SLLM-MODELS.md](docs/AI-SLLM-MODELS.md) — 모델 카탈로그 상세

---

## 라이선스

본 프로젝트 코드: 자유 사용
모델별 라이선스는 [docs/AI-SLLM-MODELS.md](docs/AI-SLLM-MODELS.md) §9 참조 (EXAONE/HyperCLOVA는 비상업, Qwen/Gemma/Llama 등은 상업 가능)
