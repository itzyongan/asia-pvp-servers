const fs = require("fs");
const { marked } = require("marked");

const readme = fs.readFileSync("README.md", "utf8");
const content = marked.parse(readme);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Asia PvP Servers</title>

  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 1000px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.6;
      background: #111;
      color: #eee;
    }

    a {
      color: #66b3ff;
    }

    img {
      max-width: 100%;
    }

    code {
      background: #222;
      padding: 2px 5px;
      border-radius: 4px;
    }

    pre {
      background: #222;
      padding: 15px;
      overflow-x: auto;
      border-radius: 8px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 10px;
      border-bottom: 1px solid #333;
      text-align: left;
    }
  </style>
</head>

<body>
  ${content}
</body>
</html>`;

fs.writeFileSync("index.html", html);

console.log("README.md successfully converted to index.html");
