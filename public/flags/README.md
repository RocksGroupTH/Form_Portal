# Country flags

One SVG per country offered by `src/lib/acc/country-currency.ts`, named by the
lowercased ISO-3166-1 alpha-2 code (`th.svg`, `my.svg`), 3:2 aspect.

**Copied from [`country-flag-icons`](https://www.npmjs.com/package/country-flag-icons)
(MIT, © 2020 @catamphetamine), not depended on at runtime.** The package is
~5.8 MB for every country in several formats; these 25 files are 56 KB, and
copying them means no dependency to keep current, nothing in the bundle, and no
external request at render time — the same arrangement `public/brandlogo` uses.

## Adding a country

Add it to `COUNTRIES` first, then put its flag here. `flag-asset-coverage.test.ts`
fails if a country has no file, so a missing one is caught in `npm test` rather
than by a reader seeing a broken image.

```
npm install --no-save country-flag-icons
cp node_modules/country-flag-icons/3x2/XX.svg public/flags/xx.svg
npm uninstall --no-save country-flag-icons
```

**Emoji flags were tried first and do not work.** Windows ships no flag glyphs
at all, so Chrome and Edge there render the two-letter code as plain text —
which reads as a broken image rather than a deliberate choice.
