const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, 'dist');
const NODE_MODULES = path.join(__dirname, 'node_modules');

// Native modules that need to be copied
const NATIVE_MODULES = [
    'screenshot-desktop',
    'systray2',
    'node-notifier'
];

async function build() {
    console.log('=== Clawd Node Build ===\n');

    // 1. Clean dist folder
    console.log('1. Limpando pasta dist...');
    if (fs.existsSync(DIST_DIR)) {
        fs.rmSync(DIST_DIR, { recursive: true });
    }
    fs.mkdirSync(DIST_DIR, { recursive: true });

    // 2. Run pkg
    console.log('2. Compilando executavel com pkg...');
    try {
        execSync('npx pkg . --targets node18-win-x64 --output dist/ClawdNode.exe', {
            stdio: 'inherit',
            cwd: __dirname
        });
    } catch (err) {
        console.error('Erro ao compilar:', err.message);
        process.exit(1);
    }

    // 3. Copy native modules
    console.log('\n3. Copiando modulos nativos...');
    const distModules = path.join(DIST_DIR, 'node_modules');
    fs.mkdirSync(distModules, { recursive: true });

    function copyDir(src, dest) {
        if (!fs.existsSync(src)) return;
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                copyDir(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    for (const mod of NATIVE_MODULES) {
        const src = path.join(NODE_MODULES, mod);
        const dest = path.join(distModules, mod);
        if (fs.existsSync(src)) {
            console.log(`   Copiando ${mod}...`);
            copyDir(src, dest);
        }
    }

    // 4. Copy icon files
    console.log('\n4. Copiando icones...');
    const icons = ['icon.ico', 'icon.png'];
    for (const icon of icons) {
        const src = path.join(__dirname, icon);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(DIST_DIR, icon));
            console.log(`   Copiando ${icon}...`);
        }
    }

    // 5. Create launcher files
    console.log('\n5. Criando launchers...');

    // Debug launcher (shows console)
    fs.writeFileSync(path.join(DIST_DIR, 'ClawdNode-debug.bat'), `@echo off
cd /d "%~dp0"
ClawdNode.exe
pause
`);

    // Silent launcher (hides console) - VBScript
    fs.writeFileSync(path.join(DIST_DIR, 'ClawdNode.vbs'), `Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "ClawdNode.exe", 0, False
`);

    // Copy config.json if exists
    const configSrc = path.join(__dirname, 'config.json');
    if (fs.existsSync(configSrc)) {
        fs.copyFileSync(configSrc, path.join(DIST_DIR, 'config.json'));
        console.log('   Copiando config.json...');
    }

    // 6. Patch exe to hide console (change PE subsystem from CONSOLE to WINDOWS)
    console.log('\n6. Removendo console do executavel...');
    const exePath = path.join(DIST_DIR, 'ClawdNode.exe');
    try {
        const exe = fs.readFileSync(exePath);
        // Find PE header offset (at 0x3C)
        const peOffset = exe.readUInt32LE(0x3C);
        // Subsystem is at PE + 0x5C (for PE32+/64-bit)
        const subsystemOffset = peOffset + 0x5C;
        // Change from 3 (CONSOLE) to 2 (WINDOWS/GUI)
        if (exe.readUInt16LE(subsystemOffset) === 3) {
            exe.writeUInt16LE(2, subsystemOffset);
            fs.writeFileSync(exePath, exe);
            console.log('   Console removido com sucesso!');
        } else {
            console.log('   Subsystem ja eh GUI ou nao encontrado');
        }
    } catch (err) {
        console.log('   Aviso: Nao foi possivel modificar o exe:', err.message);
    }

    // 7. Apply icon to exe using rcedit
    console.log('\n7. Aplicando icone no executavel...');
    const icoPath = path.join(DIST_DIR, 'icon.ico');
    if (fs.existsSync(icoPath)) {
        try {
            const rcedit = require('rcedit');
            await rcedit(exePath, {
                icon: icoPath,
                'version-string': {
                    ProductName: 'Clawd Node',
                    FileDescription: 'Clawd Node Agent for Windows',
                    CompanyName: 'Clawdbot',
                    LegalCopyright: '2025 Clawdbot',
                    OriginalFilename: 'ClawdNode.exe'
                },
                'file-version': '1.0.0',
                'product-version': '1.0.0'
            });
            console.log('   Icone e metadados aplicados com sucesso!');
        } catch (err) {
            console.log('   Aviso: Nao foi possivel aplicar o icone:', err.message);
        }
    } else {
        console.log('   Aviso: icon.ico nao encontrado');
    }

    console.log('\n=== Build completo! ===');
    console.log(`\nArquivos em: ${DIST_DIR}`);
    console.log('\nPara executar:');
    console.log('  dist\\ClawdNode.exe');
    console.log('\nPara debug (ver erros):');
    console.log('  dist\\ClawdNode-debug.bat');
}

build().catch(err => {
    console.error('Erro no build:', err);
    process.exit(1);
});
