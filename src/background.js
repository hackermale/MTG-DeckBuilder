const STORAGE_KEY = "mtgDecks";
const ACTIVE_DECK_KEY = "activeDeckId";
const ALLOWED_FORMATS = ["standard", "commander", "modern", "pioneer", "historic", "alchemy"];
const SCRYFALL_API_BASE = "https://api.scryfall.com";
const COMMANDER_DECK_SIZE = 100;
const scryfallCardCache = new Map();

function normalizeDeckFormat(format) {
  const normalized = String(format || "standard").trim().toLowerCase();
  return ALLOWED_FORMATS.includes(normalized) ? normalized : "standard";
}

function createDeck(name = "My Deck", format = "standard") {
  const normalizedFormat = normalizeDeckFormat(format);
  const deck = {
    id: crypto.randomUUID(),
    name,
    format: normalizedFormat,
    cards: [],
    updatedAt: Date.now()
  };
  if (normalizedFormat === "commander") {
    deck.commanderCardId = null;
    deck.commanderColorIdentity = null;
  }
  return deck;
}

async function getState() {
  const data = await chrome.storage.local.get([STORAGE_KEY, ACTIVE_DECK_KEY]);
  let decks = Array.isArray(data[STORAGE_KEY])
    ? data[STORAGE_KEY].map((deck) => {
        const format = normalizeDeckFormat(deck.format);
        const next = { ...deck, format };
        if (format === "commander") {
          next.commanderCardId = deck.commanderCardId ?? null;
          next.commanderColorIdentity = Array.isArray(deck.commanderColorIdentity)
            ? deck.commanderColorIdentity
            : null;
        }
        return next;
      })
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

function normalizeLegalityStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isLegalStatus(status) {
  const normalized = normalizeLegalityStatus(status);
  return normalized === "legal";
}

function legalityCacheKey(card) {
  return `${String(card.name || "").trim().toLowerCase()}|${String(card.set || "").trim().toLowerCase()}`;
}

async function fetchScryfallCard(card) {
  const name = String(card.name || "").trim();
  if (!name) return null;

  const set = String(card.set || "").trim().toLowerCase();
  const exactPath = `${SCRYFALL_API_BASE}/cards/named?exact=${encodeURIComponent(name)}`;
  const withSetPath = set ? `${exactPath}&set=${encodeURIComponent(set)}` : exactPath;
  const urls = set ? [withSetPath, exactPath] : [exactPath];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      if (data?.object === "card") {
        return data;
      }
    } catch (_error) {
      continue;
    }
  }

  return null;
}

async function getScryfallCard(card) {
  const key = legalityCacheKey(card);
  if (scryfallCardCache.has(key)) {
    return scryfallCardCache.get(key);
  }

  const data = await fetchScryfallCard(card);
  scryfallCardCache.set(key, data);
  return data;
}

async function getCardLegalities(card) {
  const data = await getScryfallCard(card);
  return data?.legalities || null;
}

async function ensureCardLegalInFormat(card, format) {
  const normalizedFormat = normalizeDeckFormat(format);
  const legalities = await getCardLegalities(card);

  if (!legalities) {
    throw new Error(`Could not verify legality for ${card.name} in ${normalizedFormat}.`);
  }

  const status = legalities[normalizedFormat];
  if (!isLegalStatus(status)) {
    throw new Error(`${card.name} is not legal in ${normalizedFormat}.`);
  }
}

function isValidCommanderCandidate(typeLine) {
  const t = String(typeLine || "").toLowerCase();
  if (!t.includes("legendary")) return false;
  return t.includes("creature") || t.includes("planeswalker");
}

function isColorIdentitySubset(cardIdentity, commanderIdentity) {
  const allowed = new Set(commanderIdentity || []);
  for (const color of cardIdentity || []) {
    if (!allowed.has(color)) {
      return false;
    }
  }
  return true;
}

function deckCardTotal(deck) {
  return deck.cards.reduce((sum, c) => sum + Number(c.count || 0), 0);
}

function maxCopiesForDeck(deck) {
  return normalizeDeckFormat(deck.format) === "commander" ? 1 : 4;
}

async function reconcileCommanderState(deck) {
  if (normalizeDeckFormat(deck.format) !== "commander") return;

  if (deck.commanderCardId) {
    const stillThere = deck.cards.some((c) => c.id === deck.commanderCardId);
    if (stillThere) {
      return;
    }
    deck.commanderCardId = null;
    deck.commanderColorIdentity = null;
  }

  if (!deck.cards.length) return;

  for (const c of deck.cards) {
    const sf = await getScryfallCard(c);
    const line = sf?.type_line || c.typeLine;
    if (sf && isValidCommanderCandidate(line)) {
      deck.commanderCardId = c.id;
      deck.commanderColorIdentity = sf.color_identity || [];
      deck.updatedAt = Date.now();
      return;
    }
  }
}

async function validateCommanderCardAdd(deck, normalizedCard, scryfallCard) {
  await reconcileCommanderState(deck);

  const typeLine = scryfallCard?.type_line || normalizedCard.typeLine;
  const cardIdentity = scryfallCard?.color_identity || [];

  if (!deck.commanderCardId) {
    if (deck.cards.length > 0) {
      throw new Error(
        "This Commander deck needs a legendary creature or planeswalker as commander. Remove cards until the first add can be your commander, or start a new Commander deck."
      );
    }
    if (!isValidCommanderCandidate(typeLine)) {
      throw new Error(
        "Choose a legendary creature or planeswalker as your commander before adding other cards."
      );
    }
    return;
  }

  if (deckCardTotal(deck) >= COMMANDER_DECK_SIZE) {
    throw new Error(`Commander decks are limited to ${COMMANDER_DECK_SIZE} cards.`);
  }

  if (!isColorIdentitySubset(cardIdentity, deck.commanderColorIdentity)) {
    throw new Error(`${normalizedCard.name} is outside your commander's color identity.`);
  }
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
  const maxNonBasic = maxCopiesForDeck(deck);
  const maxCount = isBasicLand(normalized) ? Number.POSITIVE_INFINITY : maxNonBasic;

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
    if (normalizeDeckFormat(deck.format) === "commander" && deck.commanderCardId === cardId) {
      deck.commanderCardId = null;
      deck.commanderColorIdentity = null;
    }
    deck.updatedAt = Date.now();
    return;
  }

  const maxNonBasic = maxCopiesForDeck(deck);
  const maxCount = isBasicLand(target) ? Number.POSITIVE_INFINITY : maxNonBasic;
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
    const normalizedCard = normalizeCard(card);
    const scryfallCard = await getScryfallCard(normalizedCard);
    if (!scryfallCard?.legalities) {
      throw new Error(`Could not verify card data for ${normalizedCard.name}.`);
    }
    await ensureCardLegalInFormat(normalizedCard, activeDeck.format);

    if (normalizeDeckFormat(activeDeck.format) === "commander") {
      await validateCommanderCardAdd(activeDeck, normalizedCard, scryfallCard);
    }

    addCardToDeck(activeDeck, normalizedCard);

    if (normalizeDeckFormat(activeDeck.format) === "commander" && !activeDeck.commanderCardId) {
      const line = scryfallCard.type_line || normalizedCard.typeLine;
      if (isValidCommanderCandidate(line)) {
        activeDeck.commanderCardId = normalizedCard.id;
        activeDeck.commanderColorIdentity = scryfallCard.color_identity || [];
      }
    }

    await saveState(state);
  }
  return state;
}

async function handleUpdateCount(cardId, count) {
  const state = await getState();
  const activeDeck = state.decks.find((d) => d.id === state.activeDeckId);
  if (activeDeck) {
    const nextCount = Number(count);
    if (normalizeDeckFormat(activeDeck.format) === "commander") {
      await reconcileCommanderState(activeDeck);
    }
    const target = activeDeck.cards.find((c) => c.id === cardId);

    if (target && nextCount > 0 && normalizeDeckFormat(activeDeck.format) === "commander") {
      const sf = await getScryfallCard(target);
      if (!sf) {
        throw new Error(`Could not verify card data for ${target.name}.`);
      }
      const currentTotal = deckCardTotal(activeDeck);
      const delta = nextCount - Number(target.count || 0);
      if (delta > 0 && currentTotal + delta > COMMANDER_DECK_SIZE) {
        throw new Error(`Commander decks are limited to ${COMMANDER_DECK_SIZE} cards.`);
      }
      if (activeDeck.commanderCardId && cardId !== activeDeck.commanderCardId) {
        const cardIdentity = sf.color_identity || [];
        if (!isColorIdentitySubset(cardIdentity, activeDeck.commanderColorIdentity)) {
          throw new Error(`${target.name} is outside your commander's color identity.`);
        }
      }
    }

    updateCardCount(activeDeck, cardId, nextCount);
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
