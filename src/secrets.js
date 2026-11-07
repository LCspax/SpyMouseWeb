// Wall-crack entrances to the native hidden levels.
//
// Evidence:
// - level_data.xml marks the hidden levels and their parent uid:
//   3-H1 (map584) by1=26 -> 3-2 map724
//   3-H2 (map522) by1=33 -> 3-8 map709
//   5-H1 (map756) by1=48 -> 5-2 map525
// - The parent map backgrounds contain the painted branching crack that the
//   native game exposes as a secret wall (the crack is part of the level art,
//   not a separate MBN object); the player pushes through it.
//
// The crack point is the decal in level coordinates; trigger/return is the
// open-floor point beside it. Return positions are intentionally specific:
// after clearing the hidden level the hero emerges at that exact point, not at
// the parent level start.
export const SECRET_CRACKS = {
  // 1-7 (map98). `level_data.xml` authors no secret child for uid 7 and 1-S
  // (map798, uid 111) is `by1=-1`, so nothing on the map screen unlocks it.
  // The parent background nevertheless paints a crack at the end of the
  // right-hand corridor (level px ~926,452), which is what the player sees and
  // pushes against. The port wires that painted crack to the chapter's secret
  // level: WEB-COMPATIBLE - the art is authored, the doorway is not.
  map98: [{
    id: '1-S-crack',
    x: 926, y: 452,
    trigger: { x: 904, y: 456 },
    returnTo: { x: 904, y: 456 },
    target: 'map798',
  }],
  map724: [{
    id: '3-H1-crack',
    x: 430, y: 300,
    trigger: { x: 455, y: 300 },
    returnTo: { x: 455, y: 300 },
    target: 'map584',
  }],
  map709: [{
    id: '3-H2-crack',
    x: 760, y: 432,
    trigger: { x: 730, y: 432 },
    returnTo: { x: 730, y: 432 },
    target: 'map522',
  }],
  map525: [{
    id: '5-H1-crack',
    x: 103, y: 302,
    trigger: { x: 132, y: 302 },
    returnTo: { x: 132, y: 302 },
    target: 'map756',
  }],
};
