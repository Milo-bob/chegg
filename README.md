# CHEGG

Browser remake of the Minecraft minigame **CHEGG** (Chess x Egg) by Gerg: a turn-based deck-building duel on a 8x10 checkerboard (blue at the bottom, red at the top). Pure HTML/JS/canvas, no build step, no dependencies.

- Play vs. computer or local 2-player (hot seat)
- 17 minions + Villager king, rules and stats follow the public CHEGG ruleset
- Sprites (spawn eggs, tiles) come from the Unity prototype in the parent folder; the redstone lamp mana gauge uses Minecraft block textures

## Files
- `index.html` - canvas page
- `js/data.js` - minion roster (cost, move/attack patterns, abilities)
- `js/rules.js` - rules engine + computer opponent (no DOM, runs in Node too)
- `js/game.js` - rendering, input, menus
- `assets/` - egg sprites and tile textures

## Controls
Mouse/touch. Enter or Space = end turn, P = pause, Backspace = back/menu.

## Embedding
Sends `{type:'ready'}` on load and `{type:'gameOver', score}` (turn count) when a match ends.

## Online
Supabase accounts, matchmaking (queue or invite code), chess clock and leaderboard. Setup: see `../supabase/SETUP.md`; enter URL and anon key in `js/config.js`. `js/vendor/supabase.js` is supabase-js 2.118.0 (MIT).
