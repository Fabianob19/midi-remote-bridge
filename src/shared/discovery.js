const dgram = require('dgram');
const os = require('os');
const { logEvent } = require('./logger');

const BROADCAST_PORT = 9903;
const DISCOVERY_MSG = 'usb-remoto-discovery';

/**
 * Obtém todas as sub-redes IPv4 e calcula seus endereços de broadcast.
 * Essencial para suportar múltiplas placas de rede (Wi-Fi, Ethernet, ZeroTier).
 */
function getBroadcastAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        // Calcula o broadcast address bit a bit (ex: 192.168.1.255)
        const ipBlocks = net.address.split('.').map(Number);
        const maskBlocks = net.netmask.split('.').map(Number);
        const broadcastBlocks = ipBlocks.map((block, i) => block | (~maskBlocks[i] & 255));
        const broadcastAddress = broadcastBlocks.join('.');
        
        addresses.push({ name, ip: net.address, broadcast: broadcastAddress });
      }
    }
  }
  return addresses;
}

/**
 * Inicia o emissor (vMix) que grita na rede "Estou aqui!".
 * @param {number} wsPort Porta do servidor WebSocket que será anunciada
 * @returns {function} Função para parar o broadcast
 */
function startBroadcaster(wsPort) {
  const socket = dgram.createSocket('udp4');
  let interval;

  socket.on('error', (err) => {
    logEvent(`[Discovery] Erro no socket broadcaster: ${err.message}`, 'ERROR');
    try { socket.close(); } catch(e){}
  });

  socket.bind(() => {
    try {
      socket.setBroadcast(true);
    } catch (err) {
      logEvent(`[Discovery] Falha ao habilitar modo Broadcast: ${err.message}`, 'WARN');
    }
    
    const message = Buffer.from(JSON.stringify({ 
      service: DISCOVERY_MSG, 
      port: wsPort 
    }));

    // Anuncia a cada 3 segundos
    interval = setInterval(() => {
      const addresses = getBroadcastAddresses();
      
      addresses.forEach(({ name, broadcast }) => {
        socket.send(message, 0, message.length, BROADCAST_PORT, broadcast, (err) => {
          if (err && err.code !== 'ENETUNREACH' && err.code !== 'EHOSTUNREACH') {
            // Ignora erros de rede inalcançável (comum se uma interface VPN estiver down)
            logEvent(`[Discovery] Erro ao enviar na interface ${name}: ${err.message}`, 'WARN');
          }
        });
      });
    }, 3000);
    
    logEvent(`[Discovery] Broadcaster ativado. Anunciando porta ${wsPort}...`, 'INFO');
  });

  return () => {
    if (interval) clearInterval(interval);
    try { socket.close(); } catch(e){}
  };
}

/**
 * Inicia o ouvinte (Casa/Host) que procura pelo vMix na rede.
 * @param {function} onDiscover Callback chamado quando encontra um remoto (recebe "IP:PORT")
 * @returns {function} Função para parar de escutar
 */
function startListener(onDiscover) {
  const socket = dgram.createSocket('udp4');
  let found = false;

  socket.on('error', (err) => {
    logEvent(`[Discovery] Erro no listener: ${err.message}`, 'ERROR');
    try { socket.close(); } catch(e){}
  });

  socket.on('message', (msg, rinfo) => {
    if (found) return; // Evita chamar múltiplas vezes se receber de várias redes

    try {
      const data = JSON.parse(msg.toString());
      if (data.service === DISCOVERY_MSG) {
        found = true;
        logEvent(`[Discovery] Remoto encontrado via UDP! IP de origem: ${rinfo.address}:${data.port}`, 'INFO');
        onDiscover(`${rinfo.address}:${data.port}`);
        
        // Fecha o socket após encontrar para não gastar recursos à toa
        try { socket.close(); } catch(e){}
      }
    } catch (e) {
      // Ignora pacote, não é o nosso JSON
    }
  });

  socket.on('listening', () => {
    logEvent(`[Discovery] Ouvindo broadcasts UDP na porta ${BROADCAST_PORT}...`, 'INFO');
  });

  // Bind na porta universal (0.0.0.0) para escutar em TODAS as placas de rede
  try {
    socket.bind(BROADCAST_PORT);
  } catch (err) {
    logEvent(`[Discovery] Erro ao fazer bind na porta UDP ${BROADCAST_PORT}: ${err.message}`, 'ERROR');
  }

  return () => {
    if (!found) {
      try { socket.close(); } catch(e){}
    }
  };
}

module.exports = { startBroadcaster, startListener, getBroadcastAddresses };
