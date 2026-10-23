// Decodes an EA Blast ".mbn" map binary.
// Algorithm proven in analysis/parallel/E2/findings.md:
//   key ring = 70-byte string at file 0x272e80 (incl. NUL);
//   variant B: 12-byte LE header (magic 0xFFFFA329, djb2, len^hash) + XOR payload;
//   variant A: whole-file XOR; decoded magic 0x0ffbadfa;
//   ints big-endian, floats little-endian.
// Usage: node tools/decode-mbn.mjs <file.mbn> [--json]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const KEY = Buffer.from(
  "345$%#RTDJ5HGUTY6G*()UPILH63JKB<!@#WERT465HJMZXDFG85569HYUIO()P_^Y4HG\x00",
  "latin1"
);

class Reader {
  constructor(buf, cursor = 0) {
    this.buf = buf;
    this.pos = 0;
    this.cursor = cursor;
    this.xor = 0;
    this.hash = 0x1505;
  }
  raw(n) {
    if (!Number.isSafeInteger(n) || n < 0 || n > this.buf.length - this.pos) {
      throw new Error(`MBN read out of range: offset=${this.pos}, length=${n}, size=${this.buf.length}`);
    }
    const out = Buffer.allocUnsafe(n);
    for (let i = 0; i < n; i++) {
      const v = this.buf[this.pos + i] ^ KEY[this.cursor];
      this.cursor = (this.cursor + 1) % KEY.length;
      out[i] = v;
      this.xor ^= v;
      this.hash = (Math.imul(this.hash, 33) + v) >>> 0;
    }
    this.pos += n;
    return out;
  }
  i32be() {
    return this.raw(4).readInt32BE(0);
  }
  u32be() {
    return this.raw(4).readUInt32BE(0);
  }
  f32le() {
    return this.raw(4).readFloatLE(0);
  }
  cstr() {
    const bytes = [];
    for (;;) {
      const c = this.raw(1)[0];
      if (c === 0) break;
      bytes.push(c);
    }
    return Buffer.from(bytes).toString("latin1");
  }
  eof() {
    return this.pos >= this.buf.length;
  }
}

export function openStream(data) {
  const w0 = data.readUInt32LE(0);
  if (w0 === 0xffffa329) {
    const hash = data.readUInt32LE(4);
    const lenXor = data.readUInt32LE(8);
    return { reader: new Reader(data.subarray(12), 0), variant: "B", hash, lenXor };
  }
  return { reader: new Reader(data, 0), variant: "A", hash: null, lenXor: null };
}

export function parseMbn(file) {
  const data = fs.readFileSync(file);
  const { reader, variant, hash, lenXor } = openStream(data);
  const magic = reader.u32be();
  if (magic !== 0x0ffbadfa) throw new Error(`bad mbn magic ${magic.toString(16)}`);
  const background = reader.cstr();
  const nVertices = reader.i32be();
  const vertices = [];
  for (let i = 0; i < nVertices; i++) {
    const x = reader.f32le();
    const y = reader.f32le();
    const flags = reader.i32be();
    const prop = reader.i32be();
    const id = reader.i32be();
    const tag = reader.i32be();
    const wait = reader.i32be();
    const name = reader.cstr();
    vertices.push({ x, y, flags, prop, id, tag, wait, name });
  }
  const readLines = (n) => {
    const lines = [];
    for (let i = 0; i < n; i++) {
      const vA = reader.i32be();
      const vB = reader.i32be();
      const c = reader.i32be();
      const d = reader.i32be();
      lines.push({ vA, vB, c, d, flag: d >= 0 ? 1 : 0, absD: Math.abs(d) });
    }
    return lines;
  };
  const nA = reader.i32be();
  const linesA = readLines(nA);
  const nB = reader.i32be();
  const linesB = readLines(nB);
  const tail = reader.raw(1)[0];
  const info = {
    file,
    variant,
    size: data.length,
    background,
    vertices,
    linesA,
    linesB,
    tail,
    eof: reader.eof(),
    xorChecksum: reader.xor,
    hash: reader.hash >>> 0,
  };
  if (variant === "B") {
    info.headerHash = hash;
    info.headerLenXor = lenXor;
    info.hashOk = info.hash === hash;
    info.lenXorOk = ((data.length ^ hash) >>> 0) === lenXor;
  }
  return info;
}

const isCli =
  typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node tools/decode-mbn.mjs <file.mbn> [--json]");
    process.exit(2);
  }
  const info = parseMbn(file);
  if (args.includes("--json")) {
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.log(`file: ${file}`);
    console.log(
      `variant=${info.variant} size=${info.size} bg=${info.background} vertices=${info.vertices.length} linesA=${info.linesA.length} linesB=${info.linesB.length} tail=${info.tail} eof=${info.eof} xor=${info.xorChecksum} hashOk=${info.hashOk ?? "-"}`
    );
  }
}
