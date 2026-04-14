// VLM 앱 컨트롤러
const App = {
  statusEl: null,
  modelsReady: false,

  async init() {
    this.statusEl = document.getElementById('hailo-status');
    VLM.init();

    // 페이지 닫기/이동 시 모델 언로드
    window.addEventListener('beforeunload', () => {
      API.unloadModels();
    });

    await this.checkAndPreload();
  },

  async checkAndPreload() {
    const el = this.statusEl;
    const iconEl = el.querySelector('.status-icon');
    const textEl = el.querySelector('.status-text');

    // 1단계: 상태 확인
    el.classList.remove('loading', 'ready', 'error', 'partial');
    el.classList.add('loading');
    textEl.textContent = 'Hailo NPU 확인 중...';

    let status;
    try {
      status = await API.getVLMStatus();
    } catch (e) {
      el.classList.remove('loading');
      el.classList.add('error');
      iconEl.textContent = '';
      textEl.textContent = '백엔드 서버에 연결할 수 없습니다.';
      return;
    }

    if (!status.vlm_ready) {
      el.classList.remove('loading');
      el.classList.add('error');
      iconEl.textContent = '';
      textEl.textContent = status.message || 'VLM 사용 불가';
      this._showSetupGuide(status);
      return;
    }

    // 2단계: 모델 프리로드
    textEl.textContent = '모델 로딩 중... (VLM + 번역 모델)';

    try {
      const result = await API.preloadModels();
      const vlmOk = result.vlm === 'loaded';
      const trOk = result.translate === 'loaded';

      if (vlmOk && trOk) {
        el.classList.remove('loading');
        el.classList.add('ready');
        iconEl.textContent = '';
        textEl.textContent = `준비 완료 (VLM: Qwen2-VL-2B, 번역: exaone3.5:2.4b)`;
        this.modelsReady = true;
        // 분석 버튼 활성화 (이미지가 있는 경우)
        if (VLM.imageFile) {
          document.getElementById('btn-analyze').disabled = false;
        }
      } else {
        el.classList.remove('loading');
        el.classList.add('partial');
        iconEl.textContent = '';
        textEl.textContent = `일부 모델 로드 실패 (VLM: ${result.vlm}, 번역: ${result.translate})`;
      }
    } catch (e) {
      el.classList.remove('loading');
      el.classList.add('error');
      iconEl.textContent = '';
      textEl.textContent = `모델 로드 실패: ${e.message}`;
    }
  },

  _showSetupGuide(status) {
    const resultLog = document.getElementById('result-log');
    resultLog.innerHTML = '';

    const guide = document.createElement('div');
    guide.className = 'setup-guide';
    guide.innerHTML = `
      <h3>VLM 설정 안내</h3>
      <p style="margin-bottom:16px;color:#6b7280;">
        Hailo-10H NPU가 감지되었지만 VLM 실행 환경이 아직 준비되지 않았습니다.
      </p>
      <pre>git clone https://github.com/hailo-ai/hailo-apps ~/hailo-apps
cd ~/hailo-apps && pip install -e ".[gen-ai]"
hailo-download-resources --group vlm_chat --arch hailo10h</pre>
      <p style="margin-top:16px;color:#9ca3af;font-size:0.85rem;">
        SDK: ${status.sdk_version || '미설치'} |
        FW: ${status.firmware_version || '미확인'}
      </p>
    `;
    resultLog.appendChild(guide);
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
