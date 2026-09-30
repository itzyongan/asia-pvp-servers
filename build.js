const fs = require("fs");
const { marked } = require("marked");

const readme = fs.readFileSync("README.md", "utf8");
const markdownHtml = marked.parse(readme);

// Keep the existing website design and replace only the
// content between the generated markers.
const index = fs.readFileSync("index.html", "utf8");

const startMarker = "<!-- README-CONTENT-START -->";
const endMarker = "<!-- README-CONTENT-END -->";

const start = index.indexOf(startMarker);
const end = index.indexOf(endMarker);

if (start === -1 || end === -1) {
  console.error("Could not find README content markers in index.html");
  process.exit(1);
}

const before = index.slice(0, start + startMarker.length);
const after = index.slice(end);

const output =
  before +
  "\n" +
  "\n" +
  markdownHtml +
  "\n" +
  after;

fs.writeFileSync("index.html", output);

console.log("README.md → index.html complete!");
