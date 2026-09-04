const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const destination = path.join(root, 'artifacts', `Codex-Boss-${version}-${Date.now()}`);
for (const file of ['dist/index.html', 'dist-electron/electron/main.js']) if (!fs.existsSync(path.join(root, file))) throw new Error('Run pnpm build before packaging');
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(path.join(root, 'node_modules/electron/dist'), destination, { recursive: true });
fs.renameSync(path.join(destination, 'electron.exe'), path.join(destination, 'Codex Boss.exe'));
const app = path.join(destination, 'resources', 'app'); fs.mkdirSync(app, { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(app, 'dist'), { recursive: true });
function copyCompiled(sourceRoot) {
  for (const item of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, item.name);
    if (item.isDirectory()) copyCompiled(source);
    else if (item.name.endsWith('.ts')) {
      const relative = path.relative(root, source).replace(/\.ts$/, '.js');
      const target = path.join(app, 'dist-electron', relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, 'dist-electron', relative), target);
    }
  }
}
copyCompiled(path.join(root, 'electron')); copyCompiled(path.join(root, 'src/shared'));
fs.mkdirSync(path.join(app, 'scripts'));
fs.copyFileSync(path.join(root, 'scripts/pc-chat-relay.ps1'), path.join(app, 'scripts/pc-chat-relay.ps1'));
fs.cpSync(path.join(root, '.codex-boss/config'), path.join(app, '.codex-boss/config'), { recursive: true });
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'codex-boss', version, main: 'dist-electron/electron/main.js' }, null, 2));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(app, 'LICENSE'));
const manifest = [];
function visit(directory) { for (const item of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, item.name); if (item.isDirectory()) visit(file); else manifest.push({ path: path.relative(destination, file).replaceAll('\\', '/'), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }); } }
visit(destination);
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ version, files: manifest }, null, 2));
fs.writeFileSync(path.join(root, 'artifacts', 'latest-package.json'), JSON.stringify({ destination }, null, 2));
console.log(destination);
