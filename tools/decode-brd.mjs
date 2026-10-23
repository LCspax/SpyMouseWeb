// Decodes an EA Blast ".brd" binary-XML file.
// Algorithm proven in analysis/parallel/D1/findings.md:
//   magic 7b 02; XOR bytes [2..EOF) with a 29-byte key; running XOR must be 0;
//   decoded stream is a binary XML tree.
// Usage:
//   node tools/decode-brd.mjs <file.brd> [--json] [--max-depth N]
import fs from "node:fs";

const KEY = Buffer.from([
  0xf5, 0xed, 0x47, 0x0b, 0x9d, 0x79, 0xd8, 0xcc, 0x01, 0x70, 0x6e, 0x7e,
  0x9b, 0xf1, 0x0a, 0x8a, 0x79, 0xe2, 0xf0, 0xbf, 0xf0, 0xd6, 0xb0, 0x7d,
  0x02, 0x10, 0x06, 0x2a, 0xc3,
]);

function decode(raw) {
  if (raw.length < 3) throw new Error("file too short");
  if (raw[0] !== 0x7b || raw[1] !== 0x02) {
    throw new Error(`bad magic ${raw[0]?.toString(16)} ${raw[1]?.toString(16)} (expected 7b 02)`);
  }
  const out = Buffer.from(raw);
  let checksum = 0;
  for (let i = 2; i < out.length; i++) {
    const v = out[i] ^ KEY[(i - 2) % KEY.length];
    out[i] = v;
    checksum ^= v;
  }
  if (checksum !== 0) throw new Error(`checksum mismatch: ${checksum}`);
  return out.subarray(2);
}

function parseNode(buf, off, maxDepth, depth = 0) {
  if (off + 4 > buf.length) throw new Error(`node at ${off} out of range`);
  const totalSize = buf.readUInt32BE(off);
  let p = off + 4;
  const readCString = () => {
    const end = buf.indexOf(0, p);
    if (end < 0) throw new Error(`unterminated string at ${p}`);
    const s = buf.toString("latin1", p, end);
    p = end + 1;
    return s;
  };
  const name = readCString();
  const attrCount = buf.readUInt32BE(p);
  p += 4;
  const attrs = [];
  for (let i = 0; i < attrCount; i++) {
    const attrName = readCString();
    const type = buf[p++];
    let value;
    switch (type) {
      case 0:
        value = readCString();
        break;
      case 1:
        value = buf[p++] !== 0;
        break;
      case 2:
        value = buf[p++];
        break;
      case 3:
        // Supervisor-verified: int16 attributes are big-endian; int32/float stay LE.
        value = buf.readInt16BE(p);
        p += 2;
        break;
      case 4:
        value = buf.readInt32LE(p);
        p += 4;
        break;
      case 5:
        value = buf.readFloatLE(p);
        p += 4;
        break;
      default:
        throw new Error(`unknown attr type ${type} for ${attrName}`);
    }
    attrs.push({ name: attrName, type, value });
  }
  const childCount = buf.readUInt32BE(p);
  p += 4;
  const children = [];
  for (let i = 0; i < childCount; i++) {
    if (depth + 1 > maxDepth) throw new Error(`max depth exceeded at ${p}`);
    const r = parseNode(buf, p, maxDepth, depth + 1);
    children.push(r.node);
    p = r.next;
  }
  return { node: { name, attrs, children, totalSize }, next: p };
}

function toXml(node, indent = "") {
  const attrs = node.attrs
    .map((a) => ` ${a.name}="${typeof a.value === "string" ? a.value : a.value}"`)
    .join("");
  const kids = node.children;
  if (!kids.length) return `${indent}<${node.name}${attrs}/>`;
  const inner = kids.map((c) => toXml(c, indent + "  ")).join("\n");
  return `${indent}<${node.name}${attrs}>\n${inner}\n${indent}</${node.name}>`;
}

export { decode, parseNode, toXml };

const isCli =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isCli) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const asJson = args.includes("--json");
  const maxDepthArg = args.indexOf("--max-depth");
  const maxDepth = maxDepthArg >= 0 ? +args[maxDepthArg + 1] : 64;
  if (!file) {
    console.error("usage: node tools/decode-brd.mjs <file.brd> [--json] [--max-depth N]");
    process.exit(2);
  }
  const raw = fs.readFileSync(file);
  const payload = decode(raw);
  const { node, next } = parseNode(payload, 0, maxDepth);
  const trailing = payload.length - next;
  if (asJson) {
    console.log(JSON.stringify({ file, decodedBytes: payload.length, trailingBytes: trailing, tree: node }, null, 2));
  } else {
    console.log(`file: ${file}`);
    console.log(`decoded: ${payload.length} bytes, trailing after root: ${trailing}`);
    console.log(toXml(node));
  }
}
