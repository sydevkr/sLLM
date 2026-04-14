// VLM 이미지 분석 로직
const VLM = {
  dropZone: null,
  fileInput: null,
  previewImg: null,
  promptInput: null,
  analyzeBtn: null,
  stopBtn: null,
  resultLog: null,
  monitorBar: null,
  imageInfo: null,

  imageFile: null,
  abortFn: null,

  init() {
    this.dropZone = document.getElementById('drop-zone');
    this.fileInput = document.getElementById('file-input');
    this.previewImg = document.getElementById('preview-img');
    this.promptInput = document.getElementById('vlm-prompt');
    this.analyzeBtn = document.getElementById('btn-analyze');
    this.stopBtn = document.getElementById('btn-stop');
    this.resultLog = document.getElementById('result-log');
    this.monitorBar = document.getElementById('monitor-bar');
    this.imageInfo = document.getElementById('image-info');

    this._setupDropZone();
    this._setupButtons();
  },

  _setupDropZone() {
    const dz = this.dropZone;

    // 클릭으로 파일 선택
    dz.addEventListener('click', (e) => {
      if (this.imageFile) return; // 이미 이미지가 있으면 무시
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) this.setImage(e.target.files[0]);
    });

    // 드래그 앤 드롭
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    });
    dz.addEventListener('dragleave', () => {
      dz.classList.remove('dragover');
    });
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) this.setImage(files[0]);
    });
  },

  _setupButtons() {
    this.analyzeBtn.addEventListener('click', () => this.analyze());
    this.stopBtn.addEventListener('click', () => this.stop());
    document.getElementById('btn-clear-image').addEventListener('click', () => this.clearImage());

    // Enter로 분석 시작 (Shift+Enter는 줄바꿈)
    this.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.analyze();
      }
    });
  },

  setImage(file) {
    // 타입 검증
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      alert('JPEG, PNG, WebP 이미지만 지원합니다.');
      return;
    }
    // 크기 검증
    if (file.size > 10 * 1024 * 1024) {
      alert('이미지 크기가 10MB를 초과합니다.');
      return;
    }

    this.imageFile = file;

    // 미리보기
    const reader = new FileReader();
    reader.onload = (e) => {
      this.previewImg.src = e.target.result;
      this.previewImg.classList.remove('hidden');
      this.dropZone.querySelector('.drop-content').classList.add('hidden');
      this.dropZone.classList.add('has-image');
    };
    reader.readAsDataURL(file);

    // 이미지 정보
    document.getElementById('image-name').textContent = file.name;
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    const sizeKB = (file.size / 1024).toFixed(0);
    document.getElementById('image-size').textContent = file.size > 1024 * 1024 ? `${sizeMB}MB` : `${sizeKB}KB`;
    this.imageInfo.classList.remove('hidden');

    // 분석 버튼 활성화 (모델 로드 완료 시에만)
    this.analyzeBtn.disabled = !App.modelsReady;
  },

  clearImage() {
    this.imageFile = null;
    this.fileInput.value = '';
    this.previewImg.src = '';
    this.previewImg.classList.add('hidden');
    this.dropZone.querySelector('.drop-content').classList.remove('hidden');
    this.dropZone.classList.remove('has-image');
    this.imageInfo.classList.add('hidden');
    this.analyzeBtn.disabled = true;
  },

  async analyze() {
    if (!this.imageFile || this.abortFn) return;

    const prompt = this.promptInput.value.trim() || '이 이미지를 분석해주세요.';

    // UI 상태 변경
    this.analyzeBtn.classList.add('hidden');
    this.stopBtn.classList.remove('hidden');
    this.promptInput.disabled = true;

    // 결과 영역 준비
    this.resultLog.innerHTML = '';
    const resultItem = document.createElement('div');
    resultItem.className = 'result-item';
    resultItem.innerHTML = `
      <div class="result-header"><span class="loading-spinner"></span> 분석 중...</div>
      <div class="result-body"></div>
    `;
    this.resultLog.appendChild(resultItem);
    const headerEl = resultItem.querySelector('.result-header');
    const bodyEl = resultItem.querySelector('.result-body');

    // 모니터 바 표시
    this.monitorBar.classList.remove('hidden', 'done', 'error');
    this.monitorBar.classList.add('generating');
    this.monitorBar.querySelector('.status').textContent = '분석 중...';

    const tStart = Date.now();
    let acc = '';
    let lastMonitor = null;

    // sLLM 채팅과 동일한 라벨 포맷
    const formatLabeled = (timeStr, sys) => {
      const cpu = sys?.cpu_percent != null ? `${sys.cpu_percent.toFixed(0)}%` : '--';
      const ram = sys?.ram_used_mb != null ? `${(sys.ram_used_mb / 1024).toFixed(1)}GB` : '--';
      const temp = sys?.temp_c != null ? `${sys.temp_c.toFixed(0)}C` : '--';
      return `응답속도 ${timeStr}, CPU ${cpu}, RAM ${ram}, 온도 ${temp}`;
    };

    Monitor.start((s) => {
      lastMonitor = s;
      const elapsed = `${((Date.now() - tStart) / 1000).toFixed(1)}s`;
      this.monitorBar.querySelector('.metrics').textContent = formatLabeled(`경과 ${elapsed}`, s);
    });

    // FormData 구성
    const formData = new FormData();
    formData.append('image', this.imageFile);
    formData.append('prompt', prompt);

    let enText = '';

    this.abortFn = API.analyzeStream(formData, {
      onProgress: (step, message) => {
        headerEl.innerHTML = `<span class="loading-spinner"></span> ${message}`;
      },
      onTokenEn: (text) => {
        enText = text;
        bodyEl.textContent = text;
        this.resultLog.scrollTop = this.resultLog.scrollHeight;
      },
      onTokenKr: (text) => {
        bodyEl.textContent = enText + '\n\n' + text;
        this.resultLog.scrollTop = this.resultLog.scrollHeight;
      },
      onDone: (meta) => {
        Monitor.stop();
        const totalSec = meta.total_ms ? (meta.total_ms / 1000).toFixed(1) : ((Date.now() - tStart) / 1000).toFixed(1);
        const vlmSec = meta.vlm_ms ? (meta.vlm_ms / 1000).toFixed(1) : '?';
        const transSec = meta.translate_ms ? (meta.translate_ms / 1000).toFixed(1) : '?';
        headerEl.innerHTML = `분석 완료 (VLM ${vlmSec}s + 번역 ${transSec}s = ${totalSec}s)`;
        this._setMonitorDone(`완료 ${totalSec}s (VLM ${vlmSec}s + 번역 ${transSec}s)`, formatLabeled(`${totalSec}s`, lastMonitor));
        this.resetInput();
      },
      onError: (msg, code) => {
        Monitor.stop();
        headerEl.innerHTML = `오류`;
        bodyEl.textContent = msg;
        bodyEl.classList.add('error');
        this._setMonitorError(msg);
        this.resetInput();
      },
      onAborted: () => {
        Monitor.stop();
        const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
        headerEl.innerHTML = `중단됨`;
        if (acc) {
          bodyEl.textContent = acc + '\n\n[중단됨]';
        } else {
          bodyEl.textContent = '(분석 시작 전 중단됨)';
        }
        this._setMonitorDone('중단됨', formatLabeled(`${elapsed}s (중단)`, lastMonitor));
        this.resetInput();
      },
    });
  },

  stop() {
    if (this.abortFn) {
      try { this.abortFn(); } catch {}
      this.abortFn = null;
    }
  },

  resetInput() {
    this.abortFn = null;
    this.promptInput.disabled = false;
    this.analyzeBtn.classList.remove('hidden');
    this.stopBtn.classList.add('hidden');
    this.promptInput.focus();
  },

  _setMonitorDone(statusText, metricsText) {
    this.monitorBar.classList.remove('generating');
    this.monitorBar.classList.add('done');
    this.monitorBar.querySelector('.status').textContent = statusText;
    if (metricsText) this.monitorBar.querySelector('.metrics').textContent = metricsText;
  },

  _setMonitorError(text) {
    this.monitorBar.classList.remove('generating');
    this.monitorBar.classList.add('error');
    this.monitorBar.querySelector('.status').textContent = 'Error';
    this.monitorBar.querySelector('.metrics').textContent = text;
  },
};
