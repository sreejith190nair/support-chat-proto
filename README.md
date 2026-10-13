# Live support chat · prototype

A clickable prototype of the 4ROOMS hotel ↔ admin live support chat described in
`chat_support.md` (in the 4rooms-pms-and-4rooms-admin repo). It is a design and
flow aid only: everything runs in the browser tab's memory, with no backend, no
database and no real Reverb. Reloading the page resets it.

None of this code carries over to the real product, which is Laravel Blade with
DashLite/jQuery on the hotel side and vanilla JS on the admin panel. What carries
over is the screens, the flow and the rules.

## Run it

```bash
npm install     # once
npm run dev     # http://localhost:3000
```

## What's on screen

- **Left: the hotel PMS** (Priya, Acme Hotel) with the floating Help widget.
- **Right: the 4ROOMS admin panel** live-chat workspace: queue, conversation, context.
- **Bottom: the Inspector.** Every click shows what the server would do:
  - `CONTROL PLANE DB` / `TENANT DB`: which database each write goes to
  - `REVERB` / `AUTH` / `DROPPED`: socket nudges (ids only, never message text)
  - `HTTP`: the request each side makes, including the fetch after a nudge
  - `EMAIL` / `PUSH` / `SWEEP`: notifications and the every-minute sweep

Each side keeps its own copy of the data and only refreshes when it receives a
Reverb nudge, polls, or does something itself, as the real clients would.

## Things to try

1. **Happy path.** Help → Channels → "Wrong rate…" → pick a booking → Still need
   help → Start chat. In the admin, it lands under **For you** (Asha manages
   Acme). Type `/` for canned replies, send, add an 🟨 internal note, then Resolve.
2. **Did this fix it?** On the hotel side, answer "No, still need help": a new
   follow-up chat starts with the same topic, higher priority, back to the same agent.
3. **Claim race.** Open a waiting chat as Asha and click "Simulate: Ravi claims
   first". Asha's pane turns read-only with "Transfer to me".
4. **Reverb down.** Toggle it in the top bar: nudges are dropped and both sides
   fall back to polling (watch the HTTP filter).
5. **Missed chat.** Set "Missed after" to 20 s, start a chat and don't answer it.
6. **Offline.** Untick "Within support hours", or set every agent to Away, or
   Pause the queue: the widget routes to a ticket instead.
7. **Incoming chat.** "+ Incoming chat (Blue Bay)" starts a chat from another
   hotel whose user replies by script.
8. **GDPR bits.** Type a card number (e.g. 4111 1111 1111 1111) in the hotel
   composer: it's blocked. In the admin, hover a hotel message → Redact.
9. **Idle.** After an agent reply, leave the hotel silent for 60 s: "Are you
   still there?", then auto-close.

Demo timers are shortened (nudge email 30 s, push 10 s, idle 60 s + 45 s).

## Layout

- `lib/store.ts`: the fake server (services, Reverb bus, sweep, log)
- `lib/types.ts`: shapes mirroring the planned `support_chats` tables
- `lib/catalog.ts`: topics, articles, canned replies, resolution codes
- `components/HotelSide.tsx`, `components/AdminSide.tsx`, `components/Inspector.tsx`
