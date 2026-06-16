Generate PWA icons

This project includes `public/icon.svg` as the source artwork.

To generate PNG/ICO icons (requires Node.js and build tools):

1. Install dependencies:

```bash
npm install
```

2. Install optional native dependencies if `sharp` requires them (platform-specific).

3. Run the generator:

```bash
npm run generate-icons
```

This will create `public/icons/icon-192.png`, `public/icons/icon-512.png`, maskable variants, and overwrite `public/favicon.ico`.
