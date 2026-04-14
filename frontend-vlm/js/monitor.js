// 시스템 모니터 폴링 (기존 sLLM 패턴 재사용)
const Monitor = {
  intervalId: null,
  _stopped: true,
  start(onUpdate) {
    this.stop();
    this._stopped = false;
    const tick = async () => {
      try {
        const s = await API.getSystemStatus();
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
      const warn = s.temp_c >= 80 ? 'HOT ' : '';
      parts.push(`${warn}${s.temp_c.toFixed(0)}C`);
    }
    return parts.join(' | ');
  },
};
