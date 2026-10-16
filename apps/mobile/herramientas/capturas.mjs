// Fotografía con Chrome (sin ventana) cada HTML de .capturas a tamaño de teléfono.
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(process.argv[2] ?? ".capturas");
const chrome = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
if (!chrome) throw new Error("No se encontró Chrome ni Edge");
const filtro = process.argv[3] ?? "";
for (const f of readdirSync(dir).filter((x) => x.endsWith(".html") && x.includes(filtro))) {
  const png = join(dir, f.replace(/\.html$/, ".png"));
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--window-size=412,1600", `--screenshot=${png}`, pathToFileURL(join(dir, f)).href], { stdio: "ignore" });
}
console.log("listo");
