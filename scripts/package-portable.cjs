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

// Electron main-process modules are emitted as CommonJS and keep their runtime
// package imports. Copy only the WorkBook parser dependency closure into the
// portable app (not the development toolchain or Electron npm wrapper).
function packageRootFor(name, fromDirectory) {
  let cursor = path.resolve(fromDirectory);
  while (cursor !== path.dirname(cursor)) {
    const candidate = path.basename(cursor) === 'node_modules'
      ? path.join(cursor, ...name.split('/'))
      : path.join(cursor, 'node_modules', ...name.split('/'));
    if (fs.existsSync(candidate)) {
      const real = fs.realpathSync(candidate);
      const manifest = path.join(real, 'package.json');
      if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) return real;
    }
    cursor = path.dirname(cursor);
  }
  const entry = require.resolve(name, { paths: [fromDirectory] });
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (parsed.name === name) return directory;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Cannot locate runtime package root: ${name}`);
}
function copyRuntimePackage(name, fromDirectory, targetNodeModules) {
  const source = packageRootFor(name, fromDirectory);
  const target = path.join(targetNodeModules, ...name.split('/'));
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, {
      recursive: true,
      filter: (candidate) => {
        const relative = path.relative(source, candidate);
        return relative === '' || relative.split(path.sep)[0] !== 'node_modules';
      }
    });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const dependencies = Object.keys(manifest.dependencies ?? {});
  for (const dependency of dependencies) {
    copyRuntimePackage(dependency, source, path.join(target, 'node_modules'));
  }
}
const runtimePackages = ['fflate', 'mammoth', 'pdfjs-dist', 'yaml'];
for (const name of runtimePackages) copyRuntimePackage(name, root, path.join(app, 'node_modules'));
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
for (const name of ['pc-chat-relay.ps1', 'windows-ocr.ps1']) fs.copyFileSync(path.join(root, 'scripts', name), path.join(app, 'scripts', name));
fs.cpSync(path.join(root, '.codex-boss/config'), path.join(app, '.codex-boss/config'), { recursive: true });
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
  name: 'codex-boss',
  version,
  main: 'dist-electron/electron/main.js',
  dependencies: Object.fromEntries(runtimePackages.map((name) => [name, require(path.join(root, 'node_modules', name, 'package.json')).version]))
}, null, 2));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(app, 'LICENSE'));
const manifest = [];
function visit(directory) { for (const item of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, item.name); if (item.isDirectory()) visit(file); else manifest.push({ path: path.relative(destination, file).replaceAll('\\', '/'), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }); } }
visit(destination);
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ version, files: manifest }, null, 2));
fs.writeFileSync(path.join(root, 'artifacts', 'latest-package.json'), JSON.stringify({ destination }, null, 2));
console.log(destination);
