/**
 * USB-Remoto — REMOTE Server (v3.0 Multi-Device)
 *
 * Roda no PC REMOTO onde o vMix está rodando.
 *
 * Responsabilidades:
 * 1. WebSocket Server — recebe mensagens MIDI do Host (com deviceId)
 * 2. Gerencia múltiplos pares loopMIDI output+input por deviceId
 * 3. Roteia feedback do vMix (Activators) de volta ao Host com o deviceId correto
 * 4. Serve painel web com status da conexão
 */

const easymidi = require('easymidi');
const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { WS_PORT, WEB_PORT, HEARTBEAT_INTERVAL_MS, CONTROL_TYPES } = require('./shared/constants');
const { midiToJson, jsonToMidi, isValidMidiJson, MIDI_EVENT_MAP } = require('./shared/midi-protocol');
const { logEvent, initCrashHandler } = require('./shared/logger');
const { startBroadcaster } = require('./shared/discovery');

// ── CLI Args ──────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const LOCAL_WS_PORT = parseInt(args.port || args.p, 10) || WS_PORT;
const LOCAL_WEB_PORT = parseInt(args.web || args.w, 10) || WEB_PORT + 1;
const CLI_MIDI_OUT = args['midi-out'] || null;
const CLI_MIDI_IN  = args['midi-in']  || null;

// ── State ─────────────────────────────────────────────────
/**
 * Array de dispositivos MIDI ativos no lado remoto.
 * Cada entrada: { id, inputName, outputName, input, output }
 * O deviceId espelha o deviceId vindo do Host.
 */
let midiDevices = [];
const MAX_DEVICES = 4;

let hostConnected = false;
let hostSocket = null;
let messageCount = { sent: 0, received: 0 };
let recentMessages = [];
const MAX_RECENT = 50;

// ── Express Server (Painel Web) ───────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'web')));

app.get('/api/devices', (req, res) => {
  try {
    res.json({
      inputs: safeGetInputs(),
      outputs: safeGetOutputs(),
      selectedInput: midiDevices[0]?.inputName || null,
      selectedOutput: midiDevices[0]?.outputName || null,
      connectedDevices: midiDevices.map(d => ({ id: d.id, inputName: d.inputName, outputName: d.outputName })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Adicionar novo par loopMIDI (multi-device)
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

// API: Remover par de dispositivo por ID
app.post('/api/remove-device', (req, res) => {
  const { deviceId } = req.body;
  const removed = removeMidiDevice(deviceId);
  if (!removed) return res.status(404).json({ error: `Device ${deviceId} não encontrado` });
  res.json({ ok: true });
});

// API: Retrocompatibilidade com v2.x
app.post('/api/select', (req, res) => {
  const { input, output } = req.body;
  try {
    disconnectAllDevices();
    const device = addMidiDevice(output, input);
    res.json({ ok: true, output: device.outputName, input: device.inputName });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/disconnect', (req, res) => {
  disconnectAllDevices();
  res.json({ ok: true });
});

app.get('/api/status', (req, res) => {
  res.json({
    mode: 'remote',
    midiOutput: midiDevices[0]?.outputName || null,
    midiInput: midiDevices[0]?.inputName || null,
    connectedDevices: midiDevices.map(d => ({ id: d.id, inputName: d.inputName, outputName: d.outputName })),
    hostConnected,
    wsPort: LOCAL_WS_PORT,
    messageCount,
    recentMessages: recentMessages.slice(-20),
  });
});

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

const webServer = app.listen(LOCAL_WEB_PORT, () => {
  const url = `http://localhost:${LOCAL_WEB_PORT}`;
  log(`[WEB] Painel web: ${url}`);
  setTimeout(() => exec(`start ${url}`), 1500);
});

// ── WebSocket interno para painel ─────────────────────────
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

// ── WebSocket Server (recebe do Host) ─────────────────────
let stopBroadcaster = null;
const wss = new WebSocket.Server({ port: LOCAL_WS_PORT }, () => {
  log(`[CONN] WebSocket server ouvindo na porta ${LOCAL_WS_PORT}`);
  stopBroadcaster = startBroadcaster(LOCAL_WS_PORT);
});

wss.on('connection', (ws, req) => {
  const remoteAddr = req.socket.remoteAddress;
  hostSocket = ws;
  hostConnected = true;
  log(`[ OK ] Host conectado: ${remoteAddr}`);
  sendToPanel({ type: 'ws_status', connected: true, host: remoteAddr });

  ws.on('message', (raw) => {
    try {
      const json = JSON.parse(raw.toString());
      if (isValidMidiJson(json)) {
        messageCount.received++;
        trackMessage('in', json);
        sendToPanel({ type: 'midi', direction: 'in', data: json });

        // Roteamento por deviceId: envia para o output correto
        const targetDeviceId = json.deviceId ?? 0;
        const targetDevice = midiDevices.find(d => d.id === targetDeviceId);
        const outputToUse = targetDevice?.output || midiDevices[0]?.output || null;

        if (outputToUse) {
          const converted = jsonToMidi(json);
          if (converted) {
            outputToUse.send(converted.type, converted.msg);
          }
        }
      }
    } catch (err) {
      log(`[WARN] Mensagem inválida do host: ${err.message}`);
    }
  });

  ws.on('close', () => {
    hostConnected = false;
    hostSocket = null;
    log('[DROP] Host desconectado');
    sendToPanel({ type: 'ws_status', connected: false });
  });

  ws.on('error', (err) => {
    log(`[FAIL] Erro WebSocket: ${err.message}`);
  });
});

// ── MIDI Device Management ────────────────────────────────
function addMidiDevice(outputName, inputName) {
  // Calcula o menor ID livre (0-3) para reutilizar slots apagados
  const usedIds = new Set(midiDevices.map(d => d.id));
  let deviceId = 0;
  while (usedIds.has(deviceId) && deviceId < MAX_DEVICES) deviceId++;
  if (deviceId >= MAX_DEVICES) throw new Error('Limite de dispositivos atingido');

  const device = { id: deviceId, outputName: outputName || null, inputName: inputName || null, output: null, input: null };

  if (outputName) {
    const outputs = safeGetOutputs();
    if (!outputs.includes(outputName)) throw new Error(`Output "${outputName}" não encontrado`);
    device.output = new easymidi.Output(outputName);
    device.outputName = outputName;
    log(`[ OUT] [Device #${deviceId}] MIDI Output: ${outputName} (→ vMix Shortcuts)`);
  }

  if (inputName) {
    const inputs = safeGetInputs();
    if (!inputs.includes(inputName)) throw new Error(`Input "${inputName}" não encontrado`);
    device.input = new easymidi.Input(inputName);
    device.inputName = inputName;
    log(`[ IN ] [Device #${deviceId}] MIDI Input: ${inputName} (← vMix Activators)`);

    // Escuta feedback do vMix e reenvia ao Host com o deviceId correto
    Object.keys(MIDI_EVENT_MAP).forEach((type) => {
      if (type === 'sysex') return;
      device.input.on(type, (msg) => {
        // Preserva o deviceId original para o Host rotear o feedback à controladora certa
        const json = midiToJson(type, msg, deviceId);
        messageCount.sent++;
        trackMessage('out', json);
        sendToPanel({ type: 'midi', direction: 'out', data: json });
        if (hostSocket && hostSocket.readyState === WebSocket.OPEN) {
          hostSocket.send(JSON.stringify(json));
        }
      });
    });
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

// ── Helpers ───────────────────────────────────────────────
function trackMessage(direction, json) {
  recentMessages.push({ direction, ...json, _time: new Date().toISOString() });
  if (recentMessages.length > MAX_RECENT) recentMessages.shift();
}

function getFullStatus() {
  return {
    mode: 'remote',
    midiOutput: midiDevices[0]?.outputName || null,
    midiInput: midiDevices[0]?.inputName || null,
    connectedDevices: midiDevices.map(d => ({ id: d.id, inputName: d.inputName, outputName: d.outputName })),
    hostConnected,
    wsPort: LOCAL_WS_PORT,
    messageCount,
    availableInputs: safeGetInputs(),
    availableOutputs: safeGetOutputs(),
  };
}

function safeGetInputs()  { try { return easymidi.getInputs();  } catch { return []; } }
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
initCrashHandler('remote');

console.log('\n╔══════════════════════════════════════╗');
console.log('║     USB-REMOTO — Modo VMIX           ║');
console.log('║   Dev: Fabiano Brandão | André Gribel║');
console.log('╚══════════════════════════════════════╝\n');

log('[MIDI] Dispositivos detectados:');
safeGetInputs().forEach((d, i) => log(`  [IN]  Input  [${i}]: ${d}`));
safeGetOutputs().forEach((d, i) => log(`  [OUT] Output [${i}]: ${d}`));

if (safeGetOutputs().length === 0) {
  log('[WARN] Nenhum output MIDI encontrado. Certifique-se que o loopMIDI está rodando!');
}

if (CLI_MIDI_OUT || CLI_MIDI_IN) {
  try {
    addMidiDevice(CLI_MIDI_OUT, CLI_MIDI_IN);
  } catch (err) {
    log(`[FAIL] Erro ao conectar device via CLI: ${err.message}`);
  }
}

process.on('SIGINT', () => {
  log('[EXIT] Encerrando...');
  disconnectAllDevices();
  if (stopBroadcaster) stopBroadcaster();
  process.exit(0);
});

process.on('SIGTERM', () => {
  disconnectAllDevices();
  if (stopBroadcaster) stopBroadcaster();
  process.exit(0);
});
