/**
 * Tests for domain-lookup.mjs.  Run:  node tools/domain-lookup.test.mjs
 *
 * Same shape as site-check.test.mjs: a plain runnable script, assertions
 * counted, non-zero exit on failure. Each test names the wrong answer it
 * prevents rather than the function it calls.
 */

import assert from 'node:assert/strict';
import {
  normalizeDomain,
  registrableDomain,
  domainsMatch,
  rowDomain,
  brandQueriesFromDomain,
  buildQueryPlan,
  findBusinessByDomain,
  DEFAULT_RADIUS_METERS,
  parseArgs,
  formatResult,
  rowsAsSearch,
  EXIT_FOUND,
  EXIT_USAGE,
  EXIT_INCONCLUSIVE,
} from './domain-lookup.mjs';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    failures.push({ name, message: error.message });
  }
}

/** A stub search: a map of lowercased query -> rows. */
function stubSearch(byQuery, log = []) {
  return async ({ query, radiusMeters }) => {
    log.push({ query, radiusMeters });
    return { businesses: byQuery[query.toLowerCase()] ?? [] };
  };
}

// --- normalizeDomain ---------------------------------------------------------

await test('a full URL with path and query reduces to its host', () => {
  assert.equal(normalizeDomain('https://www.derby-kitchens.com/contact?ref=gbp'), 'derby-kitchens.com');
});

await test('a bare host passes through unchanged', () => {
  assert.equal(normalizeDomain('derby-kitchens.com'), 'derby-kitchens.com');
});

await test('case and surrounding whitespace are normalized away', () => {
  assert.equal(normalizeDomain('  HTTPS://Derby-Kitchens.COM/  '), 'derby-kitchens.com');
});

await test('a port never survives into the compared host', () => {
  assert.equal(normalizeDomain('http://example.co.uk:8080/x'), 'example.co.uk');
});

await test('a trailing dot on a fully-qualified name is dropped', () => {
  assert.equal(normalizeDomain('example.com.'), 'example.com');
});

await test('unusable input yields null rather than a bogus host', () => {
  for (const input of ['', '   ', 'localhost', 'not a domain', null, undefined, 42, 'a..b']) {
    assert.equal(normalizeDomain(input), null, `expected null for ${JSON.stringify(input)}`);
  }
});

// --- registrableDomain -------------------------------------------------------

await test('a .co.uk keeps three labels, not two', () => {
  // peaklocal.co.uk truncated to "co.uk" would match every UK business alive.
  assert.equal(registrableDomain('peaklocal.co.uk'), 'peaklocal.co.uk');
  assert.equal(registrableDomain('shop.peaklocal.co.uk'), 'peaklocal.co.uk');
});

await test('a subdomain on a plain TLD reduces to the apex', () => {
  assert.equal(registrableDomain('booking.example.com'), 'example.com');
  assert.equal(registrableDomain('a.b.c.example.com'), 'example.com');
});

// --- domainsMatch ------------------------------------------------------------

await test('www and apex are the same site', () => {
  assert.equal(domainsMatch('https://www.derby-kitchens.com', 'derby-kitchens.com'), true);
});

await test('a subdomain matches its apex under a multi-part suffix', () => {
  assert.equal(domainsMatch('shop.peaklocal.co.uk', 'peaklocal.co.uk'), true);
});

await test('two different businesses do not collide', () => {
  assert.equal(domainsMatch('derby-kitchens.com', 'derbykitchens.com'), false);
  assert.equal(domainsMatch('peaklocal.co.uk', 'peaklocal.com'), false);
  // The bug this guards: two unrelated .co.uk sites sharing only the suffix.
  assert.equal(domainsMatch('alpha.co.uk', 'beta.co.uk'), false);
});

await test('an unreadable domain matches nothing, including itself', () => {
  assert.equal(domainsMatch('localhost', 'localhost'), false);
  assert.equal(domainsMatch(null, 'example.com'), false);
});

// --- rowDomain ---------------------------------------------------------------

await test('an explicit domain field on the SERP row wins', () => {
  assert.equal(rowDomain({ domain: 'derby-kitchens.com', url: 'https://facebook.com/x' }), 'derby-kitchens.com');
});

await test('a row without a domain field falls back to its website link', () => {
  assert.equal(rowDomain({ url: 'https://www.derby-kitchens.com/kitchens' }), 'derby-kitchens.com');
  assert.equal(rowDomain({ contact_url: 'derby-kitchens.com' }), 'derby-kitchens.com');
  assert.equal(rowDomain({ website: 'http://derby-kitchens.com' }), 'derby-kitchens.com');
});

await test('a listing with no website at all yields null, not a crash', () => {
  assert.equal(rowDomain({ name: 'Some Business' }), null);
  assert.equal(rowDomain(null), null);
});

// --- brandQueriesFromDomain --------------------------------------------------

await test('a hyphenated domain becomes a spaced brand query', () => {
  const queries = brandQueriesFromDomain('derby-kitchens.com');
  assert.ok(queries.includes('derby kitchens'), `got ${JSON.stringify(queries)}`);
  assert.ok(queries.includes('derbykitchens'), 'the run-together variant should also be tried');
});

await test('the TLD never leaks into the query', () => {
  for (const query of brandQueriesFromDomain('peaklocal.co.uk')) {
    assert.ok(!query.includes('co'), `"${query}" leaked part of the suffix`);
    assert.ok(!query.includes('uk'), `"${query}" leaked part of the suffix`);
  }
});

await test('trimming noise never produces an empty query', () => {
  // Every token is noise here; the untrimmed string must survive.
  const queries = brandQueriesFromDomain('the-uk-online.com');
  assert.ok(queries.length > 0, 'expected at least one query');
  assert.ok(queries.every((query) => query.trim() !== ''), `empty query in ${JSON.stringify(queries)}`);
});

await test('an unreadable domain yields no queries rather than throwing', () => {
  assert.deepEqual(brandQueriesFromDomain('localhost'), []);
});

// --- buildQueryPlan ----------------------------------------------------------

await test('the known trading name is searched before anything guessed', () => {
  const plan = buildQueryPlan({ domain: 'derby-kitchens.com', name: 'Duffield Kitchens' });
  assert.equal(plan[0].query, 'Duffield Kitchens');
  assert.equal(plan[0].source, 'name');
});

await test('a name equal to the domain guess is not searched twice', () => {
  const plan = buildQueryPlan({ domain: 'derby-kitchens.com', name: 'Derby Kitchens' });
  const spaced = plan.filter((entry) => entry.query.toLowerCase() === 'derby kitchens');
  assert.equal(spaced.length, 1, `duplicate query spends credits twice: ${JSON.stringify(plan)}`);
});

// --- findBusinessByDomain: the failure this module exists for ----------------

await test('REGRESSION: a listing whose name shares nothing with its domain is found', async () => {
  // Duffield Kitchens / derby-kitchens.com. Three name-keyed checks concluded
  // "no Google listing". Matching on the row domain finds it.
  const rows = {
    'derby kitchens': [
      { name: 'Duffield Kitchens', domain: 'derby-kitchens.com', cid: '1122', latitude: 52.9, longitude: -1.5 },
      { name: 'Derby Kitchen Co', domain: 'someoneelse.co.uk', cid: '9999' },
    ],
  };
  const result = await findBusinessByDomain(
    { domain: 'derby-kitchens.com' },            // domain only — no name known
    { searchLocalBusinesses: stubSearch(rows) },
  );

  assert.equal(result.status, 'found');
  assert.equal(result.matches.length, 1, 'the unrelated business must not match');
  assert.equal(result.matches[0].name, 'Duffield Kitchens');
  assert.equal(result.matches[0].cid, '1122');
  assert.equal(result.matches[0].nameDiffersFromQuery, true);
});

await test('REGRESSION: a miss is inconclusive, never "no listing exists"', async () => {
  const result = await findBusinessByDomain(
    { domain: 'derby-kitchens.com' },
    { searchLocalBusinesses: stubSearch({}) },
  );

  assert.equal(result.status, 'inconclusive');
  assert.equal(result.matches.length, 0);
  assert.equal(result.verified, false);
  assert.ok(result.attempts.length > 0, 'the queries tried must be recorded for hand-checking');
  assert.ok(
    /not evidence that no listing exists/i.test(result.note),
    'the note must refuse to assert absence',
  );
});

await test('a found match is still marked unverified', async () => {
  // The standing rule: nothing automated goes to a prospect unchecked.
  const rows = { 'duffield kitchens': [{ name: 'Duffield Kitchens', domain: 'derby-kitchens.com', cid: '1122' }] };
  const result = await findBusinessByDomain(
    { domain: 'derby-kitchens.com', name: 'Duffield Kitchens' },
    { searchLocalBusinesses: stubSearch(rows) },
  );
  assert.equal(result.status, 'found');
  assert.equal(result.verified, false);
});

await test('the search runs wide by default', async () => {
  const log = [];
  await findBusinessByDomain(
    { domain: 'derby-kitchens.com' },
    { searchLocalBusinesses: stubSearch({}, log) },
  );
  assert.ok(log.length > 0);
  assert.equal(log[0].radiusMeters, DEFAULT_RADIUS_METERS);
  assert.ok(DEFAULT_RADIUS_METERS >= 50000, 'a tight radius is how the listing was missed');
});

await test('searching stops once an authoritative cid is in hand', async () => {
  // Every extra query is a paid call.
  const log = [];
  const rows = { 'duffield kitchens': [{ name: 'Duffield Kitchens', domain: 'derby-kitchens.com', cid: '1122' }] };
  await findBusinessByDomain(
    { domain: 'derby-kitchens.com', name: 'Duffield Kitchens' },
    { searchLocalBusinesses: stubSearch(rows, log) },
  );
  assert.equal(log.length, 1, `expected to stop after the first hit, ran ${log.length} searches`);
});

await test('the same listing surfacing twice is reported once', async () => {
  const rows = {
    'derby kitchens': [{ name: 'Duffield Kitchens', domain: 'derby-kitchens.com' }],
    'derbykitchens': [{ name: 'Duffield Kitchens', domain: 'derby-kitchens.com' }],
  };
  const result = await findBusinessByDomain(
    { domain: 'derby-kitchens.com' },
    { searchLocalBusinesses: stubSearch(rows) },
  );
  assert.equal(result.matches.length, 1, 'a listing without a cid must still de-duplicate');
});

await test('a failing search is recorded, not thrown', async () => {
  const result = await findBusinessByDomain(
    { domain: 'derby-kitchens.com' },
    { searchLocalBusinesses: async () => { throw new Error('rate limited'); } },
  );
  assert.equal(result.status, 'inconclusive');
  assert.ok(result.attempts.every((attempt) => attempt.error === 'rate limited'));
});

await test('a bare array response is accepted as well as {businesses}', async () => {
  const result = await findBusinessByDomain(
    { domain: 'derby-kitchens.com' },
    { searchLocalBusinesses: async () => ([{ name: 'Duffield Kitchens', domain: 'derby-kitchens.com', cid: '1122' }]) },
  );
  assert.equal(result.status, 'found');
});

await test('an unreadable domain is rejected before any credit is spent', async () => {
  const log = [];
  const result = await findBusinessByDomain(
    { domain: 'not a domain' },
    { searchLocalBusinesses: stubSearch({}, log) },
  );
  assert.equal(result.status, 'invalid_domain');
  assert.equal(log.length, 0, 'a malformed domain must not reach a paid search');
});

await test('a missing search dependency fails loudly at the call site', async () => {
  await assert.rejects(() => findBusinessByDomain({ domain: 'example.com' }, {}), TypeError);
});

// --- CLI ---------------------------------------------------------------------

await test('flags parse into options', () => {
  const options = parseArgs(['--domain', 'derby-kitchens.com', '--name', 'Duffield Kitchens', '--rows', '-', '--json']);
  assert.equal(options.domain, 'derby-kitchens.com');
  assert.equal(options.name, 'Duffield Kitchens');
  assert.equal(options.rows, '-');
  assert.equal(options.json, true);
});

await test('a flag swallowing the next flag as its value is rejected', () => {
  // `--domain --rows x` must not silently set domain to "--rows".
  assert.throws(() => parseArgs(['--domain', '--rows', 'x']), /needs a value/);
  assert.throws(() => parseArgs(['--domain']), /needs a value/);
});

await test('an unknown flag is rejected rather than ignored', () => {
  assert.throws(() => parseArgs(['--bogus', 'x']), /unknown argument/);
});

await test('the exit code for "no match" is neither success nor a usage error', () => {
  // Collapsing these would make a miss indistinguishable from a hit or a crash.
  assert.notEqual(EXIT_INCONCLUSIVE, EXIT_FOUND);
  assert.notEqual(EXIT_INCONCLUSIVE, EXIT_USAGE);
  assert.equal(EXIT_FOUND, 0);
});

await test('a match is rendered with its cid and the name-mismatch warning', async () => {
  const rows = [{ name: 'Duffield Kitchens', url: 'https://www.derby-kitchens.com/', cid: '333' }];
  const result = await findBusinessByDomain(
    { domain: 'derby-kitchens.com' },
    { searchLocalBusinesses: rowsAsSearch(rows) },
  );
  const text = formatResult(result);
  assert.match(text, /MATCHED/);
  assert.match(text, /Duffield Kitchens/);
  assert.match(text, /cid 333/);
  assert.match(text, /listing name differs from the query/);
});

await test('rendered output of a miss never claims the listing does not exist', async () => {
  const result = await findBusinessByDomain(
    { domain: 'derby-kitchens.com' },
    { searchLocalBusinesses: rowsAsSearch([{ name: 'Ascot', domain: 'abkkitchens.co.uk' }]) },
  );
  const text = formatResult(result);
  assert.match(text, /NO MATCH/);
  assert.match(text, /not evidence that no listing exists/i);
  assert.doesNotMatch(text, /has no (google )?listing/i);
  // The queries tried must be on screen so the miss can be checked by hand.
  assert.match(text, /derby kitchens/);
});

await test('every rendered result carries its hand-check note', async () => {
  for (const rows of [[{ name: 'Duffield Kitchens', domain: 'derby-kitchens.com', cid: '1' }], []]) {
    const result = await findBusinessByDomain(
      { domain: 'derby-kitchens.com' },
      { searchLocalBusinesses: rowsAsSearch(rows) },
    );
    assert.ok(formatResult(result).includes(result.note), 'the note must reach the screen');
  }
});

// --- report ------------------------------------------------------------------

for (const failure of failures) {
  console.error(`FAIL  ${failure.name}\n      ${failure.message}`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
