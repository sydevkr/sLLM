// 메인 앱 컨트롤러
const App = {
  state: {
    currentModelId: null,
    currentModel: null,
    currentPersonaId: 'default',
    ramGb: null,
    skipConfirm: false,
    pendingModelChange: null,
    pendingPersonaChange: null,
  },
  async init() {
    Chat.init();
    document.getElementById('btn-settings-dash').addEventListener('click', () => this.openSettings());
    document.getElementById('btn-settings').addEventListener('click', () => this.openSettings());
    document.getElementById('btn-close-settings').addEventListener('click', () => this.closeSettings());
    document.getElementById('modal-cancel').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-confirm').addEventListener('click', () => this.confirmChange());
    document.getElementById('settings-show-monitor').addEventListener('change', (e) => {
      Monitor.enabled = e.target.checked;
    });
    document.getElementById('btn-manage-models').addEventListener('click', () => {
      this.closeSettings();
      this.showScreen('dashboard');
    });
    document.getElementById('btn-back-to-chat').addEventListener('click', () => {
      if (this.state.currentModelId) this.showScreen('chat-screen');
    });

    await Models.load();
    await Personas.load();
    this.autoSelectAndOpen();
  },
  // 접속 직후 자동 모델 선택 → 채팅 화면 진입
  autoSelectAndOpen() {
    const installed = Models.all.filter((m) => m.is_installed && Models.isCompatible(m));
    if (installed.length === 0) {
      // 설치된 모델 없음 → 모델 관리(대시보드)로 안내. 첫 사용자에게 명확한 안내 표시.
      console.warn('설치된 모델 없음 — 대시보드로 이동');
      const grid = document.getElementById('model-grid');
      const guide = document.createElement('div');
      guide.style.cssText = 'background:#fef3c7;border:1px solid #fde68a;color:#92400e;padding:14px 18px;border-radius:8px;margin-bottom:20px;text-align:center;';
      guide.innerHTML = '👋 처음 오셨나요? 아래 모델 중 하나를 골라 <b>"다운로드 후 대화"</b>를 누르세요.<br><small>RAM이 부족한 모델은 자동으로 숨겨집니다.</small>';
      if (grid && !document.getElementById('first-time-guide')) {
        guide.id = 'first-time-guide';
        grid.parentNode.insertBefore(guide, grid);
      }
      this.showScreen('dashboard');
      return;
    }
    // 1순위: 카탈로그 default=true 이면서 설치된 것
    let target = installed.find((m) => m.default);
    // 2순위: 한국어 점수 높은 순
    if (!target) target = [...installed].sort((a, b) => (b.korean_level || 0) - (a.korean_level || 0))[0];
    this.selectModel(target.id);
  },
  showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(name).classList.add('active');
    // 대시보드: 현재 모델이 있으면 "← 채팅으로" 버튼 표시
    const backBtn = document.getElementById('btn-back-to-chat');
    if (backBtn) backBtn.classList.toggle('hidden', !(name === 'dashboard' && this.state.currentModelId));
  },
  selectModel(modelId) {
    this.state.currentModelId = modelId;
    this.state.currentModel = Models.get(modelId);
    // 두 select 모두 동기화 (상단 model-picker + 우측 설정 패널)
    const sm = document.getElementById('settings-model');
    const mp = document.getElementById('model-picker-select');
    if (sm) sm.value = modelId;
    if (mp) mp.value = modelId;
    Chat.clear();
    this.showScreen('chat-screen');
    Chat.input.focus();
  },
  requestModelChange(newId) {
    if (!this.state.currentModelId || newId === this.state.currentModelId) {
      this.selectModel(newId);
      return;
    }
    if (this.state.skipConfirm || Chat.log.children.length === 0) {
      this.selectModel(newId);
      return;
    }
    this.state.pendingModelChange = newId;
    this.openModal(
      this.state.currentModel?.display_name || this.state.currentModelId,
      Models.get(newId)?.display_name || newId
    );
  },
  requestPersonaChange(newId) {
    if (newId === this.state.currentPersonaId) return;
    this.state.currentPersonaId = newId;
    if (Chat.log.children.length > 0) Chat.clear();
  },
  openModal(fromName, toName) {
    document.getElementById('modal-from').textContent = fromName;
    document.getElementById('modal-to').textContent = toName;
    document.getElementById('modal-skip').checked = false;
    document.getElementById('modal-change').classList.remove('hidden');
  },
  closeModal() {
    document.getElementById('modal-change').classList.add('hidden');
    // 두 드롭다운 모두 원복
    const sm = document.getElementById('settings-model');
    const mp = document.getElementById('model-picker-select');
    if (sm && this.state.currentModelId) sm.value = this.state.currentModelId;
    if (mp && this.state.currentModelId) mp.value = this.state.currentModelId;
    this.state.pendingModelChange = null;
  },
  confirmChange() {
    const skip = document.getElementById('modal-skip').checked;
    if (skip) this.state.skipConfirm = true;
    const newId = this.state.pendingModelChange;
    document.getElementById('modal-change').classList.add('hidden');
    this.state.pendingModelChange = null;
    if (newId) this.selectModel(newId);
  },
  openSettings() {
    document.getElementById('settings-panel').classList.remove('hidden');
  },
  closeSettings() {
    document.getElementById('settings-panel').classList.add('hidden');
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
