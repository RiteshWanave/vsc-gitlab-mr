'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTemplate,
  buildDescription,
} = require('../out/template.js');
const {
  projectPathFromRemote,
  readConventionalCommits,
  branchToTitle,
} = require('../out/repo.js');

test('parseTemplate extracts variables, sections, quick actions', () => {
  const tpl = [
    '* [Polarion](https://example.com/workitem?id=PUT ID HERE)',
    '# Description',
    'Describe the change.',
    '# Checklist',
    '- [ ] add tests',
    '/assign me',
    '/label ~foo',
  ].join('\n');

  const parsed = parseTemplate(tpl);
  assert.deepEqual(parsed.variables, ['ID']);
  assert.deepEqual(parsed.fields.map((f) => f.label), ['Description', 'Checklist']);
  assert.deepEqual(parsed.quickActions, ['/assign me', '/label ~foo']);
});

test('parseTemplate supports angle-bracket placeholder and dedupes variables', () => {
  const parsed = parseTemplate('a=<PUT_ID_HERE> b=<PUT_ID_HERE> # D\nx');
  assert.deepEqual(parsed.variables, ['ID']);
});

test('parseTemplate falls back to a Description field when there are no sections', () => {
  const parsed = parseTemplate('plain template without headings\n/assign me');
  assert.equal(parsed.fields.length, 1);
  assert.equal(parsed.fields[0].label, 'Description');
});

test('buildDescription substitutes variables and keeps empty ones as-is', () => {
  const parsed = parseTemplate('* [Polarion](https://x/workitem?id=<PUT_ID_HERE>)\n# D\nfill');
  const doc = buildDescription(parsed, {
    title: 'fix(core): fix the thing',
    variables: ['123456'],
    fields: ['filled'],
    quickActions: '/assign me',
  });
  assert.ok(doc.includes('id=123456'));
  assert.ok(doc.includes('# D\nfilled'));
  assert.ok(doc.includes('/assign me'));
  assert.ok(!doc.includes('PUT_ID_HERE'));
});

test('buildDescription keeps placeholder when no value given', () => {
  const parsed = parseTemplate('id=PUT ID HERE\n# D\nx');
  const doc = buildDescription(parsed, {
    title: 't',
    variables: [''],
    fields: ['x'],
    quickActions: '',
  });
  assert.ok(doc.includes('id=PUT ID HERE'));
});

test('projectPathFromRemote parses https, ssh shorthand and strips .git', () => {
  assert.equal(projectPathFromRemote('https://gitlab.com/org/proj.git'), 'org/proj');
  assert.equal(projectPathFromRemote('ssh://git@host:2222/org/proj.git'), 'org/proj');
  assert.equal(projectPathFromRemote('git@host:org/proj.git'), 'org/proj');
  assert.equal(projectPathFromRemote('git@host:org/proj/'), 'org/proj');
  assert.equal(projectPathFromRemote('org/project'), 'org/project');
  assert.equal(projectPathFromRemote('~/local/path'), null);
  assert.equal(projectPathFromRemote('/abs/path'), null);
});

test('branchToTitle cleans the branch into a title', () => {
  assert.equal(branchToTitle('feature/add-foo'), 'Add foo');
  assert.equal(branchToTitle('fix/JSX_parser'), 'JSX parser');
  assert.equal(branchToTitle('main'), 'Main');
});

test('readConventionalCommits parses the config file', () => {
  const { mkdtempSync, writeFileSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');

  const dir = mkdtempSync(join(tmpdir(), 'gitlabmr-'));
  writeFileSync(
    join(dir, 'conventionalCommits.json'),
    JSON.stringify({ requireScopes: true, scopes: ['core', 'docs'] })
  );

  assert.deepEqual(readConventionalCommits(dir), {
    requireScopes: true,
    scopes: ['core', 'docs'],
  });
  assert.equal(readConventionalCommits(join(dir, 'nope')), null);
});
