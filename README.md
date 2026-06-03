# r1 kcal

A Rabbit R1 Creation for a gamified calorie counter. It is designed for the stock rabbitOS Creations runtime: a fixed 240x282 screen, scroll-wheel events, side-button events, the R1 LLM message channel, and Creation storage.

## Run Locally

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Install On Rabbit R1

1. Deploy this folder as a static site over HTTPS.
   Good hosts: GitHub Pages, Netlify, Vercel, Cloudflare Pages.
2. Open Rabbit's QR generator from the official SDK repo:
   `https://github.com/rabbit-hmi-oss/creations-sdk/tree/main/qr`
3. Fill in:
   - Title: `r1 kcal`
   - URL: `https://qdog1342.github.io/r1-calorie-counter/`
   - Description: `A gamified calorie counter for Rabbit R1`
   - Theme color: `#FE5000`
   You can also start from `qr-payload.example.json`.
4. On the R1, open Creations, choose add via QR code, and scan the generated code.
5. Open the installed card from the bottom of the R1 card stack.

## R1 Runtime Hooks

- Scroll wheel: `scrollUp` and `scrollDown` switch between Today, Actions, and Log, clamped at top and bottom. Wheel bursts are debounced so one scroll gesture moves one page.
- Side button: `longPressStart` begins voice capture; `longPressEnd` submits the transcript.
- AI calorie estimates: `PluginMessageHandler.postMessage(... useLLM: true ...)`.
- Responses: `window.onPluginMessage`.
- Persistence: redundant saves to `window.creationStorage.plain`, `localStorage`, and cookie storage when available. The newest valid snapshot is loaded on start.
- Actions: voice food and exercise are available by scrolling down from the wheel.
- Food memory: logged foods are remembered with stable calorie estimates and included in future AI prompts.

## Current SDK Limitation

Rabbit's public Creations SDK documents text LLM messages, hardware events, storage, sensors, and standard web microphone APIs. It does not document a field for sending captured audio blobs directly to native Rabbit AI STT. This app therefore:

- Uses the native R1 LLM for calorie reasoning when text/transcript is available.
- Uses browser SpeechRecognition if available, with a tiny manual transcript fallback.
- Does not include photo logging until Rabbit exposes documented vision input for Creations.

## Multiplier Model

- Exercise credits use only part of estimated active calories: 55% light, 65% moderate, 75% vigorous.
- Fasting creates focus multipliers at 12h, 16h, and 18h rather than adding calories.
- Exercise and fasting are the only displayed multipliers.
