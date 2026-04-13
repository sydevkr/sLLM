// 응답 중 시스템 정보 폴링. 응답 완료 시 중지.
const Monitor = {
  intervalId: null,
  enabled: true,
  _stopped: true,
  // 폴링 시작 - onUpdate(snapshot) 콜백 매 초 호출
  start(onUpdate) {
    if (!this.enabled) return;
    this.stop();
    this._stopped = false;
    const tick = async () => {
      try {
        const s = await API.getSystemStatus();
        // race condition 방지: await 중 stop() 호출됐다면 콜백 실행 안 함
        if (this._stopped) return;
        onUpdate?.(s);
      } catch (e) {}
    };
    tick();
    this.intervalId = setInterval(tick, 1000);
  },
  stop() {
    this._stopped = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  },
  format(s) {
    if (!s) return '';
    const parts = [];
    parts.push(`CPU ${s.cpu_percent?.toFixed?.(0) ?? 0}%`);
    parts.push(`RAM ${(s.ram_used_mb / 1024).toFixed(1)}GB`);
    if (s.temp_c != null) {
      const warn = s.temp_c >= 80 ? '🔥' : '🌡️';
      parts.push(`${warn} ${s.temp_c.toFixed(0)}℃`);
    }
    return parts.join(' · ');
  },
};
