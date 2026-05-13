import { describe, it, expect } from 'vitest';
import {
  isTextByName,
  looksLikeText,
  detectEditability,
  DEFAULT_MAX_EDIT_BYTES,
  SNIFF_BYTES,
} from '../../src/util/text-detect.js';

describe('isTextByName — allowlist hits and misses', () => {
  it.each([
    'notes.txt',
    'config.json',
    'docker-compose.yml',
    'webpack.config.js',
    'snake.py',
    'main.rs',
    'index.html',
    'styles.css',
    'README.md',
    'README.MD',
    'queries.sql',
    'main.tf',
    'pkg/util.go',
    'src/lib.rs',
  ])('matches known text extension: %s', (name) => {
    expect(isTextByName(name)).toBe(true);
  });

  it.each([
    'Dockerfile',
    'Makefile',
    'LICENSE',
    'README',
    'CHANGELOG',
    '.env',
    '.env.local',
    '.gitignore',
    '.eslintrc.json',
  ])('matches known no-extension basename: %s', (name) => {
    expect(isTextByName(name)).toBe(true);
  });

  it.each([
    'photo.png',
    'audio.mp3',
    'video.mp4',
    'archive.zip',
    'report.pdf',
    'doc.docx',
    'sheet.xlsx',
    'random.bin',
    'no-extension-mystery-file',
  ])('rejects known binary or unknown name: %s', (name) => {
    expect(isTextByName(name)).toBe(false);
  });
});

describe('looksLikeText — content sniff', () => {
  it('accepts pure ASCII text', () => {
    const buf = Buffer.from('hello world\nthis is a config\nkey=value\n');
    expect(looksLikeText(buf)).toBe(true);
  });

  it('accepts UTF-8 with non-ASCII codepoints', () => {
    const buf = Buffer.from('café — résumé — emoji 🎉\n', 'utf8');
    expect(looksLikeText(buf)).toBe(true);
  });

  it('treats an empty buffer as text (editable)', () => {
    expect(looksLikeText(Buffer.alloc(0))).toBe(true);
  });

  it('rejects content containing a NUL byte', () => {
    const buf = Buffer.concat([Buffer.from('text'), Buffer.from([0]), Buffer.from('more')]);
    expect(looksLikeText(buf)).toBe(false);
  });

  it('rejects content dominated by control bytes (binary blob)', () => {
    const arr = new Uint8Array(1024);
    // Fill with non-NUL control bytes that aren't tab/CR/LF — i.e. 0x01..0x08.
    for (let i = 0; i < arr.length; i++) arr[i] = (i % 8) + 1;
    expect(looksLikeText(arr)).toBe(false);
  });

  it('inspects at most SNIFF_BYTES — clean prefix wins even with binary tail beyond cap', () => {
    const head = Buffer.alloc(SNIFF_BYTES, 0x61); // 'a' * SNIFF_BYTES
    const tail = Buffer.alloc(64, 0); // NUL bytes outside sniff window
    expect(looksLikeText(Buffer.concat([head, tail]))).toBe(true);
  });
});

describe('detectEditability — composite decision', () => {
  it('OK for a text-named file under the size cap', () => {
    const r = detectEditability('config.json', 100, Buffer.from('{"a":1}'));
    expect(r).toEqual({ editable: true, reason: 'ok', maxBytes: DEFAULT_MAX_EDIT_BYTES });
  });

  it('binary reason when content looks binary even if extension is known-text', () => {
    const buf = Buffer.concat([Buffer.from('{'), Buffer.from([0, 0, 0])]);
    const r = detectEditability('config.json', buf.length, buf);
    expect(r.editable).toBe(false);
    expect(r.reason).toBe('binary');
  });

  it('OK for an unknown extension if the content sniffs as text', () => {
    const buf = Buffer.from('some pseudocode\nstep 1\nstep 2\n');
    const r = detectEditability('plan.steps', buf.length, buf);
    expect(r.editable).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('refuses based on declared size (no bytes needed)', () => {
    const r = detectEditability('huge.txt', DEFAULT_MAX_EDIT_BYTES + 1, undefined);
    expect(r.editable).toBe(false);
    expect(r.reason).toBe('too-large');
  });

  it('refuses based on buffer length when declared size is missing', () => {
    const buf = Buffer.alloc(DEFAULT_MAX_EDIT_BYTES + 1, 0x61);
    const r = detectEditability('weird-no-ext-but-big', undefined, buf);
    expect(r.editable).toBe(false);
    expect(r.reason).toBe('too-large');
  });

  it('unknown reason when extension is unknown and no bytes were provided', () => {
    const r = detectEditability('mystery.dat', 100, undefined);
    expect(r.editable).toBe(false);
    expect(r.reason).toBe('unknown');
  });

  it('honors a custom maxBytes', () => {
    const small = Buffer.alloc(10, 0x61);
    const r = detectEditability('a.txt', small.length, small, 8);
    expect(r.editable).toBe(false);
    expect(r.reason).toBe('too-large');
    expect(r.maxBytes).toBe(8);
  });
});
