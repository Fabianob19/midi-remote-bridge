# USB-Remoto v3.0

**Bridge MIDI bidirecional via WebSocket** — Controle o vMix, OBS ou qualquer software MIDI remotamente usando suas controladoras USB via rede/VPN.

```
OPERADOR / Host (até 4 Controladoras MIDI) ←── WebSocket / VPN ──→ VMIX / Remote (loopMIDI → vMix/OBS)
```

---

## Features v3.0

| Feature | Descrição |
|---------|-----------|
| **Multi-Controladoras** | Até 4 controladoras USB simultâneas com isolamento por Device ID |
| **Remapeamento de Canal** | Cada controladora sai automaticamente em um canal MIDI diferente (anti-conflito) |
| **Auto-Discovery** | Host e Remote se encontram na rede automaticamente via broadcast UDP |
| **Interface Tática** | Painel web com faders em tempo real, abas por device e log colorido |
| **Cores por Device** | Device #1=Verde, #2=Laranja, #3=Ciano, #4=Magenta |
| **Executável Standalone** | `.exe` pronto para rodar, sem precisar instalar Node.js |
| **Feedback Bidirecional** | LEDs, tally e faders motorizados com roteamento por device |
| **Reconexão Automática** | Queda de VPN? Reconecta sozinho em 3 segundos |

---

## Requisitos

### Modo EXE (Recomendado)

| Modo | Requisitos |
|----|------------|
| **Operador (Host)** | Windows 10/11, Controladora MIDI USB |
| **vMix (Remote)** | Windows 10/11, [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) |
| **Ambos** | Rede/VPN ([ZeroTier](https://www.zerotier.com/), [Tailscale](https://tailscale.com/), etc.) |

### Modo Desenvolvedor

| PC | Requisitos |
|----|------------|
| **Ambos** | Node.js 18+ (`node --version` para verificar) |

---

## Quick Start (Modo EXE)

> **⚠️ OBRIGATÓRIO: Execute o `usb-remoto.exe` sempre como Administrador.**
> Clique com o botão direito → "Executar como administrador". O acesso a dispositivos MIDI USB e portas de rede requer privilégios elevados.

1. Baixe o `usb-remoto.exe` da [Releases](../../releases)
2. Copie para ambos os PCs
3. No **vMix (Remote)**: abra o loopMIDI e crie uma porta virtual
4. Clique direito no .exe → **Executar como administrador** → selecione `MODO VMIX`
5. No **Operador (Host)**: clique direito no .exe → **Executar como administrador** → selecione `MODO OPERADOR`
6. Acesse o painel web e configure as controladoras

---

## Instalação (Modo Desenvolvedor)

### 1. Instalar Node.js (ambos os PCs)

1. Acesse: **https://nodejs.org** → Download LTS
2. Execute o instalador → Next → Next → Finish
3. Reinicie o terminal e verifique:

```powershell
node --version   # v22.x.x
npm --version    # 10.x.x
```

### 2. Extrair e instalar dependências

```powershell
cd C:\usb-remoto
npm install
```

### 3. Verificar dispositivos MIDI

```powershell
npm run list
```

Saída esperada:
```
MIDI Inputs: [ 'Launch Control XL', 'APC MINI' ]
MIDI Outputs: [ 'Launch Control XL', 'APC MINI', 'Microsoft GS Wavetable Synth' ]
```

---

## Uso

### vMix / Remote (onde o software de transmissão roda)

```bash
# Modo simples
npm run remote

# Com parâmetros
node src/remote.js --midi-out "loopMIDI Port" --midi-in "loopMIDI Port"

# Atalhos Windows
scripts\start-remote.bat              # Abre janela
scripts\start-remote-minimized.bat    # Inicia oculto na barra de tarefas
```

- Painel web: `http://localhost:9902`
- WebSocket escuta na porta `9900`

> **⚠️ IMPORTANTE:** Não feche a janela do terminal. Se quiser ocultar, use o atalho `minimized`.

### Operador / Host (onde as controladoras estão conectadas)

```bash
# Modo simples
npm run host

# Conectar direto a um IP
npm run host -- --remote 10.147.20.53:9900

# Atalhos Windows
scripts\start-host.bat              # Abre janela
scripts\start-host-minimized.bat    # Inicia oculto na barra de tarefas
```

- Painel web: `http://localhost:9901`

> **⚠️ IMPORTANTE:** Não feche a janela do terminal. Se quiser ocultar, use o atalho `minimized`.

**Como descobrir o IP do Remote:**
Abra o ZeroTier no PC onde roda o vMix → copie o IP (ex: `10.147.20.53`).

---

## Multi-Controladoras (Novo v3.0)

### Como funciona

Conecte até **4 controladoras USB** simultaneamente no Operador (Host). O painel web mostra **abas com cores táticas** para cada device:

| Device | Cor | Canal MIDI de Saída |
|--------|-----|---------------------|
| Device #1 | 🟢 Verde Ácido | Canal 0 |
| Device #2 | 🟠 Laranja Neon | Canal 1 |
| Device #3 | 🔵 Ciano Elétrico | Canal 2 |
| Device #4 | 🟣 Rosa Magenta | Canal 3 |

### Remapeamento Automático de Canal

O USB-Remoto **reescreve o canal MIDI automaticamente** antes de entregar ao vMix/OBS:

```
Sem USB-Remoto:
  Mesa de Vídeo  → CH:0 CC:1 → vMix confunde com a outra mesa ❌
  Mesa de Áudio  → CH:0 CC:1 → vMix confunde com a outra mesa ❌

Com USB-Remoto v3.0:
  Mesa de Vídeo (Device #1) → CH:0 CC:1 → vMix recebe no Canal 0 ✅
  Mesa de Áudio (Device #2) → CH:1 CC:1 → vMix recebe no Canal 1 ✅
```

Isso permite usar **duas controladoras idênticas** (mesmo modelo, mesmos CCs) sem nenhum conflito.

### Retrocompatibilidade

Se você usa **apenas 1 controladora**, nada muda. O Device #1 usa Canal 0, exatamente como na versão anterior.

---

## Configurar vMix

### Shortcuts (Controle → vMix)

1. **Settings → Shortcuts → Add**
2. Selecione o device **loopMIDI**
3. Para multi-controladoras, filtre pelo **canal MIDI**:
   - Canal 0 = Atalhos da mesa de vídeo (Device #1)
   - Canal 1 = Atalhos da mesa de áudio (Device #2)
4. Mapeie os faders/botões para funções (SetVolume, Cut, Fade, etc.)

### Activators (vMix → Controle / Feedback)

1. **Settings → Activators → Add**
2. Selecione o device **loopMIDI**
3. Configure feedback: Tally (Input Live), Volume, etc.

---

## Configurar OBS

### Usando obs-midi plugin

1. Instale o plugin [obs-midi](https://github.com/cpyarger/obs-midi)
2. Em **Tools → obs-midi Settings**, selecione o device **loopMIDI**
3. Para multi-controladoras, use o filtro de canal MIDI:
   - Canal 0 = Controles de cena (Device #1)
   - Canal 1 = Controles de áudio (Device #2)
4. Mapeie CC/Notes para ações do OBS (Switch Scene, SetVolume, etc.)

---

## Auto-Discovery

O USB-Remoto usa **broadcast UDP** para que Host e Remote se encontrem automaticamente na rede local ou VPN.

- O Remote envia broadcasts periódicos na porta `9900`
- O Host escuta e conecta automaticamente ao primeiro Remote encontrado
- Se preferir, passe o IP manualmente: `--remote IP:PORTA`

---

## Terminal Log

O painel web mostra um log em tempo real com **tags coloridas por device**:

```
[DEV#1] CH:0 CC [7] VAL:100     ← Verde (mesa de vídeo)
[DEV#2] CH:1 CC [1] VAL:64      ← Laranja (mesa de áudio)
```

Isso facilita a identificação instantânea de qual controladora enviou cada mensagem.

---

## Troubleshooting

### ❌ Conectou mas não recebe dados MIDI
- Desconecte e reconecte a controladora USB
- Ou reinicie o host com a controladora já plugada
- Ordem recomendada: **1º plugar a controladora → 2º iniciar o host**

### ❌ Device MIDI não aparece na lista
- Feche outros programas que usam MIDI (DAW, outro software)
- Reconecte o USB da controladora
- Execute `npm run list` para verificar

### ❌ WebSocket não conecta
- Verifique se o ZeroTier está ativo nos dois PCs
- Teste: `ping IP_DO_REMOTO`
- Confirme que a porta **9900** não está bloqueada pelo firewall:
  ```powershell
  netsh advfirewall firewall add rule name="USB-Remoto" dir=in action=allow protocol=TCP localport=9900
  ```

### ❌ Conexão cai durante o uso
- A reconexão é automática (a cada 3 segundos)
- Se não reconectar, reinicie o host no Operador

### ❌ Duas controladoras causam conflito no vMix
- O USB-Remoto v3.0 já remapeia canais automaticamente
- No vMix, configure os Shortcuts filtrando por **canal MIDI** (Canal 0, Canal 1, etc.)
- Se o problema persistir, verifique se ambos os devices estão aparecendo no painel web

---

## Controladoras Testadas

| Controladora | Faders | Botões | Observações |
|---|---|---|---|
| **Novation LaunchControl XL** | CC 77-84 (8 faders) | 16 botões + 24 knobs | Suporta troca de canal MIDI |
| **Akai APC Mini** | CC 48-56 (9 faders) | 64 botões com LED RGB | Feedback visual completo |

> Qualquer controladora MIDI USB Class-Compliant é compatível.

---

## Parâmetros CLI

```bash
# Host
node src/host.js --remote IP:PORTA --port PORTA_WEB

# Remote
node src/remote.js --port PORTA_WS --web PORTA_WEB --midi-out "nome" --midi-in "nome"

# EXE
usb-remoto.exe --mode host --remote IP:PORTA
usb-remoto.exe --mode remote --midi-out "loopMIDI Port"
```

## Portas Padrão

| Serviço | Porta |
|---|---|
| WebSocket (bridge MIDI) | 9900 |
| Painel Web (Host) | 9901 |
| Painel Web (Remote) | 9902 |

---

## Build (Desenvolvedor)

```bash
npm run build    # Gera dist/usb-remoto.exe
npm test         # Roda 13 testes unitários
```

---

## Créditos

| Função | Nome |
|--------|------|
| **Desenvolvimento** | Fabiano Brandão |
| **Colaboração & Testes** | André Gribel |

## Licença

MIT
