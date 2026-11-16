# DAP Website

The website is a static site published from this directory.

- Change page copy in `locales/`.
- Change the shared page structure in `page.template.html`.
- Do not edit generated `index.html` or `en/index.html` directly.
- Run `node website/build.mjs` to regenerate the static pages.
- Run `node website/build.mjs --check` to verify that committed pages match the template and locale files.

The build script uses only Node.js built-in modules. Generated HTML is committed so the static hosting setup does not need a separate build command.
