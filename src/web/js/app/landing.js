import "./fonts.js";

// Legacy QR codes pointed at index.html?here=… — forward deep links to the studio.
const params = new URLSearchParams(location.search);
if (["here", "room", "floor", "view", "ask"].some((k) => params.has(k))) {
  location.replace(`studio.html${location.search}`);
}
