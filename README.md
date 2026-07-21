# RouteForge LCR 2

RouteForge stores a default set of USA vendor CSV rate decks, then builds protected customer sell decks using the second-lowest vendor rate independently for `interrate`, `intrarate`, and `ijrate`.

## Required CSV columns

```text
code,interrate,intrarate,ijrate
```

Codes are matched exactly as digit strings. Existing customer rates are never increased. Eligible new codes receive the user-entered markup.

## Local development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`. Local vendor defaults are saved under `.data/`.

## Deploy on Coolify

1. Push this project to a Git repository and create a new Coolify application from that repository.
2. Select **Dockerfile** as the build pack. Coolify will detect the included `Dockerfile`.
3. Expose container port `3000`.
4. Add a persistent storage volume with destination path `/data`.
5. Set `DATA_DIR=/data` and deploy.
6. Use `/api/health` as the health-check path if Coolify asks for one.

The `/data` volume is essential: it preserves saved vendor decks across deployments and container restarts. Because rate decks are commercially sensitive, keep the application private or place it behind access control before exposing it to the internet.

## Production behavior

- Maximum upload: 100 MB per CSV.
- Replacing the default vendor set validates every new CSV before switching the saved set.
- One file counts as one vendor; duplicate rows inside a vendor file cannot create false route diversity.
- `fallback` accepts a sole quote and reports new codes with no redundancy.
- `require2` keeps existing fields unchanged and omits new codes without two valid quotes in every rate field.
- Every generated CSV is re-read and validated before download.
