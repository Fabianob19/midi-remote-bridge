/**
 * USB-Remoto — Protocolo de serialização MIDI ↔ JSON
 *
 * Converte mensagens MIDI nativas (easymidi) em JSON compacto
 * para transporte via WebSocket, e vice-versa.
 */

const MIDI_EVENT_MAP = {
  cc: 'cc',
  noteon: 'noteon',
  noteoff: 'noteoff',
  program: 'program',
  pitch: 'pitch',
  sysex: 'sysex',
};

/**
 * Converte evento easymidi em JSON para transporte
 * @param {string} type - Tipo do evento MIDI (cc, noteon, noteoff, etc.)
 * @param {object} msg - Mensagem easymidi
 * @returns {object} JSON serializado
 */
function midiToJson(type, msg) {
  const base = { type, channel: msg.channel ?? 0, ts: Date.now() };

  switch (type) {
    case 'cc':
      return { ...base, controller: msg.controller, value: msg.value };
    case 'noteon':
      return { ...base, note: msg.note, velocity: msg.velocity };
    case 'noteoff':
      return { ...base, note: msg.note, velocity: msg.velocity ?? 0 };
    case 'program':
      return { ...base, number: msg.number };
    case 'pitch':
      return { ...base, value: msg.value };
    case 'sysex':
      return { ...base, bytes: Array.from(msg.bytes || []) };
    default:
      return { ...base, raw: msg };
  }
}

/**
 * Converte JSON de transporte em mensagem easymidi
 * @param {object} json - Objeto JSON recebido via WebSocket
 * @returns {{ type: string, msg: object }} Tipo + mensagem para easymidi
 */
function jsonToMidi(json) {
  const base = { channel: json.channel ?? 0 };

  switch (json.type) {
    case 'cc':
      return {
        type: 'cc',
        msg: { ...base, controller: json.controller, value: clamp(json.value) },
      };
    case 'noteon':
      return {
        type: 'noteon',
        msg: { ...base, note: clamp(json.note), velocity: clamp(json.velocity) },
      };
    case 'noteoff':
      return {
        type: 'noteoff',
        msg: { ...base, note: clamp(json.note), velocity: clamp(json.velocity, 0) },
      };
    case 'program':
      return {
        type: 'program',
        msg: { ...base, number: clamp(json.number) },
      };
    case 'pitch':
      return {
        type: 'pitch',
        msg: { ...base, value: Math.max(0, Math.min(16383, json.value ?? 8192)) },
      };
    default:
      return null;
  }
}

/**
 * Clamp valor MIDI padrão (0-127)
 */
function clamp(val, fallback = 0) {
  const v = val ?? fallback;
  return Math.max(0, Math.min(127, Math.round(v)));
}

/**
 * Valida se um JSON é uma mensagem MIDI válida
 */
function isValidMidiJson(json) {
  return json && typeof json.type === 'string' && json.type in MIDI_EVENT_MAP;
}

module.exports = { midiToJson, jsonToMidi, isValidMidiJson, MIDI_EVENT_MAP };
