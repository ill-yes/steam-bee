# Achievement and Statistics Editor Feasibility

SteamBee does not currently implement an achievement or statistics editor. Such
an editor is technically possible without a desktop Steam client, but the
current `steam-user` integration does not expose the required operations. An
ordinary Steam Web API key cannot enable editing other publishers' games.

## Interfaces checked

| Interface                                                                        | What it provides                                                            | Limitation for SteamBee                                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Steam Web API `GetPlayerAchievements`, `GetSchemaForGame`, `GetUserStatsForGame` | Read achievement definitions, unlocked achievements, and numeric statistics | Requires a Web API key and access to the user's game data; this is not a write interface                         |
| Steam Web API `SetUserStatsForGame`                                              | Write statistics and achievements                                           | Valve requires the **publisher API key that owns the specified App ID**; a personal Web API key is insufficient  |
| Steamworks `ISteamUserStats`                                                     | `SetAchievement`, `ClearAchievement`, `SetStat`, and `StoreStats`           | The client API needs a running local Steam client, successful SDK initialization, and ownership of the App ID    |
| Steam client protocol (CM)                                                       | User-stat schema retrieval and stat storage messages exist                  | `steam-user@5.3.0` includes protobuf definitions but has no public achievement/stat retrieval or storage methods |

The `steam-user@5.3.0` installation was inspected for public methods and message
handlers. Its `steammessages_clientserver_userstats.proto` defines
`CMsgClientGetUserStats`, `CMsgClientGetUserStatsResponse`,
`CMsgClientStoreUserStats`, `CMsgClientStoreUserStats2`, and storage responses.
The existence of those wire definitions is not an implemented editor. It would
require a separately maintained transport and schema implementation rather than
calling an existing supported library method.

The reference application's published architecture describes a SteamKit2 agent
with achievement and statistics operations that does not require a local Steam
client. This establishes a possible headless approach, not compatibility with
SteamBee's Node.js library. Its source code was not copied into SteamBee.

## Requirements for a future implementation

An implementation needs to retrieve the current app schema and user state,
decode stat types and achievement bit fields, and preserve schema/CRC version
information when storing changes. It must handle Steam's out-of-date responses
and per-stat validation failures, then reread the state before reporting
success. A successful transport response alone cannot prove that each requested
value was accepted.

The game schema also defines who may write each value and any numeric
constraints. A future editor must enforce ownership and account scope, treat
server-controlled values as read-only, and respect increment-only, minimum,
maximum, maximum-change, and data-type rules. Game-coordinator-specific data may
need a separate game-specific integration. An editor cannot promise to change
every game's achievements or statistics.

Before exposing controls, this integration needs reproducible protocol fixtures
and an opt-in end-to-end test on an owned game with client-writable values. The
inspection performed for this change did not sign into a Steam account or alter
any achievements or statistics. There is no hidden write endpoint or UI that
claims successful edits without performing and verifying them.

## Sources

- [Valve: ISteamUserStats Web API](https://partner.steamgames.com/doc/webapi/ISteamUserStats#SetUserStatsForGame)
- [Valve: ISteamUserStats client API](https://partner.steamgames.com/doc/api/ISteamUserStats)
- [Valve: Steamworks API initialization](https://partner.steamgames.com/doc/sdk/api#SteamAPI_Init)
- [Valve: Stats and achievements, including Set By and numeric constraints](https://partner.steamgames.com/doc/features/achievements)
- [steam-user v5.3.0 documentation and public API](https://github.com/DoctorMcKay/node-steam-user/tree/v5.3.0)
- [Steam Game Idler architecture reference inspected at commit 6d37cff](https://github.com/zevnda/steam-game-idler/blob/6d37cff351d5465ce0a172fb1f6e96855495b4f7/CLAUDE.md#the-real-steamutility-contract)
