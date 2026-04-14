// VLM Backend API 클라이언트
const API = {
  async getVLMStatus() {
    const r = await fetch('/api/vlm/status');
    return r.json();
  },
  async getSystemStatus() {
    const r = await fetch('/api/system/status');
    return r.json();
  },
  async preloadModels() {
    const r = await fetch('/api/vlm/preload', { method: 'POST' });
    return r.json();
  },
  async unloadModels() {
    // sendBeacon for page close (fire-and-forget)
    navigator.sendBeacon('/api/vlm/unload');
  },
  // SSE VLM 분석 — FormData (image + prompt)
  //   onProgress(step, message) : 진행 상태
  //   onToken(text)             : 분석 결과 토큰
  //   onDone(meta)              : 완료
  //   onError(msg, code)        : 오류
  //   onAborted()               : 사용자 중단
  // 반환: abort 함수
  analyzeStream(formData, { onProgress, onTokenEn, onTokenKr, onDone, onError, onAborted }) {
    const controller = new AbortController();
    let doneReceived = false;
    let aborted = false;

    fetch('/api/vlm/analyze', {
      method: 'POST',
      body: formData,
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
              if (data.type === 'progress') onProgress?.(data.step, data.message);
              else if (data.type === 'token_en') onTokenEn?.(data.content);
              else if (data.type === 'token_kr') onTokenKr?.(data.content);
              else if (data.type === 'done') { doneReceived = true; onDone?.(data); }
              else if (data.type === 'error') { doneReceived = true; onError?.(data.message, data.code); }
            } catch (e) {}
          }
        }
      } catch (readErr) {
        if (aborted) { onAborted?.(); return; }
        throw readErr;
      }
      if (aborted) {
        onAborted?.();
      } else if (!doneReceived) {
        onDone?.({ type: 'done', total_ms: 0 });
      }
    }).catch((e) => {
      if (e.name === 'AbortError' || aborted) {
        onAborted?.();
      } else {
        onError?.(e.message);
      }
    });

    return () => { aborted = true; controller.abort(); };
  },
};
