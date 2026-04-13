// 페르소나 프리셋 선택
const Personas = {
  all: [],
  async load() {
    this.all = await API.getPersonas();
    const sel = document.getElementById('settings-persona');
    sel.innerHTML = '';
    for (const p of this.all) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
    sel.value = App.state.currentPersonaId || 'default';
    sel.addEventListener('change', () => {
      App.requestPersonaChange(sel.value);
    });
  },
};
