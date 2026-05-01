const STORAGE_KEY = "mtgDecks";
const ACTIVE_DECK_KEY = "activeDeckId";
const ALLOWED_FORMATS = ["standard", "commander", "modern", "pioneer", "historic", "alchemy"];

function normalizeDeckFormat(format) {
  const normalized = String(format || "standard").trim().toLowerCase();
  return ALLOWED_FORMATS.includes(normalized) ? normalized : "standard";
}

function createDeck(name = "My Deck", format = "standard") {
  return {
    id: crypto.randomUUID(),
    name,
    format: normalizeDeckFormat(format),
    cards: [],
    updatedAt: Date.now()
  };
}

async function getState() {
  const data = await chrome.storage.local.get([STORAGE_KEY, ACTIVE_DECK_KEY]);
  let decks = Array.isArray(data[STORAGE_KEY])
    ? data[STORAGE_KEY].map((deck) => ({
        ...deck,
        format: normalizeDeckFormat(deck.format)
      }))
    : [];
  let activeDeckId = data[ACTIVE_DECK_KEY];
  let shouldPersist = false;

  if (!decks.length) {
    const starterDeck = createDeck();
    decks = [starterDeck];
    activeDeckId = starterDeck.id;
    shouldPersist = true;
  }

  if (!activeDeckId || !decks.some((deck) => deck.id === activeDeckId)) {
    activeDeckId = decks[0].id;
    shouldPersist = true;
  }

  if (shouldPersist) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: decks,
      [ACTIVE_DECK_KEY]: activeDeckId
    });
  }

  return { decks, activeDeckId };
}

async function saveState({ decks, activeDeckId }) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: decks,
    [ACTIVE_DECK_KEY]: activeDeckId
  });
}

function normalizeCard(card) {
  return {
    id: String(card.id || `${card.name}|${card.set || "unknown"}`),
    name: String(card.name || "Unknown Card"),
    manaCost: String(card.manaCost || ""),
    typeLine: String(card.typeLine || ""),
    set: String(card.set || ""),
    count: Number(card.count || 1)
  };
}

function isBasicLand(card) {
  const lowerTypeLine = (card.typeLine || "").toLowerCase();
  if (lowerTypeLine.includes("basic") && lowerTypeLine.includes("land")) {
    return true;
  }

  const normalizedName = String(card.name || "")
    .trim()
    .toLowerCase();
  const basicLandNames = new Set([
    "plains",
    "island",
    "swamp",
    "mountain",
    "forest",
    "wastes",
    "snow-covered plains",
    "snow-covered island",
    "snow-covered swamp",
    "snow-covered mountain",
    "snow-covered forest",
    "snow-covered wastes"
  ]);

  return basicLandNames.has(normalizedName);
}

function addCardToDeck(deck, card) {
  const normalized = normalizeCard(card);
  const existing = deck.cards.find((c) => c.id === normalized.id);
  const maxCount = isBasicLand(normalized) ? Number.POSITIVE_INFINITY : 4;

  if (!existing) {
    deck.cards.push({ ...normalized, count: 1 });
  } else {
    existing.count = Math.min(existing.count + 1, maxCount);
  }
  deck.updatedAt = Date.now();
}

function updateCardCount(deck, cardId, nextCount) {
  const target = deck.cards.find((c) => c.id === cardId);
  if (!target) return;

  if (nextCount <= 0) {
    deck.cards = deck.cards.filter((c) => c.id !== cardId);
    deck.updatedAt = Date.now();
    return;
  }

  const maxCount = isBasicLand(target) ? Number.POSITIVE_INFINITY : 4;
  target.count = Math.min(Math.max(1, nextCount), maxCount);
  deck.updatedAt = Date.now();
}

async function handleGetState() {
  return getState();
}

async function handleCreateDeck(name, format) {
  const state = await getState();
  const deck = createDeck(name || `Deck ${state.decks.length + 1}`, format);
  state.decks.unshift(deck);
  state.activeDeckId = deck.id;
  await saveState(state);
  return state;
}

async function handleSetActiveDeck(deckId) {
  const state = await getState();
  if (state.decks.some((d) => d.id === deckId)) {
    state.activeDeckId = deckId;
    await saveState(state);
  }
  return state;
}

async function handleDeleteDeck(deckId) {
  const state = await getState();
  const remainingDecks = state.decks.filter((deck) => deck.id !== deckId);

  if (remainingDecks.length === state.decks.length) {
    return state;
  }

  if (!remainingDecks.length) {
    const starterDeck = createDeck();
    state.decks = [starterDeck];
    state.activeDeckId = starterDeck.id;
    await saveState(state);
    return state;
  }

  state.decks = remainingDecks;
  if (state.activeDeckId === deckId) {
    state.activeDeckId = remainingDecks[0].id;
  }
  await saveState(state);
  return state;
}

async function handleAddCard(card) {
  const state = await getState();
  const activeDeck = state.decks.find((d) => d.id === state.activeDeckId);
  if (activeDeck) {
    addCardToDeck(activeDeck, card);
    await saveState(state);
  }
  return state;
}

async function handleUpdateCount(cardId, count) {
  const state = await getState();
  const activeDeck = state.decks.find((d) => d.id === state.activeDeckId);
  if (activeDeck) {
    updateCardCount(activeDeck, cardId, Number(count));
    await saveState(state);
  }
  return state;
}

async function handleExportDeck(deckId) {
  const state = await getState();
  const deck = state.decks.find((d) => d.id === deckId) || state.decks[0];
  const lines = deck.cards
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((card) => `${card.count} ${card.name}`);

  return {
    deckName: deck.name,
    text: lines.join("\n")
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  await getState();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "deck/getState":
        return handleGetState();
      case "deck/create":
        return handleCreateDeck(message.name, message.format);
      case "deck/setActive":
        return handleSetActiveDeck(message.deckId);
      case "deck/delete":
        return handleDeleteDeck(message.deckId);
      case "deck/addCard":
        return handleAddCard(message.card);
      case "deck/updateCount":
        return handleUpdateCount(message.cardId, message.count);
      case "deck/export":
        return handleExportDeck(message.deckId);
      default:
        return { error: "Unknown message type" };
    }
  };

  run()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));

  return true;
});
