const { test, describe } = require('node:test');
const assert = require('node:assert');
const { midiToJson, jsonToMidi, isValidMidiJson } = require('../src/shared/midi-protocol');

describe('MIDI Protocol Serialization', () => {
  test('midiToJson - converts easymidi CC to JSON', () => {
    const raw = { channel: 0, controller: 77, value: 127 };
    const json = midiToJson('cc', raw);
    
    assert.strictEqual(json.type, 'cc');
    assert.strictEqual(json.channel, 0);
    assert.strictEqual(json.controller, 77);
    assert.strictEqual(json.value, 127);
    assert.ok(json.ts > 0, 'Should have timestamp');
  });

  test('jsonToMidi - converts JSON back to easymidi format', () => {
    const json = { type: 'noteon', channel: 1, note: 60, velocity: 100 };
    const easymidiMsg = jsonToMidi(json);
    
    assert.strictEqual(easymidiMsg.type, 'noteon');
    assert.strictEqual(easymidiMsg.msg.channel, 1);
    assert.strictEqual(easymidiMsg.msg.note, 60);
    assert.strictEqual(easymidiMsg.msg.velocity, 100);
  });

  test('jsonToMidi - clamps values to max 127 to prevent driver crashes', () => {
    const json = { type: 'cc', channel: 0, controller: 77, value: 255 }; // Invalid high value
    const easymidiMsg = jsonToMidi(json);
    
    assert.strictEqual(easymidiMsg.msg.value, 127, 'Should be clamped to 127');
  });

  test('jsonToMidi - clamps values to min 0', () => {
    const json = { type: 'noteon', channel: 0, note: -5, velocity: -100 };
    const easymidiMsg = jsonToMidi(json);
    
    assert.strictEqual(easymidiMsg.msg.note, 0, 'Note should be clamped to 0');
    assert.strictEqual(easymidiMsg.msg.velocity, 0, 'Velocity should be clamped to 0');
  });

  test('isValidMidiJson - validates correct messages', () => {
    assert.strictEqual(isValidMidiJson({ type: 'cc' }), true);
    assert.strictEqual(isValidMidiJson({ type: 'sysex' }), true);
    assert.strictEqual(isValidMidiJson({ type: 'unknown_type' }), false);
    assert.strictEqual(isValidMidiJson(null), false);
    assert.strictEqual(isValidMidiJson('string'), false);
  });

  // ── v3.0: Multi-Device (deviceId) ────────────────────
  test('midiToJson - includes deviceId when provided (multi-device)', () => {
    const raw = { channel: 0, controller: 7, value: 64 };
    const json = midiToJson('cc', raw, 2);  // deviceId = 2 (terceira controladora)
    assert.strictEqual(json.deviceId, 2, 'deviceId deve ser preservado');
  });

  test('midiToJson - defaults deviceId to 0 for backward compatibility', () => {
    const raw = { channel: 0, controller: 7, value: 64 };
    const json = midiToJson('cc', raw);  // sem deviceId
    assert.strictEqual(json.deviceId, 0, 'deviceId deve ser 0 por padrão');
  });

  test('jsonToMidi - preserves deviceId from incoming packet', () => {
    const json = { type: 'cc', channel: 0, controller: 7, value: 64, deviceId: 1 };
    const result = jsonToMidi(json);
    assert.strictEqual(result.deviceId, 1, 'deviceId deve ser passado adiante');
  });

  test('jsonToMidi - defaults deviceId to 0 when absent (backward compat)', () => {
    const json = { type: 'noteon', channel: 0, note: 60, velocity: 100 };  // sem deviceId
    const result = jsonToMidi(json);
    assert.strictEqual(result.deviceId, 0, 'deviceId ausente deve virar 0');
  });

  test('isValidMidiJson - accepts packets with deviceId (multi-device)', () => {
    const json = { type: 'cc', channel: 0, controller: 7, value: 64, deviceId: 3 };
    assert.strictEqual(isValidMidiJson(json), true, 'Packet com deviceId deve ser válido');
  });

  test('jsonToMidi - remaps channel to deviceId for multi-device isolation', () => {
    const json = { type: 'cc', channel: 0, controller: 7, value: 100, deviceId: 2 };
    const result = jsonToMidi(json);
    assert.strictEqual(result.msg.channel, 2, 'Canal deve ser remapeado para o deviceId (2)');
  });

  test('jsonToMidi - uses original channel when deviceId is 0 (backward compat)', () => {
    const json = { type: 'cc', channel: 0, controller: 7, value: 100, deviceId: 0 };
    const result = jsonToMidi(json);
    assert.strictEqual(result.msg.channel, 0, 'Canal deve permanecer 0 para deviceId 0');
  });
});

