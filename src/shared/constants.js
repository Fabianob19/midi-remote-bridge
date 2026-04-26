/**
 * USB-Remoto — Constantes compartilhadas
 */

module.exports = {
  // WebSocket
  WS_PORT: 9900,
  WEB_PORT: 9901,

  // Reconexão automática
  RECONNECT_INTERVAL_MS: 3000,
  HEARTBEAT_INTERVAL_MS: 5000,

  // Tipos de mensagem MIDI suportados
  MIDI_TYPES: ['cc', 'noteon', 'noteoff', 'program', 'pitch', 'sysex'],

  // Tipos de mensagem de controle (não-MIDI)
  CONTROL_TYPES: {
    DEVICE_LIST: 'device_list',
    SELECT_DEVICE: 'select_device',
    DEVICE_SELECTED: 'device_selected',
    STATUS: 'status',
    ERROR: 'error',
    HEARTBEAT: 'heartbeat',
  },
};
