function textOrEmpty(value) {
  return (value || "").trim();
}

function guessCardFromPage() {
  const title = textOrEmpty(document.querySelector("h1")?.textContent);
  const manaCost =
    textOrEmpty(document.querySelector("[data-card-mana-cost]")?.textContent) ||
    textOrEmpty(document.querySelector(".card-symbols, .manaCost")?.textContent);
  const typeLine =
    textOrEmpty(document.querySelector("[data-card-type]")?.textContent) ||
    textOrEmpty(document.querySelector(".type-line, .typeLine")?.textContent);
  const set =
    textOrEmpty(document.querySelector("[data-card-set]")?.textContent) ||
    textOrEmpty(document.querySelector(".set, .expansion")?.textContent);

  const name = title || document.title.replace(/\s*\|.*$/, "").trim();
  if (!name) return null;

  return {
    id: `${name}|${set || "unknown"}`,
    name,
    manaCost,
    typeLine,
    set
  };
}

async function addCurrentCardToDeck() {
  const card = guessCardFromPage();
  if (!card) return { ok: false, error: "Card data not found on this page." };

  return chrome.runtime.sendMessage({
    type: "deck/addCard",
    card
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "content/addCurrentCard") return;

  addCurrentCardToDeck()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));

  return true;
});
