import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The backend package root, so backend-relative paths in the ledger resolve. */
const BACKEND = ['../api', '../../api', '../../../api', '../../../../fleet-management', '/home/bstudio/Projects/helix/fleet-management'].find((c) => existsSync(`${c}/packages/api/src/app/app.ts`))!;
import { ALL_ENDPOINTS, ENDPOINTS, url } from '../src/api/endpoints';

const doc = readFileSync('docs/ASSUMPTIONS.md', 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : /\.tsx?$/.test(p) ? [p] : []; });
const code = [...walk('src'), ...walk('../shared/src'), 'App.tsx'].map((p) => [p, readFileSync(p, 'utf8')] as const);

// An entry heading may carry a title after the id; the BODY starts on the next line.
const entries = [...doc.matchAll(/^### ([A-Z]-\d{2})[^\n]*\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)].map((m) => ({ id: m[1]!, body: m[2]! }));
const docIds = new Set(entries.map((e) => e.id));

/** An entry is Open while it sits above the "## Resolved" heading, and Resolved below it. */
const resolvedAt = doc.search(/^## Resolved$/m);
const isResolved = (id: string): boolean => new RegExp(`^### ${id}(?![\\d-])`, 'm').exec(doc)!.index > resolvedAt;
const openIds = entries.filter((e) => !isResolved(e.id)).map((e) => e.id);
const resolvedIds = entries.filter((e) => isResolved(e.id)).map((e) => e.id);

/** Every tag the code carries: the ledger and the code must name the same open questions. */
const codeIds = new Set<string>();
for (const [, s] of code) for (const m of s.matchAll(/ASSUMPTION\[([^\]]+)\]/g)) for (const id of m[1]!.split(',')) codeIds.add(id.trim().replace(/^(S-\d+|B-\d+|E-\d+|C-\d+|U-\d+)\s+.*/, '$1'));
for (const { endpoint } of ALL_ENDPOINTS) if (endpoint.assumption) codeIds.add(endpoint.assumption.split(' ')[0]!);

describe('ASSUMPTIONS.md stays in step with the code', () => {
  it('has the expected shape: unique ids, an index row for every entry', () => {
    expect(entries.length).toBeGreaterThan(75);
    expect(docIds.size).toBe(entries.length);
    for (const e of entries) expect(doc, `${e.id} has no row in the Index`).toContain(`| ${e.id} |`);
  });

  it('every Open entry is fully written: what we assumed, where it lives, what breaks, who confirms', () => {
    for (const id of openIds) {
      const body = entries.find((e) => e.id === id)!.body;
      for (const f of ['**Assumed:**', '**Where:**', '**Evidence:**', '**If wrong:**', '**Confirm with:**', '**Blocker:**']) {
        expect(body, `${id} (open) is missing ${f}`).toContain(f);
      }
    }
  });

  /**
   * A Resolved entry must (a) cite the backend source that closed it and (b) state what the contract
   * actually is. The citation is checked as a path anywhere in the body, because some entries put the
   * evidence inline rather than under a heading.
   */
  it('every Resolved entry cites the backend source that closed it and states the real contract', () => {
    for (const id of resolvedIds) {
      const body = entries.find((e) => e.id === id)!.body;
      expect(body, `${id} (resolved) cites no backend file or openapi path as evidence`)
        .toMatch(/fleet-management|openapi\.ya?ml|packages\/api|packages\/ws|packages\/shared|db\/seed/);
      const statesContract = ['**Now:**', '**Was assumed:**', '**Code:**'].some((f) => body.includes(f));
      expect(statesContract, `${id} (resolved) states neither the real contract (**Now:**) nor the change (**Code:**)`).toBe(true);
    }
  });

  it('every ASSUMPTION[...] tag in the code has an entry in the document', () => {
    expect([...codeIds].filter((id) => !docIds.has(id))).toEqual([]);
  });

  /**
   * The resolve loop: once an entry is Resolved its tag is gone from the code, so a Resolved id must
   * NOT still be tagged. This is what stops a "resolved" entry from quietly drifting back to a guess.
   */
  it('a Resolved entry carries no ASSUMPTION tag in the code any more', () => {
    expect(resolvedIds.filter((id) => codeIds.has(id))).toEqual([]);
  });

  it('every Open C/E/S/B/U entry is still tagged in the code, so it can be found and changed', () => {
    expect(openIds.filter((id) => /^[CESBU]-/.test(id) && !codeIds.has(id))).toEqual([]);
  });

  it('the ledger does not claim to be empty: the open list is the honest state', () => {
    expect(openIds.length).toBeGreaterThanOrEqual(5);
    expect(resolvedIds.length).toBeGreaterThan(35);
  });

  it('every guessed (ASSUMED / IMPLIED) endpoint names its assumption, and it is documented', () => {
    for (const { key, endpoint } of ALL_ENDPOINTS) {
      if (endpoint.status === 'CONTRACT') continue;
      expect(endpoint.assumption, key).toBeTruthy();
      const id = endpoint.assumption!.split(' ')[0]!;
      expect(docIds.has(id), `${key} -> ${endpoint.assumption}`).toBe(true);
      // A guessed endpoint is by definition still an open question.
      expect(openIds, `${key} -> ${id} is marked ASSUMED but its ledger entry is Resolved`).toContain(id);
    }
  });

  it('every CONTRACT endpoint really is declared by a router (checked in contract.test.ts) and has no assumption', () => {
    for (const { key, endpoint } of ALL_ENDPOINTS) if (endpoint.status === 'CONTRACT') expect(endpoint.assumption, key).toBeUndefined();
  });

  it('every file the document points at exists — ours relative to the app, the backend relative to fleet-management', () => {
    const missing: string[] = [];
    for (const m of doc.matchAll(/`([^`\s]+\.(?:tsx?|json|js|ya?ml|md)|[^`\s]+\/)`/g)) {
      const p = m[1]!;
      if (p.includes('*') || p.includes('{')) continue;
      if (/^(fleet-management|packages\/(api|ws|shared|worker|db)\/|db\/|api\/openapi)/.test(p)) {
        // A backend path, written relative to the fleet-management root.
        const rel = p.replace(/^fleet-management\//, '');
        if (![rel, join(BACKEND, rel)].some((c) => existsSync(c))) missing.push(p);
        continue;
      }
      if (!/^(src|packages|docs|test|assets|\.github|app\.config|eas\.json|metro\.config|package-lock|vitest\.config)/.test(p)) continue;
      if (![p, join('..', '..', p), join('..', 'shared', p)].some((c) => existsSync(c))) missing.push(p);
    }
    expect(missing).toEqual([]);
  });
});

describe('the endpoint registry is the only place paths are written', () => {
  it('no screen or service passes a path literal to the API client, queue or list hook', () => {
    const offenders = code.filter(([p, s]) => !p.endsWith('api/endpoints.ts') && /(api\.(get|post|put)(<[^>]*>)?\(\s*['"`]\/)|(path:\s*['"`]\/)|(writeOrQueue\(\s*['"`]\/)|(useCursorList\(\[[^\]]*\],\s*['"`]\/)/.test(s)).map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it('url() fills, encodes and refuses missing parameters', () => {
    expect(url(ENDPOINTS.verifyShift, { id: 'abc' })).toBe('/shifts/abc/verify');
    expect(url(ENDPOINTS.accidentMedia, { id: 'a/b c' })).toBe('/accidents/a%2Fb%20c/media');
    expect(url(ENDPOINTS.login)).toBe('/auth/login');
    expect(() => url(ENDPOINTS.verifyShift)).toThrow(/Missing "id"/);
    expect(() => url(ENDPOINTS.verifyShift, { id: '' })).toThrow();
  });

  it('registry templates are unique per method and well formed', () => {
    const seen = new Set<string>();
    for (const { key, endpoint } of ALL_ENDPOINTS) {
      expect(endpoint.template, key).toMatch(/^\/[A-Za-z0-9\-_/{}]+$/);   // `{deviceId}` is a real Express param name
      const k = `${endpoint.method} ${endpoint.template}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });

  /**
   * There is NO guessed endpoint left. `POST /fuel/refuel` was the only one and it has been retired on the
   * backend (U-12): it needed gauge-record ids that no endpoint ever created, behind a permission that was
   * not in app.permissions, so it answered 403 for every role. Anything added to this list again must name a
   * ledger entry, which the test above enforces.
   */
  it('no endpoint is guessed: every call the app makes is declared by a router', () => {
    const guessed = ALL_ENDPOINTS.filter((e) => e.endpoint.status !== 'CONTRACT').map((e) => e.key);
    expect(guessed).toEqual([]);
  });

  it('every endpoint records the permission its route enforces, so a control can be gated on it', () => {
    for (const { key, endpoint } of ALL_ENDPOINTS) {
      // Routes that need only a valid session, with no requirePermission() of their own.
      const SESSION_ONLY = ['login', 'mfaVerify', 'refresh', 'logout', 'logoutAll', 'changePassword', 'acceptConsent', 'registerDevice', 'setPin', 'refreshDeviceToken', 'uploadUrl', 'mediaObject', 'consentStatus', 'phonePoints', 'signup', 'passwordResetRequest', 'passwordResetComplete', 'acceptInvite'];
      if (SESSION_ONLY.includes(key)) continue;
      expect(endpoint.permission, `${key} (${endpoint.method} ${endpoint.template}) records no permission`).toBeTruthy();
    }
  });
});