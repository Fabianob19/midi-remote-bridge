# 🚀 USB-Remoto: Roadmap & Propostas Futuras (v3.0+)

Este documento compila as ideias e sugestões técnicas de evolução para o **USB-Remoto**. A versão atual (2.0) já atende aos requisitos de produção (*Zero-Config, Executável Standalone, Auto-Discovery e Logs*). As propostas abaixo são visões para o futuro, visando cenários ainda mais complexos de broadcast.

---

## 🎛️ 1. Qualidade de Sinal e Controle Físico

### Suporte Otimizado a Faders Motorizados
Controladoras de altíssimo nível (como Behringer X-Touch ou Yamaha) possuem motores nos faders. Quando o operador altera o volume no vMix com o mouse, o fader físico precisa se mover sozinho na casa do usuário.
- **O que precisa:** O protocolo atual já transmite esses dados, mas precisaríamos implementar um algoritmo de *Smoothing* (Suavização) e controle estrito de latência bidirecional para evitar que o motor do fader "trepide" ou entre em loop infinito (fader briga com o mouse).

### Filtro de Ruído (Deadzone / Zona Morta)
Faders e knobs analógicos desgastados ou de baixa qualidade costumam enviar "lixo MIDI" na rede (flutuando entre os valores 65, 66, 65, 66 sem ninguém tocar).
- **O que precisa:** Criar um algoritmo de `Deadzone` no host. O software só transmite o dado para o PC remoto se a variação do fader for maior que `X` valores, cortando o envio de dados fantasmas e poupando banda da rede VPN.

---

## 🎨 2. Feedback Visual Avançado (LEDs e Cores)

### Mapeamento RGB (Ao Vivo vs Preview)
Equipamentos como a *Akai APC Mini* ou a *Novation Launchpad* possuem botões com LEDs RGB (várias cores).
- **O que precisa:** Interceptar o sinal de *Activators* do vMix e permitir traduzir isso para as cores da controladora. Exemplo: O botão fica **Vermelho** quando a câmera está em *Program* (Ao Vivo), e fica **Verde** quando está em *Preview*.

### Alerta de Tempo (Blink Mode)
- **O que precisa:** Utilizar a capacidade bidirecional do USB-Remoto para interpretar o tempo de um VT/Vídeo rolando no vMix. Fazer o botão físico da controladora **piscar rapidamente** quando o vídeo estiver nos últimos 10 segundos, avisando o operador que ele precisa cortar para a câmera.

---

## 🔌 3. Expansão de Hardware e Conectividade

### ✅ Multi-Controladoras (Multiplexing) — IMPLEMENTADO v3.0
O Host agora suporta até 4 controladoras USB simultâneas com isolamento por Device ID.
- **Remapeamento automático de canal MIDI**: Cada device sai num canal diferente (Device #1=CH0, #2=CH1, etc.)
- **Interface tática**: Abas com cores por device, log colorido, faders isolados
- **Reutilização de IDs**: Slots removidos são reciclados automaticamente

### Autenticação por PIN (Segurança)
Hoje o WebSocket (ponte de rede) é aberto na rede ZeroTier.
- **O que precisa:** Adicionar uma camada de segurança onde o Painel Remoto (vMix) exibe um PIN de 4 dígitos gerado aleatoriamente, e o operador em Casa precisa digitar esse PIN no seu painel para que a conexão MIDI seja liberada. Isso evita que outras pessoas na mesma VPN enviem comandos acidentalmente para o vMix.

---

## 🖥️ 4. Integração com o Sistema Operacional

### Modo Invisível (System Tray) & Auto-Start
O executável atual ainda abre uma janela de terminal (prompt) que não pode ser fechada.
- **O que precisa:** Transformar o `.exe` em um serviço de background que fica oculto na Bandeja do Sistema (perto do relógio do Windows) com um ícone próprio. Permitir que ele inicie automaticamente junto com o Windows, tornando o sistema 100% à prova de esquecimentos.

---

*Revisão técnica gerada para André Gribel e equipe.*
