#!/usr/bin/env python3
"""Thin capstone wrapper for libSpyMouse.so (Thumb-2, vaddr == file offset).

Usage:
  python tools/disasm.py --start 0x86000 --end 0x86200
  python tools/disasm.py --find-float 0.4
  python tools/disasm.py --find-imm 0x3ecccccd
  python tools/disasm.py --calls-to 0x916e0
"""
import argparse
import struct
import sys

import capstone

SO = "libSpyMouse.so"
BASE = 0x0C400000


def load():
    with open(SO, "rb") as fh:
        return fh.read()


MODE = capstone.CS_MODE_ARM


def disasm(data, start, end):
    md = capstone.Cs(capstone.CS_ARCH_ARM, MODE)
    md.detail = True
    md.skipdata = True
    code = data[start:end]
    for ins in md.disasm(code, BASE + start):
        off = ins.address - BASE
        print(f"{off:08x}  {ins.mnemonic:<10} {ins.op_str}")


def find_float(data, value):
    target = struct.pack("<f", value)
    i = 0
    hits = []
    while True:
        i = data.find(target, i)
        if i < 0:
            break
        hits.append(i)
        i += 1
    return hits


def find_imm(data, imm):
    target = struct.pack("<I", imm)
    i = 0
    hits = []
    while True:
        i = data.find(target, i)
        if i < 0:
            break
        hits.append(i)
        i += 1
    return hits


def calls_to(data, target):
    """List BL/BLX instructions whose resolved target equals `target`."""
    md = capstone.Cs(capstone.CS_ARCH_ARM, MODE)
    md.detail = True
    out = []
    for ins in md.disasm(data, BASE):
        if ins.mnemonic in ("bl", "blx") and ins.operands:
            op = ins.operands[0]
            if op.type == capstone.arm.ARM_OP_IMM:
                if (op.imm - BASE) == target:
                    out.append(ins.address - BASE)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=lambda s: int(s, 0))
    ap.add_argument("--end", type=lambda s: int(s, 0))
    ap.add_argument("--find-float", type=float)
    ap.add_argument("--find-imm", type=lambda s: int(s, 0))
    ap.add_argument("--calls-to", type=lambda s: int(s, 0))
    ap.add_argument("--limit", type=int, default=40)
    args = ap.parse_args()
    data = load()
    if args.start is not None and args.end is not None:
        disasm(data, args.start, args.end)
    if args.find_float is not None:
        hits = find_float(data, args.find_float)
        print(f"float {args.find_float}: {len(hits)} hits")
        for h in hits[: args.limit]:
            print(f"  {h:08x}")
    if args.find_imm is not None:
        hits = find_imm(data, args.find_imm)
        print(f"imm 0x{args.find_imm:x}: {len(hits)} hits")
        for h in hits[: args.limit]:
            print(f"  {h:08x}")
    if args.calls_to is not None:
        hits = calls_to(data, args.calls_to)
        print(f"calls to 0x{args.calls_to:x}: {len(hits)}")
        for h in hits[: args.limit]:
            print(f"  {h:08x}")


if __name__ == "__main__":
    sys.exit(main())
