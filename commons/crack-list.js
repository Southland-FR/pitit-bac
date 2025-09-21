const listCards = require("./data/crack-list-lists.json");

const LETTER_DISTRIBUTION = [
  { letter: "A", count: 3 },
  { letter: "B", count: 3 },
  { letter: "C", count: 3 },
  { letter: "D", count: 3 },
  { letter: "E", count: 3 },
  { letter: "F", count: 2 },
  { letter: "G", count: 2 },
  { letter: "H", count: 3 },
  { letter: "I", count: 2 },
  { letter: "J", count: 2 },
  { letter: "K", count: 2 },
  { letter: "L", count: 3 },
  { letter: "M", count: 3 },
  { letter: "N", count: 3 },
  { letter: "O", count: 3 },
  { letter: "P", count: 3 },
  { letter: "Q", count: 1 },
  { letter: "R", count: 3 },
  { letter: "S", count: 3 },
  { letter: "T", count: 3 },
  { letter: "U", count: 2 },
  { letter: "V", count: 2 },
  { letter: "W", count: 1 },
  { letter: "X", count: 1 },
  { letter: "Y", count: 1 },
  { letter: "Z", count: 1 }
];

const ACTION_DISTRIBUTION = [
  { action: "SWITCH", count: 4 },
  { action: "STOP", count: 4 },
  { action: "SWAP", count: 4 },
  { action: "CRACK_LIST", count: 5 }
];

const PENALTY_MAPPING = {
  plus3: new Set(["Q", "X"]),
  plus2: new Set(["I", "J", "K", "W", "Y", "Z"]),
  plus1: new Set(["E", "H", "O", "U"])
};

function weightedShuffle(items, randomFn = Math.random) {
  const array = items.slice();
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function generateId(prefix, randomFn = Math.random) {
  const randomPart = Math.floor(randomFn() * 1e9).toString(16);
  const timePart = Date.now().toString(36);
  return `${prefix}-${timePart}-${randomPart}`;
}

function buildLetterCards(randomFn) {
  const cards = [];
  LETTER_DISTRIBUTION.forEach(({ letter, count }) => {
    for (let i = 0; i < count; i++) {
      cards.push({
        id: generateId("letter", randomFn),
        type: "LETTER",
        letter,
        penalty: getPenalty(letter)
      });
    }
  });
  return cards;
}

function buildActionCards(randomFn) {
  const cards = [];
  ACTION_DISTRIBUTION.forEach(({ action, count }) => {
    for (let i = 0; i < count; i++) {
      cards.push({
        id: generateId("action", randomFn),
        type: "ACTION",
        action
      });
    }
  });
  return cards;
}

function buildListCards(randomFn) {
  return listCards.map(options => ({
    id: generateId("list", randomFn),
    type: "LIST",
    options: options.slice()
  }));
}

function getPenalty(letter) {
  if (PENALTY_MAPPING.plus3.has(letter)) return 3;
  if (PENALTY_MAPPING.plus2.has(letter)) return 2;
  if (PENALTY_MAPPING.plus1.has(letter)) return 1;
  return 0;
}

function createRedDeck(randomFn = Math.random) {
  return weightedShuffle(
    [...buildLetterCards(randomFn), ...buildActionCards(randomFn)],
    randomFn
  );
}

function createBlueDeck(randomFn = Math.random) {
  return weightedShuffle(buildListCards(randomFn), randomFn);
}

function drawCards(deck, count) {
  const drawn = deck.slice(0, count);
  const remaining = deck.slice(count);
  return { drawn, remaining };
}

function ensureDeck(deck, discard, randomFn = Math.random) {
  if (deck.length > 0 || discard.length === 0) {
    return weightedShuffle(deck, randomFn);
  }

  const recycled = weightedShuffle(discard, randomFn);
  discard.splice(0, discard.length);
  return recycled;
}

module.exports = {
  createRedDeck,
  createBlueDeck,
  drawCards,
  ensureDeck,
  getPenalty,
  LETTER_DISTRIBUTION,
  ACTION_DISTRIBUTION,
  PENALTY_MAPPING
};
