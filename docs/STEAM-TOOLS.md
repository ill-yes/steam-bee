# Steam Tools

Open an account and use its workspace tabs: **Games & playtime**, **Inventory &
market**, **Card farming**, **Free game offers**, and **Account & safety**.
The compact account bar keeps the current connection and activity visible.
Changing tabs only changes the view. Each tool loads when opened. A Steam account
must already be connected for authenticated Community requests. Web cookies are
obtained from that existing Steam connection, kept in memory, and never sent
to the browser or saved in a configuration file.

## Free game offers

Offers are paid games temporarily discounted by 100% in the public US Steam
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

The tool opens on **Inventory**. Use **Market listings** to review existing
listings or **Pricing rules** to edit quote settings. Search stays visible;
**Filters & sort** reveals the additional controls. Active filters remain visible
as named, removable chips when collapsed, with a reset action inside the full-width form. Selection, filters and unfinished price
rules survive changes between these views. Running batch progress and its stop
action remain visible in every view.

The inventory covers Steam Community items (AppID 753, context 6), including
cards and backgrounds held as inventory items. It does not expose every game's
separate inventory. Each game has one framed section: on wide content areas its
artwork, name, totals and group selection sit to the left of the cards; on narrow
areas the game header sits above them. Cards have four aligned areas: identity
and market/trading availability, inventory and extra copies, market estimates,
then sale quantity and the visible **Preview sale** action. The remaining stock
is shown before a sale. A protected last copy or an unavailable item explains
its restriction in words. Each game retains a full-width row with the same
game column and card widths, including games with only one card. Normal page
scrolling keeps the game context and batch selection reachable; short viewports
use normal-flow headers so they cannot cover the controls.
Search by item or game, filter by game, item type,
normal/foil cards, marketability, tradability or duplicates, and choose a sort
order. Broken or unavailable artwork has a local fallback. Large inventories
are paginated.

A game can continue onto another page. Its header then shows the current page's
variant count alongside the total matching group. Group selection applies to all
filtered eligible variants for that game, including other pages. Separate assets
with the same Steam class/instance identity appear as one variant. Names and
market hashes are not used to merge inventory ownership. Variants are formed
from the full snapshot before filtering, so filtering duplicates never lowers
the actual stock shown for that variant. Normal and foil cards remain distinct.
The game summary retains its full stock and separately names filtered matches.

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

### Pricing rules

Rules are saved per account. Choose the lowest sell order or highest buy order
as the reference, add a signed buyer-price adjustment, and optionally set minimum
and maximum buyer prices. Amounts are exact integer minor units of the wallet
currency; the form accepts decimal currency amounts. Rules with custom amounts
are bound to that wallet currency. A currency change requires reviewing those
amounts again. Invalid precision and prices outside the limits are rejected;
SteamBee does not silently round or clamp them. Buyer prices include Steam and
publisher fees, which are shown separately in the preview. Saving rules never
starts a sale.

### Single and bulk actions

Sales keep at least one copy of each item. Request a preview, review quantity,
buyer price, Steam/publisher fees and your proceeds, and confirm before a listing
is submitted. Prices are obtained from Steam's order book and displayed in the
wallet currency. Single-item previews expire after one minute. The server checks current
ownership, quantity, currency, fees and pricing again on confirmation; a changed
quote requires a new preview. An offered price does not guarantee a buyer or an
immediate sale.

Active market listings can also be reviewed and cancelled through a separate
preview and confirmation. Select individual items, a game's eligible duplicates,
or filtered duplicates for a batch of up to 50 actual market actions. A grouped
variant quantity can require several separate Steam asset listings. The UI
shows selected variants, copies and action count separately, maps quantities
back to their real eligible asset IDs and never silently truncates a batch.
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

Start the account's Steam connection, review the farming settings, scan for
remaining drops, and explicitly start farming. Farming does not start on page
load or automatically resume after a restart.

**Overview** shows status, remaining drops, active games and the paginated queue.
Active games appear first, with artwork and individual drop or exclusion states.
The overview shows when Steam was last scanned for card drops, or that no scan
has completed. **Refresh** reloads the current status; **Scan card drops** checks
Steam again.
Open **Selection & settings** to change concurrency, refund protection or game
choices. An unfinished draft remains visible as a reminder on the overview and
links back to its save/discard controls. Start, scan and stop remain above both
views. Before the first badge scan, unknown drop counts display a dash.

The warming phase can report multiple games until they have approximately two
hours of playtime. The farming phase then reports one eligible game at a time
and periodically rescans its remaining drops. The game limit respects the
account's custom-title slot and configured concurrency. Drop timing and rewards
remain controlled by Steam; no completion time is guaranteed.

The visual game picker combines the imported library, badge scan and saved game
IDs. Choose the normal queue behavior, allow a game, or exclude it; exclusions win
when both lists contain the same game. A nonempty allowed list restricts the
queue to those games. Search and pagination keep large libraries manageable.
Manual AppID fields remain available under advanced settings. Saving a selection
does not start farming.

Refund protection is enabled
by default: games below two hours with an unknown purchase date are skipped.
Disabling that protection is an explicit choice and may affect refund eligibility.
Operational safety holds, pause, stop, connection loss, session conflicts and
shutdown invalidate the current run. A completed or explicitly stopped farming
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

Unfinished farming settings stay in this browser tab when switching tools or
accounts. Save them before scanning or starting, or discard them to restore
saved settings. Unfinished pricing rules are retained per account in this
browser; new sales wait until those rules are saved or discarded. Browser drafts
are separate from saved server settings. Saved settings are stored per account
in SQLite and included in the existing encrypted database backup. Live runs, Community sessions, and pending market previews are
process state and are not restored from a backup.

Card farming may violate Steam or game-service rules. Safety controls do not
make automation compliant; review the project's existing product and security
guidance before use.

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
