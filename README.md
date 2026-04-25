# MTG Deck Extension Starter

Starter browser extension (Manifest V3) for building Magic: The Gathering decks while browsing card database pages.

## Features Included

- Create and switch between local decks
- Add current page card to the active deck via content script
- Track card counts with normal 4-copy cap (basic lands are unlimited)
- Export deck list to clipboard (`<count> <card name>` format)

## Project Structure

- `manifest.json` - extension manifest
- `src/background.js` - storage and deck message handlers
- `src/content/content.js` - basic page card data extraction + add action
- `src/popup/popup.html` - popup UI shell
- `src/popup/popup.css` - popup styling
- `src/popup/popup.js` - popup behavior and rendering

## Load in Browser (Chrome/Edge)

1. Open extension management page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `mtg-deck-extension`

## Notes

- The content script uses generic selectors and is intentionally conservative.
- You may need to adjust selectors in `src/content/content.js` to match the exact MTG site pages you want to support.
