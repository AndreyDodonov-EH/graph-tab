// Minimal RFC 1950/1951 (zlib/DEFLATE) decoder, puff.c-style. Returns both
// the decompressed bytes and how many input bytes were consumed — pack
// parsing needs the latter to find the next object, and no browser-native
// API reports it (DecompressionStream can't say where a stream ended).

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35,
  43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
  4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
  9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function getbits(s, need) {
  let val = s.bitbuf;
  while (s.bitcnt < need) {
    if (s.pos >= s.input.length) throw new Error('inflate: out of input');
    val |= s.input[s.pos++] << s.bitcnt;
    s.bitcnt += 8;
  }
  s.bitbuf = val >>> need;
  s.bitcnt -= need;
  return val & ((1 << need) - 1);
}

// Canonical Huffman table as {counts per length, symbols sorted by code}.
function buildHuffman(lengths) {
  const counts = new Array(16).fill(0);
  for (const len of lengths) if (len) counts[len]++;
  const offsets = new Array(16).fill(0);
  for (let len = 1; len < 15; len++) offsets[len + 1] = offsets[len] + counts[len];
  const symbols = [];
  lengths.forEach((len, sym) => {
    if (len) symbols[offsets[len]++] = sym;
  });
  return { counts, symbols };
}

function decode(s, huff) {
  let code = 0, first = 0, index = 0;
  for (let len = 1; len <= 15; len++) {
    code |= getbits(s, 1);
    const count = huff.counts[len];
    if (code - first < count) return huff.symbols[index + code - first];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error('inflate: invalid code');
}

let fixedCache = null;
function fixedTables() {
  if (!fixedCache) {
    const lit = new Array(288);
    for (let i = 0; i < 288; i++) lit[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
    fixedCache = { lit: buildHuffman(lit), dist: buildHuffman(new Array(30).fill(5)) };
  }
  return fixedCache;
}

function dynamicTables(s) {
  const hlit = getbits(s, 5) + 257;
  const hdist = getbits(s, 5) + 1;
  const hclen = getbits(s, 4) + 4;
  const clcLengths = new Array(19).fill(0);
  for (let i = 0; i < hclen; i++) clcLengths[CLC_ORDER[i]] = getbits(s, 3);
  const clc = buildHuffman(clcLengths);
  const lengths = [];
  while (lengths.length < hlit + hdist) {
    const sym = decode(s, clc);
    if (sym < 16) lengths.push(sym);
    else if (sym === 16) {
      let n = 3 + getbits(s, 2);
      const prev = lengths[lengths.length - 1];
      while (n--) lengths.push(prev);
    } else {
      let n = sym === 17 ? 3 + getbits(s, 3) : 11 + getbits(s, 7);
      while (n--) lengths.push(0);
    }
  }
  return { lit: buildHuffman(lengths.slice(0, hlit)), dist: buildHuffman(lengths.slice(hlit)) };
}

/**
 * Inflate one raw DEFLATE stream starting at input[start].
 * @returns {{ data: Uint8Array, consumed: number }}
 */
export function rawInflate(input, start = 0, sizeHint = 0) {
  const s = { input, pos: start, bitbuf: 0, bitcnt: 0 };
  let out = new Uint8Array(sizeHint > 0 ? sizeHint : 256);
  let len = 0;
  const ensure = (n) => {
    if (len + n <= out.length) return;
    const grown = new Uint8Array(Math.max(out.length * 2, len + n));
    grown.set(out);
    out = grown;
  };

  let last;
  do {
    last = getbits(s, 1);
    const type = getbits(s, 2);
    if (type === 0) {
      s.bitbuf = 0;
      s.bitcnt = 0; // stored blocks are byte-aligned
      const n = input[s.pos] | (input[s.pos + 1] << 8);
      s.pos += 4; // LEN + NLEN
      ensure(n);
      out.set(input.subarray(s.pos, s.pos + n), len);
      len += n;
      s.pos += n;
    } else if (type === 1 || type === 2) {
      const { lit, dist } = type === 1 ? fixedTables() : dynamicTables(s);
      for (;;) {
        const sym = decode(s, lit);
        if (sym === 256) break;
        if (sym < 256) {
          ensure(1);
          out[len++] = sym;
        } else {
          const length = LEN_BASE[sym - 257] + getbits(s, LEN_EXTRA[sym - 257]);
          const d = decode(s, dist);
          const distance = DIST_BASE[d] + getbits(s, DIST_EXTRA[d]);
          if (distance > len) throw new Error('inflate: distance too far back');
          ensure(length);
          for (let k = 0; k < length; k++, len++) out[len] = out[len - distance];
        }
      }
    } else {
      throw new Error('inflate: invalid block type');
    }
  } while (!last);

  return { data: out.subarray(0, len), consumed: s.pos - start };
}

/**
 * Inflate one zlib stream (2-byte header + DEFLATE + adler32 trailer), the
 * format git uses for every object inside a pack.
 * @returns {{ data: Uint8Array, consumed: number }} consumed covers the whole stream
 */
export function zlibInflate(input, start = 0, sizeHint = 0) {
  const cmf = input[start], flg = input[start + 1];
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0 || flg & 0x20) {
    throw new Error('inflate: bad zlib header');
  }
  const { data, consumed } = rawInflate(input, start + 2, sizeHint);
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const p = start + 2 + consumed;
  const adler = ((input[p] << 24) | (input[p + 1] << 16) | (input[p + 2] << 8) | input[p + 3]) >>> 0;
  if ((((b << 16) | a) >>> 0) !== adler) throw new Error('inflate: checksum mismatch');
  return { data, consumed: consumed + 6 };
}
