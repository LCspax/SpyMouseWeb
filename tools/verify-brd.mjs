// Verifies the .brd binary-XML decoder against the plaintext .xml twins:
// per-attribute and per-subtree comparison, plus corrupted-input boundaries.
// Read-only. Usage: node tools/verify-brd.mjs
import fs from "node:fs";
import path from "node:path";
import { decode, parseNode } from "./decode-brd.mjs";

const RES = path.join("com.ea.spymouse_row", "files", "res");

function parseXml(text) {
  let s = text.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[\s\S]*?>/g, "");
  let i = 0;
  const fail = (msg) => {
    throw new Error(`${msg} at ${i}`);
  };
  function parseElement() {
    if (s[i] !== "<") fail("expected <");
    i++;
    const nm = /^([A-Za-z_][\w:.-]*)/.exec(s.slice(i));
    if (!nm) fail("expected tag name");
    const name = nm[1];
    i += name.length;
    const attrs = [];
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith("/>", i)) {
        i += 2;
        return { name, attrs, children: [] };
      }
      if (s[i] === ">") {
        i++;
        break;
      }
      const am = /^([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|([^\s/>]+))/.exec(s.slice(i));
      if (!am) fail("expected attribute");
      attrs.push({ name: am[1], value: am[2] !== undefined ? am[2] : am[3] });
      i += am[0].length;
    }
    const children = [];
    for (;;) {
      if (s.startsWith("</", i)) {
        const cm = /^<\/([A-Za-z_][\w:.-]*)\s*>/.exec(s.slice(i));
        if (!cm) fail("expected closing tag");
        if (cm[1] !== name) fail(`mismatched closing tag ${cm[1]} for ${name}`);
        i += cm[0].length;
        return { name, attrs, children };
      }
      if (s[i] === "<") {
        children.push(parseElement());
        continue;
      }
      const next = s.indexOf("<", i);
      if (next < 0) fail("unterminated element");
      i = next;
    }
  }
  while (i < s.length && s[i] !== "<") i++;
  return parseElement();
}

function valueMatches(xmlValue, decodedValue) {
  const dv = decodedValue;
  if (typeof dv === "boolean") return String(dv) === xmlValue;
  if (typeof dv === "number") {
    const xv = parseFloat(xmlValue);
    if (!Number.isNaN(xv)) {
      if (Math.abs(xv - dv) < 1e-4) return true;
      // binary values may be stored as unsigned while the XML is signed
      for (const mod of [256, 65536, 4294967296]) {
        if (Math.abs(dv - mod - xv) < 1e-4) return true;
        if (Math.abs(dv + mod - xv) < 1e-4) return true;
      }
      return false;
    }
    return String(dv) === xmlValue;
  }
  return String(dv) === xmlValue;
}

function compareNodes(xmlNode, decNode, pathStr, mismatches) {
  if (xmlNode.name !== decNode.name) {
    mismatches.push({ path: pathStr, kind: "tag", xml: xmlNode.name, decoded: decNode.name });
    return;
  }
  const xmlAttrs = new Map(xmlNode.attrs.map((a) => [a.name, a.value]));
  const decAttrs = new Map(decNode.attrs.map((a) => [a.name, a.value]));
  for (const [k, v] of xmlAttrs) {
    if (!decAttrs.has(k)) mismatches.push({ path: `${pathStr}/${xmlNode.name}`, kind: "missing-attr", attr: k });
    else if (!valueMatches(v, decAttrs.get(k)))
      mismatches.push({ path: `${pathStr}/${xmlNode.name}`, kind: "attr-value", attr: k, xml: v, decoded: decAttrs.get(k) });
  }
  for (const k of decAttrs.keys()) {
    if (!xmlAttrs.has(k)) mismatches.push({ path: `${pathStr}/${xmlNode.name}`, kind: "extra-attr", attr: k, decoded: decAttrs.get(k) });
  }
  if (xmlNode.children.length !== decNode.children.length) {
    mismatches.push({
      path: `${pathStr}/${xmlNode.name}`,
      kind: "child-count",
      xml: xmlNode.children.length,
      decoded: decNode.children.length,
    });
    return;
  }
  for (let i = 0; i < xmlNode.children.length; i++) {
    compareNodes(xmlNode.children[i], decNode.children[i], `${pathStr}/${xmlNode.name}`, mismatches);
  }
}

function findBrd(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) findBrd(p, out);
    else if (entry.name.endsWith(".brd")) out.push(p);
  }
  return out;
}

const files = findBrd(RES);
const report = { files: files.length, matched: 0, mismatched: [], errors: [], corrupted: [] };
for (const file of files) {
  const twin = file.slice(0, -4);
  if (!fs.existsSync(twin)) continue;
  try {
    const raw = fs.readFileSync(file);
    const payload = decode(raw);
    const { node } = parseNode(payload, 0, 128);
    const decRoot = node.children[0];
    const xmlRoot = parseXml(fs.readFileSync(twin, "utf8"));
    const mismatches = [];
    compareNodes(xmlRoot, decRoot, "", mismatches);
    if (mismatches.length) {
      report.mismatched.push({ file, count: mismatches.length, first: mismatches.slice(0, 5) });
    } else {
      report.matched++;
    }
  } catch (e) {
    report.errors.push({ file, error: String(e.message || e) });
  }
}

// corrupted-input boundaries: every case must throw, not crash
function expectThrow(name, fn) {
  try {
    fn();
    report.corrupted.push({ name, expected: "throw", actual: "no error" });
  } catch (e) {
    report.corrupted.push({ name, expected: "throw", actual: "threw", message: String(e.message || e) });
  }
}
const samplePath = files.find((f) => f.endsWith("amb_schemes.xml.brd")) || files[0];
const sample = samplePath ? fs.readFileSync(samplePath) : Buffer.from([0x7b, 0x02, 0x00]);
expectThrow("empty", () => decode(Buffer.alloc(0)));
expectThrow("one-byte", () => decode(Buffer.from([0x7b])));
expectThrow("wrong-magic", () => decode(Buffer.concat([Buffer.from([0x00, 0x02]), sample.subarray(2)])));
expectThrow("wrong-version", () => decode(Buffer.concat([Buffer.from([0x7b, 0x03]), sample.subarray(2)])));
expectThrow("bad-checksum", () => {
  const b = Buffer.from(sample);
  b[b.length - 1] ^= 0xff;
  decode(b);
});
expectThrow("truncated", () => decode(sample.subarray(0, Math.max(3, sample.length - 8))));
expectThrow("random", () => decode(Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37) & 0xff))));

const corruptedOk = report.corrupted.every((c) => c.actual === "threw");
report.corruptedBoundaryOk = corruptedOk;
console.log(JSON.stringify(report, null, 2));
