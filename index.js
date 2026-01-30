const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');
const SysTray = require('systray2').default;
const sharp = require('sharp');
const notifier = require('node-notifier');
// Screenshot via PowerShell (more reliable on Windows than screenshot-desktop)
const captureScreen = () => new Promise((resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `screenshot_${Date.now()}.png`);
    const ps = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height);
$graphics = [System.Drawing.Graphics]::FromImage($bitmap);
$graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bitmap.Size);
$bitmap.Save('${tempFile.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png);
$graphics.Dispose();
$bitmap.Dispose()
`;
    exec(`powershell -Command "${ps.replace(/\n/g, ' ')}"`, { windowsHide: true }, (err) => {
        if (err) {
            reject(err);
            return;
        }
        fs.readFile(tempFile, (readErr, data) => {
            fs.unlink(tempFile, () => {}); // cleanup
            if (readErr) reject(readErr);
            else resolve(data);
        });
    });
});

// Clipboard via PowerShell (works on Windows without ESM issues)
const clipboardRead = () => new Promise((resolve, reject) => {
    exec('powershell -Command "Get-Clipboard"', { encoding: 'utf8' }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
    });
});
const clipboardWrite = (text) => new Promise((resolve, reject) => {
    const safeText = String(text || ' ');  // PowerShell doesn't accept empty string
    const escaped = safeText.replace(/'/g, "''").replace(/`/g, '``').replace(/\$/g, '`$');
    exec(`powershell -Command "Set-Clipboard -Value '${escaped}'"`, (err) => {
        if (err) reject(err);
        else resolve();
    });
});

// Camera via ffmpeg (Windows DirectShow)
const FFMPEG_PATH = 'C:\\Users\\samyr\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe';

const listCameras = () => new Promise((resolve, reject) => {
    exec(`"${FFMPEG_PATH}" -list_devices true -f dshow -i dummy 2>&1`, { encoding: 'utf8' }, (err, stdout, stderr) => {
        const output = stdout || stderr || '';
        const cameras = [];
        const lines = output.split('\n');
        for (const line of lines) {
            // Match lines like: [dshow @ ...] "Camera Name" (video)
            const match = line.match(/\[dshow @.*?\]\s*"([^"]+)"\s*\(video\)/);
            if (match) {
                cameras.push({ name: match[1], index: cameras.length });
            }
        }
        resolve({ cameras });
    });
});

const captureCamera = (params = {}) => new Promise((resolve, reject) => {
    const cameraName = params.camera || 'Integrated Camera';
    const tempFile = path.join(os.tmpdir(), `camera_${Date.now()}.jpg`);
    const cmd = `"${FFMPEG_PATH}" -f dshow -i video="${cameraName}" -frames:v 1 -y "${tempFile}" 2>&1`;
    exec(cmd, { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => {
        if (err && !fs.existsSync(tempFile)) {
            reject(new Error(`Camera capture failed: ${err.message}`));
            return;
        }
        fs.readFile(tempFile, (readErr, data) => {
            fs.unlink(tempFile, () => {});
            if (readErr) {
                reject(readErr);
            } else {
                resolve({
                    base64: data.toString('base64'),
                    format: 'jpg',
                    size: data.length,
                });
            }
        });
    });
});

const recordClip = (params = {}) => new Promise((resolve, reject) => {
    const cameraName = params.camera || 'Integrated Camera';
    const duration = Math.min(params.duration || 5, 30); // max 30s
    const tempFile = path.join(os.tmpdir(), `clip_${Date.now()}.mp4`);
    const cmd = `"${FFMPEG_PATH}" -f dshow -i video="${cameraName}" -t ${duration} -c:v libx264 -preset ultrafast -y "${tempFile}" 2>&1`;
    exec(cmd, { timeout: (duration + 10) * 1000, windowsHide: true }, (err) => {
        if (err && !fs.existsSync(tempFile)) {
            reject(new Error(`Clip recording failed: ${err.message}`));
            return;
        }
        fs.readFile(tempFile, (readErr, data) => {
            fs.unlink(tempFile, () => {});
            if (readErr) {
                reject(readErr);
            } else {
                resolve({
                    base64: data.toString('base64'),
                    format: 'mp4',
                    size: data.length,
                    duration,
                });
            }
        });
    });
});

// Paths
const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(__dirname, 'log.txt');
const SVG_PATH = path.join(__dirname, 'favicon.svg');
const CONFIG_GUI_PATH = path.join(__dirname, 'config-gui.ps1');
const LOCK_PATH = path.join(__dirname, '.lock');
const STATUS_PATH = path.join(__dirname, 'status.txt');
const IDENTITY_PATH = path.join(os.homedir(), '.clawdbot', 'identity', 'device.json');
const PROFILES_DIR = path.join(os.homedir(), '.clawdbot', 'browser');

// Device identity (loaded from clawdbot's store)
let deviceIdentity = null;

// State
let config = null;
let ws = null;
let browser = null;
let browserContext = null;
let currentProfile = null;
let logs = [];
let connected = false;
let authPending = false;
let lastStatus = 'Desconectado';
let reconnectTimer = null;
let configFormOpen = false;
let systrayReady = false;
let systray = null;
let messageId = 0;
let pendingRequests = new Map();
let connectNonce = null;
let connectSent = false;

// ============== CONFIG ==============
function loadConfig() {
    try {
        let content = fs.readFileSync(CONFIG_PATH, 'utf8');
        // Remove BOM if present (PowerShell adds it)
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }
        config = JSON.parse(content);
        return config;
    } catch (e) {
        log(`Erro ao ler config: ${e.message}`);
        return null;
    }
}

// ============== DEVICE IDENTITY (Ed25519) ==============
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64UrlEncode(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem) {
    const key = crypto.createPublicKey(publicKeyPem);
    const spki = key.export({ type: 'spki', format: 'der' });
    if (spki.length === ED25519_SPKI_PREFIX.length + 32 &&
        spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
        return spki.subarray(ED25519_SPKI_PREFIX.length);
    }
    return spki;
}

function publicKeyRawBase64UrlFromPem(publicKeyPem) {
    return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function signDevicePayload(privateKeyPem, payload) {
    const key = crypto.createPrivateKey(privateKeyPem);
    const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key);
    return base64UrlEncode(sig);
}

function buildDeviceAuthPayload(params) {
    const version = params.nonce ? 'v2' : 'v1';
    const scopes = params.scopes.join(',');
    const token = params.token || '';
    const base = [
        version,
        params.deviceId,
        params.clientId,
        params.clientMode,
        params.role,
        scopes,
        String(params.signedAtMs),
        token,
    ];
    if (version === 'v2') {
        base.push(params.nonce || '');
    }
    return base.join('|');
}

function loadDeviceIdentity() {
    try {
        if (fs.existsSync(IDENTITY_PATH)) {
            const raw = fs.readFileSync(IDENTITY_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
                deviceIdentity = {
                    deviceId: parsed.deviceId,
                    publicKeyPem: parsed.publicKeyPem,
                    privateKeyPem: parsed.privateKeyPem,
                };
                log(`Identidade carregada: ${deviceIdentity.deviceId.substring(0, 16)}...`);
                return deviceIdentity;
            }
        }
    } catch (e) {
        log(`Erro ao carregar identidade: ${e.message}`);
    }
    log('Identidade nao encontrada - execute "clawdbot node run" primeiro');
    return null;
}

// ============== LOGGING ==============
function log(msg) {
    const ts = new Date().toLocaleTimeString();
    const line = `[${ts}] ${msg}`;
    logs.push(line);
    if (logs.length > 500) logs = logs.slice(-500);
    console.log(line);
}

// ============== STATUS FILE ==============
function writeStatus(status, details = '') {
    try {
        const ts = new Date().toISOString();
        const content = JSON.stringify({ status, details, timestamp: ts, connected });
        fs.writeFileSync(STATUS_PATH, content);
    } catch (e) {
        // Ignore errors writing status
    }
}

// ============== ICON ==============
function pngToIco(pngBuffer) {
    const iconDir = Buffer.alloc(6);
    iconDir.writeUInt16LE(0, 0);
    iconDir.writeUInt16LE(1, 2);
    iconDir.writeUInt16LE(1, 4);

    const iconEntry = Buffer.alloc(16);
    iconEntry.writeUInt8(0, 0);
    iconEntry.writeUInt8(0, 1);
    iconEntry.writeUInt8(0, 2);
    iconEntry.writeUInt8(0, 3);
    iconEntry.writeUInt16LE(1, 4);
    iconEntry.writeUInt16LE(32, 6);
    iconEntry.writeUInt32LE(pngBuffer.length, 8);
    iconEntry.writeUInt32LE(22, 12);

    return Buffer.concat([iconDir, iconEntry, pngBuffer]);
}

async function getIcon() {
    try {
        if (fs.existsSync(SVG_PATH)) {
            const pngBuffer = await sharp(SVG_PATH)
                .resize(64, 64)
                .png()
                .toBuffer();
            return pngToIco(pngBuffer).toString('base64');
        }
    } catch (e) {
        console.error('Erro ao converter ícone:', e.message);
    }
    return 'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAgIAAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAgIAA//8AAP//AACAgIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAgIAA//8AAP//AAD//wAAgICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgIAA//8AAP//AAD//wAA//8AAICAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgIAA//8AAP//AAD//wAA//8AAP//AACAgIAAAAAAAAAAAAAAAAAAAAAAAAAAAICAAP//AAD//wAA//8AAP//AAD//wAA//8AAICAAAAAAAAAAAAAAAAAAAAAAAAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AACAgAAAAAAAAAAAAAAAgIAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAAgIAAAAAAAACAgAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAAgIAAAAAAAICA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AACAAAAAAIAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAICAAAAAAAAAgP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AACAgAAAAAAAAACAgP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAICAgAAAAAAAAAAAAICAgP//AAD//wAA//8AAP//AAD//wAA//8AAP//AACAgIAAgIAAAAAAAAAAAAAAAACAgICAgIAAgICAAICAgACAgIAAgICAAICAgACAgIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAP//AADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAAD//wAA//8AAA==';
}

// ============== WINDOWS NOTIFICATION ==============
function notify(title, message) {
    const ps = `
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        $template = @"
        <toast>
            <visual>
                <binding template="ToastText02">
                    <text id="1">${title.replace(/"/g, '`"')}</text>
                    <text id="2">${message.replace(/"/g, '`"')}</text>
                </binding>
            </visual>
        </toast>
"@
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($template)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Clawd").Show($toast)
    `;
    exec(`powershell -Command "${ps.replace(/\n/g, ' ')}"`, { windowsHide: true });
}

// ============== SHELL EXECUTION ==============
function runCommand(command, timeout = 60000) {
    return new Promise((resolve) => {
        log(`Executando: ${command}`);
        const proc = exec(command, {
            timeout,
            windowsHide: true,
            shell: true
        }, (error, stdout, stderr) => {
            resolve({
                success: !error,
                stdout: stdout || '',
                stderr: stderr || '',
                code: error?.code || 0
            });
        });
    });
}

// ============== BROWSER (PLAYWRIGHT) ==============
async function getBrowser(options = {}) {
    const profile = options.profile || 'clawd';
    const headless = options.headless !== undefined
        ? options.headless
        : (config?.browser?.headless !== false);

    // Se já existe um contexto com o mesmo profile, retorna
    if (browserContext && currentProfile === profile) {
        return browserContext;
    }

    // Fecha contexto anterior se existir
    if (browserContext) {
        await browserContext.close().catch(() => {});
        browserContext = null;
        browser = null;
        currentProfile = null;
    }

    try {
        const { chromium } = require('playwright-core');

        // Cria diretório do profile se não existir
        const userDataDir = path.join(PROFILES_DIR, profile, 'user-data');
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
            log(`Profile directory created: ${userDataDir}`);
        }

        const launchOptions = {
            headless,
            channel: 'chrome',
            args: [
                '--enable-extensions',
                '--disable-component-extensions-with-background-pages=false'
            ],
            ignoreDefaultArgs: ['--disable-extensions'],
        };

        log(`Launching persistent browser: profile=${profile}, headless=${headless}, userDataDir=${userDataDir}`);

        // launchPersistentContext retorna um BrowserContext (não Browser)
        browserContext = await chromium.launchPersistentContext(userDataDir, launchOptions);
        currentProfile = profile;

        log(`Browser iniciado com profile: ${profile}`);
        return browserContext;
    } catch (e) {
        log(`Erro ao iniciar browser: ${e.message}`);
        throw e;
    }
}

async function closeBrowser() {
    if (browserContext) {
        await browserContext.close().catch(() => {});
        browserContext = null;
        browser = null;
        currentProfile = null;
        log('Browser fechado');
    }
}

// Active browser session for proxy
let browserSession = null;
let browserPage = null;

// Convert accessibility tree to readable text format for AI
function formatAccessibilityTree(node, depth = 0) {
    if (!node) return '';
    const indent = '  '.repeat(depth);
    let result = '';

    if (node.role && node.role !== 'none' && node.role !== 'generic') {
        const name = node.name ? ` "${node.name}"` : '';
        const value = node.value ? ` value="${node.value}"` : '';
        const checked = node.checked !== undefined ? ` [${node.checked ? 'checked' : 'unchecked'}]` : '';
        const focused = node.focused ? ' [focused]' : '';
        result += `${indent}- ${node.role}${name}${value}${checked}${focused}\n`;
    }

    if (node.children) {
        for (const child of node.children) {
            result += formatAccessibilityTree(child, node.role && node.role !== 'none' && node.role !== 'generic' ? depth + 1 : depth);
        }
    }
    return result;
}

// Convert DOM tree to readable text format (fallback)
function formatDomTree(node, depth = 0) {
    if (!node) return '';
    const indent = '  '.repeat(depth);
    let result = '';

    const tag = node.tag;
    if (tag) {
        let line = `${indent}- ${tag}`;
        if (node.id) line += ` #${node.id}`;
        if (node.text) line += ` "${node.text.substring(0, 50)}"`;
        if (node.href) line += ` [${node.href}]`;
        if (node.value) line += ` value="${node.value}"`;
        if (node.type) line += ` type=${node.type}`;
        result += line + '\n';
    }

    if (node.children) {
        for (const child of node.children) {
            result += formatDomTree(child, depth + 1);
        }
    }
    return result;
}

async function browserAction(action, params) {
    log(`Browser action: ${action}`);

    try {
        switch (action) {
            // ========== Gateway proxy actions ==========
            case 'start': {
                // Start browser session with persistent profile
                const profile = params?.profile || 'clawd';
                const headless = params?.headless !== false;

                await getBrowser({ profile, headless });

                // Usa página existente ou cria nova
                const pages = browserContext.pages();
                browserPage = pages[0] || await browserContext.newPage();

                const userDataDir = path.join(PROFILES_DIR, profile, 'user-data');
                browserSession = {
                    id: `session_${Date.now()}`,
                    startedAt: Date.now(),
                    profile,
                };
                log(`Browser session started: ${browserSession.id}, profile: ${profile}`);
                return {
                    running: true,
                    profile,
                    userDataDir,
                    sessionId: browserSession.id,
                };
            }

            case 'status': {
                // Return browser status
                const running = browserContext !== null && browserPage !== null;
                return {
                    running,
                    profile: currentProfile,
                    sessionId: browserSession?.id || null,
                    url: running ? browserPage.url() : null,
                    title: running ? await browserPage.title().catch(() => null) : null,
                };
            }

            case 'snapshot': {
                // Accessibility snapshot or DOM - converted to readable text
                if (!browserPage) {
                    throw new Error('No active browser session');
                }
                let snapshotText;
                try {
                    // Try accessibility tree first (best for AI)
                    const tree = await browserPage.accessibility.snapshot();
                    snapshotText = formatAccessibilityTree(tree);
                } catch {
                    // Fallback: get simplified DOM and format as text
                    const domTree = await browserPage.evaluate(() => {
                        function getNode(el) {
                            if (!el || el.nodeType !== 1) return null;
                            const tag = el.tagName.toLowerCase();
                            const obj = { tag };
                            if (el.id) obj.id = el.id;
                            if (['a', 'button', 'input', 'textarea', 'select', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'label'].includes(tag)) {
                                obj.text = el.textContent?.slice(0, 100)?.trim();
                                if (el.href) obj.href = el.href;
                                if (el.value !== undefined) obj.value = el.value;
                                if (el.type) obj.type = el.type;
                            }
                            const children = Array.from(el.children).map(getNode).filter(Boolean);
                            if (children.length) obj.children = children;
                            return obj;
                        }
                        return getNode(document.body);
                    });
                    snapshotText = formatDomTree(domTree);
                }
                // Return in gateway expected format (readable text)
                return {
                    ok: true,
                    format: 'aria',
                    snapshot: snapshotText || '(empty page)',
                    targetId: browserSession?.id || 'default',
                    url: browserPage.url(),
                };
            }

            case 'screenshot': {
                // Save screenshot to file and return path
                if (!browserPage) {
                    throw new Error('No active browser session');
                }
                // Create screenshots directory
                const screenshotsDir = path.join(os.tmpdir(), 'clawdbot-screenshots');
                if (!fs.existsSync(screenshotsDir)) {
                    fs.mkdirSync(screenshotsDir, { recursive: true });
                }
                const filename = `screenshot_${Date.now()}.png`;
                const filepath = path.join(screenshotsDir, filename);

                await browserPage.screenshot({ path: filepath, type: 'png', fullPage: params?.fullPage });

                return {
                    ok: true,
                    path: filepath,
                    targetId: browserSession?.id || 'default',
                    url: browserPage.url(),
                };
            }

            case 'open':
            case 'navigate':
            case 'goto': {
                // Navigate to URL
                if (!browserPage && browser) {
                    browserPage = await browserContext.newPage();
                }
                if (!browserPage) {
                    await getBrowser();
                    browserPage = await browserContext.newPage();
                }
                const url = params?.url;
                if (!url) throw new Error('URL required');
                await browserPage.goto(url, { waitUntil: params?.waitUntil || 'domcontentloaded' });
                return {
                    success: true,
                    url: await browserPage.url(),
                    title: await browserPage.title().catch(() => null),
                };
            }

            case 'act': {
                // Generic action handler - clicks, types, etc.
                if (!browserPage) throw new Error('No active browser session');
                const actType = params?.type || params?.action;
                const selector = params?.selector || params?.target;
                const text = params?.text || params?.value || '';

                switch (actType) {
                    case 'click':
                        if (!selector) throw new Error('Selector required for click');
                        await browserPage.click(selector);
                        break;
                    case 'type':
                    case 'fill':
                        if (!selector) throw new Error('Selector required for type');
                        await browserPage.fill(selector, text);
                        break;
                    case 'press':
                        const key = params?.key || text;
                        if (selector) {
                            await browserPage.press(selector, key);
                        } else {
                            await browserPage.keyboard.press(key);
                        }
                        break;
                    case 'scroll':
                        const x = params?.x || 0;
                        const y = params?.y || params?.amount || 500;
                        await browserPage.evaluate(({x, y}) => window.scrollBy(x, y), {x, y});
                        break;
                    case 'hover':
                        if (!selector) throw new Error('Selector required for hover');
                        await browserPage.hover(selector);
                        break;
                    case 'focus':
                        if (!selector) throw new Error('Selector required for focus');
                        await browserPage.focus(selector);
                        break;
                    case 'select':
                        if (!selector) throw new Error('Selector required for select');
                        await browserPage.selectOption(selector, params?.value || params?.option);
                        break;
                    default:
                        throw new Error(`Unknown act type: ${actType}`);
                }
                return { success: true, action: actType };
            }

            case 'click': {
                if (!browserPage) throw new Error('No active browser session');
                const selector = params?.selector;
                if (!selector) throw new Error('Selector required');
                await browserPage.click(selector);
                return { success: true };
            }

            case 'type':
            case 'fill': {
                if (!browserPage) throw new Error('No active browser session');
                const selector = params?.selector;
                const text = params?.text || params?.value || '';
                if (!selector) throw new Error('Selector required');
                await browserPage.fill(selector, text);
                return { success: true };
            }

            case 'evaluate':
            case 'exec': {
                if (!browserPage) throw new Error('No active browser session');
                const script = params?.script || params?.code || params?.expression;
                if (!script) throw new Error('Script required');
                const result = await browserPage.evaluate(script);
                return { result };
            }

            case 'content':
            case 'html': {
                if (!browserPage) throw new Error('No active browser session');
                const content = await browserPage.content();
                return { content };
            }

            case 'stop':
            case 'close': {
                // Stop browser session
                if (browserPage) {
                    await browserPage.close().catch(() => {});
                    browserPage = null;
                }
                await closeBrowser();
                browserSession = null;
                return { success: true };
            }

            // ========== Tabs management ==========
            case 'tabs': {
                // List all tabs/pages
                if (!browserContext) {
                    return { tabs: [] };
                }
                const pages = browserContext.pages();
                const tabs = await Promise.all(pages.map(async (page, idx) => ({
                    id: `tab_${idx}`,
                    url: page.url(),
                    title: await page.title().catch(() => ''),
                    active: page === browserPage,
                })));
                return { tabs };
            }

            case 'tabFocus': {
                // Focus a specific tab
                if (!browserContext) throw new Error('No browser session');
                const pages = browserContext.pages();
                const targetIdx = parseInt(params?.targetId?.replace('tab_', '') || '0');
                if (targetIdx >= 0 && targetIdx < pages.length) {
                    browserPage = pages[targetIdx];
                    await browserPage.bringToFront();
                    return { success: true, focused: `tab_${targetIdx}` };
                }
                throw new Error('Tab not found');
            }

            case 'tabClose': {
                // Close a specific tab
                if (!browserContext) throw new Error('No browser session');
                const pages = browserContext.pages();
                const closeIdx = parseInt(params?.targetId?.replace('tab_', '') || '-1');
                if (closeIdx >= 0 && closeIdx < pages.length) {
                    const pageToClose = pages[closeIdx];
                    await pageToClose.close();
                    // If closed current page, switch to another
                    if (pageToClose === browserPage) {
                        const remaining = browserContext.pages();
                        browserPage = remaining.length > 0 ? remaining[0] : null;
                    }
                    return { success: true, closed: `tab_${closeIdx}` };
                }
                throw new Error('Tab not found');
            }

            // ========== Console & Cookies ==========
            case 'console': {
                // Return console logs (would need to be captured)
                return { logs: [] }; // TODO: implement console capture
            }

            case 'cookies': {
                if (!browserContext) return { cookies: [] };
                const cookies = await browserContext.cookies();
                return { cookies };
            }

            case 'cookieSet': {
                if (!browserContext) throw new Error('No browser session');
                const cookie = {
                    name: params?.name,
                    value: params?.value,
                    url: params?.url || browserPage?.url(),
                    domain: params?.domain,
                    path: params?.path || '/',
                };
                await browserContext.addCookies([cookie]);
                return { success: true };
            }

            case 'cookieClear': {
                if (!browserContext) throw new Error('No browser session');
                await browserContext.clearCookies();
                return { success: true };
            }

            // ========== Legacy page-based actions ==========
            case 'newPage': {
                await getBrowser();
                const page = await browserContext.newPage();
                const pageId = `page_${Date.now()}`;
                browserContext._pages = browserContext._pages || {};
                browserContext._pages[pageId] = page;
                return { pageId };
            }

            case 'closePage': {
                const page = browserContext._pages?.[params.pageId];
                if (page) {
                    await page.close();
                    delete browserContext._pages[params.pageId];
                }
                return { success: true };
            }

            default:
                throw new Error(`Unknown browser action: ${action}`);
        }
    } catch (e) {
        log(`Browser error: ${e.message}`);
        throw e;
    }
}

// ============== BROWSER CONTROL HTTP SERVER ==============
const BROWSER_CONTROL_PORT = 18790;
let browserControlServer = null;

function startBrowserControlServer() {
    if (browserControlServer) return;

    browserControlServer = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${BROWSER_CONTROL_PORT}`);
        const pathname = url.pathname;

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Parse body for POST requests
        let body = {};
        if (req.method === 'POST') {
            try {
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                const raw = Buffer.concat(chunks).toString().trim();
                log(`HTTP body raw: "${raw}"`);
                if (raw) {
                    try {
                        body = JSON.parse(raw);
                    } catch {
                        // Try to fix unquoted JSON keys (from shell escaping issues)
                        // {text:value} -> {"text":"value"}
                        const fixed = raw.replace(/\{(\w+):/g, '{"$1":').replace(/:([^"}\]]+)([}\]])/g, ':"$1"$2');
                        log(`HTTP body fixed: "${fixed}"`);
                        body = JSON.parse(fixed);
                    }
                }
                log(`HTTP body parsed: ${JSON.stringify(body)}`);
            } catch (e) {
                log(`Browser control parse error: ${e.message}`);
            }
        }

        log(`Browser control: ${req.method} ${pathname}`);

        try {
            let result;

            switch (pathname) {
                case '/status':
                    result = await browserAction('status', {});
                    break;

                case '/start':
                    result = await browserAction('start', body);
                    break;

                case '/stop':
                    result = await browserAction('stop', {});
                    break;

                case '/open':
                    result = await browserAction('open', body);
                    break;

                case '/navigate':
                    result = await browserAction('navigate', body);
                    break;

                case '/snapshot':
                    result = await browserAction('snapshot', body);
                    break;

                case '/screenshot':
                    result = await browserAction('screenshot', body);
                    break;

                case '/act':
                    // Map Clawdbot act format to our format
                    const actParams = {
                        type: body.kind || body.type || body.action,
                        selector: body.ref || body.selector || body.target,
                        text: body.text || body.value,
                        key: body.key,
                        x: body.x,
                        y: body.y,
                    };
                    result = await browserAction('act', actParams);
                    break;

                case '/content':
                case '/html':
                    result = await browserAction('content', {});
                    break;

                case '/evaluate':
                    result = await browserAction('evaluate', body);
                    break;

                // ========== System capabilities ==========
                case '/notify':
                    notifier.notify({
                        title: body.title || 'Clawdbot',
                        message: body.message || body.text || '',
                        icon: path.join(__dirname, 'icon.ico'),
                        sound: body.sound !== false,
                    });
                    result = { success: true };
                    break;

                case '/clipboard':
                    if (req.method === 'GET') {
                        const text = await clipboardRead();
                        result = { text };
                    } else {
                        log(`Clipboard write: body.text="${body.text}", body=${JSON.stringify(body)}`);
                        await clipboardWrite(body.text || '');
                        result = { success: true };
                    }
                    break;

                case '/screen':
                    try {
                        const imgBuffer = await captureScreen();
                        result = {
                            base64: imgBuffer.toString('base64'),
                            format: 'png',
                            size: imgBuffer.length,
                        };
                    } catch (screenErr) {
                        log(`Screenshot error: ${screenErr.message}`);
                        result = { error: screenErr.message };
                    }
                    break;

                case '/camera/list':
                    try {
                        result = await listCameras();
                    } catch (camErr) {
                        log(`Camera list error: ${camErr.message}`);
                        result = { error: camErr.message };
                    }
                    break;

                case '/camera/snap':
                    try {
                        result = await captureCamera(body);
                    } catch (snapErr) {
                        log(`Camera snap error: ${snapErr.message}`);
                        result = { error: snapErr.message };
                    }
                    break;

                case '/camera/clip':
                    try {
                        result = await recordClip(body);
                    } catch (clipErr) {
                        log(`Camera clip error: ${clipErr.message}`);
                        result = { error: clipErr.message };
                    }
                    break;

                default:
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `Unknown route: ${pathname}` }));
                    return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));

        } catch (e) {
            log(`Browser control error: ${e.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
    });

    browserControlServer.listen(BROWSER_CONTROL_PORT, '0.0.0.0', () => {
        log(`Browser control server listening on http://0.0.0.0:${BROWSER_CONTROL_PORT} (network accessible)`);
    });

    browserControlServer.on('error', (e) => {
        log(`Browser control server error: ${e.message}`);
    });
}

function stopBrowserControlServer() {
    if (browserControlServer) {
        browserControlServer.close();
        browserControlServer = null;
        log('Browser control server stopped');
    }
}

// ============== WEBSOCKET ==============
function connect() {
    if (!config) {
        loadConfig();
        if (!config) {
            notify('Clawd Node', 'Erro: config.json nao encontrado');
            return;
        }
    }

    if (ws) {
        ws.terminate();
        ws = null;
    }

    log(`Conectando a ${config.gatewayUrl}...`);
    lastStatus = 'Conectando...';
    authPending = false;
    updateTrayStatus();
    writeStatus('connecting', `Conectando a ${config.gatewayUrl}`);

    try {
        ws = new WebSocket(config.gatewayUrl);

        ws.on('open', () => {
            log('WebSocket conectado, aguardando challenge...');
            lastStatus = 'Aguardando challenge...';
            authPending = true;
            connectNonce = null;
            connectSent = false;
            updateTrayStatus();
            writeStatus('connecting', 'Aguardando challenge do servidor');
        });

        ws.on('message', async (data) => {
            try {
                const msg = JSON.parse(data.toString());
                await handleMessage(msg);
            } catch (e) {
                log(`Erro ao processar mensagem: ${e.message}`);
            }
        });

        ws.on('close', (code, reason) => {
            const reasonStr = reason ? reason.toString() : '';
            if (connected) {
                lastStatus = 'Desconectado';
                log(`Desconectado do Gateway (${code})`);
                notify('Clawd Node', 'Desconectado do Gateway');
                writeStatus('disconnected', `Desconectado: ${reasonStr || code}`);
            } else if (authPending) {
                lastStatus = 'Auth falhou';
                log(`Autenticacao falhou: ${code} ${reasonStr}`);
                notify('Clawd Node', 'Autenticacao rejeitada');
                writeStatus('auth_failed', reasonStr || 'Autenticacao rejeitada');
            } else {
                log(`WebSocket fechado: ${code}`);
            }
            connected = false;
            authPending = false;
            updateTrayStatus();
            scheduleReconnect();
        });

        ws.on('error', (err) => {
            log(`WebSocket erro: ${err.message}`);
            lastStatus = `Erro: ${err.message.substring(0, 20)}`;
            notify('Clawd Node', `Erro: ${err.message}`);
            connected = false;
            authPending = false;
            updateTrayStatus();
            writeStatus('error', err.message);
        });

    } catch (e) {
        log(`Erro ao conectar: ${e.message}`);
        lastStatus = 'Erro ao conectar';
        notify('Clawd Node', `Erro ao conectar: ${e.message}`);
        writeStatus('error', e.message);
        scheduleReconnect();
    }
}

function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const json = JSON.stringify(msg);
        log(`WS SEND: ${json.substring(0, 300)}${json.length > 300 ? '...' : ''}`);
        ws.send(json);
    } else {
        log(`WS NOT CONNECTED - cannot send: ${msg.method || msg.type}`);
    }
}

function sendRequest(method, params = {}) {
    const id = String(++messageId);  // Must be string per protocol
    const msg = { type: 'req', id, method, params };
    send(msg);
    return id;
}

function sendConnect() {
    if (connectSent) return;
    if (!deviceIdentity) {
        log('ERRO: Identidade do dispositivo nao carregada');
        writeStatus('error', 'Identidade do dispositivo nao encontrada');
        return;
    }

    connectSent = true;
    const signedAtMs = Date.now();
    const role = 'node';
    const scopes = [];
    const clientId = 'node-host';
    const clientMode = 'node';

    // Build device auth payload (matching clawdbot protocol)
    const payload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId,
        clientId: clientId,
        clientMode: clientMode,
        role: role,
        scopes: scopes,
        signedAtMs: signedAtMs,
        token: config?.token || null,
        nonce: connectNonce,
    });

    // Sign with Ed25519 private key
    const signature = signDevicePayload(deviceIdentity.privateKeyPem, payload);
    log(`Assinatura gerada para connect`);

    // Build connect request
    const connectParams = {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
            id: clientId,
            displayName: config?.nodeName || os.hostname(),
            version: '1.0.0',
            platform: 'win32',
            mode: clientMode,
            instanceId: config?.nodeId || 'windows-pc',
        },
        caps: ['system', 'browser', 'clipboard', 'screen', 'camera'],
        commands: ['system.run', 'system.which', 'browser.proxy', 'notification', 'clipboard.read', 'clipboard.write', 'screen.capture', 'camera.list', 'camera.snap', 'camera.clip'],
        permissions: {
            exec: true,
            camera: false,
            screen: false,
            location: false
        },
        // pathEnv omitted to keep message size small
        auth: {
            token: config?.token || undefined,
            password: config?.password || undefined,
        },
        role: role,
        scopes: scopes,
        device: {
            id: deviceIdentity.deviceId,
            publicKey: publicKeyRawBase64UrlFromPem(deviceIdentity.publicKeyPem),
            signature: signature,
            signedAt: signedAtMs,
            nonce: connectNonce,
        },
    };

    sendRequest('connect', connectParams);
    log('Connect request enviado');
    writeStatus('auth_pending', 'Aguardando resposta do servidor');
}

function getDeviceId() {
    // Returns clawdbot device ID if available, otherwise generates one
    if (deviceIdentity) return deviceIdentity.deviceId;
    const data = `${os.hostname()}-${config?.nodeId || 'default'}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

function handleEvent(event, payload) {
    log(`Evento: ${event}`);

    switch (event) {
        case 'connect.challenge':
            log(`Challenge recebido: ${payload.nonce}`);
            connectNonce = payload.nonce;
            lastStatus = 'Autenticando...';
            updateTrayStatus();
            writeStatus('authenticating', 'Challenge recebido, enviando connect');
            sendConnect();
            break;

        case 'hello-ok':
        case 'auth.success':
            connected = true;
            authPending = false;
            lastStatus = 'Conectado';
            log('Autenticacao bem-sucedida!');
            // Salva token se recebido
            if (payload?.token) {
                config.token = payload.token;
                fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
                log('Token salvo');
            }
            notify('Clawd Node', `Conectado ao Gateway como "${config?.nodeName}"`);
            updateTrayStatus();
            writeStatus('connected', 'Autenticacao bem-sucedida');
            break;

        case 'auth.failed':
        case 'error':
            const reason = payload?.reason || payload?.message || payload?.error || 'Auth falhou';

            // Se nao esta pareado, solicita pareamento
            if (reason.includes('NOT_PAIRED') || reason.includes('UNAUTHORIZED') || reason.includes('device identity')) {
                log('Node nao pareado - solicitando pareamento...');
                lastStatus = 'Solicitando pareamento';
                writeStatus('pairing', 'Solicitando pareamento');
                sendRequest('node.pair.request', {
                    nodeId: config?.nodeId || 'windows-pc',
                    nodeName: config?.nodeName || os.hostname(),
                    platform: 'windows',
                    caps: ['system.run', 'browser.proxy', 'notification', 'clipboard', 'screen', 'camera', 'exec']
                });
                notify('Clawd Node', 'Solicitando pareamento - aprove no Gateway');
            } else {
                authPending = false;
                lastStatus = reason;
                log(`Falha: ${reason}`);
                notify('Clawd Node', `Erro: ${reason}`);
                updateTrayStatus();
                writeStatus('auth_failed', reason);
            }
            break;

        case 'node.pair.requested':
            log('Pareamento solicitado - aguardando aprovacao no Gateway');
            lastStatus = 'Aguardando aprovacao';
            writeStatus('pairing', 'Aguardando aprovacao do operador');
            notify('Clawd Node', 'Solicitacao de pareamento enviada - aprove no Gateway');
            break;

        case 'node.pair.approved':
            log('Pareamento aprovado!');
            if (payload?.token) {
                config.token = payload.token;
                fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
                log('Token de pareamento salvo');
            }
            break;

        case 'ping':
            send({ type: 'event', event: 'pong' });
            break;

        case 'node.invoke.request':
            // Gateway v3 sends commands via this event
            handleNodeInvoke(payload);
            break;

        default:
            log(`Evento nao tratado: ${event} - ${JSON.stringify(payload).substring(0, 100)}`);
    }
}

async function handleMessage(msg) {
    const { id, type, action, command, params, title, message: notifMsg, method, ok, payload, error } = msg;

    log(`Recebido: ${JSON.stringify(msg).substring(0, 300)}`);

    try {
        let result;

        switch (type) {
            // Respostas do servidor (protocolo OpenClaw v3)
            case 'res':
                if (ok && payload?.type === 'hello-ok') {
                    connected = true;
                    authPending = false;
                    lastStatus = 'Conectado';
                    log(`Conectado! Protocolo v${payload.protocol || '?'}, host: ${payload.server?.host || '?'}`);
                    // Save device token if provided and different from current
                    if (payload?.auth?.deviceToken && payload.auth.deviceToken !== config?.token) {
                        config.token = payload.auth.deviceToken;
                        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
                        log('Token do dispositivo salvo');
                    }
                    notify('Clawd Node', `Conectado ao Gateway (${payload.server?.host || 'Gateway'})`);
                    updateTrayStatus();
                    writeStatus('connected', `Conectado ao ${payload.server?.host || 'Gateway'}`);
                } else if (ok && payload?.type === 'pair-ok') {
                    log('Pareamento aprovado!');
                    if (payload?.token) {
                        config.token = payload.token;
                        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
                        log('Token de pareamento salvo');
                    }
                    // Reconecta com o token
                    disconnect();
                    setTimeout(() => connect(), 1000);
                } else if (!ok) {
                    const errMsg = error || 'Erro desconhecido';
                    // Verifica se precisa de pareamento
                    if (errMsg.includes('NOT_PAIRED') || errMsg.includes('UNAUTHORIZED') || errMsg.includes('device identity')) {
                        log('Node nao pareado - solicitando pareamento...');
                        lastStatus = 'Solicitando pareamento';
                        writeStatus('pairing', 'Solicitando pareamento');
                        sendRequest('node.pair.request', {
                            nodeId: config?.nodeId || 'windows-pc',
                            nodeName: config?.nodeName || os.hostname(),
                            platform: 'windows',
                            caps: ['system.run', 'browser.proxy', 'notification', 'clipboard', 'screen', 'camera', 'exec']
                        });
                        notify('Clawd Node', 'Solicitando pareamento - aprove no Gateway');
                    } else {
                        authPending = false;
                        lastStatus = errMsg;
                        log(`Erro na resposta: ${errMsg}`);
                        writeStatus('error', errMsg);
                    }
                }
                break;

            // Eventos do servidor
            case 'event':
                handleEvent(msg.event, msg.payload);
                break;

            // Invocacoes do servidor (comandos para executar)
            case 'invoke':
                await handleInvoke(id, method, params);
                break;

            // Tipos legados
            case 'auth_ok':
                connected = true;
                authPending = false;
                lastStatus = 'Conectado';
                log('Autenticacao bem-sucedida!');
                notify('Clawd Node', `Conectado ao Gateway como "${config?.nodeName}"`);
                updateTrayStatus();
                writeStatus('connected', 'Autenticacao bem-sucedida');
                break;

            case 'auth_error':
                authPending = false;
                lastStatus = 'Auth falhou';
                log(`Autenticacao falhou: ${msg.error}`);
                notify('Clawd', `Erro: ${msg.error}`);
                writeStatus('auth_failed', msg.error || 'Erro de autenticacao');
                break;

            case 'system.run':
                result = await runCommand(command, msg.timeout);
                send({ type: 'res', id, ok: true, payload: result });
                break;

            case 'browser.proxy':
                result = await browserAction(action, params);
                send({ type: 'res', id, ok: true, payload: result });
                break;

            case 'notification':
                notify(title || 'Clawd', notifMsg || '');
                send({ type: 'res', id, ok: true, payload: { success: true } });
                break;

            case 'ping':
                send({ type: 'pong', id });
                break;

            default:
                log(`Tipo desconhecido: ${type}`);
        }
    } catch (e) {
        log(`Erro ao executar ${type}: ${e.message}`);
        send({ type: 'res', id, ok: false, error: e.message });
    }
}

// Handler for Gateway v3 node.invoke.request events
async function handleNodeInvoke(payload) {
    const { id, nodeId, command, paramsJSON, params: rawParams } = payload || {};

    if (!id || !command) {
        log(`Invoke invalido: ${JSON.stringify(payload).substring(0, 100)}`);
        return;
    }

    log(`Node invoke: ${command}`);

    // Parse params
    let params = rawParams;
    if (paramsJSON && !params) {
        try {
            params = JSON.parse(paramsJSON);
        } catch (e) {
            params = {};
        }
    }

    try {
        let result;

        switch (command) {
            case 'system.run':
                const argv = params?.command || [];
                const cmd = Array.isArray(argv) ? argv.join(' ') : String(argv);
                result = await runCommand(cmd, params?.timeoutMs);
                sendNodeInvokeResult(id, nodeId, true, result);
                break;

            case 'system.which':
                // Return empty for now
                sendNodeInvokeResult(id, nodeId, true, { bins: {} });
                break;

            case 'browser.proxy':
                // Log full params to see what gateway sends
                log(`browser.proxy params: ${JSON.stringify(params)}`);

                // Gateway sends: { method: 'GET', path: '/', body: {...} }
                // GET / = status
                // POST / with { action: 'start' } = other actions
                const proxyMethod = params?.method || 'GET';
                const proxyPath = params?.path || '/';
                const proxyBody = params?.body || {};

                let action;
                let actionParams = proxyBody;

                if (proxyPath === '/') {
                    // Root path: GET = status, POST = action from body
                    if (proxyMethod === 'GET') {
                        action = 'status';
                    } else {
                        // POST / with action in body
                        action = proxyBody.action || 'status';
                        actionParams = proxyBody;
                    }
                } else {
                    // Map path to action
                    const pathToAction = {
                        // Status & lifecycle
                        '/status': 'status',
                        '/start': 'start',
                        '/stop': 'stop',
                        // Navigation
                        '/open': 'open',
                        '/navigate': 'navigate',
                        '/tabs/open': 'open',
                        '/tabs/navigate': 'navigate',
                        // Tabs management
                        '/tabs': 'tabs',
                        '/tabs/list': 'tabs',
                        '/tabs/focus': 'tabFocus',
                        '/tabs/close': 'tabClose',
                        // Snapshot & screenshot (MOST IMPORTANT!)
                        '/snapshot': 'snapshot',
                        '/tabs/snapshot': 'snapshot',
                        '/screenshot': 'screenshot',
                        '/tabs/screenshot': 'screenshot',
                        // Actions
                        '/act': 'act',
                        '/tabs/act': 'act',
                        // Content
                        '/content': 'content',
                        '/tabs/content': 'content',
                        '/html': 'content',
                        '/evaluate': 'evaluate',
                        // Extras
                        '/console': 'console',
                        '/cookies': 'cookies',
                        '/cookies/set': 'cookieSet',
                        '/cookies/clear': 'cookieClear',
                    };
                    action = pathToAction[proxyPath];

                    // Handle DELETE /tabs/:targetId
                    if (!action && proxyPath.startsWith('/tabs/') && proxyMethod === 'DELETE') {
                        action = 'tabClose';
                        actionParams = { targetId: proxyPath.split('/')[2] };
                    }
                }

                if (!action) {
                    throw new Error(`Unknown browser proxy path: ${proxyPath}`);
                }

                log(`browser.proxy action: ${action}`);

                // For 'act', map Clawdbot format
                if (action === 'act') {
                    actionParams = {
                        type: proxyBody.kind || proxyBody.type || proxyBody.action,
                        selector: proxyBody.ref || proxyBody.selector || proxyBody.target,
                        text: proxyBody.text || proxyBody.value,
                        key: proxyBody.key,
                        x: proxyBody.x,
                        y: proxyBody.y,
                    };
                }

                result = await browserAction(action, actionParams);
                log(`browser.proxy result: ${JSON.stringify(result).substring(0, 500)}`);
                sendNodeInvokeResult(id, nodeId, true, result);
                break;

            case 'notification':
                notifier.notify({
                    title: params?.title || 'Clawdbot',
                    message: params?.message || params?.body || '',
                    icon: path.join(__dirname, 'icon.ico'),
                    sound: params?.sound !== false,
                });
                sendNodeInvokeResult(id, nodeId, true, { success: true });
                break;

            case 'clipboard.read':
                const clipText = await clipboardRead();
                sendNodeInvokeResult(id, nodeId, true, { text: clipText });
                break;

            case 'clipboard.write':
                await clipboardWrite(params?.text || '');
                sendNodeInvokeResult(id, nodeId, true, { success: true });
                break;

            case 'screen.capture':
                try {
                    const screenImg = await captureScreen();
                    sendNodeInvokeResult(id, nodeId, true, {
                        base64: screenImg.toString('base64'),
                        format: 'png',
                        size: screenImg.length,
                    });
                } catch (screenErr) {
                    log(`Screenshot error: ${screenErr.message}`);
                    sendNodeInvokeResult(id, nodeId, false, null, { code: 'ERROR', message: screenErr.message });
                }
                break;

            case 'camera.list':
                try {
                    const cameras = await listCameras();
                    sendNodeInvokeResult(id, nodeId, true, cameras);
                } catch (camListErr) {
                    log(`Camera list error: ${camListErr.message}`);
                    sendNodeInvokeResult(id, nodeId, false, null, { code: 'ERROR', message: camListErr.message });
                }
                break;

            case 'camera.snap':
                try {
                    const camSnap = await captureCamera(params);
                    sendNodeInvokeResult(id, nodeId, true, camSnap);
                } catch (camSnapErr) {
                    log(`Camera snap error: ${camSnapErr.message}`);
                    sendNodeInvokeResult(id, nodeId, false, null, { code: 'ERROR', message: camSnapErr.message });
                }
                break;

            case 'camera.clip':
                try {
                    const camClip = await recordClip(params);
                    sendNodeInvokeResult(id, nodeId, true, camClip);
                } catch (camClipErr) {
                    log(`Camera clip error: ${camClipErr.message}`);
                    sendNodeInvokeResult(id, nodeId, false, null, { code: 'ERROR', message: camClipErr.message });
                }
                break;

            default:
                log(`Comando desconhecido: ${command}`);
                sendNodeInvokeResult(id, nodeId, false, null, { code: 'UNAVAILABLE', message: `Unknown command: ${command}` });
        }
    } catch (e) {
        log(`Erro no invoke ${command}: ${e.message}`);
        sendNodeInvokeResult(id, nodeId, false, null, { code: 'ERROR', message: e.message });
    }
}

function sendNodeInvokeResult(id, nodeId, ok, payload, error) {
    log(`sendNodeInvokeResult: id=${id}, ok=${ok}, payload=${payload !== undefined ? 'defined' : 'undefined'}`);
    const result = {
        id,
        nodeId: nodeId || config?.nodeId || 'windows-pc',
        ok,
    };
    if (payload !== null && payload !== undefined) {
        result.payloadJSON = JSON.stringify(payload);
        log(`payloadJSON length: ${result.payloadJSON.length}`);
    } else {
        log(`WARNING: payload is ${payload}`);
    }
    if (error) {
        result.error = error;
    }
    log(`Sending node.invoke.result: ${JSON.stringify(result).substring(0, 500)}`);
    sendRequest('node.invoke.result', result);
}

// Legacy invoke handler (kept for compatibility)
async function handleInvoke(id, method, params) {
    log(`Legacy Invoke: ${method}`);
    let result;

    try {
        switch (method) {
            case 'exec':
            case 'system.run':
                result = await runCommand(params?.command || params?.cmd, params?.timeout);
                send({ type: 'invoke-res', id, ok: true, payload: result });
                break;

            case 'browser':
            case 'browser.proxy':
                result = await browserAction(params?.action, params);
                send({ type: 'invoke-res', id, ok: true, payload: result });
                break;

            case 'notification':
            case 'notify':
                notifier.notify({
                    title: params?.title || 'Clawdbot',
                    message: params?.message || params?.body || '',
                    icon: path.join(__dirname, 'icon.ico'),
                    sound: params?.sound !== false,
                });
                send({ type: 'invoke-res', id, ok: true, payload: { success: true } });
                break;

            case 'clipboard.read':
                result = { text: await clipboardRead() };
                send({ type: 'invoke-res', id, ok: true, payload: result });
                break;

            case 'clipboard.write':
                await clipboardWrite(params?.text || '');
                send({ type: 'invoke-res', id, ok: true, payload: { success: true } });
                break;

            case 'screen.capture':
                try {
                    const screenBuf = await captureScreen();
                    send({ type: 'invoke-res', id, ok: true, payload: {
                        base64: screenBuf.toString('base64'),
                        format: 'png',
                        size: screenBuf.length,
                    }});
                } catch (screenErr) {
                    log(`Screenshot error: ${screenErr.message}`);
                    send({ type: 'invoke-res', id, ok: false, error: screenErr.message });
                }
                break;

            case 'camera.list':
                try {
                    const cams = await listCameras();
                    send({ type: 'invoke-res', id, ok: true, payload: cams });
                } catch (camErr) {
                    log(`Camera list error: ${camErr.message}`);
                    send({ type: 'invoke-res', id, ok: false, error: camErr.message });
                }
                break;

            case 'camera.snap':
                try {
                    const snap = await captureCamera(params);
                    send({ type: 'invoke-res', id, ok: true, payload: snap });
                } catch (snapErr) {
                    log(`Camera snap error: ${snapErr.message}`);
                    send({ type: 'invoke-res', id, ok: false, error: snapErr.message });
                }
                break;

            case 'camera.clip':
                try {
                    const clip = await recordClip(params);
                    send({ type: 'invoke-res', id, ok: true, payload: clip });
                } catch (clipErr) {
                    log(`Camera clip error: ${clipErr.message}`);
                    send({ type: 'invoke-res', id, ok: false, error: clipErr.message });
                }
                break;

            default:
                log(`Metodo invoke desconhecido: ${method}`);
                send({ type: 'invoke-res', id, ok: false, error: `Unknown method: ${method}` });
        }
    } catch (e) {
        log(`Erro no invoke ${method}: ${e.message}`);
        send({ type: 'invoke-res', id, ok: false, error: e.message });
    }
}

function scheduleReconnect() {
    if (reconnectTimer) return;

    const interval = config?.reconnectInterval || 5000;
    log(`Reconectando em ${interval/1000}s...`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, interval);
}

function disconnect(forReconnect = false) {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (ws) {
        ws.terminate();
        ws = null;
    }
    connected = false;
    updateTrayStatus();
    // Só escreve "disconnected" se não for para reconectar
    if (!forReconnect) {
        writeStatus('disconnected', 'Desconectado manualmente');
    }
    log('Desconectado');
}

// ============== SYSTRAY ==============
function updateTrayStatus(state) {
    if (!systray || !systrayReady) return;

    let statusText, canConnect, canDisconnect;

    if (state === 'connecting') {
        statusText = '🟡 Conectando...';
        canConnect = false;
        canDisconnect = true;
    } else if (connected) {
        statusText = '🟢 Conectado';
        canConnect = false;
        canDisconnect = true;
    } else {
        statusText = `⚪ ${lastStatus}`;
        canConnect = true;
        canDisconnect = false;
    }

    systray.sendAction({
        type: 'update-item',
        item: { title: statusText, enabled: false },
        seq_id: 1
    });
    systray.sendAction({
        type: 'update-item',
        item: { title: '▶️ Conectar', enabled: canConnect },
        seq_id: 2
    });
    systray.sendAction({
        type: 'update-item',
        item: { title: '⏹️ Desconectar', enabled: canDisconnect },
        seq_id: 3
    });
}

function openConfig() {
    if (configFormOpen) {
        log('Formulario de config ja esta aberto');
        return;
    }
    const vbsPath = path.join(__dirname, 'open-config.vbs');
    log(`Abrindo config: ${vbsPath}`);
    configFormOpen = true;
    const proc = exec(`start /wait "" "${vbsPath}"`, { cwd: __dirname, windowsHide: true }, (err) => {
        configFormOpen = false;
        if (err) log(`Erro ao abrir config: ${err.message}`);
    });
}

function openLogs() {
    fs.writeFileSync(LOG_PATH, logs.join('\n'));
    spawn('notepad', [LOG_PATH], { detached: true });
}

function checkSingleInstance() {
    try {
        // Tenta criar lock exclusivo
        if (fs.existsSync(LOCK_PATH)) {
            const pid = fs.readFileSync(LOCK_PATH, 'utf8').trim();
            // Verifica se o processo ainda existe
            try {
                process.kill(parseInt(pid), 0);
                // Processo existe - outra instância rodando
                console.log('Outra instância já está rodando (PID: ' + pid + ')');
                process.exit(1);
            } catch (e) {
                // Processo não existe - lock órfão, podemos continuar
            }
        }
        // Cria novo lock
        fs.writeFileSync(LOCK_PATH, process.pid.toString());
    } catch (e) {
        console.error('Erro ao verificar instância:', e.message);
    }
}

function cleanupLock() {
    try {
        if (fs.existsSync(LOCK_PATH)) {
            const pid = fs.readFileSync(LOCK_PATH, 'utf8').trim();
            if (pid === process.pid.toString()) {
                fs.unlinkSync(LOCK_PATH);
            }
        }
    } catch (e) {}
}

async function main() {
    checkSingleInstance();
    loadConfig();

    // Load device identity from clawdbot's store
    if (!loadDeviceIdentity()) {
        notify('Clawd Node', 'Execute "clawdbot node run" para criar identidade');
    }

    // Start browser control HTTP server
    startBrowserControlServer();

    const icon = await getIcon();

    systray = new SysTray({
        menu: {
            icon,
            title: '',
            tooltip: `Clawd Node - ${config?.nodeName || 'Windows'}`,
            items: [
                { title: '🦀 Clawd Node', enabled: false },
                { title: '⚪ Desconectado', enabled: false },
                { title: '▶️ Conectar', enabled: false },  // Desabilitado pois auto-conecta
                { title: '⏹️ Desconectar', enabled: false },
                { title: '⚙️ Configurações', enabled: true },
                { title: '📋 Logs', enabled: true },
                { title: '❌ Sair', enabled: true }
            ]
        }
    });

    systray.onClick(a => {
        switch(a.seq_id) {
            case 2: connect(); break;
            case 3: disconnect(); break;
            case 4: openConfig(); break;
            case 5: openLogs(); break;
            case 6:
                disconnect();
                stopBrowserControlServer();
                closeBrowser().finally(() => {
                    cleanupLock();
                    systray.kill();
                    process.exit(0);
                });
                break;
        }
    });

    log('Clawd Node iniciado');
    log(`Node ID: ${config?.nodeId || 'não configurado'}`);
    log(`Gateway: ${config?.gatewayUrl || 'não configurado'}`);

    // Watch config file for changes
    let configWatchTimeout = null;
    fs.watch(CONFIG_PATH, (eventType) => {
        if (eventType === 'change') {
            // Debounce to avoid multiple reloads
            if (configWatchTimeout) clearTimeout(configWatchTimeout);
            configWatchTimeout = setTimeout(() => {
                log('Config alterado, recarregando...');
                loadConfig();
                disconnect(true);  // true = for reconnect, don't write "disconnected" status
                setTimeout(() => connect(), 500);
            }, 300);
        }
    });

    // Wait a bit for systray to initialize, then connect
    setTimeout(() => {
        systrayReady = true;
        connect();
    }, 1000);
}

// Handle shutdown
process.on('SIGINT', () => {
    disconnect();
    stopBrowserControlServer();
    closeBrowser().finally(() => {
        cleanupLock();
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    disconnect();
    stopBrowserControlServer();
    closeBrowser().finally(() => {
        cleanupLock();
        process.exit(0);
    });
});

process.on('exit', () => {
    stopBrowserControlServer();
    cleanupLock();
});

main().catch(e => {
    cleanupLock();
    console.error('Erro fatal:', e);
    process.exit(1);
});
