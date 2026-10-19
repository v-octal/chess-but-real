built with agent duel - https://github.com/bottomless/agent-duel

# Chess Royale

Chess Royale is a browser chess game where each piece has health and weapon damage.

## Website

- Live site: [https://v-viii.com/chess-royale/](https://v-viii.com/chess-royale/) ([http://v-viii.com/chess-royale/](http://v-viii.com/chess-royale/))
- GitHub Pages URL: [https://v-octal.github.io/chess-royale/](https://v-octal.github.io/chess-royale/)

## Rules

- Each turn permits one move or one attack.
- A nonlethal attack leaves both pieces on their squares.
- A lethal attack reduces the target to zero health and captures its square.
- Attack damage decreases with distance and increases with ally support.
- Reduce the enemy king to zero health to win the game.

## Modes and Features

- Play against the computer across four difficulty levels.
- Play a local two-player game on one device.
- Play a friend online with a room code or an invite link.
- Inspect piece health, weapon stats, range falloff, and support bonuses.
- Review past turns, export games as JSON, and change board themes.

## Development

Install the dependencies:

```sh
npm ci
```

Start the local server:

```sh
npm run dev
```

Run the checks and tests:

```sh
npm run lint
npm run typecheck
npm test
```

Create a production build:

```sh
npm run build
```
