# Steam Tools

Open an account and use the section list beside the workspace: **Boost
playtime** and **Card farming** (Games), **Inventory**, **Market listings** and
**Pricing rules** (Items), **Free to keep** (Discover), **Presets**,
**Schedules** and **Statistics** (Automation), and **Account & safety**
(Account). The account bar keeps the connection visible and holds one activity
switch: **Nothing**, **Boost playtime** or **Farm cards**. Steam has a single
games-played list per account, so playtime boosting and card farming are
exclusive; switching asks before it stops the other activity. Changing sections only changes the view. Each tool loads when opened. A Steam account
must already be connected for authenticated Community requests. Web cookies are
obtained from that existing Steam connection, kept in memory, and never sent
to the browser or saved in a configuration file.

## Free to keep

**Free to keep** lists temporary free-game offers. Offers are paid games temporarily discounted by 100% in the public US Steam
store. Permanently free games are excluded. Availability and eligibility may
differ in the account's country; follow the store link to review and claim an
offer yourself. SteamBee does not automatically redeem it.

Import the account library for ownership filtering. Its import timestamp is
available under **Region & ownership details** because new purchases will not be
excluded until the library is refreshed. The region, last offer check and number
of excluded owned offers remain visible above the games. Offer cards link
directly to Steam; notification preferences sit below the results.
Successful empty imports also count as imported. After upgrading from a version
before migration `014_library_import_marker`, a historically empty library needs
one new import because earlier versions did not retain its import timestamp.
Existing nonempty libraries retain their recorded import time.
The shared server cache lasts ten minutes. A recent cached result can remain
visible after an upstream failure, with an explicit stale indication. No offer
expiry time is invented from the search result.

Offer notices require an explicit opt-in and an imported library. Enabling them
establishes a baseline; existing offers are not announced as new. Dashboard
notices also work when browser notifications are unavailable or blocked. System
notifications additionally require browser permission. Checks continue while
the selected account's dashboard is open, including in a background tab; they
stop when the dashboard closes. Account and browser-tab switches preserve the
opt-in and deduplicate new offers.

## Inventory and Community Market

**Inventory**, **Market listings** and **Pricing rules** share one tool, so the
basket, filters and unfinished price rules survive switching between them.
Running batch progress and its stop action remain visible in every view.

The inventory covers Steam Community items (AppID 753, context 6), including
cards and backgrounds held as inventory items. It does not expose every game's
separate inventory. Each game is shown like a Steam badge page: a header with
artwork, copies and extras, set progress (owned of total cards), badge level
and remaining card drops, followed by horizontally scrollable rows for the card
set, foil cards and other items. Missing cards of the set appear as dashed
slots. Set data comes from the account's game card page
(`GET /api/accounts/:id/inventory/card-sets/:appId`, cached for ten minutes) and
is loaded only for games on the current page, two at a time; if it fails, the
inventory still shows owned items with a retry. Search, item-type chips,
**Only extras** and sorting by name or most extras apply to the whole
inventory; ten games are shown per page. Missing slots are hidden while a
search or extras filter is active.

Separate assets with the same Steam class/instance identity appear as one
variant. Names and market hashes are not used to merge inventory ownership; the
set view matches badge cards to inventory cards by name only for display.
Normal and foil cards remain distinct.

### Automatic price estimates

Market prices load automatically for cards entering the visible viewport, in
small batches. Each card distinguishes the market reference, your buyer-facing
listing price under the saved pricing rules, and expected proceeds after fees
for the chosen quantity. Estimates use the account's wallet currency and exact
Steam fee calculations. They do not guarantee a buyer or available buy-order
volume. A final sale preview still fetches current inventory, prices and fees.

Display quotes are fresh for 60 seconds. After an upstream failure a previous
observation can remain visible, explicitly marked stale with its original price
time, for no more than five minutes. Missing prices and failed rule calculations
have explicit states; they are never displayed as zero. Offscreen cards and
hidden browser tabs do not poll. Wallet, rule, account and inventory changes
invalidate incompatible estimates. Steam throttling delays subsequent reads.

The authenticated, CSRF-protected `POST /api/accounts/:id/inventory/price-overview`
accepts up to ten canonical variant IDs from a validated recent inventory.
It is a display-only operation: it creates no sale previews, tokens, jobs or
reservations. Prices and bounded metadata caches stay in memory. A missing price
context permits one automatic inventory refresh before requiring explicit retry.

### Market listings

**Market listings** shows active listings as a compact table with the card
icon and type, buyer price, proceeds and status, filtered by status chips with
counts. Listings that still wait for a confirmation in the Steam Mobile app get
a banner with **Check now**. While such listings exist, the list refreshes every
8 seconds for up to 10 minutes (not in background tabs) and says when a listing
became active or disappeared because it sold right away or was declined.

### Pricing rules

Rules are saved per account. Start from one of three strategies: **Sell
instantly** (at the highest buy order), **Undercut the cheapest listing** or
**Match the cheapest listing**. Each shows its expected speed and
estimated proceeds. A price scale shows where the resulting price lands between
the highest buy order and the cheapest listing, with the minimum/maximum range
and fees. Values that match no strategy show as a custom rule. For fine-tuning,
choose the lowest sell order or highest buy order
as the reference, add a signed buyer-price adjustment, and optionally set minimum
and maximum buyer prices. Amounts are exact integer minor units of the wallet
currency; the form accepts decimal currency amounts. Rules with custom amounts
are bound to that wallet currency. A currency change requires reviewing those
amounts again. Invalid precision and prices outside the limits are rejected;
SteamBee does not silently round or clamp them. Buyer prices include Steam and
publisher fees, which are shown separately in the preview. Saving rules never
starts a sale.

### Sell basket

Click a card with extra copies to put all of its extras in the **Sell basket**
beside the inventory, or use **Add extras to basket** for a whole game. One copy
of each item always stays; protected and unmarketable items explain why they
cannot be added. The basket adjusts quantities per item, shows estimated buyer
totals, fees and proceeds, the number of Steam actions and their delay, and
links to the pricing rules. **Review sale** opens the existing confirmation:
a single listing uses the one-item preview, anything larger uses the batch
preview. Prices are obtained from Steam's order book and displayed in the wallet
currency. Single-item previews expire after one minute. The server checks
current ownership, quantity, currency, fees and pricing again on confirmation;
a changed quote requires a new preview. An offered price does not guarantee a
buyer or an immediate sale.

A batch holds at most 50 actual market actions. A grouped variant quantity can
require several separate Steam asset listings, so adding stops at that limit and
says so instead of silently truncating. Active market listings can also be reviewed and cancelled through a separate
preview and confirmation.
Each asset action remains limited to 100 units. Grouped sale previews and
progress retain inspectable per-asset outcomes, including partial failures.
Listing cancellations also
support selection and a batch preview. Bulk previews expire after two minutes
and list unavailable items, fees and totals before confirmation. Only eligible,
reviewed rows are queued. Each row is revalidated before submission; a changed
price is reported for that row instead of silently using a new price.

Confirmed batches run on the server with a configurable delay of 1–60 seconds
between submitted actions (10 seconds by default). Progress reports each item,
including failures and Steam confirmations. Switching tools does not stop a
batch; opening the market again recovers its active progress. **Stop remaining
actions** cancels queued work and waiting periods. Pause, stop, account removal
and server shutdown also invalidate pending work and previews. A request already
sent to Steam can still finish; completed actions cannot be undone. A batch does
not survive a server restart. An uncertain submission stops the remaining batch
and is never retried automatically.

Steam Guard, account restrictions, or mobile/email
confirmation can still require action in Steam. SteamBee does not store Steam
Guard shared secrets or approve those confirmations for you. An uncertain sale
response is reported explicitly and is not automatically retried.

Inventory and market endpoints depend on Steam Community's current response
formats. Unsupported or incomplete data blocks a sale rather than estimating
missing prices or using a partial inventory. Authenticated behavior must be
validated with an operator-owned account; fixture tests do not prove Steam will
accept a live listing.

## Card farming

Start the account's Steam connection and choose **Farm cards** in the account
bar or **Start farming** on the card farming page. Starting also works from a
manual pause or after a finished run: SteamBee clears the manual pause and
resumes the connection without replaying the saved boost games. Other safety
holds, such as **Pause until**, still block farming. Farming never starts on
page load.

The card farming page is one board with three columns: **Farming now**, **Up
next** and **Skipped** (with the reason for each skipped game). The header shows
status, remaining drops, when Steam was last checked for card drops and the
controls to find card drops, refresh, start and stop. Exclude a game or allow it
again directly on its card. The remaining rules (parallel warm-up games, refund
protection, automatic resume and the manual AppID lists) open in the **Rules**
dialog. Rule changes apply right away, also while farming is running; the
running worker picks the new selection at its next idle moment. Before the first
badge scan, unknown drop counts display a dash.

The warming phase can report multiple games until they have approximately two
hours of playtime. The farming phase then reports one eligible game at a time
and periodically rescans its remaining drops. The game limit respects the
account's custom-title slot and configured concurrency. Drop timing and rewards
remain controlled by Steam; no completion time is guaranteed.

### Farming order

**Up next** has an order menu: as on Steam's badge page (default), highest card
value first, most or fewest drops first, most playtime first, longest owned
first, or by name. The options follow ArchiSteamFarm's farming orders, plus card
value. Drag games into **Pulled forward** (or use **Pull forward** and **Move
up**) to farm them first, one at a time, in that order; **Release** returns a
game to the automatic order. Pinned games come first, then the chosen order,
then the badge page order. Order and pins are saved with the farming rules.

Card value is the average current price of a game's normal trading cards in the
account's wallet currency, read from one Steam Community Market search per game.
SteamBee looks up missing values only while this order is selected: at most 60
games per pass, 1.5 seconds apart, stopping when Steam throttles requests, and
caches each value for 24 hours. Cards show "≈ price per card" while sorting by
value. The value is an estimate for ordering only; it does not predict which
cards drop or what a sale would return.

### Excluded and allowed games

Exclusions win when a game is in both lists. A nonempty allowed list restricts
the queue to those games. Saving rules does not start farming.

### Refund protection and restarts

Refund protection is enabled by default: games below two hours are skipped
during the first 14 days after acquisition. The acquisition date comes from the
account's Steam licenses (the earliest license per game); games without a known
date are also skipped. Disabling that protection is an explicit choice and may
affect refund eligibility.

**Resume farming after a SteamBee restart** is on by default. Running farming is
remembered and starts again once the account is back online after a SteamBee
restart or a short Steam disconnect. An explicit stop, a pause and applying a
preset end farming for good; the page names the cause of each halt.
Operational safety holds, pause, stop, session conflicts and presets end the
current run. A completed or explicitly stopped farming
run pauses the account and does not resume its previous manual game selection.
The previous manual selection itself remains saved.

Card farming also accrues playtime for the games reported to Steam. Steam uses
one games-played list per connection; farming and manually chosen games are not
two independent Steam activity streams. SGI can merge both owners into that
list. SteamBee deliberately presents one explicit mode per account: starting
farming clears the manual live payload before scanning and uses the farming
queue; switching back explicitly restores the saved manual selection. Navigation
does not switch modes. Activity counts and local analytics use the games actually
reported, including farming target changes, without crediting the saved manual
selection. Session safety limits remain continuous across target changes.

Reference behavior was checked against SGI commit
[`6d37cff`](https://github.com/zevnda/steam-game-idler/blob/6d37cff351d5465ce0a172fb1f6e96855495b4f7/src-tauri/src/idling/claims.rs)
and the installed
[`steam-user` gamesPlayed API](https://github.com/DoctorMcKay/node-steam-user#gamesplayedapps-force).
SteamBee implements its own web/server workflow for those feature concepts.

Unfinished changes in the farming **Rules** dialog stay in this browser tab
when switching tools or accounts until you save or discard them. Unfinished
pricing rules are retained per account in this
browser; new sales wait until those rules are saved or discarded. Browser drafts
are separate from saved server settings. Saved settings are stored per account
in SQLite and included in the existing encrypted database backup. Live runs, Community sessions, and pending market previews are
process state and are not restored from a backup.

Card farming may violate Steam or game-service rules. Safety controls do not
make automation compliant; review the project's existing product and security
guidance before use.

## Presets, schedules and statistics

**Presets** shows each saved preset as a card with game artwork, persona, Steam
title, game count and how many schedules use it; the running preset is
highlighted. The last card saves the current selection as a new preset.

**Schedules** shows a weekly timeline with one row per weekday. Overnight
windows continue on the next day, disabled schedules are dashed and a marker
shows the current time. Each schedule has an on/off switch, its next start, and
skip and delete actions; new schedules open in a dialog. The list of upcoming
windows stays below.

**Statistics** shows what is running now, playtime today and in the last seven
days, the number of sessions, playtime per day and top games as bars, recent
sessions and playtime goals with progress bars. Daily values use the server's
local days and count the games actually reported to Steam.

## Appearance

The appearance menu offers System, Light, Dark, Midnight, Forest, and Paper
themes, plus local system, sans-serif, serif, and monospace font stacks. The
available fonts depend on the host device; no font service is contacted.
Preferences are stored in this browser, synchronize between its tabs, and are
available on mobile and desktop. Escape closes the appearance panel and returns
focus to its trigger.
There are no custom background, image URL, upload, or background-color controls.
Inventory background items are ordinary Steam items, not application backgrounds.

## Achievement editor

The feasibility assessment found that headless editing is technically possible,
but the current Steam client library has no public read/write interface for
it. No editor or achievement-write endpoint is enabled. See
[Achievement and Statistics Editor Feasibility](ACHIEVEMENT-EDITOR.md) for the
checked interfaces and requirements.
