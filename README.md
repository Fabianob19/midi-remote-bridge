# 🎛️ USB-Remoto

**Bridge MIDI bidirecional via WebSocket** — Use sua controladora MIDI local para controlar o vMix em outro PC via rede/VPN.

## Como Funciona

```
PC Casa (Controladora MIDI) ←──WebSocket/VPN──→ PC Remoto (loopMIDI → vMix)
```

- **Faders** (CC 0-127) → Controlam volume, transições no vMix
- **Botões** (Note On/Off) → Executam Shortcuts no vMix
- **Feedback** (LEDs) ← vMix Activators enviam tally de volta

## Requisitos

| PC | Software |
|---|---|
| **Casa (Host)** | Node.js 18+, Controladora MIDI USB |
| **Remoto (vMix)** | Node.js 18+, [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html), vMix |
| **Ambos** | Rede/VPN (ZeroTier, Tailscale, etc.) |

---

## Instalação Detalhada

### Passo 1: Instalar o Node.js (em ambos os PCs)

Se ainda não tem o Node.js instalado:

1. Acesse: **https://nodejs.org**
2. Clique em **"Download"** (versão LTS recomendada, 22.x)
3. Execute o instalador `.msi` e siga Next → Next → Finish
4. **Reinicie o terminal** (feche e abra de novo)
5. Verifique se instalou corretamente:

```powershell
node --version
# Deve mostrar algo como: v22.14.0

npm --version
# Deve mostrar algo como: 10.x.x
```

> Se o comando `node` não for reconhecido, reinicie o PC.

### Passo 2: Extrair o ZIP

1. Copie o arquivo `usb-remoto.zip` para o PC (via pen drive, ZeroTier, Google Drive, etc.)
2. Extraia em uma pasta de fácil acesso, por exemplo:
   - `C:\usb-remoto\` ou `D:\usb-remoto\`
3. A estrutura deve ficar assim:

```
usb-remoto/
├── package.json
├── README.md
├── src/
│   ├── host.js
│   ├── remote.js
│   ├── shared/
│   │   ├── constants.js
│   │   └── midi-protocol.js
│   └── web/
│       ├── index.html
│       ├── styles.css
│       └── app.js
└── scripts/
    ├── start-host.bat
    └── start-remote.bat
```

### Passo 3: Instalar dependências

1. Abra o **Prompt de Comando** ou **PowerShell**
2. Navegue até a pasta do projeto:

```powershell
cd C:\usb-remoto
```

3. Execute o comando de instalação:

```powershell
npm install
```

4. Aguarde — vai baixar ~86 pacotes (~30 segundos)
5. Deve terminar com:

```
added 86 packages, and audited 87 packages in 22s
found 0 vulnerabilities
```

> Se der erro de permissão, tente rodar o terminal como **Administrador**.

### Passo 4: Verificar se funciona

```powershell
npm run list
```

Deve listar os dispositivos MIDI conectados, ex:

```
🎛️  MIDI Inputs: [ 'Launch Control XL', 'APC MINI' ]
🎛️  MIDI Outputs: [ 'Launch Control XL', 'APC MINI', 'Microsoft GS Wavetable Synth' ]
```

✅ Se viu os devices, está tudo pronto!

---

## Uso

### 1. PC Remoto (onde está o vMix)

```bash
# Iniciar loopMIDI e criar uma porta virtual (ex: "USB-Remoto")
# Depois:
npm run remote

# Ou com atalhos Windows:
scripts\start-remote.bat             # Abre janela (pode minimizar)
scripts\start-remote-minimized.bat   # Já inicia oculto na barra de tarefas
```

> **⚠️ IMPORTANTE:** Não feche a janela preta (CMD). Se fechar, o programa para e a conexão cai! Se quiser ocultar, use o atalho `minimized`.

- Painel web: `http://localhost:9902`
- WebSocket escuta na porta `9900`
- Selecionar a porta loopMIDI no painel

### 2. PC Casa (onde está a controladora)

```bash
npm run host

# Ou com atalhos Windows:
scripts\start-host.bat             # Abre janela (pode minimizar)
scripts\start-host-minimized.bat   # Já inicia oculto na barra de tarefas
```

> **⚠️ IMPORTANTE:** Não feche a janela preta (CMD). Se fechar, o programa para e a conexão cai! Se quiser ocultar, use o atalho `minimized`.

- Painel web: `http://localhost:9901`
- Selecionar a controladora MIDI no painel
- Informar o **IP ZeroTier do PC remoto (vMix)** no campo "IP do Remoto"

**⚠️ Como descobrir o IP do PC remoto:**
No PC que roda o **vMix**, abra o ZeroTier e copie o IP dele (ex: `10.147.20.53`).
Depois no painel do Host, coloque: `10.147.20.53:9900`

Ou já passe direto na CLI:
```bash
npm run host -- --remote 10.147.20.53:9900
```

### 3. Configurar vMix

1. **Settings → Shortcuts → Add**
   - Selecionar o device loopMIDI
   - Mapear faders/botões para funções (SetVolume, Cut, etc.)

2. **Settings → Activators → Add**
   - Selecionar o device loopMIDI
   - Configurar feedback: Tally (Input Live), Volume Fader, etc.

## Troubleshooting

### ❌ Conectou mas não recebe dados MIDI
- **Desconecte e reconecte a controladora USB** após iniciar o host
- Ou reinicie o `host.js` com a controladora já plugada
- Ordem recomendada: **1º plugar a controladora → 2º iniciar o host**

### ❌ Device MIDI não aparece na lista
- Feche outros programas que usam MIDI (DAW, outro software)
- Reconecte o USB da controladora
- Execute `npm run list` para verificar

### ❌ WebSocket não conecta
- Verifique se o ZeroTier está ativo nos dois PCs
- Teste: `ping IP_DO_REMOTO` — deve responder
- Confirme que a porta **9900** não está bloqueada pelo firewall
- No PC remoto, libere a porta: `netsh advfirewall firewall add rule name="USB-Remoto" dir=in action=allow protocol=TCP localport=9900`

### ❌ Conexão cai durante o programa
- A reconexão é automática (a cada 3 segundos)
- Se não reconectar, reinicie o `host.js` no PC casa

---

## Controladoras Suportadas

| Controladora | Faders CC | Botões |
|---|---|---|
| **Novation LaunchControl XL** | CC 77-84 (8 faders) | 16 botões + 24 knobs |
| **Akai APC Mini** | CC 48-56 (9 faders) | 64 botões com LED |

## Parâmetros CLI

```bash
# Host
node src/host.js --remote IP:PORTA --port PORTA_WEB

# Remote
node src/remote.js --port PORTA_WS --web PORTA_WEB --midi-out "loopMIDI Port" --midi-in "loopMIDI Port"
```

## Portas Padrão

| Serviço | Porta |
|---|---|
| WebSocket (bridge MIDI) | 9900 |
| Painel Web (host) | 9901 |
| Painel Web (remote) | 9902 |

## Licença

MIT
