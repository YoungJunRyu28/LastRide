/**
 * Blocks deploying scheduled jobs that would keep the scale-to-zero database
 * (Neon) awake. It sleeps after ~5 minutes without queries; a job querying it
 * every 5 minutes all day keeps it awake around the clock (~180 CU-hours a
 * month, past the free plan's 100). Group alerts, retries and receipt checks
 * run from an event-driven one-time schedule and an on-demand watchdog that
 * exists only while alerts are pending (artifacts/api-server/src/lib/
 * leaveAlertSchedule.ts); the fixed schedules in infra/template.yaml must stay
 * sparse: the departure-alert backstop at most every 30 minutes, at night only,
 * and receipts at most daily.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function section(template, name, following) {
  const match = template.match(new RegExp(`^        ${name}:\\n([\\s\\S]*?)(?=^[ ]{2,8}${following}:)`, 'm'));
  if (!match) throw new Error(`Expected the ${name} schedule in infra/template.yaml`);
  return match[1];
}

function cron(block, name) {
  const match = block.match(/ScheduleExpression: "cron\(([^)]+)\)"/);
  if (!match) throw new Error(`${name} must use a cron expression`);
  return match[1].split(/\s+/);
}

export function checkAlertRecoveryBudget(stage, template) {
  if (stage !== 'production' && stage !== 'staging') throw new Error('Invalid release stage');
  const backstop = section(template, 'DepartureAlerts', 'PushReceipts');
  const [minutes, hours] = cron(backstop, 'DepartureAlerts');
  if (!backstop.includes(`Input: '{"task":"departureAlerts","backstop":true}'`))
    throw new Error('The fixed departure-alert schedule must be the backstop (it skips the database while the watchdog runs)');
  const step = minutes === '0' ? 60 : Number(minutes.match(/^\*\/(\d+)$/)?.[1]);
  if (!(step >= 30)) throw new Error(`The departure-alert backstop runs every ${minutes} minutes: at most every 30, or the database never sleeps`);
  if (hours === '*') throw new Error('The departure-alert backstop runs at all hours: limit it to the night');
  const [receiptMinutes, receiptHours] = cron(section(template, 'PushReceipts', 'ApiErrorsAlarm'), 'PushReceipts');
  if (!/^\d+$/.test(receiptMinutes) || !/^\d+$/.test(receiptHours))
    throw new Error('The receipt schedule must run once a day: group receipts are checked from the one-time schedule');
  return `${stage}: scheduled jobs leave the database asleep (backstop every ${step} min, hours ${hours}; receipts daily)`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const template = readFileSync(resolve(fileURLToPath(new URL('../infra/template.yaml', import.meta.url))), 'utf8');
    console.log(checkAlertRecoveryBudget(process.argv[2], template));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
