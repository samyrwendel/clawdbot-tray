const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const SysTray = require('systray2').default;
const sharp = require('sharp');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(__dirname, 'log.txt');
const SVG_PATH = path.join(__dirname, 'favicon.svg');

let logs = [];
let isConnected = false;

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        log(`Erro ao ler config: ${e.message}`);
        return null;
    }
}

function pngToIco(pngBuffer) {
    // ICO header: 6 bytes
    // ICO entry: 16 bytes per image
    // PNG data follows
    const iconDir = Buffer.alloc(6);
    iconDir.writeUInt16LE(0, 0);      // Reserved
    iconDir.writeUInt16LE(1, 2);      // Type: 1 = ICO
    iconDir.writeUInt16LE(1, 4);      // Number of images

    const iconEntry = Buffer.alloc(16);
    iconEntry.writeUInt8(0, 0);       // Width (0 = 256)
    iconEntry.writeUInt8(0, 1);       // Height (0 = 256)
    iconEntry.writeUInt8(0, 2);       // Color palette
    iconEntry.writeUInt8(0, 3);       // Reserved
    iconEntry.writeUInt16LE(1, 4);    // Color planes
    iconEntry.writeUInt16LE(32, 6);   // Bits per pixel
    iconEntry.writeUInt32LE(pngBuffer.length, 8);  // Size of image data
    iconEntry.writeUInt32LE(22, 12);  // Offset to image data (6 + 16 = 22)

    return Buffer.concat([iconDir, iconEntry, pngBuffer]);
}

async function getIcon() {
    try {
        if (fs.existsSync(SVG_PATH)) {
            const pngBuffer = await sharp(SVG_PATH)
                .resize(64, 64)
                .png()
                .toBuffer();
            const icoBuffer = pngToIco(pngBuffer);
            return icoBuffer.toString('base64');
        }
    } catch (e) {
        console.error('Erro ao converter ícone:', e.message);
    }
    // fallback icon
    return 'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAgIAAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAgIAA//8AAP//AACAgIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAgIAA//8AAP//AAD//wAAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgIAA//8AAP//AAD//wAA//8AAICAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgIAA//8AAP//AAD//wAA//8AAP//AACAgIAAAAAAAAAAAAAAAAAAAAAAAAAAAICAAP//AAD//wAA//8AAP//AAD//wAA//8AAICAAAAAAAAAAAAAAAAAAAAAAAAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AACAgAAAAAAAAAAAAAAAgIAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAAgIAAAAAAAACAgAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAAgIAAAAAAAICA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AACAAAAAAIAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAICAAAAAAAAAgP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AACAgAAAAAAAAACAgP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAICAgAAAAAAAAAAAAICAgP//AAD//wAA//8AAP//AAD//wAA//8AAP//AACAgIAAgIAAAAAAAAAAAAAAAACAgICAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAP//AADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAAD//wAA//8AAA=='
}

function log(msg) {
    const ts = new Date().toLocaleTimeString();
    logs.push(`[${ts}] ${msg}`);
    if (logs.length > 500) logs = logs.slice(-500);
    console.log(`[${ts}] ${msg}`);
}

function execSSH(command, callback) {
    const config = loadConfig();
    if (!config) {
        callback && callback(new Error('Config inválida'));
        return;
    }

    const conn = new Client();
    let output = '';

    conn.on('ready', () => {
        isConnected = true;
        log(`SSH conectado a ${config.host}`);
        conn.exec(command, (err, stream) => {
            if (err) {
                log(`Erro exec: ${err.message}`);
                conn.end();
                callback && callback(err);
                return;
            }
            stream.on('close', (code) => {
                log(`Comando finalizado (code: ${code})`);
                conn.end();
                callback && callback(null, output, code);
            }).on('data', (data) => {
                output += data.toString();
                data.toString().split('\n').filter(l => l.trim()).forEach(l => log(l));
            }).stderr.on('data', (data) => {
                data.toString().split('\n').filter(l => l.trim()).forEach(l => log(`[ERR] ${l}`));
            });
        });
    });

    conn.on('error', (err) => {
        isConnected = false;
        log(`SSH erro: ${err.message}`);
        callback && callback(err);
    });

    conn.on('close', () => {
        isConnected = false;
    });

    const connConfig = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
    };

    if (config.privateKeyPath && fs.existsSync(config.privateKeyPath)) {
        connConfig.privateKey = fs.readFileSync(config.privateKeyPath);
    } else if (config.password) {
        connConfig.password = config.password;
    }

    log(`Conectando a ${config.host}...`);
    conn.connect(connConfig);
}

function start() {
    const config = loadConfig();
    if (!config) return;
    log('Iniciando Clawd...');
    execSSH(config.clawdStartCmd);
}

function stop() {
    const config = loadConfig();
    if (!config) return;
    log('Parando Clawd...');
    execSSH(config.clawdStopCmd);
}

function restart() {
    const config = loadConfig();
    if (!config) return;
    log('Reiniciando Clawd...');
    execSSH(config.clawdCommand);
}

function status() {
    const config = loadConfig();
    if (!config) return;
    log('Verificando status...');
    execSSH(config.clawdStatusCmd);
}

function openConfig() {
    spawn('notepad', [CONFIG_PATH], { detached: true });
}

function openLogs() {
    fs.writeFileSync(LOG_PATH, logs.join('\n'));
    spawn('notepad', [LOG_PATH], { detached: true });
}

async function main() {
    const icon = await getIcon();

    const systray = new SysTray({
        menu: {
            icon, title: '', tooltip: 'Clawdbot',
            items: [
                { title: '🦀 Clawdbot', enabled: false },
                { title: '▶️ Iniciar', enabled: true },
                { title: '⏹️ Parar', enabled: true },
                { title: '🔄 Reiniciar', enabled: true },
                { title: '📊 Status', enabled: true },
                { title: '⚙️ Configurações', enabled: true },
                { title: '📋 Logs', enabled: true },
                { title: '❌ Sair', enabled: true }
            ]
        }
    });

    systray.onClick(a => {
        switch(a.seq_id) {
            case 1: start(); break;
            case 2: stop(); break;
            case 3: restart(); break;
            case 4: status(); break;
            case 5: openConfig(); break;
            case 6: openLogs(); break;
            case 7: systray.kill(); process.exit(0);
        }
    });

    log('Tray pronto');
    status(); // check status on start
}

main().catch(e => console.error(e));
