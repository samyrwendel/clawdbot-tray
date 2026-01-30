# Clawd Node Agent

Agente Windows para o Gateway Clawd. Roda na system tray e conecta via WebSocket usando o protocolo OpenClaw v3 com autenticação Ed25519.

## Requisitos

### Sistema
- Windows 10/11
- Node.js 18+ (recomendado: 20 LTS)

### Dependências Externas

#### FFmpeg (para câmera)
```powershell
winget install ffmpeg
```
> **Nota**: Após instalar, reinicie o terminal ou o PC para atualizar o PATH. Se o PATH não for atualizado, o código usa o caminho completo do WinGet.

#### Node.js
```powershell
winget install OpenJS.NodeJS.LTS
```

## Instalação

### 1. Clonar/Copiar os arquivos
```powershell
mkdir c:\Tools\clawdbot-tray
cd c:\Tools\clawdbot-tray
# Copiar index.js, package.json, favicon.svg, icon.ico
```

### 2. Instalar dependências Node
```powershell
npm install
```

Dependências principais:
- `ws` - WebSocket client
- `systray2` - System tray integration
- `node-notifier` - Desktop notifications
- `sharp` - Image processing
- `tweetnacl` - Ed25519 cryptography

### 3. Configurar o Gateway

Criar `config.json`:
```json
{
  "gatewayUrl": "ws://SEU_GATEWAY_IP:18789",
  "nodeId": "windows-pc",
  "nodeName": "PC Windows",
  "reconnectInterval": 5000
}
```

### 4. Primeira execução (pareamento)

```powershell
node index.js
```

Na primeira execução:
1. O node gera uma identidade Ed25519 em `~/.clawdbot/identity/device.json`
2. Conecta ao Gateway e solicita pareamento
3. **No Gateway**: aprovar o pareamento do dispositivo
4. Após aprovado, o node conecta automaticamente

## Habilidades (Capabilities)

| Capability | Comandos | Descrição |
|------------|----------|-----------|
| `system` | `system.run`, `system.which` | Execução de comandos shell |
| `browser` | `browser.proxy` | Controle de browser Puppeteer |
| `clipboard` | `clipboard.read`, `clipboard.write` | Leitura/escrita do clipboard |
| `screen` | `screen.capture` | Screenshot da tela |
| `camera` | `camera.list`, `camera.snap`, `camera.clip` | Webcam via FFmpeg |

## Endpoints HTTP (porta 18790)

Para testes locais e integração:

### Status
```bash
curl http://localhost:18790/status
```

### Screenshot
```bash
curl http://localhost:18790/screen
# Retorna: { base64, format: "png", size }
```

### Clipboard
```bash
# Ler
curl http://localhost:18790/clipboard

# Escrever
curl -X POST http://localhost:18790/clipboard \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello"}'
```

### Câmera
```bash
# Listar câmeras
curl http://localhost:18790/camera/list
# Retorna: { cameras: [{ name, index }] }

# Tirar foto
curl -X POST http://localhost:18790/camera/snap \
  -H "Content-Type: application/json" \
  -d '{"camera": "HD Pro Webcam C920"}'
# Retorna: { base64, format: "jpg", size }

# Gravar clipe (máx 30s)
curl -X POST http://localhost:18790/camera/clip \
  -H "Content-Type: application/json" \
  -d '{"camera": "HD Pro Webcam C920", "duration": 5}'
# Retorna: { base64, format: "mp4", size, duration }
```

### Browser Control
```bash
# Iniciar browser
curl -X POST http://localhost:18790/start \
  -d '{"url": "https://example.com"}'

# Status
curl http://localhost:18790/status

# Navegar
curl -X POST http://localhost:18790/navigate \
  -d '{"url": "https://google.com"}'

# Screenshot do browser
curl http://localhost:18790/screenshot

# Executar ação
curl -X POST http://localhost:18790/act \
  -d '{"type": "click", "selector": "#button"}'

# Parar browser
curl -X POST http://localhost:18790/stop
```

### Notificação
```bash
curl -X POST http://localhost:18790/notify \
  -H "Content-Type: application/json" \
  -d '{"title": "Teste", "message": "Hello World"}'
```

## Arquivos

```
clawdbot-tray/
├── index.js           # Código principal
├── package.json       # Dependências
├── config.json        # Configuração (criar manualmente)
├── favicon.svg        # Ícone do tray (SVG)
├── icon.ico           # Ícone para notificações
├── log.txt            # Log de execução (auto-gerado)
├── status.txt         # Status atual (auto-gerado)
├── .lock              # Lock file (auto-gerado)
└── .gitignore         # Arquivos ignorados
```

### Identidade (auto-gerada)
```
~/.clawdbot/identity/device.json
```
Contém:
- `publicKey` - Chave pública Ed25519 (hex)
- `secretKey` - Chave privada Ed25519 (hex)
- `deviceId` - Hash da chave pública

## Menu do Tray

- 🦀 **Clawd Node** - Título com status
- 🔌 **Conectar** - Conecta ao Gateway
- 🔌 **Desconectar** - Desconecta do Gateway
- ⚙️ **Configurações** - Abre GUI de configuração
- 📋 **Logs** - Abre os logs no Notepad
- ❌ **Sair** - Fecha o agente

## Execução como Serviço

### Opção 1: Task Scheduler
1. Abrir Task Scheduler
2. Create Task > "Clawd Node Agent"
3. Trigger: At logon
4. Action: Start a program
   - Program: `node`
   - Arguments: `c:\Tools\clawdbot-tray\index.js`
   - Start in: `c:\Tools\clawdbot-tray`
5. Conditions: desmarcar "Start only if on AC power"

### Opção 2: Startup Folder
```powershell
# Criar atalho
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\ClawdNode.lnk")
$Shortcut.TargetPath = "node"
$Shortcut.Arguments = "c:\Tools\clawdbot-tray\index.js"
$Shortcut.WorkingDirectory = "c:\Tools\clawdbot-tray"
$Shortcut.Save()
```

## Troubleshooting

### FFmpeg não encontrado
Se `camera.list` retorna vazio após instalar ffmpeg:
1. Reinicie o terminal/PC
2. Ou edite `FFMPEG_PATH` no index.js com o caminho completo:
```javascript
const FFMPEG_PATH = 'C:\\Users\\SEU_USER\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe';
```

### Node não conecta
1. Verificar `config.json` com URL correta do Gateway
2. Verificar se Gateway está rodando e acessível
3. Ver `log.txt` para erros

### Screenshot não funciona
O screenshot usa PowerShell com System.Drawing. Se falhar:
1. Verificar se .NET Framework está instalado
2. Testar manualmente:
```powershell
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
```

### Clipboard vazio
PowerShell Set-Clipboard não aceita string vazia. O código já trata isso, mas se falhar:
```powershell
Get-Clipboard  # Deve retornar conteúdo
```

## Protocolo OpenClaw v3

### Autenticação
1. Gateway envia `connect.challenge` com nonce
2. Node assina `connect:{nonce}` com Ed25519
3. Node envia `connect` request com assinatura
4. Gateway valida e responde `hello-ok`

### Mensagens
- `req` - Request (espera resposta)
- `res` - Response
- `event` - Evento (sem resposta)

### Invoke (execução remota)
1. Gateway envia `node.invoke.request`
2. Node executa comando
3. Node responde `node.invoke.result`

## Segurança

- Chaves Ed25519 são geradas localmente e nunca transmitidas
- Cada mensagem sensível é assinada
- Pareamento requer aprovação explícita no Gateway
- HTTP server escuta em 0.0.0.0 - restringir via firewall se necessário

## Desenvolvimento

### Logs em tempo real
```powershell
Get-Content log.txt -Wait -Tail 20
```

### Testar endpoints
```powershell
# Screenshot
Invoke-RestMethod http://localhost:18790/screen | Select-Object format, size

# Câmeras
Invoke-RestMethod http://localhost:18790/camera/list

# Clipboard
Invoke-RestMethod http://localhost:18790/clipboard
```
