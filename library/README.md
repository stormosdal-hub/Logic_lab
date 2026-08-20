# Always-loaded components

Drop exported ICs in here and they will be in the palette every time the app
starts, under **Library**.

## How to add one

1. Build the component and press **📦 Create IC**.
2. Press **⬇ Export ICs** (or the small **⬇** on the component's palette tile to
   export just that one). You get a `.json` file.
3. Move that file into this folder.
4. Run:

   ```bash
   node tools/build-library.mjs
   ```

5. Reload the app. The component is in the **Library** palette section.

To remove one, delete its `.json` file and run the command again.

## Why the extra command

Logic Lab is meant to run by opening `index.html` directly, with no server. A
`file://` page **cannot read a sibling file** — the browser blocks it as a
cross-origin request, and there is no way to list a directory from a web page in
any case. A `<script>` tag *does* load from `file://`, so the command bundles
these `.json` files into `library/library.js`, which the app loads at startup.

The `.json` files here stay the source of truth; `library.js` is generated from
them and is safe to delete and rebuild. The deploy workflow regenerates it
automatically, so for the published site you only need to commit the `.json`.

## Notes

- Library components can't be deleted from inside the app — they come back on
  the next reload. Delete the file instead.
- They are not written into browser storage, so **Save**/**Load** and **New**
  leave them alone.
- A component you build yourself with the same name as a library one is ignored
  in favour of the library copy, so what is on disk always wins.
- Exporting a *sketch* that uses a library component still bundles it, so the
  sketch file stays portable to someone without your library.
