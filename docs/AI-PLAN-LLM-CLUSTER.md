# AI-PLAN-LLM-CLUSTER.md — LLM 클러스터 에이전트 페이지 설계 및 기술 검토

> 작성일: 2026-04-15
> 대상 하드웨어: Raspberry Pi 5 × 3대 (확장 가능)
> 목적: 단일 노드 sLLM 서비스를 3대 클러스터로 확장해 첫 응답 지연 제거 + 동시 사용자 확장
> 전제 문서: [AI-PLAN.md](AI-PLAN.md) (단일 노드 설계), [01REQUIREMENTS.md](01REQUIREMENTS.md), [02ENVIRONMENT.md](02ENVIRONMENT.md), [03TASKS.md](03TASKS.md)

---

## 0. 배경 및 정체성

프로젝트는 최종적으로 **4개의 독립 웹페이지**로 구성된다 ([02ENVIRONMENT.md §구현하게 될 LLM/VLM 에이전트 페이지](02ENVIRONMENT.md)):

1. `/` — **LLM 에이전트** (단일 노드, 기존 구현 완료)
2. `/llm-cluster` — **LLM 클러스터 에이전트** ← **본 문서의 대상**
3. `/vlm` — **VLM 에이전트** (단일 노드, 기존 구현 완료)
4. `/vlm-cluster` — **VLM 클러스터 에이전트** (향후, 본 문서 밖)

본 문서는 **기존 `/` 페이지를 건드리지 않고** 별도 페이지에서 3대 라즈베리파이5 클러스터 기반 LLM 서비스를 제공하는 설계다.

### 요구사항 ([03TASKS.md §진행중 · 클러스터 분산 처리 (for LLM)](03TASKS.md))

- **R1**: 라즈베리파이5 3대로 LLM 서비스 구축
- **R2**: LLM 서비스는 웹 서비스를 통해 제공 (별도 `/llm-cluster` 페이지)
- **R3**: 라즈베리파이5 한 대보다 속도와 성능 개선
- **R4**: 보드 수 증가 시 속도/동시 사용자 확장 가능한 구조
- **R5**: 위 기능 구현 가능성 기술 검토 (3대 1차 작업)

---

## 0.1 클러스터 적용 시 기대 효과 (Summary)

### A. 정량 효과 (단일 보드 대비)

| 항목 | 단일 RPi5 | 3노드 클러스터 | 효과 |
|---|---|---|---|
| **첫 토큰 지연 (신규 모델 요청 시)** | 30~75s (콜드 로딩) | **1~3s (상시 웜)** | 🚀 **10~75배 개선** |
| **첫 토큰 지연 (동일 모델 연속)** | 1~3s | 1~3s | = 동일 |
| **토큰 생성 속도 (tok/s)** | 5~15 tok/s | 5~15 tok/s | = **불변** (메모리 대역폭 한계) |
| **모델 전환 시간** | 30~75s (언로드+로드) | **0s** (각 모델이 다른 노드에 상주) | 🚀 즉시 전환 |
| **동시 다른-모델 사용자** | 1명 (직렬) | **3명 병렬** | 🚀 3배 |
| **동시 같은-모델 사용자** | 1명 | 1명/노드 | = 동일 |
| **모델 상시 상주 가능 수** | 1개 (RAM 8GB 기준) | **3개 (EXAONE + Qwen + Gemma 동시)** | 🚀 3배 |
| **노드 장애 시 서비스** | 전체 중단 | **Secondary 페일오버** (~30~75s 콜드 로드) | 🚀 가용성 확보 |

### B. 정성 효과 (사용자 체감)

| 효과 | 설명 |
|---|---|
| **"언제 써도 바로 응답"** | 콜드 로딩 대기(30~75s) 완전 제거 — 첫 방문 사용자/오래 안 쓴 사용자도 즉시 체험 |
| **"모델 A/B 비교가 자연스러움"** | 드롭다운 전환 → 즉시 응답 가능 → 한국어 특화 vs 다국어 vs 경량 모델 실전 비교 UX 가능 |
| **"동료와 동시 사용"** | 데모/워크숍에서 3명이 서로 다른 모델로 동시 채팅 가능 |
| **"노드 하나 죽어도 서비스 지속"** | 단일 장애점(SPOF) 제거, 운영 안정성 상승 |
| **"보드 추가만으로 확장"** | 새 모델 실험 시 전용 보드 할당 → 기존 서비스 영향 없음 (R4 구조) |

### C. 확장 시 기대 효과 (R4 검증)

| 보드 수 | 상시 웜 모델 | 동시 다른-모델 사용자 | 전체 장애 내성 |
|---|---|---|---|
| 1대 (baseline) | 1개 | 1명 | ❌ SPOF |
| **3대 (본 설계)** | **3개** | **3명** | ✅ 1대 장애 허용 |
| 5대 | 5개 | 5명 | ✅ 2대 장애 허용 |
| 10대 | 10개 | 10명 | ✅ 4~5대 장애 허용 |

→ **모델 슬롯과 동시 사용자 수가 보드 수에 선형 비례**. 특정 모델 수요가 많으면 해당 모델을 여러 보드에 복제해 라운드로빈도 가능.

### D. 한계 — 정직하게 밝혀야 할 것

| 기대하지 말 것 | 이유 |
|---|---|
| ❌ 토큰 생성이 2~3배 빨라질 것 | RPi5 메모리 대역폭(~17GB/s)이 local bus 한계. Gigabit Ethernet(125MB/s)로는 분산 불가. 한 노드의 한 모델은 여전히 5~15 tok/s |
| ❌ 7B+ 큰 모델이 3대 합쳐서 동작할 것 | llama.cpp RPC 텐서 분할은 기가비트 LAN에서 **더 느려짐** (기법별 판정 §1.1 참조) |
| ❌ 같은 모델 동시 사용자 3배 | 같은 모델은 단일 primary 노드의 Ollama 직렬 처리 제약이 그대로 남음 (보드 추가 복제로만 완화) |
| ❌ Hailo NPU로 LLM 가속 | Hailo GenAI는 VLM만 지원, 텍스트 LLM용 HEF 없음 |

### E. 이해관계자 한 줄 요약

> **"토큰이 빨리 쏟아지지는 않지만, 누구에게나 언제든 1~3초 안에 응답이 시작되고, 3명이 동시에 서로 다른 모델로 대화할 수 있는 서비스를 3대 보드로 만든다. 보드를 늘리면 그만큼 선형으로 확장된다."**

---

## 1. 기술 검토 결론 (Feasibility)

### 1.1 기법별 판정 (설계 제약으로 사용)

| 기법 | 판정 | 근거 |
|---|---|---|
| **llama.cpp RPC 텐서 분할** (`llama-server --rpc`) | ❌ NOT VIABLE | 기가비트 LAN(≈125MB/s)에서 32레이어 중 20레이어 오프로드 시 토큰당 40~120ms 추가 오버헤드 → 단일노드(토큰당 100~200ms)의 **2배 이상 느려짐**. 또한 Ollama가 `--rpc` 플래그를 노출하지 않아 Ollama 폐기 + 모델 레지스트리/프리로드 API 재구현 필요 |
| **vLLM / TGI 텐서 패러럴** | ❌ NOT VIABLE | CUDA 전용. ARM64 CPU 분산 백엔드 없음. RPi5에서 실행 불가 |
| **파이프라인 패러럴리즘** | ❌ NOT VIABLE | Pipeline bubble 문제 — 대화형 단일 토큰 생성에서 RPC보다 더 나쁨. Off-the-shelf 툴 없음 |
| **Speculative Decoding** (`llama.cpp --draft`) | ⚠️ MARGINAL | 단일 16GB 보드에서 ~1.5배 속도. **두 모델이 같은 프로세스에 상주해야 함** → 멀티노드 기법 아님, Ollama 지원 안 함. 단일보드 POC용 |
| **요청 레벨 병렬 + 모델 어피니티** | ✅ **VIABLE** | 각 노드에 전담 모델을 `keep_alive=-1`로 상시 웜. **콜드 로딩 30~75s를 제거**하는 것이 R3의 실질 효과 |
| **Hailo-10H에 텍스트 LLM 오프로드** | ❌ 지원 안 됨 | Hailo GenAI는 현재 VLM(Qwen2-VL-2B)만 지원. 일반 텍스트 LLM용 HEF 없음 |

### 1.2 핵심 인사이트 — RPi5의 물리적 한계

- **메모리 대역폭 병목**: RPi5 LPDDR4X ~17GB/s. 7B Q4 모델(≈4GB 가중치) 토큰 1개당 전체 가중치 1회 읽기 → ~235ms/토큰(≈4.3 tok/s)이 이론 상한. **이 한계는 Ethernet으로 분산 불가** (로컬 버스이므로)
- **Gigabit Ethernet (125MB/s)** 은 메모리 대역폭보다 136배 느림 → 레이어 활성화를 네트워크로 보내는 순간 손해

### 1.3 병렬 처리의 한계성 (⚠️ 반복 재검토 방지용)

**질문**: "답변 1개의 행렬 연산을 3대 노드에 쪼개 병렬로 돌리면 빨라지지 않나?"
**답**: 아이디어 자체는 정통 기법(ChatGPT/Claude가 수백 GPU로 그렇게 함). 단 **RPi5 + 1GbE 조합에선 노드 간 대역폭이 로컬 메모리보다 136배 느려서 역효과**. 그래서 본 프로젝트는 "한 답변 가속" 대신 "요청별 병렬 + 모델 상시 웜"을 선택했다.

#### LLM 답변 생성의 구조

```
프롬프트 → Embedding → Block #1 → Block #2 → … → Block #N → 출력층 → 토큰 1개
                         └─ 각 Block 내부: MHA(Q/K/V/Out matmul) + FFN(Up/Down matmul) ─┘
(토큰 1개 나오면 입력에 붙여서 처음부터 반복 — autoregressive)
```

Llama/Qwen 7B: N=32. 연산량의 ~2/3은 각 Block의 **matmul**.

#### 무엇이 병렬 가능하고 무엇이 순차 강제인가

| 축 | 병렬? | 이유 |
|---|---|---|
| Block 간 순서 (#1 → #N) | ❌ | 데이터 의존 (N 입력 = N-1 출력) |
| Token 간 생성 (Decode) | ❌ | autoregressive — K번째는 K-1 이후에만 결정 |
| **Block 내부 matmul** | ✅ | 행/열 분할 = **Tensor Parallelism** ← 사용자 직관이 맞는 부분 |
| Multi-Head Attention의 head | ✅ | 각 head 독립 계산 |
| Prefill (프롬프트 일괄 처리) | ✅ | 토큰 간 동시 처리 가능 |

연산을 쪼개는 것 자체는 **수학적으로 가능**. 문제는 쪼갠 결과를 매 Block마다 네트워크로 합쳐야 한다는 점.

#### 왜 RPi5 환경에선 쪼개도 안 빨라지나

Tensor Parallelism 은 매 Block 마다 "분배 → 부분 계산 → AllReduce" 동기화를 요구한다. 이 동기화 비용이 얻는 이득을 잡아먹는다.

| 환경 | 로컬 메모리 | 노드 간 네트워크 | 비율 |
|---|---|---|---|
| H100 + NVLink (데이터센터) | 3,350 GB/s | 900 GB/s | 1 : 3.7 → 쪼개면 이득 |
| **RPi5 + 1GbE** | **17 GB/s** | **0.125 GB/s** | **1 : 136 → 쪼개면 손해** |

추가로 TCP/IP 오버헤드, barrier 대기, KV 캐시 동기화, 소량 메시지 비효율 등이 누적. 실측(llama.cpp RPC on ARM) 에서도 3노드 Tensor Parallelism 이 단일노드와 같거나 느리다.

**핵심 원리**: 메모리 대역폭은 칩 로컬이라 Ethernet으로 "합칠 수" 없다. RPi5 3대 = 51 GB/s 공유가 아니라 각자 17 GB/s.

#### 본 프로젝트의 선택

| 기법 | 채택 |
|---|---|
| ❌ Tensor/Pipeline Parallelism (한 답변 가속) | 불가 |
| ✅ **Data Parallelism** (요청별 병렬) | 채택 — 처리량 개선 |
| ✅ **Model Affinity** (상시 웜) | 채택 — 콜드 로딩 30~75s 제거 |

#### 재검토 트리거

아래 중 하나라도 나오면 본 섹션 재평가:
- RPi5 후속 세대의 **10GbE / PCIe 보드간 직결** 지원
- Hailo 등 NPU의 **텍스트 LLM HEF** 지원
- **활성화 양자화 전송**(int4/int8) 이 Ollama/llama.cpp 에 통합

그 전까지는 Data Parallel + Model Affinity 가 이 하드웨어 환경의 이론 최적에 가깝다.

---

### 1.4 R3 재정의 (이해관계자용 프레이밍)

요구사항 "단일 RPi5 대비 빠른 응답"은 **두 측면으로 분리해 이해**해야 한다:

| 측면 | 단일 노드 | 3노드 클러스터 | 평가 |
|---|---|---|---|
| **첫 토큰 지연** (콜드) | 30~75s | **1~3s 고정** | ✅ 압도적 개선 (모델 상시 웜) |
| **첫 토큰 지연** (웜) | 1~3s | 1~3s | = 동일 |
| **토큰 생성 속도** | 5~15 tok/s | **5~15 tok/s (불변)** | = 동일 (메모리 대역폭 한계, §1.3 참조) |
| **동시 다른-모델 사용자** | 1명 | **3명** | ✅ 3배 (선형 확장) |
| **동시 같은-모델 사용자** | 1명 | 1명/해당노드 | = 동일 (Ollama 직렬 처리) |

**결론**: 사용자 체감에서는 "언제 써도 바로 응답 시작하는 서비스"로 확실히 개선되지만, "토큰이 2배 빨리 쏟아진다"는 아님. 이해관계자에 정직하게 설명 필수.

---

## 2. 아키텍처 — Gateway-co-located on Node-A

### 2.1 3노드 구성도 (3대 제약 반영)

```
┌─────────────────── Node A (Gateway + Worker) ───────────────────┐
│  FastAPI :8000                                                   │
│    ├─ /                (단일노드 LLM, 기존, 변경 없음)            │
│    ├─ /vlm             (VLM, 기존, 변경 없음)                     │
│    ├─ /llm-cluster     (신규 — 클러스터 대시보드 + 채팅)          │
│    ├─ /api/chat        (단일노드, 기존)                           │
│    ├─ /api/vlm/*       (VLM, 기존)                                │
│    └─ /api/cluster/*   (신규)                                     │
│  Ollama :11434 (OLLAMA_HOST=0.0.0.0:11434)                       │
│    └─ EXAONE 3.5 2.4B (keep_alive=-1 상시 웜)                    │
└──────────────────┬─────────────────────────┬───────────────────┘
                   │  Gigabit LAN            │
         ┌─────────▼──────┐          ┌──────▼──────────┐
         │ Node B (Worker) │          │ Node C (Worker) │
         │ FastAPI :8000    │          │ FastAPI :8000    │
         │  └─ /api/cluster/│          │  └─ /api/cluster/│
         │     worker/health│          │     worker/health│
         │ Ollama :11434    │          │ Ollama :11434    │
         │  (0.0.0.0 바인드) │          │  (0.0.0.0 바인드) │
         │  Qwen 2.5 3B 웜  │          │  Gemma 3 4B 웜   │
         └─────────────────┘          └─────────────────┘
```

**설계 선택 이유**: 보드 3대 제약 하에서 전용 게이트웨이를 둘 여유가 없으므로, Node A가 게이트웨이 + 워커 겸임. Node B/C는 워커 전용 (FastAPI는 헬스 엔드포인트만 노출).

### 2.2 요청 흐름

```
[브라우저]
   │ POST /api/cluster/chat { model: "qwen2.5:3b", prompt, persona_id }
   ▼
[Node A · Gateway · cluster_router.py]
   │ 1. 어피니티 맵 조회: "qwen2.5:3b" → primary="b"
   │ 2. Node B 헬스 캐시 확인 → alive
   │ 3. OllamaClient(base_url="http://rpi-b:11434") 호출
   ▼
[Node B · Ollama :11434]   (qwen2.5:3b 상시 웜)
   │ /api/generate stream=true
   │ 토큰 스트림 반환
   ▼
[Node A · Gateway]
   │ SSE 이벤트로 릴레이:
   │   { type: "token", content: "..." }
   │   { type: "done", served_by: "b", tokens_sec, total_ms, ... }
   ▼
[브라우저]
```

### 2.3 핵심 설계 원칙

1. **Stateless 유지**: Single-shot Q&A ([AI-PLAN.md §0 참조](AI-PLAN.md)) — 세션 어피니티 불필요, 어떤 노드도 어떤 요청 처리 가능
2. **기존 `OllamaClient` 재사용**: `backend/services/ollama_client.py` 의 `OllamaClient(base_url=...)` 파라미터를 활용. 노드별 인스턴스화, 코드 중복 없음
3. **워커 Ollama LAN 노출**: `OLLAMA_HOST=0.0.0.0:11434` 로 각 워커 Ollama를 Gateway에서 직접 호출 (프록시 홉 제거)
4. **기존 경로 불가침**: `/`, `/vlm`, `/api/chat`, `/api/vlm/*` 변경 금지 — 리그레션 방지

---

## 3. 모델 어피니티 및 라우팅

### 3.1 어피니티 맵 (`backend/data/cluster_affinity.json` 신규)

```json
{
  "default_node": "a",
  "affinity": {
    "exaone3.5:2.4b": { "primary": "a", "secondary": ["b", "c"] },
    "qwen2.5:3b":     { "primary": "b", "secondary": ["a", "c"] },
    "gemma3:4b":      { "primary": "c", "secondary": ["a", "b"] }
  }
}
```

- **primary**: 상시 웜으로 유지되는 기본 노드
- **secondary**: primary down 시 페일오버 대상. secondary에는 해당 모델이 웜이 아닐 수 있음 → 콜드 로딩 가능성 사용자에게 경고
- **default_node**: 어피니티 맵에 없는 모델은 이 노드로 라우팅 (Ollama가 필요 시 pull + 로드)

### 3.2 라우팅 알고리즘 (`cluster_router.py`)

```
async def route_request(model: str) -> (node_id, OllamaClient):
    entry = affinity.get(model) or { primary: default_node, secondary: [] }

    # 1. primary 시도
    if health[entry.primary].ollama_alive:
        return entry.primary, clients[entry.primary]

    # 2. secondary 순회 (SSE warning 이벤트 발생)
    for sec in entry.secondary:
        if health[sec].ollama_alive:
            emit_warning(f"primary={entry.primary} down, falling back to {sec}. Cold-load possible (30~75s).")
            return sec, clients[sec]

    # 3. 모두 down
    raise ClusterUnavailableError()
```

### 3.3 헬스 체크

- **워커 엔드포인트**: `GET /api/cluster/worker/health` (모든 노드에 노출)
  - 반환: `{ node_id, cpu_percent, ram_used_mb, ram_total_mb, temp_c, ollama_alive, loaded_models: [...] }`
  - 재사용: [backend/services/system_monitor.py](../backend/services/system_monitor.py) `snapshot()` + `OllamaClient.list_models()`
- **Gateway 폴링**: 5초 간격으로 각 노드 헬스 체크, 결과 캐시
- **프론트엔드 폴링**: 2초 간격으로 `GET /api/cluster/nodes` 호출

### 3.4 동시성

- **서로 다른 모델**: 각 노드가 병렬 처리 → 3명까지 선형
- **같은 모델**: 해당 primary 노드의 Ollama가 직렬 처리 (단일 노드와 동일 제약)
  - 개선 옵션: Ollama 0.6+ 의 `OLLAMA_NUM_PARALLEL=2` 환경변수 — 단 메모리 대역폭 공유로 속도 저하 동반
- **페일오버 시**: secondary로 이동하면 primary 복구 후 자동 원복

---

## 4. API 표면

### 4.1 Gateway 전용 (Node A에만 노출)

| 엔드포인트 | 메서드 | 설명 |
|---|---|---|
| `/api/cluster/chat` | POST | `{model, prompt, persona_id}` → SSE. 이벤트: `warning`(선택), `token`, `done{served_by, tokens_sec, load_ms, ...}`, `error` |
| `/api/cluster/nodes` | GET | 모든 노드 헬스 + 로드된 모델 목록 |
| `/api/cluster/models` | GET | 모델 카탈로그 + `{primary_node, secondary_nodes, is_warm, warm_on_node}` 주석 |
| `/api/cluster/models/{id}/warm` | POST | primary 노드에 `keep_alive=-1` 프리로드 |

### 4.2 모든 노드 공통

| 엔드포인트 | 메서드 | 설명 |
|---|---|---|
| `/api/cluster/worker/health` | GET | 자기 노드의 헬스 (Gateway가 폴링) |

### 4.3 기존 API (변경 없음)

- `/api/chat`, `/api/models`, `/api/personas`, `/api/system`, `/api/vlm/*` — 기존 단일노드 동작 그대로

---

## 5. 페이지 구조 — `frontend-cluster/`

기존 `frontend-vlm/` 패턴을 복제. Node A의 FastAPI 에 `/llm-cluster` 로 정적 마운트.

```
frontend-cluster/
  index.html                 # 채팅 UI + 상단 3노드 상태 패널
  css/
    app.css                  # 기본 테마 + 노드 카드 스타일
  js/
    api.js                   # clusterChatStream (SSE), /api/cluster/* 클라이언트
    monitor.js               # /api/cluster/nodes 2초 폴링, 3개 카드 렌더
    chat.js                  # frontend/js/chat.js 포크, "served by node-X" 표시
    models.js                # 모델 드롭다운에 노드 라벨 ("Qwen 2.5 3B (Node B)")
    personas.js              # frontend/js/personas.js 직접 재사용
    app.js                   # 페이지 컨트롤러
```

### 5.1 메인(`/`) 페이지와의 차이점

| 기능 | `/` 메인 | `/llm-cluster` |
|---|---|---|
| 상단 노드 상태 패널 | 없음 (단일 모니터 바) | **3개 카드 대시보드** (CPU/RAM/온도/모델, 상태등) |
| 모델 드롭다운 | 단순 모델명 | "EXAONE 3.5 2.4B (Node A)" 식 노드 라벨 |
| 응답 완료 메타 | tokens_sec, total_ms | + `served_by: node-b` |
| Warm-up 버튼 | 암묵적 (선택 시) | 명시적 `POST /models/{id}/warm` 버튼 |
| 페일오버 경고 | 없음 | SSE `warning` 이벤트 수신 시 UI 배너 |

### 5.2 재사용 원칙

- **SSE 파서**: `frontend/js/api.js` 의 SSE 파싱 로직 포크 (엔드포인트만 변경)
- **채팅 렌더링**: `frontend/js/chat.js` 포크, `send()` 에서 `API.clusterChatStream()` 호출
- **페르소나 피커**: `frontend/js/personas.js` 직접 재사용 (동작 동일)
- **CSS 테마**: `frontend/css/app.css` 기반 + 노드 카드 스타일 확장

---

## 6. 배포

### 6.1 환경 변수

**Node A (Gateway)**:
```bash
NODE_ROLE=gateway NODE_ID=a \
CLUSTER_NODES="http://rpi-a:8000,http://rpi-b:8000,http://rpi-c:8000" \
OLLAMA_HOST=0.0.0.0:11434 \
bash start.sh
```

**Node B (Worker)**:
```bash
NODE_ROLE=worker NODE_ID=b \
OLLAMA_HOST=0.0.0.0:11434 \
bash start.sh
```

**Node C (Worker)**: 동일 패턴, `NODE_ID=c`

### 6.2 `config.py` 추가

```python
FRONTEND_CLUSTER_DIR = ROOT_DIR / "frontend-cluster"
NODE_ROLE = os.getenv("NODE_ROLE", "standalone")  # standalone|gateway|worker
NODE_ID = os.getenv("NODE_ID", "a")
CLUSTER_NODES = os.getenv("CLUSTER_NODES", "")  # comma-separated URLs
CLUSTER_AFFINITY_PATH = BACKEND_DIR / "data" / "cluster_affinity.json"
```

### 6.3 `main.py` 수정

```python
# 1. 라우터 추가
from routers import chat, models, personas, system, vlm, cluster
app.include_router(cluster.router, prefix="/api")

# 2. /llm-cluster 리다이렉트 (VLM 패턴)
@app.get("/llm-cluster")
async def cluster_redirect():
    return RedirectResponse(url="/llm-cluster/")

# 3. 정적 마운트 (/ 앞에, /vlm 다음에)
if NODE_ROLE in ("gateway", "standalone") and FRONTEND_CLUSTER_DIR.exists():
    app.mount("/llm-cluster", StaticFiles(directory=..., html=True), name="cluster-frontend")

# 4. startup 훅 — ClusterRouter 헬스 폴링 태스크 시작
```

### 6.4 `start.sh` 수정

- `NODE_ROLE=worker` 면 `/llm-cluster` 배너 숨김
- `NODE_ROLE=gateway|standalone` 시 URL 안내에 `http://IP:8000/llm-cluster` 포함
- `OLLAMA_HOST` 환경변수 안내 문구 추가

### 6.5 변경하지 않는 것

- `install.sh`, `build.sh` — 모든 노드 동일 설치
- ngrok — Gateway 노드에만 (기존 `NGROK=1` 플래그 그대로)
- `backend/routers/chat.py`, `backend/services/ollama_client.py`, `frontend/`, `frontend-vlm/`

### 6.6 신규 워커 추가 (R4 확장성)

```
1. 신규 RPi5에 git clone + bash install.sh + bash build.sh
2. NODE_ROLE=worker NODE_ID=d OLLAMA_HOST=0.0.0.0:11434 bash start.sh
3. Gateway 노드의 CLUSTER_NODES 에 URL 추가: "...,http://rpi-d:8000"
4. Gateway FastAPI 재시작 (Phase D 완료 후에는 자동 등록)
5. cluster_affinity.json 에 신규 모델 ↔ node-d 매핑 추가
```

---

## 7. 파일 목록

### 7.1 신규 생성

| 경로 | 설명 |
|---|---|
| `backend/routers/cluster.py` | `/api/cluster/*` 라우터 |
| `backend/services/cluster_router.py` | 노드 레지스트리, 헬스 폴링, 어피니티 라우팅, 페일오버 |
| `backend/data/cluster_affinity.json` | 모델 ↔ 노드 매핑 |
| `frontend-cluster/index.html` | 페이지 HTML |
| `frontend-cluster/css/app.css` | 스타일 (3노드 카드 포함) |
| `frontend-cluster/js/api.js` | API 클라이언트 |
| `frontend-cluster/js/monitor.js` | 다노드 모니터 |
| `frontend-cluster/js/chat.js` | 채팅 로직 |
| `frontend-cluster/js/models.js` | 모델 피커 (노드 라벨) |
| `frontend-cluster/js/personas.js` | 페르소나 피커 (기존 복사) |
| `frontend-cluster/js/app.js` | 앱 컨트롤러 |

### 7.2 수정

| 경로 | 변경 |
|---|---|
| `backend/config.py` | `FRONTEND_CLUSTER_DIR`, `NODE_ROLE`, `NODE_ID`, `CLUSTER_NODES`, `CLUSTER_AFFINITY_PATH` 추가 |
| `backend/main.py` | cluster 라우터 등록, `/llm-cluster` 마운트 + 리다이렉트, `ClusterRouter.start()` startup 훅 |
| `start.sh` | `NODE_ROLE` 분기, 배너 조건부 출력, `OLLAMA_HOST` 안내 |

### 7.3 변경 금지

- `backend/routers/chat.py`
- `backend/services/ollama_client.py` (단, `base_url` 인자 재사용만 함)
- `frontend/` (단일노드 페이지)
- `frontend-vlm/` (VLM 페이지)
- `install.sh`, `build.sh`

---

## 8. 단계별 구현 (Phased Delivery)

### Phase A — MVP (페이지 스캐폴드 + 라운드로빈)

**목표**: End-to-end 동작 증명. 최소 기능으로 빠르게 띄운다.

**산출물**:
- `frontend-cluster/` 기본 UI (채팅 + 3노드 상태 패널)
- `backend/routers/cluster.py` — `POST /api/cluster/chat` (단순 round-robin)
- `backend/services/cluster_router.py` — `CLUSTER_NODES` 파싱 + 헬스 폴링
- `GET /api/cluster/nodes` — 라이브 헬스 반환
- `config.py`, `main.py` 마운트 로직

**검증**: 로컬 Docker 3 Ollama 인스턴스로 시뮬레이션, `/llm-cluster` 페이지 로드 + 노드 카드 + round-robin 채팅 동작

### Phase B — 모델 어피니티 + 상시 웜 (R3 핵심 가치)

**목표**: 콜드 로딩 제거로 사용자 체감 개선.

**산출물**:
- `backend/data/cluster_affinity.json`
- `ClusterRouter.route_request()` 어피니티 기반
- `POST /api/cluster/models/{id}/warm` — primary 노드에 `keep_alive=-1` 프리로드
- Gateway startup에서 모든 affinity 모델 자동 웜업
- `GET /api/cluster/models` — 노드 어사인먼트 + 웜 상태
- 프론트 모델 드롭다운 노드 라벨 + `served_by` 표시

**검증**: 3모델 지정 후 첫 응답 지연 1~3s 유지 확인, 모델 스위치 시 즉시 응답

### Phase C — 페일오버 + 상태 색상 UI

**목표**: 노드 장애에 강건한 동작.

**산출물**:
- primary down 시 secondary 자동 라우팅
- SSE `warning` 이벤트로 사용자 통지
- "Warm-on-demand" — secondary에 모델 없으면 load 먼저
- 프론트 노드 카드 색상 (초록/노랑/빨강)
- primary 복구 시 자동 원복

**검증**: 워커 1대 kill → 빨강 + fallback + warning 수신, 복구 시 초록 + primary 라우팅

### Phase D — N노드 자동 등록 (R4 구조)

**목표**: 보드 추가만으로 확장.

**산출물**:
- `POST /api/cluster/nodes/register` — 워커 자가 등록
- 워커 startup에서 `GATEWAY_URL` 에 등록 호출
- Gateway 재시작 없이 live join/leave
- 프론트 동적 N노드 카드 렌더
- 어피니티 재분배 힌트 UI

**검증**: 4번째 워커 추가 → Gateway 재시작 없이 카드 추가, 새 모델 어사인

---

## 9. 로컬 시뮬레이션 (RPi5 배포 전 검증)

### 9.1 Docker로 3 Ollama 인스턴스

```bash
docker run -d --name ollama-a -p 11434:11434 -v ollama-a:/root/.ollama ollama/ollama
docker run -d --name ollama-b -p 11435:11434 -v ollama-b:/root/.ollama ollama/ollama
docker run -d --name ollama-c -p 11436:11434 -v ollama-c:/root/.ollama ollama/ollama

# 각 인스턴스에 모델 pull
docker exec ollama-a ollama pull exaone3.5:2.4b
docker exec ollama-b ollama pull qwen2.5:3b
docker exec ollama-c ollama pull gemma3:4b
```

### 9.2 Gateway 단독 실행 (CLUSTER_NODES 를 직접 Ollama 포트로)

```bash
# 간이 검증 — Gateway만 FastAPI 띄우고 3 Ollama 직접 호출
NODE_ROLE=gateway NODE_ID=a \
CLUSTER_NODES="http://localhost:11434,http://localhost:11435,http://localhost:11436" \
bash start.sh
```

(실제로는 `CLUSTER_NODES`는 워커 FastAPI URL 이지만, 로컬 POC에서는 Ollama URL 로 단축 가능. 본 구현 시 헬스 엔드포인트가 FastAPI 쪽이므로 별도 simulate 필요)

### 9.3 curl 체크리스트

```bash
# 노드 상태
curl http://localhost:8000/api/cluster/nodes

# 클러스터 모델 목록 (노드 어사인먼트 포함)
curl http://localhost:8000/api/cluster/models

# 모델 웜업
curl -X POST http://localhost:8000/api/cluster/models/exaone3.5:2.4b/warm

# 클러스터 채팅 (SSE)
curl -N -X POST http://localhost:8000/api/cluster/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"exaone3.5:2.4b","prompt":"안녕하세요, 자기소개 해주세요"}'

# 페르소나 포함
curl -N -X POST http://localhost:8000/api/cluster/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5:3b","prompt":"파이썬 리스트 컴프리헨션 설명","persona_id":"code_tutor"}'
```

### 9.4 수동 테스트 체크리스트

- [ ] `/llm-cluster` 페이지 로드, 3노드 카드 표시
- [ ] 노드 카드 2초마다 라이브 업데이트 (CPU/RAM/온도)
- [ ] 모델 피커에 노드 어사인먼트 라벨 표시
- [ ] 모델 선택 시 Warm-up 버튼 동작, `is_warm=true` 반환
- [ ] SSE 토큰 스트림 정상, 모니터 바에 `served_by: node-X` 표시
- [ ] 페르소나 선택 반영
- [ ] 워커 1대 kill → 카드 빨강 전환, secondary로 페일오버 + `warning` 이벤트 수신
- [ ] 워커 복구 → 카드 초록, primary로 라우팅 복귀
- [ ] **기존 `/` 페이지 변경 없음** (regression 테스트)
- [ ] **기존 `/vlm` 페이지 변경 없음**
- [ ] `NODE_ROLE=worker` 모드에서 `/llm-cluster` 프론트엔드 제공 안 함
- [ ] 요청 중 Stop 버튼 → SSE 연결 끊김, Ollama 스트림 cancellation 전파

---

## 10. 요구사항 판정 요약

| # | 요구사항 | 판정 | 비고 |
|---|---|---|---|
| R1 | 3대로 LLM 서비스 구축 | ✅ FEASIBLE | Gateway(A) + 2워커(B/C), 노드별 Ollama + 전담 모델 |
| R2 | 웹 서비스 제공 | ✅ FEASIBLE | `/llm-cluster` 독립 페이지, 기존 `/` 무영향 |
| R3 | 단일 RPi5보다 빠른 성능 | ⚠️ PARTIALLY FEASIBLE | **첫 토큰 지연: 30~75s → 1~3s**(압도적 개선). **토큰 생성 속도: 불변**(메모리 대역폭 한계). 이해관계자에 정직 프레이밍 필수 |
| R4 | 보드 증가 시 확장 | ✅ FEASIBLE | 보드 1대당 모델 슬롯 1개 + 동시 다른-모델 사용자 1명 선형 증가. Phase D에서 자동 등록 |
| R5 | 기술 검토 | ✅ FEASIBLE | 본 문서가 검토 결과물 |

**중요 리스크 (실장 전 POC 필요 사항)**:
- 워커 Ollama를 0.0.0.0 으로 노출했을 때 네트워크 보안 — 내부망 한정 + 방화벽 필수 확인
- Gigabit LAN 혼잡 시 SSE 토큰 전달 지연 — 실제 RPi5 3대 환경에서 측정 필요
- `keep_alive=-1` 로 상시 웜 시 장시간 메모리 안정성 — 24시간 이상 운용 테스트 필요

---

## 11. 향후 확장 (본 문서 밖)

- **VLM 클러스터 에이전트 페이지 `/vlm-cluster`**: [03TASKS.md §클러스터 분산 처리 (for VLM)](03TASKS.md) 의 메인-워커 구조를 별도 페이지로. 본 LLM 클러스터 구조의 라우팅/헬스/등록 메커니즘을 공유 가능
- **통합 클러스터 대시보드**: LLM + VLM 공통 노드 상태/작업 큐 모니터링
- **Speculative decoding 단일보드 POC**: `llama-server --draft` 로 16GB 보드 대상 1.5× 속도 실측 (선택 과제)

---

## 12. 참고

- 단일 노드 설계: [AI-PLAN.md](AI-PLAN.md)
- 모델 카탈로그: [AI-SLLM-MODELS.md](AI-SLLM-MODELS.md)
- 프로젝트 문서 인덱스: [00README.md](00README.md)
- VLM 클러스터 참고 구조: [03TASKS.md §클러스터 분산 처리 (for VLM)](03TASKS.md)
