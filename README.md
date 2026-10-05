# Cricket Mini Games

## Run locally

```sh
npm start
```

The server uses Railway's `PORT` environment variable when available and listens on `0.0.0.0`.

## Deploy on Railway

1. Deploy this repository as a Node.js service. Railway uses the `npm start` script.
2. Add a Railway Volume and mount it at `/data`.
3. Set the service variable `DATA_DIR=/data`.

Accounts, password hashes, game history, profile pictures, and saved themes are stored in `DATA_DIR`. Without a mounted persistent volume, Railway's filesystem can be reset when the service is redeployed.

## Maintain the Team Draft player list

Edit [`server/draft-players.json`](server/draft-players.json). Team Draft loads its complete player pool from that file each time a draft starts; players absent from the file cannot appear in a new game.
