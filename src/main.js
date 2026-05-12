const readline = require('readline');
const { logEvent } = require('./shared/logger');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.clear();
console.log('╔════════════════════════════════════════════════════╗');
console.log('║               USB-REMOTO v3.0                      ║');
console.log('║   Dev: Fabiano Brandão | Collab: André Gribel      ║');
console.log('╠════════════════════════════════════════════════════╣');
console.log('║                                                    ║');
console.log('║  Escolha o modo de operação para este computador:  ║');
console.log('║                                                    ║');
console.log('║  [1] MODO OPERADOR (Host)                          ║');
console.log('║      Onde a controladora USB física está conectada.║');
console.log('║                                                    ║');
console.log('║  [2] MODO VMIX (Remote)                            ║');
console.log('║      Onde o software vMix está rodando.            ║');
console.log('║                                                    ║');
console.log('╚════════════════════════════════════════════════════╝\n');

rl.question('Digite 1 ou 2 e pressione ENTER: ', (answer) => {
  const choice = answer.trim();
  
  if (choice === '1') {
    logEvent('Iniciando modo OPERADOR (Host) pelo Menu Principal...', 'INFO');
    // Adiciona o diretório atual ao argv para simular a execução direta do host.js
    process.argv = [process.argv[0], __dirname + '/host.js'];
    require('./host');
  } else if (choice === '2') {
    logEvent('Iniciando modo VMIX (Remote) pelo Menu Principal...', 'INFO');
    // Adiciona o diretório atual ao argv para simular a execução direta do remote.js
    process.argv = [process.argv[0], __dirname + '/remote.js'];
    require('./remote');
  } else {
    console.log('[FAIL] Opção inválida. Fechando o programa.');
    process.exit(1);
  }
  
  rl.close();
});
