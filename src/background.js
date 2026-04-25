const STORAGE_KEY = "mtgDecks";
const ACTIVE_DECK_KEY = "activeDeckId";

function createDeck(name = "My Deck") {
  return {
    id: crypto.randomUUID(),
    name,
    cards: [],
    updatedAt: Date.now()
  };
}

async function getState() {
  const data = await chrome.storage.local.get([STORAGE_KEY, ACTIVE_DECK_KEY]);
  let decks = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  let activeDeckId = data[ACTIVE_DECK_KEY];

  if (!decks.length) {
    const starterDeck = createDeck();
    decks = [starterDeck];
    activeDeckId = starterDeck.id;
    await chrome.storage.local.set({
      [STORAGE_KEY]: decks,
      [ACTIVE_DECK_KEY]: activeDeckId
    });
  }

  if (!activeDeckId || !decks.some((deck) => deck.id === activeDeckId)) {
    activeDeckId = decks[0].id;
    await chrome.storage.local.set({ [ACTIVE_DECK_KEY]: activeDeckId });
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
  const lower = (card.typeLine || "").toLowerCase();
  return lower.includes("basic") && lower.includes("land");
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

async function handleCreateDeck(name) {
  const state = await getState();
  const deck = createDeck(name || `Deck ${state.decks.length + 1}`);
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
        return handleCreateDeck(message.name);
      case "deck/setActive":
        return handleSetActiveDeck(message.deckId);
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
