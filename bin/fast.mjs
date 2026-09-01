#!/usr/bin/env node
// Plain JS on purpose: no TypeScript, no bundler, no dependencies.
// Booting tsx costs ~1.6s per command, which dwarfs the browser work itself.
// This talks straight to the running session over HTTP and exits.
import { readFileSync, existsSync } from 'node:fs';

const SESSION_FILE = '.qa-session.json';
const [, , cmd, ...rest] = process.argv;

// Colour only when a human is watching. Piped output and CI logs get plain
// text — escape codes in a log file are noise, not colour.
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const GREEN = tty ? '\x1b[32m' : '', RED = tty ? '\x1b[31m' : '';
const DIM = tty ? '\x1b[2m' : '', YEL = tty ? '\x1b[33m' : '', OFF = tty ? '\x1b[0m' : '';

function session() {
  if (!existsSync(SESSION_FILE)) {
    console.error(`${RED}error:${OFF} No browser session running. Start one with \`qa start\`.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
}

async function send(payload) {
  const { port } = session();
  try {
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch {
    console.error(`${RED}error:${OFF} The browser session is not responding. Run \`qa start\` again.`);
    process.exit(1);
  }
}

/** Pull `--flag value` / `--flag` out of the argument list. */
function takeFlags(args, withValue = []) {
  const flags = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const name = a.slice(2);
    if (withValue.includes(name)) flags[name] = args[++i];
    else flags[name] = true;
  }
  return { flags, positional };
}

const VIEWPORTS = {
  mobile: [390, 844], 'mobile-small': [360, 640], tablet: [820, 1180],
  desktop: [1440, 900], wide: [1920, 1080],
};

function printSteps(steps) {
  for (const s of steps) {
    if (s.skipped) { console.log(`${DIM}○ ${s.step}${OFF}`); continue; }
    if (s.ok) {
      console.log(`${GREEN}✓${OFF} ${s.step}${s.locator ? `${DIM} · ${s.locator}${OFF}` : ''} ${DIM}${s.durationMs}ms${OFF}`);
    } else {
      console.log(`${RED}✗${OFF} ${s.step}`);
      for (const line of (s.detail ?? '').split('\n').slice(0, 6)) console.log(`${DIM}    ${line}${OFF}`);
      if (s.screenshot) console.log(`${YEL}    screenshot: ${s.screenshot}${OFF}`);
      if (s.snapshot) {
        console.log(`${DIM}    ── page at the moment of failure ──${OFF}`);
        for (const line of s.snapshot.split('\n')) console.log(`${DIM}    ${line}${OFF}`);
        if (s.snapshotPath) console.log(`${DIM}    (full tree: ${s.snapshotPath})${OFF}`);
      }
    }
  }
}

const ok = (r) => { console.log(r.ok ? `${GREEN}✓${OFF} ${r.message}` : `${RED}✗${OFF} ${r.message}`); return r.ok ? 0 : 1; };

async function main() {
  switch (cmd) {
    case 'status': {
      const r = await send({ type: 'status' });
      console.log(JSON.stringify(r.data, null, 2));
      return 0;
    }
    case 'detect': return ok(await send({ type: 'detect' }));
    case 'doctor': return ok(await send({ type: 'doctor' }));
    case 'vars-reset': return ok(await send({ type: 'reset' }));
    case 'stop': return ok(await send({ type: 'stop' }));

    case 'frames': {
      const r = await send({ type: 'frames' });
      for (const f of r.data) console.log(`${f.name || `${DIM}(unnamed)${OFF}`}  ${f.url}`);
      return 0;
    }
    case 'shot': return ok(await send({ type: 'screenshot', path: rest[0] }));

    case 'viewport': {
      const preset = (rest[0] ?? '').toLowerCase();
      const named = VIEWPORTS[preset];
      const m = /^(\d+)x(\d+)$/.exec(preset);
      if (!named && !m) {
        console.error(`${RED}Unknown viewport "${rest[0]}". Use ${Object.keys(VIEWPORTS).join(', ')}, or WxH.${OFF}`);
        return 1;
      }
      const [w, h] = named ?? [Number(m[1]), Number(m[2])];
      return ok(await send({ type: 'viewport', width: w, height: h }));
    }

    case 'admin':
    case 'storefront':
      return ok(await send({ type: 'goto', surface: cmd, target: rest[0] }));

    case 'snapshot': {
      const { flags } = takeFlags(rest, ['frame', 'max']);
      const r = await send({
        type: 'snapshot',
        frame: flags.frame ?? 'auto',
        maxChars: flags.max ? Number(flags.max) : undefined,
      });
      const d = r.data;
      console.log(`${DIM}# ${d.surface} · ${d.url}${OFF}\n`);
      for (const [name, tree] of Object.entries(d.frames)) {
        console.log(`## frame: ${name}`);
        console.log(tree);
        console.log();
      }
      return 0;
    }

    case 'do': {
      const { flags, positional } = takeFlags(rest, ['case', 'timeout']);
      const r = await send({
        type: 'do', step: positional[0], testCaseId: flags.case,
        timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
      });
      return ok(r);
    }

    case 'play': {
      const { flags, positional } = takeFlags(rest, ['case', 'title', 'suite', 'tags', 'file', 'timeout']);
      const steps = flags.file
        ? readFileSync(flags.file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        : positional;
      if (steps.length === 0) { console.error(`${RED}No steps given.${OFF}`); return 1; }
      const r = await send({
        type: 'play', steps, testCaseId: flags.case,
        stopOnFailure: !flags['keep-going'], shotEvery: Boolean(flags.shots),
        timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
      });
      printSteps(r.data.steps);
      console.log(`${DIM}\n${r.data.surface} · ${r.data.url}${OFF}`);
      // --record still needs the TS path, which owns the results file
      return r.ok ? 0 : 1;
    }

    default:
      console.error(`fast client does not handle "${cmd}"`);
      return 2;
  }
}

process.exit(await main());
