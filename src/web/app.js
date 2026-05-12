document.addEventListener('DOMContentLoaded', () => {
  // ── Elements ──────────────────────────────────────────
  const elements = {
    remoteHost: document.getElementById('remoteHost'),
    remotePort: document.getElementById('remotePort'),
    btnConnectRemote: document.getElementById('btnConnectRemote'),
    btnDisconnectRemote: document.getElementById('btnDisconnectRemote'),

    deviceSlots: document.getElementById('deviceSlots'),
    btnAddDevice: document.getElementById('btnAddDevice'),
    newDeviceForm: document.getElementById('newDeviceForm'),
    newMidiInput: document.getElementById('newMidiInput'),
    newMidiOutput: document.getElementById('newMidiOutput'),
    btnConfirmAddDevice: document.getElementById('btnConfirmAddDevice'),
    btnCancelAddDevice: document.getElementById('btnCancelAddDevice'),

    msgSent: document.getElementById('msgSent'),
    msgReceived: document.getElementById('msgReceived'),
    latency: document.getElementById('latency'),

    wsIndicator: document.getElementById('wsIndicator'),
    wsStatusText: document.getElementById('wsStatusText'),
    modeBadge: document.getElementById('modeBadge'),

    networkIpList: document.getElementById('networkIpList'),
    faderTabs: document.getElementById('faderTabs'),
    faderContainer: document.getElementById('faderContainer'),
    logContainer: document.getElementById('logContainer'),
    btnClearLog: document.getElementById('btnClearLog'),
  };

  const MAX_LOG_ENTRIES = 100;
  let ws = null;
  let reconnectTimeout = null;
  let mode = 'host';

  let stats = { sent: 0, received: 0 };

  let activeTabDeviceId = 0;
  let lastDeviceFingerprint = '';  // Dirty-state: evita re-render quando nada mudou

  // Cache de opções disponíveis para os selects dos novos slots
  let availableInputs = [];
  let availableOutputs = [];

  // ── Initialize ────────────────────────────────────────
  function init() {
    fetchDevices();
    fetchStatus();
    fetchNetworkInfo();
    connectPanelWebSocket();

    // Event delegation: um único listener no container de abas
    // Resolve edge-case de clique rápido durante rebuild do DOM
    elements.faderTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.fader-tab');
      if (!tab) return;
      activeTabDeviceId = parseInt(tab.getAttribute('data-target-id'), 10);
      document.querySelectorAll('.fader-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.fader-bank').forEach(b => b.classList.add('hidden'));
      const bank = document.getElementById(`bank-${activeTabDeviceId}`);
      if (bank) bank.classList.remove('hidden');
    });

    // Network Link
    elements.btnConnectRemote.addEventListener('click', async () => {
      const ip = elements.remoteHost.value.trim();
      const port = elements.remotePort.value.trim() || '9900';
      const target = `${ip}:${port}`;
      await fetch('/api/connect-remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: target }),
      });
      fetchStatus();
    });

    elements.btnDisconnectRemote.addEventListener('click', async () => {
      await fetch('/api/disconnect-remote', { method: 'POST' });
      fetchStatus();
    });

    // Multi-device: mostrar formulário de novo slot
    elements.btnAddDevice.addEventListener('click', () => {
      elements.newDeviceForm.classList.remove('hidden');
      elements.btnAddDevice.classList.add('hidden');
      populateSelect(elements.newMidiInput, availableInputs, '');
      populateSelect(elements.newMidiOutput, availableOutputs, '');
    });

    elements.btnCancelAddDevice.addEventListener('click', () => {
      elements.newDeviceForm.classList.add('hidden');
      elements.btnAddDevice.classList.remove('hidden');
    });

    elements.btnConfirmAddDevice.addEventListener('click', async () => {
      const input = elements.newMidiInput.value;
      const output = elements.newMidiOutput.value;
      if (!input && !output) {
        addLogEntry('sys', 'Selecione ao menos um INPUT ou OUTPUT');
        return;
      }
      const res = await fetch('/api/add-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, output }),
      });
      const data = await res.json();
      if (!res.ok) {
        addLogEntry('sys', `Erro: ${data.error}`);
        return;
      }
      elements.newDeviceForm.classList.add('hidden');
      elements.btnAddDevice.classList.remove('hidden');
      fetchDevices();
    });

    if (elements.btnClearLog) {
      elements.btnClearLog.addEventListener('click', () => {
        elements.logContainer.innerHTML = '<div style="color: var(--text-low); text-align: center; padding-top: 20px; font-style:italic;">Aguardando sinal MIDI...</div>';
      });
    }
  }

  // ── API Calls ─────────────────────────────────────────
  async function fetchDevices() {
    try {
      const res = await fetch('/api/devices');
      const data = await res.json();
      availableInputs = data.inputs || [];
      availableOutputs = data.outputs || [];
      renderDeviceSlots(data.connectedDevices || []);
    } catch (err) {
      console.error('Failed to fetch devices', err);
    }
  }

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      updateUI(data);
    } catch (err) {
      console.error('Failed to fetch status', err);
    }
  }

  async function fetchNetworkInfo() {
    try {
      const res = await fetch('/api/network-info');
      const list = await res.json();
      if (!elements.networkIpList) return;
      if (!list.length) {
        elements.networkIpList.innerHTML = '<span style="color:var(--text-low)">Nenhuma interface encontrada</span>';
        return;
      }
      elements.networkIpList.innerHTML = list.map(iface => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding: 3px 0; border-bottom: 1px dashed var(--border-dim); cursor:pointer;"
             title="Clique para copiar" onclick="navigator.clipboard.writeText('${iface.ip}')">
          <span style="color:var(--text-low); font-size:10px;">${iface.name}</span>
          <span style="color:var(--accent-main); font-weight:700;">${iface.ip}</span>
        </div>
      `).join('');
    } catch (err) {
      console.error('Failed to fetch network info', err);
    }
  }

  // ── Device Slots (Multi-Device UI) ───────────────────
  function renderDeviceSlots(connectedDevices) {
    renderFaderBanks(connectedDevices);

    if (!connectedDevices || connectedDevices.length === 0) {
      elements.deviceSlots.innerHTML = '<div style="color:var(--text-low); font-size:11px; padding: 10px 0; text-align:center; font-style:italic;">Nenhum dispositivo conectado</div>';
      return;
    }

    elements.deviceSlots.innerHTML = connectedDevices.map(device => `
      <div class="device-slot" data-device-id="${device.id}">
        <div class="device-slot-header">
          <span class="device-slot-label">DEVICE #${device.id + 1}</span>
          <button class="btn-mech danger btn-remove-device" data-device-id="${device.id}" title="Remover">✕</button>
        </div>
        <div class="device-slot-info">
          ${device.inputName ? `<div class="slot-info-row"><span class="slot-lbl">IN</span><span class="slot-val">${device.inputName}</span></div>` : ''}
          ${device.outputName ? `<div class="slot-info-row"><span class="slot-lbl">OUT</span><span class="slot-val">${device.outputName}</span></div>` : ''}
        </div>
      </div>
    `).join('');

    // Bind dos botões de remover por deviceId
    document.querySelectorAll('.btn-remove-device').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const deviceId = parseInt(e.target.getAttribute('data-device-id'), 10);
        await fetch('/api/remove-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId }),
        });
        fetchDevices();
      });
    });
  }

  // ── Panel WebSocket ───────────────────────────────────
  function connectPanelWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/panel-ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      elements.wsStatusText.textContent = 'PANEL CONNECTED';
      elements.wsIndicator.classList.add('active');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handlePanelMessage(msg);
      } catch (err) {
        console.error('Panel WS parse error', err);
      }
    };

    ws.onclose = () => {
      elements.wsStatusText.textContent = 'OFFLINE';
      elements.wsIndicator.classList.remove('active');
      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(connectPanelWebSocket, 2000);
    };

    ws.onerror = () => ws.close();
  }

  function handlePanelMessage(msg) {
    if (msg.type === 'status' || msg.type === 'status_update') {
      updateUI(msg.data);
      if (msg.data && msg.data.availableInputs) {
        availableInputs = msg.data.availableInputs;
        availableOutputs = msg.data.availableOutputs;
      }
      if (msg.data && msg.data.connectedDevices) {
        renderDeviceSlots(msg.data.connectedDevices);
      }
    }
    else if (msg.type === 'device_update') {
      fetchDevices();
      // renderDeviceSlots será chamado pelo fetchDevices()
    }
    else if (msg.type === 'ws_status') {
      fetchStatus();
    }
    else if (msg.type === 'midi') {
      const { direction, data } = msg;
      const event = data;
      if (!event) return;

      if (direction === 'out') { stats.sent++; elements.msgSent.textContent = stats.sent; }
      else { stats.received++; elements.msgReceived.textContent = stats.received; }

      if (event.type === 'cc') {
        const devId = event.deviceId ?? 0;
        updateFader(event.channel, event.controller, event.value, direction, devId);
      }

      if (event.type !== 'clock' && event.type !== 'active') {
        const devId = event.deviceId ?? 0;
        const deviceTag = `<span class="log-tag dev-${devId}">DEV#${devId + 1}</span>`;
        addLogEntry(direction, `${deviceTag} CH:${event.channel} ${event.type.toUpperCase()} [${event.controller || event.note || 0}] VAL:${event.value || event.velocity || 0}`);
      }
    }
  }

  // ── UI Updates ────────────────────────────────────────
  function updateUI(data) {
    if (!data) return;
    mode = data.mode;
    elements.modeBadge.textContent = mode.toUpperCase();

    if (mode === 'remote') {
      const card = document.getElementById('remoteConnectionCard');
      if (card) card.style.display = 'none';
    }

    if (mode === 'host') {
      if (data.remoteTarget) {
        const parts = data.remoteTarget.split(':');
        elements.remoteHost.value = parts[0] || '';
        if (parts[1]) elements.remotePort.value = parts[1];
      }
      if (data.wsConnected) {
        elements.btnConnectRemote.classList.add('hidden');
        elements.btnDisconnectRemote.classList.remove('hidden');
      } else {
        elements.btnConnectRemote.classList.remove('hidden');
        elements.btnDisconnectRemote.classList.add('hidden');
      }
    }

    elements.latency.textContent = data.latencyMs > 0 ? data.latencyMs : '--';
  }

  function populateSelect(selectEl, optionsArray, selectedValue) {
    selectEl.innerHTML = '<option value="">-- NENHUM --</option>';
    optionsArray.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt;
      el.textContent = opt;
      if (opt === selectedValue) el.selected = true;
      selectEl.appendChild(el);
    });
  }

  // ── Fader Bank ────────────────────────────────────────
  function renderFaderBanks(devices) {
    if (!devices || devices.length === 0) {
      lastDeviceFingerprint = '';
      elements.faderTabs.innerHTML = '';
      elements.faderContainer.innerHTML = '<div style="color:var(--text-low); padding: 20px; font-style:italic;">Conecte uma controladora para ver os faders.</div>';
      return;
    }

    // Dirty-state check: só reconstrói o DOM se a lista de devices realmente mudou
    const fingerprint = devices.map(d => `${d.id}:${d.inputName}:${d.outputName}`).join('|');
    if (fingerprint === lastDeviceFingerprint) return;
    lastDeviceFingerprint = fingerprint;

    // Se o activeTabDeviceId não existir mais, seleciona o primeiro
    if (!devices.find(d => d.id === activeTabDeviceId)) {
      activeTabDeviceId = devices[0].id;
    }

    // Render Tabs (click é tratado via event delegation no init())
    elements.faderTabs.innerHTML = devices.map(d => `
      <div class="fader-tab dev-${d.id} ${d.id === activeTabDeviceId ? 'active' : ''}" data-target-id="${d.id}">
        DEVICE #${d.id + 1}
      </div>
    `).join('');

    // Render Banks
    elements.faderContainer.innerHTML = devices.map(d => {
      let fadersHtml = '';
      for (let i = 1; i <= 16; i++) {
        fadersHtml += `
          <div class="fader-ch">
            <div class="fader-val" id="val-dev${d.id}-cc${i}">0</div>
            <div class="fader-track">
              <div class="fader-fill dev-${d.id}" id="fader-dev${d.id}-cc${i}"></div>
            </div>
            <div class="fader-lbl">F${i}</div>
          </div>
        `;
      }
      return `<div class="fader-bank fader-rack ${d.id === activeTabDeviceId ? '' : 'hidden'}" id="bank-${d.id}">${fadersHtml}</div>`;
    }).join('');
  }

  function updateFader(channel, controller, value, direction, deviceId) {
    let index = -1;
    if (controller >= 77 && controller <= 84) index = controller - 77;
    else if (controller >= 48 && controller <= 56) index = controller - 48 + 8;
    else if (controller < 16) index = controller;
    if (index < 0 || index >= 16) return;

    const cc = index + 1;
    const faderFill = document.getElementById(`fader-dev${deviceId}-cc${cc}`);
    const faderVal = document.getElementById(`val-dev${deviceId}-cc${cc}`);
    if (faderFill && faderVal) {
      const percent = Math.round((value / 127) * 100);
      faderFill.style.height = percent + '%';
      faderVal.textContent = value;
      if (direction === 'in') faderFill.classList.add('feedback');
      else faderFill.classList.remove('feedback');
      if (value > 0) faderFill.classList.add('active');
      else faderFill.classList.remove('active');
    }
  }

  // ── Terminal Log ──────────────────────────────────────
  function addLogEntry(direction, data) {
    if (elements.logContainer.innerHTML.includes('Aguardando')) {
      elements.logContainer.innerHTML = '';
    }
    const ts = new Date().toLocaleTimeString('pt-BR');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const isSys = direction === 'sys';
    const dirClass = isSys ? 'sys' : (direction === 'out' ? 'out' : 'in');
    const dirLabel = isSys ? 'SYS' : (direction === 'out' ? 'TX' : 'RX');
    entry.innerHTML = `
      <span class="l-dir ${dirClass}">${dirLabel}</span>
      <span class="l-data">${data}</span>
      <span class="l-time">${ts}</span>
    `;
    elements.logContainer.appendChild(entry);
    while (elements.logContainer.children.length > MAX_LOG_ENTRIES) {
      elements.logContainer.removeChild(elements.logContainer.firstChild);
    }
    elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
  }

  // Start
  init();
});
