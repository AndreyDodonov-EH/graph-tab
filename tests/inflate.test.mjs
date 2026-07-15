import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { rawInflate, zlibInflate } from '../src/inflate.js';

const samples = {
  empty: Buffer.alloc(0),
  short: Buffer.from('hello, world'),
  repetitive: Buffer.from('abcdef'.repeat(5000)),
  random: Buffer.from(Array.from({ length: 40000 }, () => Math.floor(Math.random() * 256))),
  commitish: Buffer.from(
    'tree 5d6ce700f8d74e8de7dfaf0d89a35f75b94d1483\n' +
    'parent 8e722e0209ee618156e2376e8eedcefa751f38cf\n' +
    'author A D <a@d> 1783425707 +0200\n\nTest Commit\n'
  ),
};

// level 0 forces stored blocks, 1/9 exercise fixed and dynamic Huffman
for (const [name, data] of Object.entries(samples)) {
  for (const level of [0, 1, 6, 9]) {
    test(`rawInflate roundtrip: ${name} @ level ${level}`, () => {
      const deflated = zlib.deflateRawSync(data, { level });
      const padded = Buffer.concat([deflated, Buffer.from('junk after stream')]);
      const { data: out, consumed } = rawInflate(new Uint8Array(padded));
      assert.deepEqual(Buffer.from(out), data);
      assert.equal(consumed, deflated.length);
    });
  }
}

test('zlibInflate consumes header and adler32, at an offset', () => {
  const data = samples.repetitive;
  const deflated = zlib.deflateSync(data);
  const padded = Buffer.concat([Buffer.from('xx'), deflated, Buffer.from('yy')]);
  const { data: out, consumed } = zlibInflate(new Uint8Array(padded), 2, data.length);
  assert.deepEqual(Buffer.from(out), data);
  assert.equal(consumed, deflated.length);
});

test('zlibInflate rejects corrupted checksum', () => {
  const deflated = zlib.deflateSync(samples.short);
  deflated[deflated.length - 1] ^= 0xff;
  assert.throws(() => zlibInflate(new Uint8Array(deflated)), /checksum/);
});

test('rawInflate rejects truncated input', () => {
  const deflated = zlib.deflateRawSync(samples.repetitive);
  assert.throws(() => rawInflate(new Uint8Array(deflated.subarray(0, 20))));
});
