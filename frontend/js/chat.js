// 채팅 화면 로직 - Single-shot Q&A
const Chat = {
  log: null,
  input: null,
  sendBtn: null,
  stopBtn: null,
  abortFn: null,
  init() {
    this.log = document.getElementById('chat-log');
    this.input = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('btn-send');
    this.stopBtn = document.getElementById('btn-stop');
    this.sendBtn.addEventListener('click', () => this.send());
    this.stopBtn.addEventListener('click', () => this.stop());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
    document.getElementById('btn-new-chat').addEventListener('click', () => this.clear());
  },
  // 응답 박스의 monitor 요소를 상태별로 갱신
  setMonitor(el, state, statusText, metrics = '') {
    if (!el) return;
    el.classList.remove('generating', 'done', 'error', 'stopping', 'stopped');
    el.classList.add(state);
    el.querySelector('.status').textContent = statusText;
    el.querySelector('.metrics').textContent = metrics;
  },
  // 현재 진행 중인 응답 추적 (중단 시 모니터 바 갱신용)
  _current: null,
  clear() {
    this.log.innerHTML = '';
    this.input.value = '';
    this.input.focus();
  },
  appendMsg(role, text, withMonitor = false) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    const who = role === 'user' ? '👤 나' : `🤖 ${App.state.currentModel?.display_name || App.state.currentModelId}`;
    // assistant 메시지: 응답 본문 위에 모니터 바 추가 (withMonitor=true)
    const monitorHtml = withMonitor
      ? `<div class="monitor"><span class="status"></span><span class="metrics"></span></div>`
      : '';
    div.innerHTML = `<div class="who">${who}</div>${monitorHtml}<div class="body"></div>`;
    div.querySelector('.body').textContent = text;
    this.log.appendChild(div);
    this.log.scrollTop = this.log.scrollHeight;
    return div;
  },
  async send() {
    const prompt = this.input.value.trim();
    if (!prompt || !App.state.currentModelId) return;
    if (this.abortFn) return; // 생성 중

    this.appendMsg('user', prompt);
    // assistant 메시지에 모니터 바 포함 (응답 박스 바로 위에 표시됨)
    const botEl = this.appendMsg('assistant', '', true);
    const bodyEl = botEl.querySelector('.body');
    const monEl = botEl.querySelector('.monitor');

    this.input.value = '';
    this.input.disabled = true;
    this.sendBtn.classList.add('hidden');
    this.stopBtn.classList.remove('hidden');

    let acc = '';
    let tokenCount = 0;
    let lastMonitor = null;
    const tStart = Date.now();
    // 라벨 포맷: "응답속도 3.6s, 토큰수 24 tok, CPU 97%, RAM 3.1GB, 온도 68℃"
    const formatLabeled = (timeStr, tokStr, sys) => {
      const cpu = sys?.cpu_percent != null ? `${sys.cpu_percent.toFixed(0)}%` : '—';
      const ram = sys?.ram_used_mb != null ? `${(sys.ram_used_mb/1024).toFixed(1)}GB` : '—';
      const temp = sys?.temp_c != null ? `${sys.temp_c.toFixed(0)}℃` : '—';
      return `응답속도 ${timeStr}, 토큰수 ${tokStr}, CPU ${cpu}, RAM ${ram}, 온도 ${temp}`;
    };

    this.setMonitor(monEl, 'generating', '🧠 생성 중', formatLabeled('—', '—', null));
    Monitor.start((s) => {
      lastMonitor = s;
      // 중단 중 상태일 때는 generating으로 덮어쓰지 말고 중단 중 라이브 메트릭만 갱신
      if (monEl.classList.contains('stopping')) {
        const elapsedNow = `${((Date.now() - tStart) / 1000).toFixed(1)}s`;
        const tokStr = `${tokenCount} tok (중단 중)`;
        this.setMonitor(monEl, 'stopping', '⏹️ 중단 중...', formatLabeled(elapsedNow, tokStr, s));
      } else {
        this.setMonitor(monEl, 'generating', '🧠 생성 중', formatLabeled('—', '—', s));
      }
    });

    // 중단 시 사용할 컨텍스트 저장
    this._current = {
      monEl, bodyEl, tStart,
      getTokens: () => tokenCount,
      getAcc: () => acc,
      getLastMonitor: () => lastMonitor,
      formatLabeled,
    };

    this.abortFn = API.chatStream(
      {
        model: App.state.currentModelId,
        prompt,
        persona_id: App.state.currentPersonaId || 'default',
      },
      {
        onToken: (t) => {
          acc += t;
          tokenCount += 1;
          bodyEl.textContent = acc;
          this.log.scrollTop = this.log.scrollHeight;
        },
        onDone: (meta) => {
          Monitor.stop();
          this._current = null;
          const totalSec = (meta.total_ms / 1000).toFixed(1);
          const loadSec = (meta.load_ms / 1000);
          const tps = meta.tokens_sec;
          let timeStr;
          if (loadSec > 1.5) {
            // 모델 콜드 로딩이 1.5초 이상 → 별도 표시 (사용자 오해 방지)
            timeStr = `${totalSec}s ⚠️ 모델로딩 ${loadSec.toFixed(1)}s 포함, 생성 ${tps}tok/s`;
          } else {
            timeStr = `${totalSec}s (${tps} tok/s)`;
          }
          const tokStr = `${meta.eval_count} tok`;
          this.setMonitor(monEl, 'done', '✅ 응답 완료', formatLabeled(timeStr, tokStr, lastMonitor));
          this.resetInput();
        },
        onError: (msg, code) => {
          Monitor.stop();
          this._current = null;
          if (code === 'model_not_found') {
            bodyEl.innerHTML = `⚠️ 모델이 설치되지 않았습니다.<br><br>터미널에서 아래 명령으로 다운로드하거나, 대시보드로 돌아가 "다운로드 후 대화" 버튼을 눌러주세요.<br><code style="background:#f3f4f6;padding:4px 8px;border-radius:4px;display:inline-block;margin-top:4px;">ollama pull ${App.state.currentModelId}</code>`;
          } else {
            bodyEl.textContent = acc || `⚠️ 응답 실패: ${msg}`;
          }
          this.setMonitor(monEl, 'error', '⚠️ 오류', msg);
          this.resetInput();
        },
        onAborted: () => {
          // 백엔드/SSE 정리가 진짜로 끝난 시점 → "중단 완료"로 확정
          Monitor.stop();
          if (this._current) {
            const elapsed = `${((Date.now() - tStart) / 1000).toFixed(1)}s`;
            const tokStr = `${tokenCount} tok (중단)`;
            // 본문에 중단 마커 추가 (이미 stop()에서 표시했지만 여기서 최종 확정)
            if (acc && !bodyEl.textContent.includes('⏹️ 사용자가 중단함')) {
              bodyEl.textContent = acc + '\n\n[⏹️ 사용자가 중단함]';
            } else if (!acc) {
              bodyEl.textContent = '(중단됨 — 응답 받기 전에 중단)';
            }
            this.setMonitor(monEl, 'stopped', '⏹️ 중단 완료', formatLabeled(elapsed, tokStr, lastMonitor));
            this._current = null;
          }
          this.resetInput();
        },
      }
    );
  },
  stop() {
    const cur = this._current;
    if (!cur) return;

    // [단계 1] 즉시 "중단 중..." 표시
    const elapsedNow = `${((Date.now() - cur.tStart) / 1000).toFixed(1)}s`;
    const tokStr = `${cur.getTokens()} tok (중단 중)`;
    this.setMonitor(
      cur.monEl,
      'stopping',
      '⏹️ 중단 중...',
      cur.formatLabeled(elapsedNow, tokStr, cur.getLastMonitor())
    );
    if (cur.getAcc()) {
      cur.bodyEl.textContent = cur.getAcc() + '\n\n[⏹️ 중단 중...]';
    }
    // 폴링 즉시 중지 (마지막 시스템 값은 화면에 그대로 남음)
    Monitor.stop();

    // [단계 2] fetch abort → SSE 끊김 → 백엔드 cancellation → ollama disconnect
    if (this.abortFn) {
      try { this.abortFn(); } catch {}
      this.abortFn = null;
    }
    this.stopBtn.disabled = true;
    this.stopBtn.textContent = '중단 중...';

    // [Fallback] 1초 안에 onAborted가 안 오면 강제로 "중단 완료" 처리
    // (대부분 100~300ms 안에 onAborted 도착하지만, 큰 buffer가 남아있을 때 대비)
    const monEl = cur.monEl;
    setTimeout(() => {
      if (this._current && this._current.monEl === monEl) {
        // 아직 onAborted가 안 옴 → 강제 마무리
        const elapsed = `${((Date.now() - cur.tStart) / 1000).toFixed(1)}s`;
        const tok = `${cur.getTokens()} tok (중단)`;
        this.setMonitor(
          monEl, 'stopped', '⏹️ 중단 완료',
          cur.formatLabeled(elapsed, tok, cur.getLastMonitor())
        );
        const acc = cur.getAcc();
        if (acc && !cur.bodyEl.textContent.includes('사용자가 중단함')) {
          cur.bodyEl.textContent = acc + '\n\n[⏹️ 사용자가 중단함]';
        } else if (!acc) {
          cur.bodyEl.textContent = '(중단됨 — 응답 받기 전에 중단)';
        }
        this._current = null;
        this.resetInput();
      }
    }, 1000);
  },
  resetInput() {
    this.abortFn = null;
    this.input.disabled = false;
    this.sendBtn.classList.remove('hidden');
    this.stopBtn.classList.add('hidden');
    // stop 버튼 상태 원복 (다음 요청에서 다시 정상 동작하도록)
    this.stopBtn.disabled = false;
    this.stopBtn.textContent = '중단';
    this.input.focus();
  },
};
