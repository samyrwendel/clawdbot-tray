# Clawd Node - Agente Windows

Agente standalone que conecta ao Gateway Clawd via WebSocket.

## Estrutura

```
clawd-node/
├── package.json      # Dependências
├── config.json       # Configuração do Gateway
├── index.js          # Agente principal
├── favicon.svg       # Ícone do tray
├── start.bat         # Iniciar com console
├── start-hidden.vbs  # Iniciar sem console (background)
└── README.md         # Este arquivo
```

## Instalação

1. Instale o Node.js (v18+)
2. Configure o `config.json`:

```json
{
  "gatewayUrl": "ws://umbrel.local:18789",
  "password": "sua-senha",
  "nodeId": "meu-windows",
  "nodeName": "PC do Trabalho",
  "reconnectInterval": 5000,
  "browser": {
    "headless": true,
    "executablePath": ""
  }
}
```

3. Instale as dependências:

```bash
npm install
```

4. (Opcional) Instale o Chromium para automação de browser:

```bash
npm run install-browser
```

## Uso

### Com console (para debug)
```bash
npm start
# ou
start.bat
```

### Sem console (background)
Dê duplo-clique em `start-hidden.vbs`

### Iniciar com Windows
1. Pressione `Win + R`
2. Digite `shell:startup`
3. Crie um atalho para `start-hidden.vbs` nessa pasta

## Funcionalidades

| Tipo | Descrição |
|------|-----------|
| `system.run` | Executa comandos shell no Windows |
| `browser.proxy` | Controla browser via Playwright |
| `notification` | Envia notificações Windows |

## Menu do Tray

- 🦀 **Clawd Node** - Título (desabilitado)
- 🔌 **Conectar** - Conecta ao Gateway
- 🔌 **Desconectar** - Desconecta do Gateway
- ⚙️ **Configurações** - Abre config.json no Notepad
- 📋 **Logs** - Abre os logs no Notepad
- ❌ **Sair** - Fecha o agente

## Protocolo WebSocket

### Autenticação
```json
{
  "type": "auth",
  "nodeId": "windows-pc",
  "nodeName": "PC Windows",
  "password": "senha",
  "capabilities": ["system.run", "browser.proxy", "notification"]
}
```

### Executar comando
```json
{
  "type": "system.run",
  "id": "123",
  "command": "dir C:\\",
  "timeout": 60000
}
```

### Browser
```json
{
  "type": "browser.proxy",
  "id": "123",
  "action": "newPage",
  "params": {}
}
```

### Notificação
```json
{
  "type": "notification",
  "id": "123",
  "title": "Título",
  "message": "Mensagem"
}
```

## Requisitos

- Windows 10/11
- Node.js 18+
- (Opcional) Chromium para browser automation
