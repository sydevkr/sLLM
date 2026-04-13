// 모델 선택/전환 UI
const Models = {
  all: [],
  async load() {
    this.all = await API.getModels();
    // RAM 자동 감지
    try {
      const info = await API.getSystemInfo();
      App.state.ramGb = info.ram_total_gb;
    } catch {}
    this.renderGrid();
    this.renderSettingsSelect();
  },
  get(id) {
    return this.all.find((m) => m.id === id);
  },
  isCompatible(m) {
    if (!App.state.ramGb) return true;
    return (m.min_hw_gb || 8) <= App.state.ramGb;
  },
  renderGrid() {
    const grid = document.getElementById('model-grid');
    grid.innerHTML = '';
    // 호환되지 않는 모델은 카드에서 제외 (예: 8GB 환경의 7B+ 모델)
    const compatList = this.all.filter((m) => this.isCompatible(m));
    const hiddenCount = this.all.length - compatList.length;
    for (const m of compatList) {
      const compat = true;
      const card = document.createElement('div');
      card.className = 'model-card';
      const stars = '★'.repeat(m.korean_level || 0) + '☆'.repeat(Math.max(0, 5 - (m.korean_level || 0)));
      const badges = [];
      if (m.default) badges.push('<span class="badge recommend">🏆 추천</span>');
      if (m.is_installed) badges.push('<span class="badge installed">✓ 설치됨</span>');
      else badges.push('<span class="badge">⬇️ 다운로드 필요</span>');
      const btnLabel = m.is_installed ? '대화 시작' : '다운로드 후 대화';
      card.innerHTML = `
        <h3>${this.flag(m.vendor)} ${m.display_name}</h3>
        <div class="vendor">${m.vendor || ''}</div>
        <div class="stars">한국어: ${stars}</div>
        <div class="meta">💾 ${((m.disk_mb||0)/1024).toFixed(1)}GB · RAM ~${((m.est_ram_mb||0)/1024).toFixed(1)}GB</div>
        <div class="meta">${m.description || ''}</div>
        <div class="badges">${badges.join('')}</div>
        <button ${compat ? '' : 'disabled'}>${btnLabel}</button>
      `;
      card.querySelector('button').addEventListener('click', async () => {
        if (!m.is_installed) {
          if (!confirm(`${m.display_name} (${((m.disk_mb||0)/1024).toFixed(1)}GB)을(를) 다운로드합니다. 네트워크 속도에 따라 수분 소요됩니다. 계속하시겠습니까?`)) return;
          await this.pullModel(m, card);
          return;
        }
        App.selectModel(m.id);
      });
      grid.appendChild(card);
    }
    // 호환되지 않는 모델 숨김 안내
    if (hiddenCount > 0) {
      const note = document.createElement('div');
      note.style.cssText = 'grid-column:1/-1;background:#f3f4f6;color:#6b7280;padding:10px 14px;border-radius:6px;font-size:0.85rem;text-align:center;border:1px dashed #d1d5db;';
      note.innerHTML = `ℹ️ 현재 시스템 RAM(${App.state.ramGb || '?'}GB)에서 실행 불가능한 <b>${hiddenCount}개 모델</b>은 숨김 처리됨 (RAM이 더 큰 시스템 필요)`;
      grid.appendChild(note);
    }
  },
  async pullModel(m, card) {
    const btn = card.querySelector('button');
    btn.disabled = true;
    btn.textContent = '다운로드 중...';
    try {
      const resp = await fetch(`/api/models/${encodeURIComponent(m.id)}/pull`, { method: 'POST' });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
            if (data.total && data.completed) {
              const pct = Math.floor((data.completed / data.total) * 100);
              btn.textContent = `${data.status || 'pulling'} ${pct}%`;
            } else if (data.status) {
              btn.textContent = data.status.slice(0, 24);
            }
            if (data.type === 'complete') {
              btn.textContent = '완료! 대화 시작';
              // 완료 시 자동으로 해당 모델 선택하고 채팅 화면으로
              await this.load();
              App.selectModel(m.id);
              return;
            }
            if (data.type === 'error') {
              alert(`다운로드 실패: ${data.message}`);
              btn.textContent = '다운로드 재시도';
              btn.disabled = false;
              return;
            }
          } catch (e) {}
        }
      }
      await this.load();
    } catch (e) {
      alert(`다운로드 오류: ${e.message}`);
      btn.disabled = false;
      btn.textContent = '다운로드 재시도';
    }
  },
  // 두 select(상단 model-picker, 우측 설정 패널)에 동일한 옵션 채움
  renderSettingsSelect() {
    this._populateSelect(document.getElementById('settings-model'));
    this._populateSelect(document.getElementById('model-picker-select'));
    // 이벤트 핸들러는 한 번만 등록되도록 dataset 플래그 사용
    for (const id of ['settings-model', 'model-picker-select']) {
      const sel = document.getElementById(id);
      if (sel.dataset.bound) continue;
      sel.dataset.bound = '1';
      sel.addEventListener('change', () => {
        const newId = sel.value;
        if (newId === '__none__') {
          // "📦 모델 설정" 선택 → 대시보드로 이동
          App.showScreen('dashboard');
          return;
        }
        if (newId === App.state.currentModelId) return;
        App.requestModelChange(newId);
      });
      // 모델이 없을 때 select 클릭 자체로 대시보드 안내
      sel.addEventListener('mousedown', (e) => {
        if (sel.value === '__none__' && sel.options.length === 1) {
          e.preventDefault();
          App.showScreen('dashboard');
        }
      });
    }
  },
  _populateSelect(sel) {
    if (!sel) return;
    sel.innerHTML = '';
    // 호환되는 모델만 (8GB 환경에서 16GB 모델은 아예 표시 안 함)
    const compat = this.all.filter((m) => this.isCompatible(m));
    const installed = compat.filter((m) => m.is_installed);
    const notInstalled = compat.filter((m) => !m.is_installed);

    // 설치된 모델이 하나도 없으면 안내 옵션 표시
    if (installed.length === 0) {
      const guide = document.createElement('option');
      guide.value = '__none__';
      guide.textContent = '📦 모델 설정 — 다운로드 필요';
      sel.appendChild(guide);
    } else {
      for (const m of installed) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.display_name;
        sel.appendChild(opt);
      }
    }
    if (notInstalled.length > 0) {
      const sep = document.createElement('option');
      sep.disabled = true;
      sep.textContent = '─── 미설치 (📦 모델 관리에서 다운로드) ───';
      sel.appendChild(sep);
      for (const m of notInstalled) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.display_name} (미설치)`;
        opt.disabled = true;
        sel.appendChild(opt);
      }
    }
  },
  flag(vendor) {
    if (/LG|HyperCLOVA|NAVER|Kakao/i.test(vendor || '')) return '🇰🇷';
    return '🌏';
  },
};
