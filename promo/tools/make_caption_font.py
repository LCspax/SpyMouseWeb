from fontTools.ttLib import TTFont

FAMILY = "SpyCaption"
SUB = "Regular"
FULL = FAMILY
PS = "SpyCaption-Regular"

f = TTFont("promo/fonts/NotoSansSC-Bold.ttf")
name = f["name"]
records = []
for pid, eid, lid in [(3, 1, 0x409), (1, 0, 0)]:
    records.append((1, FAMILY, pid, eid, lid))
    records.append((2, SUB, pid, eid, lid))
    records.append((4, FULL, pid, eid, lid))
    records.append((6, PS, pid, eid, lid))
    records.append((16, FAMILY, pid, eid, lid))
    records.append((17, SUB, pid, eid, lid))

name.names = []
for nid, val, pid, eid, lid in records:
    name.setName(val, nid, pid, eid, lid)

f["OS/2"].usWeightClass = 700
f.save("promo/fonts/spy-caption-bold.ttf")
print("ok", FAMILY, len(f.getGlyphOrder()))
