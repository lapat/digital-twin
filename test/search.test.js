const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { TranscriptIndex } = require('../lib/search');

const NIXON_DIR = path.join(__dirname, '..', 'personas', 'nixon', 'transcripts');
const REAGAN_DIR = path.join(__dirname, '..', 'personas', 'reagan', 'transcripts');
const KENNEDY_DIR = path.join(__dirname, '..', 'personas', 'kennedy', 'transcripts');
const FDR_DIR = path.join(__dirname, '..', 'personas', 'fdr', 'transcripts');

test('TranscriptIndex loads all bundled Nixon transcripts', () => {
  const index = new TranscriptIndex(NIXON_DIR);
  assert.equal(index.count(), 10);
});

test('TranscriptIndex loads all bundled Reagan/Kennedy/FDR transcripts', () => {
  assert.equal(new TranscriptIndex(REAGAN_DIR).count(), 4);
  assert.equal(new TranscriptIndex(KENNEDY_DIR).count(), 3);
  assert.equal(new TranscriptIndex(FDR_DIR).count(), 2);
});

test('keyword search finds the farewell address for "farewell"', () => {
  const index = new TranscriptIndex(REAGAN_DIR);
  const result = index.searchByKeyword('farewell', 1);
  assert.match(result, /farewell/i);
});

test('keyword search finds the resignation speech for "resign"', () => {
  const index = new TranscriptIndex(NIXON_DIR);
  const result = index.searchByKeyword('resignation', 1);
  assert.match(result, /resign/i);
});

test('keyword search returns empty string for nonsense query', () => {
  const index = new TranscriptIndex(NIXON_DIR);
  const result = index.searchByKeyword('zzqxw nonword blorp', 3);
  assert.equal(result, '');
});

test('temporal search detects a month and returns matches', () => {
  const index = new TranscriptIndex(NIXON_DIR);
  const temporal = index.detectTemporal('what did you say in january?');
  assert.deepEqual(temporal, { type: 'month', month: 0 });
  const result = index.searchByTemporal(temporal);
  assert.match(result, /january/i);
});

test('temporal search returns empty string when no entries match the month', () => {
  const index = new TranscriptIndex(NIXON_DIR);
  const temporal = index.detectTemporal('what happened in december?');
  const result = index.searchByTemporal(temporal);
  assert.equal(result, '');
});

test('search() falls back to keyword search when no temporal match', () => {
  const index = new TranscriptIndex(NIXON_DIR);
  const result = index.search('Watergate cover-up tapes');
  assert.notEqual(result, '');
});
