import qrcode from "qrcode-generator";
import { building } from "../data/building-data.js";
import { h, $ } from "../ui/dom.js";

const base = $("base");
const perRoom = $("per-room");
const sheet = $("sheet");
base.value = new URL("./studio.html", location.href).toString();

/** SVG markup produced by the vetted qrcode-generator library from a URL we built and validated. */
function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function card(title, subtitle, url, className = "qr-card") {
  const code = h("div", { className: "qr-code" });
  code.innerHTML = qrSvg(url);
  return h("figure", { className }, [code, h("figcaption", {}, [h("strong", { text: title }), h("span", { text: subtitle }), h("small", { text: url })])]);
}

function render() {
  if (typeof qrcode !== "function") {
    sheet.textContent = "QR library unavailable. Reload the page and try again.";
    return;
  }
  let root;
  try {
    root = new URL(base.value);
    if (!["http:", "https:"].includes(root.protocol)) throw new Error("protocol");
  } catch {
    sheet.textContent = "Enter a valid http(s) URL.";
    return;
  }
  root.search = "";
  root.hash = "";

  sheet.replaceChildren(card(building.name, "Scan to open the workplace twin", root.toString(), "qr-card main"));
  if (!perRoom.checked) return;

  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      const url = new URL(root);
      url.searchParams.set("here", room.id);
      sheet.append(card(room.name, `${floor.name} – you are here`, url.toString()));
    }
  }
}

base.addEventListener("input", render);
perRoom.addEventListener("change", render);
$("print").addEventListener("click", () => window.print());
render();
