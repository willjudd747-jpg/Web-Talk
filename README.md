# BagelNet

Friend-code chat app with account creation, friend requests, and private messages.

## Run

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Do not open `public/index.html` directly for real use. The app needs the server for login, accounts, requests, and messages.

## Let Other People Text

Everyone must use the same running server URL.

- Same computer: `http://localhost:3000`
- Same Wi-Fi: use the `Network:` URL printed when the server starts
- Anywhere in the world: deploy this folder to a public Node host, then share that public URL

The server listens on `0.0.0.0` and uses `PORT` if the host provides one.
