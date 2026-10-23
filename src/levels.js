// Sample levels. Real levels will be imported from the original resource pack
// once it is available; the format here matches the importer's output.

export const LEVELS = [
  {
    name: "First Steps",
    rows: [
      "############",
      "#M...C.....#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#.........E#",
      "############",
    ],
    cats: [{ tile: [5, 3], angle: Math.PI / 2 }],
  },

  {
    name: "Slip By",
    rows: [
      "##############",
      "#M...........#",
      "#.....##.....#",
      "#.....##.....#",
      "#C..........C#",
      "#.....##.....#",
      "#.....##.....#",
      "#...........E#",
      "##############",
    ],
    cats: [
      { tile: [3, 4], route: [[3, 4], [10, 4]] },
      { tile: [9, 1], route: [[9, 1], [9, 7]] },
    ],
  },

  {
    name: "Courtyard",
    rows: [
      "################",
      "#M.............#",
      "#.C..##..##..C.#",
      "#....##..##....#",
      "#....##..##....#",
      "#..............#",
      "#....##..##....#",
      "#....##..##....#",
      "#.C..........C.#",
      "#.............E#",
      "################",
    ],
    cats: [
      { tile: [3, 5], route: [[3, 5], [12, 5]] },
      { tile: [8, 1], route: [[8, 1], [8, 8]] },
      { tile: [13, 5], angle: Math.PI },
    ],
  },
];
