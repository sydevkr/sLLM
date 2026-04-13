// Backend API 클라이언트
const API = {
  async getModels() {
    const r = await fetch('/api/models');
    return r.json();
  },
  async getPersonas() {
    const r = await fetch('/api/personas');
    return r.json();
  },
  async getSystemStatus() {
    const r = await fetch('/api/system/status');
    return r.json();
  },
  async getSystemInfo() {
    const r = await fetch('/api/system/info');
    return r.json();
  },
  // SSE 채팅 — 콜백:
  //   onToken(text)        : 토큰 수신
  //   onDone(meta)         : 정상 완료
  //   onError(msg, code)   : 오류
  //   onAborted()          : 사용자 중단으로 인한 종료 (백엔드 정리 끝난 시점)
  // 반환: abort 함수
  chatStream(body, { onToken, onDone, onError, onAborted }) {
    const controller = new AbortController();
    let doneReceived = false;
    let aborted = false;
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).then(async (resp) => {
      if (!resp.ok) {
        onError?.(`HTTP ${resp.status}`);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'token') onToken?.(data.content);
              else if (data.type === 'done') { doneReceived = true; onDone?.(data); }
              else if (data.type === 'error') { doneReceived = true; onError?.(data.message, data.code); }
            } catch (e) {}
          }
        }
      } catch (readErr) {
        // reader.read() 가 abort로 인해 throw — aborted 플래그로 분기
        if (aborted) {
          onAborted?.();
          return;
        }
        throw readErr;
      }
      // 스트림 정상 종료
      if (aborted) {
        onAborted?.();
      } else if (!doneReceived) {
        // SSE 종료됐는데 done/error 못 받음 → fallback (네트워크 단절 보호)
        onDone?.({ type: 'done', tokens_sec: 0, total_ms: 0, load_ms: 0, eval_count: 0 });
      }
    }).catch((e) => {
      if (e.name === 'AbortError' || aborted) {
        onAborted?.();
      } else {
        onError?.(e.message);
      }
    });
    return () => {
      aborted = true;
      controller.abort();
    };
  },
};
