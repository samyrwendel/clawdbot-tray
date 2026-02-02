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
- `playwright-core` - Browser automation
- `screenshot-desktop` - Screenshots

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
├── build.js           # Script de build do exe
├── config.json        # Configuração (criar manualmente)
├── icon.ico           # Ícone do tray e exe
├── log.txt            # Log de execução (auto-gerado)
├── status.txt         # Status atual (auto-gerado)
├── .lock              # Lock file (auto-gerado)
├── .gitignore         # Arquivos ignorados
└── dist/              # Build do executável (gerado por npm run build)
    ├── ClawdNode.exe
    ├── config.json
    ├── icon.ico
    └── node_modules/
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

## Build do Executável (.exe)

O projeto pode ser compilado para um executável Windows standalone usando `pkg`.

### Pré-requisitos de Build

```powershell
npm install
```

DevDependencies:
- `@yao-pkg/pkg` - Empacotador Node.js para executável
- `rcedit` - Editar recursos do exe (ícone, metadados)

### Gerar o Executável

```powershell
npm run build
```

O script `build.js` executa:
1. **pkg** - Compila index.js para ClawdNode.exe (node18-win-x64)
2. **Copia módulos nativos** - screenshot-desktop, systray2, node-notifier
3. **Copia ícone** - icon.ico para a pasta dist
4. **Copia config** - config.json para a pasta dist
5. **Remove console** - Altera PE header (subsystem CONSOLE → WINDOWS)
6. **Aplica ícone** - Usa rcedit para embutir icon.ico no exe
7. **Adiciona metadados** - ProductName, Version, Company, etc.

### Estrutura do Build

```
dist/
├── ClawdNode.exe        # Executável principal (com ícone)
├── ClawdNode-debug.bat  # Launcher com console (para debug)
├── ClawdNode.vbs        # Launcher silencioso (alternativo)
├── config.json          # Configuração
├── icon.ico             # Ícone
└── node_modules/        # Módulos nativos necessários
    ├── screenshot-desktop/
    ├── systray2/
    └── node-notifier/
```

### Detalhes Técnicos do Build

#### Paths no pkg
O pkg usa `__dirname` virtual (`C:\snapshot\...`). O código detecta `process.pkg` e usa `path.dirname(process.execPath)` para paths reais:
```javascript
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
```

#### Patch do spawn para systray2
O systray2 precisa do binário `tray_windows_release.exe`. O código intercepta `child_process.spawn` para redirecionar paths do snapshot:
```javascript
if (process.pkg) {
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = function(cmd, args, opts) {
        if (cmd && cmd.includes('\\snapshot\\')) {
            cmd = cmd.replace(/C:\\snapshot\\clawdbot-tray\\node_modules/g,
                path.join(path.dirname(process.execPath), 'node_modules'));
        }
        return originalSpawn.call(this, cmd, args, opts);
    };
}
```

#### Remoção do Console
O build modifica o PE header do exe para mudar o subsystem de CONSOLE (3) para WINDOWS (2):
```javascript
const exe = fs.readFileSync(exePath);
const peOffset = exe.readUInt32LE(0x3C);
const subsystemOffset = peOffset + 0x5C;
exe.writeUInt16LE(2, subsystemOffset);  // 2 = WINDOWS/GUI
fs.writeFileSync(exePath, exe);
```

#### Aplicar Ícone
O rcedit é usado para embutir o ícone e metadados:
```javascript
await rcedit(exePath, {
    icon: 'dist/icon.ico',
    'version-string': {
        ProductName: 'Clawd Node',
        FileDescription: 'Clawd Node Agent for Windows',
        CompanyName: 'Clawdbot',
        OriginalFilename: 'ClawdNode.exe'
    },
    'file-version': '1.0.0',
    'product-version': '1.0.0'
});
```

### Distribuição

Para distribuir:
1. Compactar pasta `dist/` inteira em ZIP
2. Usuário extrai e executa `ClawdNode.exe`
3. O config.json deve estar na mesma pasta do exe

### Atualização do Executável

Ao fazer alterações no código:
```powershell
# 1. Editar index.js com as mudanças
# 2. Testar com node
node index.js

# 3. Se OK, gerar novo exe
npm run build

# 4. Testar o exe
dist\ClawdNode.exe
```

---

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
