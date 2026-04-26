/**
 * USB-Remoto — Dashboard Frontend App
 *
 * Conecta via WebSocket ao servidor local (host ou remote)
 * para controle em tempo real e monitoramento MIDI.
 */

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────
  let ws = null;
  let mode = 'unknown';
  let wsConnected = false;
  let faderValues = {};     // CC controller -> value (outgoing)
  let faderFeedback = {};   // CC controller -> value (incoming feedback)
  const MAX_LOG_ENTRIES = 200;

  // ── DOM Elements ────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const modeBadge = $('#modeBadge');
  const wsIndicator = $('#wsIndicator');
  const wsDot = wsIndicator.querySelector('.dot');
  const wsLabel = wsIndicator.querySelector('.label');

  const connectionCard = $('#connectionCard');
  const remoteHostInput = $('#remoteHost');
  const btnConnectRemote = $('#btnConnectRemote');
  const btnDisconnectRemote = $('#btnDisconnectRemote');

  const midiInputSelect = $('#midiInput');
  const midiOutputSelect = $('#midiOutput');
  const btnSelectDevice = $('#btnSelectDevice');
  const btnRefreshDevices = $('#btnRefreshDevices');
  const btnDisconnectDevice = $('#btnDisconnectDevice');

  const statSent = $('#statSent');
  const statReceived = $('#statReceived');
  const statLatency = $('#statLatency');

  const faderContainer = $('#faderContainer');
  const messageLog = $('#messageLog');
  const btnClearMonitor = $('#btnClearMonitor');

  // ── Initialize ──────────────────────────────────────
  init();

  function init() {
    connectPanel();
    loadDevices();

    btnConnectRemote.addEventListener('click', connectRemote);
    btnDisconnectRemote.addEventListener('click', disconnectRemote);
    btnSelectDevice.addEventListener('click', selectDevice);
    btnRefreshDevices.addEventListener('click', loadDevices);
    btnDisconnectDevice.addEventListener('click', disconnectDevice);
    btnClearMonitor.addEventListener('click', clearMonitor);

    // Enter key on remote host input
    remoteHostInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') connectRemote();
    });

    // Initialize fader bank (9 faders for APC Mini + 8 for LaunchControl XL)
    initFaderBank();

    // Refresh devices every 5s
    setInterval(loadDevices, 5000);
    // Refresh status every 2s
    setInterval(loadStatus, 2000);
  }

  // ── Panel WebSocket ─────────────────────────────────
  function connectPanel() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}`;

    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[Panel] WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handlePanelMessage(msg);
      } catch (e) {
        console.error('[Panel] Parse error:', e);
      }
    };

    ws.onclose = () => {
      console.log('[Panel] WebSocket disconnected, reconnecting...');
      setTimeout(connectPanel, 2000);
    };

    ws.onerror = () => {};
  }

  function handlePanelMessage(msg) {
    switch (msg.type) {
      case 'status':
        updateFullStatus(msg.data);
        break;
      case 'midi':
        onMidiMessage(msg.direction, msg.data);
        break;
      case 'ws_status':
        updateWsStatus(msg.connected, msg.target || msg.host);
        break;
      case 'device_update':
        loadDevices();
        break;
    }
  }

  // ── Status Updates ──────────────────────────────────
  function updateFullStatus(data) {
    mode = data.mode || 'unknown';
    modeBadge.textContent = mode.toUpperCase();

    if (mode === 'host') {
      connectionCard.classList.remove('hidden');
      modeBadge.style.background = 'rgba(59, 130, 246, 0.15)';
      modeBadge.style.color = '#3b82f6';
    } else {
      connectionCard.classList.add('hidden');
      modeBadge.style.background = 'rgba(34, 197, 94, 0.15)';
      modeBadge.style.color = '#22c55e';
    }

    // Update devices
    if (data.availableInputs) populateSelect(midiInputSelect, data.availableInputs, data.midiInput);
    if (data.availableOutputs) populateSelect(midiOutputSelect, data.availableOutputs, data.midiOutput);

    // Connection state
    const connected = mode === 'host' ? data.wsConnected : data.hostConnected;
    updateWsStatus(connected, data.remoteTarget);

    // Device buttons
    const hasDevice = data.midiInput || data.midiOutput;
    btnDisconnectDevice.classList.toggle('hidden', !hasDevice);

    // Stats
    if (data.messageCount) {
      statSent.textContent = formatNumber(data.messageCount.sent);
      statReceived.textContent = formatNumber(data.messageCount.received);
    }
  }

  function updateWsStatus(connected, target) {
    wsConnected = connected;
    wsDot.classList.toggle('connected', connected);
    wsLabel.textContent = connected
      ? `Conectado${target ? ' → ' + target : ''}`
      : 'Desconectado';

    if (mode === 'host') {
      btnConnectRemote.classList.toggle('hidden', connected);
      btnDisconnectRemote.classList.toggle('hidden', !connected);
    }
  }

  // ── API Calls ───────────────────────────────────────
  async function loadDevices() {
    try {
      const res = await fetch('/api/devices');
      const data = await res.json();
      populateSelect(midiInputSelect, data.inputs, data.selectedInput);
      populateSelect(midiOutputSelect, data.outputs, data.selectedOutput);

      const hasDevice = data.selectedInput || data.selectedOutput;
      btnDisconnectDevice.classList.toggle('hidden', !hasDevice);
    } catch (e) {
      console.error('Failed to load devices:', e);
    }
  }

  async function loadStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      if (data.messageCount) {
        statSent.textContent = formatNumber(data.messageCount.sent);
        statReceived.textContent = formatNumber(data.messageCount.received);
      }

      mode = data.mode || mode;
      modeBadge.textContent = mode.toUpperCase();

      const connected = mode === 'host' ? data.wsConnected : data.hostConnected;
      updateWsStatus(connected, data.remoteTarget);
    } catch (e) { /* ignore */ }
  }

  async function selectDevice() {
    const input = midiInputSelect.value;
    const output = midiOutputSelect.value;
    if (!input && !output) return alert('Selecione pelo menos um dispositivo');

    try {
      const res = await fetch('/api/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, output }),
      });
      const data = await res.json();
      if (data.error) alert('Erro: ' + data.error);
      else {
        btnDisconnectDevice.classList.remove('hidden');
        loadDevices();
      }
    } catch (e) {
      alert('Falha ao conectar device: ' + e.message);
    }
  }

  async function disconnectDevice() {
    try {
      await fetch('/api/disconnect', { method: 'POST' });
      btnDisconnectDevice.classList.add('hidden');
      loadDevices();
    } catch (e) { /* ignore */ }
  }

  async function connectRemote() {
    const host = remoteHostInput.value.trim();
    if (!host) return alert('Informe o IP:Porta do remoto');

    try {
      await fetch('/api/connect-remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host }),
      });
    } catch (e) {
      alert('Falha ao conectar: ' + e.message);
    }
  }

  async function disconnectRemote() {
    try {
      await fetch('/api/disconnect-remote', { method: 'POST' });
    } catch (e) { /* ignore */ }
  }

  // ── MIDI Message Handling ───────────────────────────
  function onMidiMessage(direction, data) {
    // Update fader visualization for CC messages
    if (data.type === 'cc') {
      const key = `${data.channel}-${data.controller}`;
      if (direction === 'out') {
        faderValues[key] = data.value;
      } else {
        faderFeedback[key] = data.value;
      }
      updateFader(data.channel, data.controller, data.value, direction);
    }

    // Add to log
    addLogEntry(direction, data);

    // Flash stat
    const el = direction === 'out' ? statSent : statReceived;
    el.style.color = direction === 'out' ? '#3b82f6' : '#22c55e';
    setTimeout(() => { el.style.color = ''; }, 150);
  }

  // ── Fader Bank ──────────────────────────────────────
  function initFaderBank() {
    faderContainer.innerHTML = '';
    // Create 16 fader slots (covers both LaunchControl XL and APC Mini)
    for (let i = 0; i < 16; i++) {
      const fader = document.createElement('div');
      fader.className = 'fader';
      fader.id = `fader-${i}`;
      fader.innerHTML = `
        <div class="fader-track">
          <div class="fader-fill" id="fader-fill-${i}"></div>
        </div>
        <div class="fader-value" id="fader-val-${i}">0</div>
        <div class="fader-label">F${i + 1}</div>
      `;
      faderContainer.appendChild(fader);
    }
  }

  function updateFader(channel, controller, value, direction) {
    // Map CC to fader index — use controller number as index for simplicity
    // LaunchControl XL faders: CC 77-84, APC Mini faders: CC 48-56
    let index = -1;

    // LaunchControl XL faders (CC 77-84)
    if (controller >= 77 && controller <= 84) {
      index = controller - 77;
    }
    // APC Mini faders (CC 48-56)
    else if (controller >= 48 && controller <= 56) {
      index = controller - 48 + 8; // offset after LaunchControl
    }
    // Generic fallback: use controller number mod 16
    else if (controller < 16) {
      index = controller;
    }

    if (index < 0 || index >= 16) return;

    const fill = document.getElementById(`fader-fill-${index}`);
    const val = document.getElementById(`fader-val-${index}`);

    if (fill && val) {
      const pct = (value / 127) * 100;
      fill.style.height = `${pct}%`;
      fill.className = `fader-fill${direction === 'in' ? ' feedback' : ''}`;
      val.textContent = value;
    }
  }

  // ── Message Log ─────────────────────────────────────
  function addLogEntry(direction, data) {
    // Remove empty placeholder
    const empty = messageLog.querySelector('.log-empty');
    if (empty) empty.remove();

    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const dirLabel = direction === 'out' ? 'TX' : 'RX';
    const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });

    let detail = '';
    switch (data.type) {
      case 'cc':
        detail = `ch:${data.channel} ctrl:${data.controller} val:${data.value}`;
        break;
      case 'noteon':
        detail = `ch:${data.channel} note:${data.note} vel:${data.velocity}`;
        break;
      case 'noteoff':
        detail = `ch:${data.channel} note:${data.note}`;
        break;
      case 'program':
        detail = `ch:${data.channel} prog:${data.number}`;
        break;
      case 'pitch':
        detail = `ch:${data.channel} val:${data.value}`;
        break;
      default:
        detail = JSON.stringify(data);
    }

    entry.innerHTML = `
      <span class="log-direction ${direction}">${dirLabel}</span>
      <span class="log-type">${data.type.toUpperCase()}</span>
      <span class="log-data">${detail}</span>
      <span class="log-time">${time}</span>
    `;

    messageLog.appendChild(entry);

    // Limit entries
    while (messageLog.children.length > MAX_LOG_ENTRIES) {
      messageLog.removeChild(messageLog.firstChild);
    }

    // Auto-scroll
    messageLog.scrollTop = messageLog.scrollHeight;
  }

  function clearMonitor() {
    messageLog.innerHTML = '<div class="log-empty">Aguardando mensagens MIDI...</div>';
    faderValues = {};
    faderFeedback = {};
    initFaderBank();
  }

  // ── Helpers ─────────────────────────────────────────
  function populateSelect(select, items, selectedValue) {
    const current = select.value;
    select.innerHTML = '<option value="">Selecionar...</option>';
    items.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item;
      opt.textContent = item;
      if (item === selectedValue || item === current) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
})();
