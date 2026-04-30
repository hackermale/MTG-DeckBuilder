const deckSelect = document.getElementById("deckSelect");
const newDeckBtn = document.getElementById("newDeckBtn");
const deleteDeckBtn = document.getElementById("deleteDeckBtn");
const addCurrentCardBtn = document.getElementById("addCurrentCardBtn");
const exportBtn = document.getElementById("exportBtn");
const cardList = document.getElementById("cardList");
const stats = document.getElementById("stats");
const statusEl = document.getElementById("status");
const createDeckDialog = document.getElementById("createDeckDialog");
const createDeckForm = document.getElementById("createDeckForm");
const deckNameInput = document.getElementById("deckNameInput");
const deckFormatSelect = document.getElementById("deckFormatSelect");
const cancelCreateDeckBtn = document.getElementById("cancelCreateDeckBtn");
const ALLOWED_FORMATS = ["standard", "commander", "modern", "pioneer", "historic", "alchemy"];

let state = { decks: [], activeDeckId: "" };

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#f87171" : "#a3e635";
}

function activeDeck() {
  return state.decks.find((deck) => deck.id === state.activeDeckId) || state.decks[0];
}

async function sendMessage(payload) {
  const result = await chrome.runtime.sendMessage(payload);
  if (!result?.ok) {
    throw new Error(result?.error || "Unknown extension error");
  }
  return result;
}

function computeStats(deck) {
  const totalCards = deck.cards.reduce((sum, card) => sum + Number(card.count || 0), 0);
  const uniqueCards = deck.cards.length;
  return { totalCards, uniqueCards };
}

function renderDeckSelect() {
  deckSelect.innerHTML = "";
  for (const deck of state.decks) {
    const option = document.createElement("option");
    option.value = deck.id;
    option.textContent = deck.name;
    option.selected = deck.id === state.activeDeckId;
    deckSelect.appendChild(option);
  }

  deleteDeckBtn.disabled = state.decks.length <= 1;
}

function renderStats(deck) {
  const summary = computeStats(deck);
  const format = String(deck.format || "standard");
  stats.textContent = `${summary.totalCards} total cards | ${summary.uniqueCards} unique cards | ${format}`;
}

function makeCardItem(deck, card) {
  const item = document.createElement("li");
  item.className = "card-item";

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = card.name;
  const type = document.createElement("div");
  type.className = "card-type";
  type.textContent = card.typeLine || "Unknown type";
  meta.append(name, type);

  const controls = document.createElement("div");
  controls.className = "card-controls";
  const countInput = document.createElement("input");
  countInput.className = "count-input";
  countInput.type = "number";
  countInput.min = "0";
  countInput.max = "99";
  countInput.value = String(card.count);
  countInput.addEventListener("change", async () => {
    try {
      const count = Number(countInput.value);
      const updated = await sendMessage({
        type: "deck/updateCount",
        cardId: card.id,
        count
      });
      state = { decks: updated.decks, activeDeckId: updated.activeDeckId };
      render();
      setStatus(`Updated ${card.name}`);
    } catch (error) {
      setStatus(String(error), true);
    }
  });

  controls.append(countInput);
  item.append(meta, controls);
  return item;
}

function renderCards(deck) {
  cardList.innerHTML = "";
  if (!deck.cards.length) {
    const empty = document.createElement("li");
    empty.textContent = "No cards yet. Open a card page and click Add Current Card.";
    cardList.appendChild(empty);
    return;
  }

  const sorted = deck.cards.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const card of sorted) {
    cardList.appendChild(makeCardItem(deck, card));
  }
}

function render() {
  if (!state.decks.length) return;
  const deck = activeDeck();
  renderDeckSelect();
  renderStats(deck);
  renderCards(deck);
}

async function addCurrentTabCard() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("No active tab found.", true);
    return;
  }

  const result = await chrome.tabs.sendMessage(tab.id, { type: "content/addCurrentCard" });
  if (!result?.ok) {
    throw new Error(result?.error || "Could not add card from this page.");
  }
  state = { decks: result.decks, activeDeckId: result.activeDeckId };
  render();
}

async function handleCreateDeck() {
  const name = String(deckNameInput.value || "").trim();
  if (!name) {
    throw new Error("Deck name is required.");
  }
  const format = String(deckFormatSelect.value || "").trim().toLowerCase();

  const updated = await sendMessage({ type: "deck/create", name, format });
  state = { decks: updated.decks, activeDeckId: updated.activeDeckId };
  render();
  setStatus(`Created ${name}`);
}

function openCreateDeckDialog() {
  deckNameInput.value = `Deck ${state.decks.length + 1}`;
  deckFormatSelect.value = "standard";
  createDeckDialog.showModal();
  deckNameInput.focus();
  deckNameInput.select();
}

function closeCreateDeckDialog() {
  createDeckDialog.close();
}

function initializeCreateDeckDialog() {
  deckFormatSelect.innerHTML = "";
  for (const format of ALLOWED_FORMATS) {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = format;
    deckFormatSelect.appendChild(option);
  }

  createDeckForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleCreateDeck()
      .then(() => closeCreateDeckDialog())
      .catch((error) => setStatus(String(error), true));
  });

  cancelCreateDeckBtn.addEventListener("click", () => {
    closeCreateDeckDialog();
  });
}

async function handleDeckChange() {
  const deckId = deckSelect.value;
  const updated = await sendMessage({ type: "deck/setActive", deckId });
  state = { decks: updated.decks, activeDeckId: updated.activeDeckId };
  render();
}

async function handleDeleteDeck() {
  const deck = activeDeck();
  if (!deck) return;

  const shouldDelete = window.confirm(`Delete "${deck.name}"?`);
  if (!shouldDelete) return;

  const updated = await sendMessage({ type: "deck/delete", deckId: deck.id });
  state = { decks: updated.decks, activeDeckId: updated.activeDeckId };
  render();
  setStatus(`Deleted ${deck.name}`);
}

async function handleExport() {
  const deck = activeDeck();
  const result = await sendMessage({ type: "deck/export", deckId: deck.id });
  await navigator.clipboard.writeText(result.text || "");
  setStatus(`Copied ${result.deckName} list`);
}

async function initialize() {
  try {
    const initial = await sendMessage({ type: "deck/getState" });
    state = { decks: initial.decks, activeDeckId: initial.activeDeckId };
    render();
  } catch (error) {
    setStatus(String(error), true);
  }
}

deckSelect.addEventListener("change", () => {
  handleDeckChange().catch((error) => setStatus(String(error), true));
});

newDeckBtn.addEventListener("click", () => {
  openCreateDeckDialog();
});

deleteDeckBtn.addEventListener("click", () => {
  handleDeleteDeck().catch((error) => setStatus(String(error), true));
});

addCurrentCardBtn.addEventListener("click", () => {
  addCurrentTabCard()
    .then(() => setStatus("Card added to deck"))
    .catch((error) => setStatus(String(error), true));
});

exportBtn.addEventListener("click", () => {
  handleExport().catch((error) => setStatus(String(error), true));
});

initialize();
initializeCreateDeckDialog();
