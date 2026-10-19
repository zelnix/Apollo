#!/usr/bin/env node
/* global __dirname */
// Post-install CI/preflight/native-build safeguard. Never installs, deletes or changes dependencies.
const path = require('node:path');
const { auditNativeDependencies } = require('./native-dependencies/scan.cjs');

function formatReport(report) {
  const lines = [`[native-dependency-guard] ${report.status.toUpperCase()}: ${report.packages.length} native package names; ${report.scannedPackageCount} installed packages inspected.`];
  for (const pkg of report.packages) {
    lines.push(`${pkg.installations.length > 1 ? 'DUPLICATE' : 'OK'} ${pkg.name}: ${pkg.versions.join(', ')}`);
    for (const install of pkg.installations) {
      for (const location of install.paths) {
        lines.push(`  ${install.version} — ${location}${location === install.realPath ? '' : ` -> ${install.realPath}`}`);
      }
    }
  }
  for (const error of report.errors) lines.push(`ERROR: ${error}`);
  if (report.duplicates.length) {
    lines.push('STOP: multiple physical installations of native singletons can register the same native views.');
    lines.push('Review every version/path above. No dependencies have been modified. Do not proceed with the native build.');
  }
  return lines.join('\n');
}

function assertNativeDependencies(projectRoot) {
  const report = auditNativeDependencies(projectRoot);
  if (report.status !== 'pass') throw new Error(formatReport(report));
  return report;
}

function run(argv = process.argv.slice(2)) {
  let projectRoot = path.resolve(__dirname, '..');
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--root' && argv[i + 1]) projectRoot = path.resolve(argv[++i]);
    else throw new Error('Usage: node scripts/native-dependency-guard.cjs [--root PROJECT] [--json]');
  }
  const report = auditNativeDependencies(projectRoot);
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.status === 'error' ? 2 : report.status === 'fail' ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = run(); }
  catch (error) { console.error(`[native-dependency-guard] ERROR: ${error.message}`); process.exitCode = 2; }
}

module.exports = { auditNativeDependencies, assertNativeDependencies, formatReport, run };