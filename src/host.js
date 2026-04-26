/**
 * USB-Remoto — HOST Server
 *
 * Roda no PC da CASA onde a controladora MIDI está conectada.
 *
 * Responsabilidades:
 * 1. Lista dispositivos MIDI conectados
 * 2. Serve painel web para seleção de device
 * 3. Captura mensagens MIDI e envia via WebSocket ao remoto
 * 4. Recebe feedback do remoto e envia de volta à controladora (LEDs)
 *
 * Uso: node src/host.js [--remote IP:PORTA] [--port PORTA_WEB]
 */

const easymidi = require('easymidi');
const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const { WS_PORT, WEB_PORT, RECONNECT_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, CONTROL_TYPES } = require('./shared/constants');
const { midiToJson, jsonToMidi, isValidMidiJson, MIDI_EVENT_MAP } = require('./shared/midi-protocol');

// ── CLI Args ──────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const REMOTE_HOST = args.remote || args.r || null;
const LOCAL_WEB_PORT = parseInt(args.port || args.p, 10) || WEB_PORT;

// ── State ─────────────────────────────────────────────────
let midiInput = null;
let midiOutput = null;
let wsConnection = null;
let selectedInputDevice = null;
let selectedOutputDevice = null;
let wsConnected = false;
let messageCount = { sent: 0, received: 0 };
let recentMessages = [];
const MAX_RECENT = 50;

// ── Express Server (Painel Web) ───────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'web')));

// API: Listar dispositivos MIDI
app.get('/api/devices', (req, res) => {
  try {
    const inputs = easymidi.getInputs();
    const outputs = easymidi.getOutputs();
    res.json({
      inputs,
      outputs,
      selectedInput: selectedInputDevice,
      selectedOutput: selectedOutputDevice,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Selecionar dispositivo
app.post('/api/select', (req, res) => {
  const { input, output } = req.body;
  try {
    connectMidiDevice(input, output);
    res.json({ ok: true, input: selectedInputDevice, output: selectedOutputDevice });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: Desconectar dispositivo
app.post('/api/disconnect', (req, res) => {
  disconnectMidiDevice();
  res.json({ ok: true });
});

// API: Status geral
app.get('/api/status', (req, res) => {
  res.json({
    mode: 'host',
    midiInput: selectedInputDevice,
    midiOutput: selectedOutputDevice,
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

// ── WebSocket interno para o painel web ───────────────────
const webServer = app.listen(LOCAL_WEB_PORT, () => {
  log(`🌐 Painel web: http://localhost:${LOCAL_WEB_PORT}`);
});

const panelWss = new WebSocket.Server({ server: webServer });
panelWss.on('connection', (ws) => {
  log('📱 Painel web conectado');
  sendToPanel({ type: 'status', data: getFullStatus() });
});

function sendToPanel(data) {
  const msg = JSON.stringify(data);
  panelWss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ── MIDI Device Connection ────────────────────────────────
function connectMidiDevice(inputName, outputName) {
  disconnectMidiDevice();

  if (inputName) {
    const inputs = easymidi.getInputs();
    if (!inputs.includes(inputName)) throw new Error(`Input "${inputName}" não encontrado`);

    midiInput = new easymidi.Input(inputName);
    selectedInputDevice = inputName;
    log(`🎛️  MIDI Input conectado: ${inputName}`);

    // Escutar todos os tipos de evento MIDI
    Object.keys(MIDI_EVENT_MAP).forEach((type) => {
      if (type === 'sysex') return; // sysex tratado separadamente
      midiInput.on(type, (msg) => {
        const json = midiToJson(type, msg);
        onMidiMessage(json);
      });
    });
  }

  if (outputName) {
    const outputs = easymidi.getOutputs();
    if (!outputs.includes(outputName)) throw new Error(`Output "${outputName}" não encontrado`);

    midiOutput = new easymidi.Output(outputName);
    selectedOutputDevice = outputName;
    log(`🎛️  MIDI Output conectado: ${outputName}`);
  }

  sendToPanel({ type: 'device_update', data: { input: selectedInputDevice, output: selectedOutputDevice } });
}

function disconnectMidiDevice() {
  if (midiInput) {
    try { midiInput.close(); } catch (e) { /* ignore */ }
    midiInput = null;
    selectedInputDevice = null;
  }
  if (midiOutput) {
    try { midiOutput.close(); } catch (e) { /* ignore */ }
    midiOutput = null;
    selectedOutputDevice = null;
  }
}

// ── MIDI Message Handler ──────────────────────────────────
function onMidiMessage(json) {
  messageCount.sent++;
  trackMessage('out', json);

  // Enviar ao painel web para visualização
  sendToPanel({ type: 'midi', direction: 'out', data: json });

  // Enviar ao remoto via WebSocket
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
  log(`🔌 Conectando ao remoto: ${url}`);

  try {
    wsConnection = new WebSocket(url);
  } catch (err) {
    log(`❌ Erro ao criar WebSocket: ${err.message}`);
    scheduleReconnect();
    return;
  }

  wsConnection.on('open', () => {
    wsConnected = true;
    log(`✅ Conectado ao remoto: ${url}`);
    sendToPanel({ type: 'ws_status', connected: true, target: hostPort });
  });

  wsConnection.on('message', (raw) => {
    try {
      const json = JSON.parse(raw.toString());

      // Mensagem MIDI de feedback → enviar para controladora
      if (isValidMidiJson(json)) {
        messageCount.received++;
        trackMessage('in', json);
        sendToPanel({ type: 'midi', direction: 'in', data: json });

        if (midiOutput) {
          const converted = jsonToMidi(json);
          if (converted) {
            midiOutput.send(converted.type, converted.msg);
          }
        }
      }
    } catch (err) {
      log(`⚠️  Mensagem inválida do remoto: ${err.message}`);
    }
  });

  wsConnection.on('close', () => {
    wsConnected = false;
    log('🔴 Conexão com remoto perdida');
    sendToPanel({ type: 'ws_status', connected: false });
    scheduleReconnect();
  });

  wsConnection.on('error', (err) => {
    log(`❌ Erro WebSocket: ${err.message}`);
  });
}

function disconnectFromRemote() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
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
    log('🔄 Tentando reconectar...');
    connectToRemote(reconnectTarget);
  }, RECONNECT_INTERVAL_MS);
}

// ── Helpers ───────────────────────────────────────────────
function trackMessage(direction, json) {
  recentMessages.push({
    direction,
    ...json,
    _time: new Date().toISOString(),
  });
  if (recentMessages.length > MAX_RECENT) recentMessages.shift();
}

function getFullStatus() {
  return {
    mode: 'host',
    midiInput: selectedInputDevice,
    midiOutput: selectedOutputDevice,
    wsConnected,
    remoteTarget: reconnectTarget,
    messageCount,
    availableInputs: safeGetInputs(),
    availableOutputs: safeGetOutputs(),
  };
}

function safeGetInputs() {
  try { return easymidi.getInputs(); } catch { return []; }
}

function safeGetOutputs() {
  try { return easymidi.getOutputs(); } catch { return []; }
}

function log(msg) {
  const ts = new Date().toLocaleTimeString('pt-BR');
  console.log(`[${ts}] ${msg}`);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      result[key] = argv[i + 1] || true;
      i++;
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      result[key] = argv[i + 1] || true;
      i++;
    }
  }
  return result;
}

// ── Startup ───────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════╗');
console.log('║     USB-REMOTO — Modo HOST           ║');
console.log('╚══════════════════════════════════════╝\n');

log('🎛️  Dispositivos MIDI detectados:');
const inputs = safeGetInputs();
const outputs = safeGetOutputs();
inputs.forEach((d, i) => log(`   📥 Input  [${i}]: ${d}`));
outputs.forEach((d, i) => log(`   📤 Output [${i}]: ${d}`));

if (inputs.length === 0) {
  log('⚠️  Nenhum dispositivo MIDI encontrado. Conecte a controladora e reinicie.');
}

// Auto-connect se passado via CLI
if (REMOTE_HOST) {
  const target = REMOTE_HOST.includes(':') ? REMOTE_HOST : `${REMOTE_HOST}:${WS_PORT}`;
  connectToRemote(target);
}

// Graceful shutdown
process.on('SIGINT', () => {
  log('👋 Encerrando...');
  disconnectMidiDevice();
  disconnectFromRemote();
  process.exit(0);
});

process.on('SIGTERM', () => {
  disconnectMidiDevice();
  disconnectFromRemote();
  process.exit(0);
});
