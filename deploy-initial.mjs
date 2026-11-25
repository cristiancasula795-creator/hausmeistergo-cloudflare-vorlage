import { execFileSync } from 'node:child_process';

const rows = JSON.parse(execFileSync('wrangler', [
  'd1', 'execute', 'DB', '--remote', '--json', '--command',
  'SELECT EXISTS(SELECT 1 FROM tenants) OR EXISTS(SELECT 1 FROM users) AS configured'
], {encoding:'utf8'}));
if (rows.length !== 1 || rows[0].success !== true || rows[0].results?.[0]?.configured !== 0) {
  throw new Error('Diese Vorlage ist für die Ersteinrichtung. Verwende für bestehende Firmen das Kundenserver-Update mit Sicherung.');
}
execFileSync('wrangler', ['deploy'], {stdio:'inherit'});
