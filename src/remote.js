/**
 * USB-Remoto — REMOTE Server
 *
 * Roda no PC REMOTO onde o vMix está rodando.
 *
 * Responsabilidades:
 * 1. WebSocket Server — recebe mensagens MIDI do Host
 * 2. Envia mensagens MIDI para porta virtual loopMIDI → vMix lê
 * 3. Lê feedback MIDI do loopMIDI (vMix Activators) → envia de volta ao Host
 * 4. Serve painel web com status da conexão
 *
 * Uso: node src/remote.js [--port PORTA_WS] [--web PORTA_WEB] [--midi-out NOME] [--midi-in NOME]
 */

const easymidi = require('easymidi');
const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const { WS_PORT, WEB_PORT, HEARTBEAT_INTERVAL_MS, CONTROL_TYPES } = require('./shared/constants');
const { midiToJson, jsonToMidi, isValidMidiJson, MIDI_EVENT_MAP } = require('./shared/midi-protocol');

// ── CLI Args ──────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const LOCAL_WS_PORT = parseInt(args.port || args.p, 10) || WS_PORT;
const LOCAL_WEB_PORT = parseInt(args.web || args.w, 10) || WEB_PORT + 1; // 9902 para não conflitar
const CLI_MIDI_OUT = args['midi-out'] || null;
const CLI_MIDI_IN = args['midi-in'] || null;

// ── State ─────────────────────────────────────────────────
let midiOutput = null;   // Enviar para loopMIDI (vMix lê)
let midiInput = null;    // Ler do loopMIDI (vMix Activators envia)
let selectedOutputDevice = null;
let selectedInputDevice = null;
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
      inputs: easymidi.getInputs(),
      outputs: easymidi.getOutputs(),
      selectedInput: selectedInputDevice,
      selectedOutput: selectedOutputDevice,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/select', (req, res) => {
  const { input, output } = req.body;
  try {
    connectMidiDevice(output, input);
    res.json({ ok: true, output: selectedOutputDevice, input: selectedInputDevice });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/disconnect', (req, res) => {
  disconnectMidiDevice();
  res.json({ ok: true });
});

app.get('/api/status', (req, res) => {
  res.json({
    mode: 'remote',
    midiOutput: selectedOutputDevice,
    midiInput: selectedInputDevice,
    hostConnected,
    wsPort: LOCAL_WS_PORT,
    messageCount,
    recentMessages: recentMessages.slice(-20),
  });
});

const webServer = app.listen(LOCAL_WEB_PORT, () => {
  log(`🌐 Painel web: http://localhost:${LOCAL_WEB_PORT}`);
});

// ── WebSocket interno para painel ─────────────────────────
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

// ── WebSocket Server (recebe do Host) ─────────────────────
const wss = new WebSocket.Server({ port: LOCAL_WS_PORT }, () => {
  log(`🔌 WebSocket server ouvindo na porta ${LOCAL_WS_PORT}`);
});

wss.on('connection', (ws, req) => {
  const remoteAddr = req.socket.remoteAddress;
  hostSocket = ws;
  hostConnected = true;
  log(`✅ Host conectado: ${remoteAddr}`);
  sendToPanel({ type: 'ws_status', connected: true, host: remoteAddr });

  ws.on('message', (raw) => {
    try {
      const json = JSON.parse(raw.toString());

      if (isValidMidiJson(json)) {
        messageCount.received++;
        trackMessage('in', json);
        sendToPanel({ type: 'midi', direction: 'in', data: json });

        // Enviar para loopMIDI → vMix
        if (midiOutput) {
          const converted = jsonToMidi(json);
          if (converted) {
            midiOutput.send(converted.type, converted.msg);
          }
        }
      }
    } catch (err) {
      log(`⚠️  Mensagem inválida do host: ${err.message}`);
    }
  });

  ws.on('close', () => {
    hostConnected = false;
    hostSocket = null;
    log('🔴 Host desconectado');
    sendToPanel({ type: 'ws_status', connected: false });
  });

  ws.on('error', (err) => {
    log(`❌ Erro WebSocket: ${err.message}`);
  });
});

// ── MIDI Device Connection ────────────────────────────────
function connectMidiDevice(outputName, inputName) {
  disconnectMidiDevice();

  // Output → envia para loopMIDI (vMix lê como MIDI device)
  if (outputName) {
    const outputs = easymidi.getOutputs();
    if (!outputs.includes(outputName)) throw new Error(`Output "${outputName}" não encontrado`);

    midiOutput = new easymidi.Output(outputName);
    selectedOutputDevice = outputName;
    log(`📤 MIDI Output conectado: ${outputName} (→ vMix Shortcuts)`);
  }

  // Input → lê do loopMIDI (vMix Activators envia feedback)
  if (inputName) {
    const inputs = easymidi.getInputs();
    if (!inputs.includes(inputName)) throw new Error(`Input "${inputName}" não encontrado`);

    midiInput = new easymidi.Input(inputName);
    selectedInputDevice = inputName;
    log(`📥 MIDI Input conectado: ${inputName} (← vMix Activators)`);

    // Escutar feedback do vMix e enviar de volta ao Host
    Object.keys(MIDI_EVENT_MAP).forEach((type) => {
      if (type === 'sysex') return;
      midiInput.on(type, (msg) => {
        const json = midiToJson(type, msg);
        messageCount.sent++;
        trackMessage('out', json);
        sendToPanel({ type: 'midi', direction: 'out', data: json });

        // Enviar feedback ao Host
        if (hostSocket && hostSocket.readyState === WebSocket.OPEN) {
          hostSocket.send(JSON.stringify(json));
        }
      });
    });
  }

  sendToPanel({ type: 'device_update', data: { output: selectedOutputDevice, input: selectedInputDevice } });
}

function disconnectMidiDevice() {
  if (midiOutput) {
    try { midiOutput.close(); } catch (e) { /* ignore */ }
    midiOutput = null;
    selectedOutputDevice = null;
  }
  if (midiInput) {
    try { midiInput.close(); } catch (e) { /* ignore */ }
    midiInput = null;
    selectedInputDevice = null;
  }
}

// ── Helpers ───────────────────────────────────────────────
function trackMessage(direction, json) {
  recentMessages.push({ direction, ...json, _time: new Date().toISOString() });
  if (recentMessages.length > MAX_RECENT) recentMessages.shift();
}

function getFullStatus() {
  return {
    mode: 'remote',
    midiOutput: selectedOutputDevice,
    midiInput: selectedInputDevice,
    hostConnected,
    wsPort: LOCAL_WS_PORT,
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
console.log('║     USB-REMOTO — Modo REMOTE         ║');
console.log('╚══════════════════════════════════════╝\n');

log('🎛️  Dispositivos MIDI detectados:');
const inputs = safeGetInputs();
const outputs = safeGetOutputs();
inputs.forEach((d, i) => log(`   📥 Input  [${i}]: ${d}`));
outputs.forEach((d, i) => log(`   📤 Output [${i}]: ${d}`));

if (outputs.length === 0) {
  log('⚠️  Nenhum output MIDI encontrado. Certifique-se que o loopMIDI está rodando!');
}

// Auto-connect se passado via CLI
if (CLI_MIDI_OUT || CLI_MIDI_IN) {
  try {
    connectMidiDevice(CLI_MIDI_OUT, CLI_MIDI_IN);
  } catch (err) {
    log(`❌ Erro ao conectar device via CLI: ${err.message}`);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  log('👋 Encerrando...');
  disconnectMidiDevice();
  wss.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  disconnectMidiDevice();
  wss.close();
  process.exit(0);
});
