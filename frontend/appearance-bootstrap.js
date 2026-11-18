import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

const marker = "<!-- dap-appearance-bootstrap -->";

export function appearanceBootstrap() {
  let source;
  let filename;
  let publicPath;

  return {
    name: "dap-appearance-bootstrap",
    configResolved(config) {
      const file = new URL("./src/appearance/preferences.ts", import.meta.url);
      const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
        },
        fileName: file.pathname,
      });
      const args = [config.env.BASE_URL, config.env.VITE_APPEARANCE_SCOPE, config.env.VITE_DEFAULT_ACCENT];
      source = `(() => { const exports = {};\n${outputText}\nexports.bootstrapAppearance(...${JSON.stringify(args)});\n})();\n`;
      const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
      filename = `assets/appearance-${hash}.js`;
      publicPath = `${config.base}${filename}`;
    },
    configureServer(server) {
      server.watcher.add(new URL("./src/appearance/preferences.ts", import.meta.url).pathname);
      server.middlewares.use((req, res, next) => {
        if (req.url !== publicPath) return next();
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(source);
      });
    },
    // Rebuild the classic script when the shared source changes during development.
    handleHotUpdate({ file, server }) {
      if (file === new URL("./src/appearance/preferences.ts", import.meta.url).pathname) return server.restart();
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: filename, source });
    },
    transformIndexHtml(html) {
      return html.replace(marker, () => `<script src="${publicPath}"></script>`);
    },
  };
}
