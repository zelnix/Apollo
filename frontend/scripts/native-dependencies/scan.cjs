// Read-only filesystem audit for this project's node_modules / Yarn Classic layout.
// No package code is evaluated. All nested packages (including extraneous ones) are inspected.
const fs = require('node:fs');
const path = require('node:path');
const { REQUIRED_SINGLETONS, nativeReasons } = require('./policy.cjs');

function scanInstalledPackages(projectRoot) {
  const records = new Map();
  const containers = new Set();
  const errors = [];
  const scannedRoots = new Set();
  const recordError = (location, error) => errors.push(`${location}: ${error.message}`);

  function visitPackage(directory) {
    try {
      const realPath = fs.realpathSync(directory);
      const existing = records.get(realPath);
      if (existing) { existing.paths.add(directory); return; }
      const filename = path.join(directory, 'package.json');
      if (!fs.existsSync(filename)) return; // an unversioned local native project, not an npm package
      const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || !manifest.version) {
        throw new Error('package.json requires a package name and version; cannot audit this installation');
      }
      records.set(realPath, {
        name: manifest.name, version: manifest.version, realPath,
        paths: new Set([directory]), reasons: nativeReasons(directory, manifest),
      });
      visitContainer(path.join(directory, 'node_modules'));
    } catch (error) { recordError(directory, error); }
  }

  function visitContainer(directory, optional = true, scoped = false) {
    try {
      const realPath = fs.realpathSync(directory);
      if (containers.has(realPath)) return;
      containers.add(realPath);
      const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      if (entries.some(entry => entry.name === '.pnpm')) {
        throw new Error('pnpm virtual stores are not supported; use the project’s locked Yarn Classic installation');
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
        const child = path.join(directory, entry.name);
        if (!scoped && entry.name.startsWith('@')) visitContainer(child, false, true);
        else visitPackage(child);
      }
    } catch (error) {
      if (!(optional && error.code === 'ENOENT')) recordError(directory, error);
    }
  }

  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')); }
  catch (error) { recordError(projectRoot, error); }
  // Include parent node_modules for workspace hoisting. Realpath sets stop symlink cycles.
  for (let current = projectRoot; ; current = path.dirname(current)) {
    const directory = path.join(current, 'node_modules');
    if (fs.existsSync(directory)) scannedRoots.add(directory);
    visitContainer(directory);
    if (current === path.dirname(current)) break;
  }
  const autolinking = manifest.expo?.autolinking ?? {};
  for (const relative of [...(autolinking.searchPaths ?? []), autolinking.nativeModulesDir ?? './modules']) {
    const directory = path.resolve(projectRoot, relative);
    if (fs.existsSync(directory)) scannedRoots.add(directory);
    visitContainer(directory);
  }
  if (!records.size || ![...scannedRoots].some(directory => path.basename(directory) === 'node_modules')) {
    errors.push('No installed node_modules tree found. Install dependencies with the committed lockfile before auditing.');
  }
  const present = new Set([...records.values()].map(record => record.name));
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if ((REQUIRED_SINGLETONS.includes(name) || name.startsWith('expo-')) && !present.has(name)) {
      errors.push(`Declared native/Expo dependency ${name} is missing from the installed tree.`);
    }
  }
  return { records: [...records.values()], errors, scannedRoots: [...scannedRoots].sort() };
}

function auditNativeDependencies(projectRoot) {
  projectRoot = path.resolve(projectRoot);
  const { records, errors, scannedRoots } = scanInstalledPackages(projectRoot);
  // If ANY copy has native metadata, include ALL copies of that package (including older ones).
  const nativeNames = new Set(records.filter(record => record.reasons.length).map(record => record.name));
  const packages = [...nativeNames].sort().map(name => {
    const installations = records.filter(record => record.name === name)
      .map(record => ({ version: record.version, paths: [...record.paths].sort(), realPath: record.realPath }))
      .sort((a, b) => a.version.localeCompare(b.version) || a.realPath.localeCompare(b.realPath));
    return {
      name, versions: [...new Set(installations.map(record => record.version))].sort(), installations,
      reasons: [...new Set(records.filter(record => record.name === name).flatMap(record => record.reasons))].sort(),
    };
  });
  const duplicates = packages.filter(pkg => pkg.installations.length > 1);
  return {
    schemaVersion: 1, projectRoot, scannedRoots, scannedPackageCount: records.length,
    requiredSingletons: REQUIRED_SINGLETONS, packages, duplicates, errors: errors.sort(),
    status: errors.length ? 'error' : duplicates.length ? 'fail' : 'pass',
  };
}

module.exports = { auditNativeDependencies };