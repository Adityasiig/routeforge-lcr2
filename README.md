# RouteForge LCR 2

RouteForge builds two independent USA NPANXX customer sell-deck variants:

- **SD** — Short Duration
- **Convo** — Conversational

Each variant has its own persistent vendor defaults. Every build also requires an existing customer CSV, a current-traffic Excel/CSV file, and a markup percentage.

## Rate-deck columns

Vendor and customer rate decks must be CSV files containing:

```text
code,interrate,intrarate,ijrate
```

## Current traffic columns

The traffic file may be `.xlsx` or `.csv` and must contain:

```text
code,attempts,completions
```

`NPANXX` is also accepted as the code heading. Common singular forms and the spelling `complition` are accepted. When a code occurs more than once, its attempts and completions are added together.

## Pricing and protection rules

1. Match digit-only codes exactly at the customer deck's detected code length.
2. If a customer code has combined attempts greater than zero, preserve all three existing customer rates verbatim.
3. For every unlocked existing code, calculate LCR 2 independently for each rate field and lower the field only when LCR 2 is cheaper.
4. Never increase an existing customer rate.
5. Add eligible new codes at LCR 2 plus the required markup.
6. If a positive-attempt traffic code is missing from the customer deck, do not assign it a new price; skip and report it for review.
7. Re-read and validate every generated deck before releasing it.

## Local development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`. Local variant defaults are stored under `.data/variants/sd` and `.data/variants/convo`.

## Deploy on Coolify

1. Push this project to a Git repository and create a Coolify application from it.
2. Select **Dockerfile** as the build pack.
3. Expose container port `3000`.
4. Add a persistent storage volume with destination path `/data`.
5. Set `DATA_DIR=/data` and deploy.
6. Use `/api/health` as the health-check path if requested.

The `/data` volume preserves both saved vendor sets across deployments and restarts. Existing installations automatically copy their original unscoped vendor set into SD once; Convo begins with its own empty vendor set.

Because rate and traffic files are commercially sensitive, protect the application with authentication or network access controls before exposing it publicly.

## Operational limits

- Maximum upload: 100 MB per file.
- Maximum saved vendor files per variant: 100.
- `fallback` accepts a sole vendor quote and reports new codes without redundancy.
- `require2` keeps existing fields unchanged and omits new codes without two eligible quotes in every field.
