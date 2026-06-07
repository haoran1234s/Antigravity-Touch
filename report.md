
## 馃悰 Root Cause: Two Issues in [package.json](cci:7://file:///C:/Users/COMPUMARTS/AppData/Roaming/npm/node_modules/antigravity-touch/package.json:0:0-0:0)

### Issue 1: `scripts/` is not included in the `files` whitelist

In your [package.json](cci:7://file:///C:/Users/COMPUMARTS/AppData/Roaming/npm/node_modules/antigravity-touch/package.json:0:0-0:0) (line 16-22), the `files` field acts as a **whitelist** for what npm publishes:

```json
"files": [
聽 聽 "bin/",
聽 聽 ".next/standalone/",
聽 聽 ".next/static/",
聽 聽 "public/",
聽 聽 "package.json"
]
```

The `scripts/` directory is **not listed**, so when you run `npm publish`, npm **excludes** the `scripts/` folder entirely from the published tarball. But on line 25, you have:

```json
"postinstall": "node scripts/patch-next.js"
```

This tries to run `scripts/patch-next.js` on the consumer's machine after install 鈥?but the file doesn't exist in the published package, so it throws `MODULE_NOT_FOUND` and the install fails.

### Issue 2: `postinstall` runs for consumers, not just for you

The `postinstall` script runs for **every user who installs the package**, not just during your local development. This means:
- When someone runs `npm install -g antigravity-touch`, npm downloads your package, then tries to execute `node scripts/patch-next.js` 鈥?which doesn't exist.

---

## 鉁?Fix

You have two options depending on what `patch-next.js` does:

### Option A: Include `scripts/` in the published files
If the patch script needs to run on the consumer's machine:

```json
"files": [
聽 聽 "bin/",
聽 聽 "scripts/",
聽 聽 ".next/standalone/",
聽 聽 ".next/static/",
聽 聽 "public/",
聽 聽 "package.json"
]
```

### Option B (Recommended): Run the patch at build time, not install time
If `patch-next.js` patches the Next.js standalone output (which seems likely given your architecture), it should run **before publishing**, not after installing. Change it to:

```json
"scripts": {
聽 聽 "dev": "next dev -p 5555",
聽 聽 "build": "next build",
聽 聽 "postbuild": "node scripts/patch-next.js",
聽 聽 "start": "next start -p 5555",
聽 聽 "tunnel": "node bin/cli.js",
聽 聽 "lint": "next lint",
聽 聽 "type-check": "tsc --noEmit",
聽 聽 "prepublishOnly": "NODE_ENV=production npm run build"
}
```

This way:
1. `npm run build` runs `next build`
2. `postbuild` automatically runs `node scripts/patch-next.js` right after the build
3. `prepublishOnly` triggers `npm run build` 鈫?which triggers `postbuild` 鈫?so the patch is applied **before** the package is published
4. Consumers never need to run the patch 鈥?they get the already-patched standalone output

**Option B is the better approach** because it keeps the published package self-contained and doesn't require consumers to have the patch script at all.
