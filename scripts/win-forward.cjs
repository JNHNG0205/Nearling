// Dev helper for WSL2 when Windows localhost forwarding is broken: relays 127.0.0.1:<port>
// on Windows to the WSL VM. Run with Windows Node, from WSL:
//   node.exe scripts/win-forward.cjs $(hostname -I | cut -d' ' -f1)
const net = require("net");
const target = process.argv[2];
for (const port of [3000, 8787]) {
  net.createServer((c) => {
    const up = net.connect(port, target);
    c.pipe(up).pipe(c);
    c.on("error", () => up.destroy());
    up.on("error", () => c.destroy());
  }).listen(port, "127.0.0.1", () => console.log(`forwarding 127.0.0.1:${port} -> ${target}:${port}`));
}
