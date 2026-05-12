const fs = require('fs');
const path = require('path');

// Arquivo será criado junto ao executável (ou ao processo atual)
const LOG_FILE = path.join(process.cwd(), 'usb-remoto.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Registra uma mensagem no console e opcionalmente em arquivo
 * @param {string} msg Mensagem a ser logada
 * @param {string} level 'INFO', 'WARN', 'ERROR', 'MIDI'
 * @param {boolean} persist Se true, salva no disco (log.txt)
 */
function logEvent(msg, level = 'INFO', persist = true) {
  const tsConsole = new Date().toLocaleTimeString('pt-BR');
  const tsFile = new Date().toLocaleString('pt-BR');
  
  // Terminal output
  if (level !== 'MIDI') {
    // Evita poluir o terminal com dados MIDI constantes
    console.log(`[${tsConsole}] ${msg}`);
  }

  // File output (Persistent)
  if (persist) {
    const logLine = `[${tsFile}] [${level}] ${msg}\n`;
    try {
      // Rotaciona o log se ficar muito grande (> 10MB)
      if (fs.existsSync(LOG_FILE)) {
        const stats = fs.statSync(LOG_FILE);
        if (stats.size > MAX_LOG_SIZE) {
          fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
        }
      }
      fs.appendFileSync(LOG_FILE, logLine, 'utf8');
    } catch (err) {
      // Ignora erro silenciosamente se não tiver permissão de escrita
      console.error(`[LOGGER] Falha ao escrever no log: ${err.message}`);
    }
  }
}

/**
 * Intercepta erros globais não tratados para garantir que sejam salvos no log
 */
function initCrashHandler(mode) {
  process.on('uncaughtException', (err) => {
    logEvent(`CRASH (${mode}): ${err.message}\n${err.stack}`, 'ERROR', true);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason) => {
    logEvent(`PROMISE_REJECTION (${mode}): ${reason}`, 'ERROR', true);
  });

  logEvent(`=== USB-REMOTO START (${mode.toUpperCase()}) ===`, 'INFO', true);
}

module.exports = {
  logEvent,
  initCrashHandler
};
