# Changelog

Todas as alterações notáveis do USB-Remoto serão documentadas neste arquivo.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [3.0.0] - 2026-05-11

### Added
- **Multi-Controladoras**: Suporte a até 4 controladoras MIDI USB simultâneas com isolamento por Device ID
- **Remapeamento Automático de Canal MIDI**: Cada device sai num canal MIDI diferente, evitando conflito no vMix/OBS
- **Auto-Discovery**: Host e Remote se encontram na rede via broadcast UDP (sem digitar IP manualmente)
- **Interface Tática**: Painel web com abas de faders por device, cores táticas e log colorido
- **Cores por Device**: Device #1=Verde Ácido, #2=Laranja Neon, #3=Ciano Elétrico, #4=Rosa Magenta
- **Terminal Log com Tags**: Cada mensagem MIDI no log tem tag colorida indicando o device de origem
- **Executável Standalone**: `.exe` via pkg — roda sem Node.js instalado
- **Ícone Profissional**: Ícone de alta visibilidade para o .exe e favicon no painel web
- **Reutilização de Device IDs**: Ao remover e readicionar um device, o ID é reciclado (sempre começa do menor livre)
- **Dirty-State Check**: Faders só são reconstruídos no DOM quando a lista de devices realmente muda
- **Event Delegation**: Cliques nas abas funcionam mesmo durante rebuild do DOM
- **Testes Unitários**: 13 testes automatizados cobrindo protocolo MIDI e discovery
- **Logger com Timezone Local**: Logs em disco usam hora local (pt-BR)
- **Créditos Autorais**: Fabiano Brandão (Dev) e André Gribel (Collab) nos metadados do .exe e na interface

### Changed
- **Logs do Terminal**: Emojis substituídos por tags ASCII táticas (compatibilidade com Windows CMD/PowerShell)
- **Protocolo MIDI**: Campo `deviceId` adicionado em cada pacote para roteamento multi-device
- **Canal de Saída**: Automaticamente substituído pelo deviceId na conversão `jsonToMidi()`

### Fixed
- **Encoding Windows**: Caracteres `??` no terminal causados por emojis removidos
- **Timezone**: Logs em disco corrigidos de UTC para hora local

---

## [2.0.0] - 2026-04-23

### Added
- Bridge MIDI bidirecional via WebSocket
- Suporte a Novation LaunchControl XL e Akai APC Mini
- Faders (CC 0-127), Botões (Note On/Off), Feedback (LEDs)
- Dashboard web com monitor MIDI em tempo real
- Reconexão automática via VPN/ZeroTier
- Scripts `.bat` para deploy rápido no Windows
- Atalhos minimizados para barra de tarefas
