/**
 * USB-Remoto — HOST Server (v3.0 Multi-Device)
 *
 * Roda no PC da CASA onde as controladoras MIDI estão conectadas.
 *
 * Responsabilidades:
 * 1. Gerencia múltiplas controladoras MIDI simultaneamente
 * 2. Serve painel web para seleção e gerenciamento de devices
 * 3. Captura mensagens MIDI com deviceId e envia via WebSocket ao remoto
 * 4. Recebe feedback do remoto e roteia de volta à controladora correta
 */

const easymidi = require('easymidi');
const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { WS_PORT, WEB_PORT, RECONNECT_INTERVAL_MS } = require('./shared/constants');
const { midiToJson, jsonToMidi, isValidMidiJson, MIDI_EVENT_MAP } = require('./shared/midi-protocol');
const { logEvent, initCrashHandler } = require('./shared/logger');
const { startListener } = require('./shared/discovery');

// ── CLI Args ──────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const REMOTE_HOST = args.remote || args.r || null;
const LOCAL_WEB_PORT = parseInt(args.port || args.p, 10) || WEB_PORT;

// ── State ─────────────────────────────────────────────────
/**
 * Array de dispositivos MIDI ativos.
 * Cada entrada: { id: number, inputName: string, outputName: string, input: MidiInput|null, output: MidiOutput|null }
 */
let midiDevices = [];

let wsConnection = null;
let wsConnected = false;
let messageCount = { sent: 0, received: 0 };
let recentMessages = [];
const MAX_RECENT = 50;
const MAX_DEVICES = 4; // Limite prático de hardware USB

// ── Express Server (Painel Web) ───────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'web')));

// API: Listar dispositivos MIDI disponíveis e conectados
app.get('/api/devices', (req, res) => {
  try {
    res.json({
      inputs: safeGetInputs(),
      outputs: safeGetOutputs(),
      // Retrocompatibilidade: expõe o primeiro device conectado como selectedInput/Output
      selectedInput: midiDevices[0]?.inputName || null,
      selectedOutput: midiDevices[0]?.outputName || null,
      connectedDevices: midiDevices.map(d => ({
        id: d.id,
        inputName: d.inputName,
        outputName: d.outputName,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Adicionar nova controladora (multi-device)
app.post('/api/add-device', (req, res) => {
  const { input, output } = req.body;
  if (!input && !output) return res.status(400).json({ error: 'input ou output é obrigatório' });
  if (midiDevices.length >= MAX_DEVICES) {
    return res.status(400).json({ error: `Máximo de ${MAX_DEVICES} dispositivos atingido` });
  }
  try {
    const device = addMidiDevice(input, output);
    res.json({ ok: true, device: { id: device.id, inputName: device.inputName, outputName: device.outputName } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: Remover controladora por ID
app.post('/api/remove-device', (req, res) => {
  const { deviceId } = req.body;
  const removed = removeMidiDevice(deviceId);
  if (!removed) return res.status(404).json({ error: `Device ${deviceId} não encontrado` });
  res.json({ ok: true });
});

// API: Retrocompatibilidade — funciona como add-device para o primeiro slot
app.post('/api/select', (req, res) => {
  const { input, output } = req.body;
  try {
    // Remove todos os devices antes de adicionar (comportamento da v2.x)
    disconnectAllDevices();
    const device = addMidiDevice(input, output);
    res.json({ ok: true, input: device.inputName, output: device.outputName });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: Desconectar todos os dispositivos
app.post('/api/disconnect', (req, res) => {
  disconnectAllDevices();
  res.json({ ok: true });
});

// API: Status geral
app.get('/api/status', (req, res) => {
  res.json({
    mode: 'host',
    // Retrocompatibilidade
    midiInput: midiDevices[0]?.inputName || null,
    midiOutput: midiDevices[0]?.outputName || null,
    // Multi-device
    connectedDevices: midiDevices.map(d => ({ id: d.id, inputName: d.inputName, outputName: d.outputName })),
    wsConnected,
    remoteTarget: REMOTE_HOST,
    messageCount,
    recentMessages: recentMessages.slice(-20),
  });
});

// API: Conectar ao remoto
app.post('/api/connect-remote', (req, res) => {
  const { host } = req.body;
  if (!host) return res.status(400).json({ error: 'host é obrigatório' });
  connectToRemote(host);
  res.json({ ok: true, connecting: host });
});

// API: Desconectar do remoto
app.post('/api/disconnect-remote', (req, res) => {
  disconnectFromRemote();
  res.json({ ok: true });
});

// API: Info de rede (todos os IPs das interfaces ativas)
app.get('/api/network-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const result = [];
  Object.entries(interfaces).forEach(([name, addrs]) => {
    addrs.forEach(addr => {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ name, ip: addr.address });
      }
    });
  });
  res.json(result);
});

// ── WebSocket interno para o painel web ───────────────────
const webServer = app.listen(LOCAL_WEB_PORT, () => {
  const url = `http://localhost:${LOCAL_WEB_PORT}`;
  log(`[WEB] Painel web: ${url}`);
  setTimeout(() => exec(`start ${url}`), 1500);
});

const panelWss = new WebSocket.Server({ server: webServer });
panelWss.on('connection', (ws) => {
  log('[WEB] Painel web conectado');
  sendToPanel({ type: 'status', data: getFullStatus() });
});

function sendToPanel(data) {
  const msg = JSON.stringify(data);
  panelWss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ── MIDI Device Management ────────────────────────────────

function addMidiDevice(inputName, outputName) {
  // Calcula o menor ID livre (0-3) para reutilizar slots apagados
  const usedIds = new Set(midiDevices.map(d => d.id));
  let deviceId = 0;
  while (usedIds.has(deviceId) && deviceId < MAX_DEVICES) deviceId++;
  if (deviceId >= MAX_DEVICES) throw new Error('Limite de dispositivos atingido');

  const device = { id: deviceId, inputName: inputName || null, outputName: outputName || null, input: null, output: null, nativeChannel: 0 };

  if (inputName) {
    const inputs = safeGetInputs();
    if (!inputs.includes(inputName)) throw new Error(`Input "${inputName}" não encontrado`);
    
    try {
      device.input = new easymidi.Input(inputName);
    } catch (err) {
      const msg = `[ERRO] Acesso Negado! O input "${inputName}" esta ocupado por outro programa (ex: vMix local). Feche-o e tente novamente.`;
      log(msg);
      throw new Error(msg);
    }
    
    log(`[MIDI] [Device #${deviceId}] Input conectado: ${inputName}`);

    Object.keys(MIDI_EVENT_MAP).forEach((type) => {
      if (type === 'sysex') return;
      device.input.on(type, (msg) => {
        if (msg.channel !== undefined) device.nativeChannel = msg.channel; // Aprende o canal nativo da controladora
        const json = midiToJson(type, msg, deviceId);  // injeta deviceId no pacote
        onMidiMessage(json);
      });
    });
  }

  if (outputName) {
    const outputs = safeGetOutputs();
    if (!outputs.includes(outputName)) throw new Error(`Output "${outputName}" não encontrado`);
    
    try {
      device.output = new easymidi.Output(outputName);
    } catch (err) {
      const msg = `[ERRO] Acesso Negado! O output "${outputName}" esta ocupado por outro programa.`;
      log(msg);
      throw new Error(msg);
    }
    
    log(`[MIDI] [Device #${deviceId}] Output conectado: ${outputName}`);
  }

  midiDevices.push(device);
  sendToPanel({ type: 'device_update', data: getFullStatus() });
  return device;
}

function removeMidiDevice(deviceId) {
  const idx = midiDevices.findIndex(d => d.id === deviceId);
  if (idx === -1) return false;
  const device = midiDevices[idx];
  try { if (device.input) device.input.close(); } catch (e) { /* ignore */ }
  try { if (device.output) device.output.close(); } catch (e) { /* ignore */ }
  midiDevices.splice(idx, 1);
  log(`[CONN] [Device #${deviceId}] Desconectado`);
  sendToPanel({ type: 'device_update', data: getFullStatus() });
  return true;
}

function disconnectAllDevices() {
  midiDevices.forEach(d => {
    try { if (d.input) d.input.close(); } catch (e) { /* ignore */ }
    try { if (d.output) d.output.close(); } catch (e) { /* ignore */ }
  });
  midiDevices = [];
  sendToPanel({ type: 'device_update', data: getFullStatus() });
}

// ── MIDI Message Handler ──────────────────────────────────
function onMidiMessage(json) {
  messageCount.sent++;
  trackMessage('out', json);
  sendToPanel({ type: 'midi', direction: 'out', data: json });

  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.send(JSON.stringify(json));
  }
}

// ── WebSocket Connection to Remote ────────────────────────
let reconnectTimer = null;
let reconnectTarget = null;

function connectToRemote(hostPort) {
  disconnectFromRemote();
  reconnectTarget = hostPort;
  const url = hostPort.startsWith('ws://') ? hostPort : `ws://${hostPort}`;
  log(`[CONN] Conectando ao remoto: ${url}`);

  try {
    wsConnection = new WebSocket(url);
  } catch (err) {
    log(`[FAIL] Erro ao criar WebSocket: ${err.message}`);
    scheduleReconnect();
    return;
  }

  wsConnection.on('open', () => {
    wsConnected = true;
    log(`[ OK ] Conectado ao remoto: ${url}`);
    sendToPanel({ type: 'ws_status', connected: true, target: hostPort });
  });

  wsConnection.on('message', (raw) => {
    try {
      const json = JSON.parse(raw.toString());
      if (isValidMidiJson(json)) {
        messageCount.received++;
        trackMessage('in', json);
        sendToPanel({ type: 'midi', direction: 'in', data: json });

        // Roteamento de feedback por deviceId
        const targetDeviceId = json.deviceId ?? 0;
        const targetDevice = midiDevices.find(d => d.id === targetDeviceId);
        const outputToUse = targetDevice?.output || midiDevices[0]?.output || null;

        if (outputToUse) {
          // Des-remapeia o canal de volta para o canal nativo da controladora física
          const nativeChannel = targetDevice?.nativeChannel ?? midiDevices[0]?.nativeChannel ?? 0;
          const feedbackJson = { ...json, channel: nativeChannel };
          
          const converted = jsonToMidi(feedbackJson, true); // disableRemap = true
          if (converted) {
            outputToUse.send(converted.type, converted.msg);
          }
        }
      }
    } catch (err) {
      log(`[WARN] Mensagem inválida do remoto: ${err.message}`);
    }
  });

  wsConnection.on('close', () => {
    wsConnected = false;
    log('[DROP] Conexão com remoto perdida');
    sendToPanel({ type: 'ws_status', connected: false });
    scheduleReconnect();
  });

  wsConnection.on('error', (err) => {
    log(`[FAIL] Erro WebSocket: ${err.message}`);
  });
}

function disconnectFromRemote() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectTarget = null;
  if (wsConnection) {
    try { wsConnection.close(); } catch (e) { /* ignore */ }
    wsConnection = null;
    wsConnected = false;
  }
}

function scheduleReconnect() {
  if (!reconnectTarget) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    log('[RETRY] Tentando reconectar...');
    connectToRemote(reconnectTarget);
  }, RECONNECT_INTERVAL_MS);
}

// ── Helpers ───────────────────────────────────────────────
function trackMessage(direction, json) {
  recentMessages.push({ direction, ...json, _time: new Date().toISOString() });
  if (recentMessages.length > MAX_RECENT) recentMessages.shift();
}

function getFullStatus() {
  return {
    mode: 'host',
    midiInput: midiDevices[0]?.inputName || null,
    midiOutput: midiDevices[0]?.outputName || null,
    connectedDevices: midiDevices.map(d => ({ id: d.id, inputName: d.inputName, outputName: d.outputName })),
    wsConnected,
    remoteTarget: reconnectTarget,
    messageCount,
    availableInputs: safeGetInputs(),
    availableOutputs: safeGetOutputs(),
  };
}

function safeGetInputs() { try { return easymidi.getInputs(); } catch { return []; } }
function safeGetOutputs() { try { return easymidi.getOutputs(); } catch { return []; } }
function log(msg) { logEvent(msg, 'INFO', true); }

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) { result[arg.slice(2)] = argv[i + 1] || true; i++; }
    else if (arg.startsWith('-')) { result[arg.slice(1)] = argv[i + 1] || true; i++; }
  }
  return result;
}

// ── Startup ───────────────────────────────────────────────
initCrashHandler('host');

console.log('\n╔══════════════════════════════════════╗');
console.log('║     USB-REMOTO — Modo OPERADOR       ║');
console.log('║   Dev: Fabiano Brandão | André Gribel║');
console.log('╚══════════════════════════════════════╝\n');

log('[MIDI] Dispositivos detectados:');
safeGetInputs().forEach((d, i) => log(`  [IN]  Input  [${i}]: ${d}`));
safeGetOutputs().forEach((d, i) => log(`  [OUT] Output [${i}]: ${d}`));

let stopListener = null;
if (REMOTE_HOST) {
  const target = REMOTE_HOST.includes(':') ? REMOTE_HOST : `${REMOTE_HOST}:${WS_PORT}`;
  connectToRemote(target);
} else {
  stopListener = startListener((ipPort) => connectToRemote(ipPort));
}

process.on('SIGINT', () => {
  log('[EXIT] Encerrando...');
  if (stopListener) stopListener();
  disconnectAllDevices();
  disconnectFromRemote();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (stopListener) stopListener();
  disconnectAllDevices();
  disconnectFromRemote();
  process.exit(0);
});
