// Configuración pm2 para el VPS. pm2 ejecuta el binario de Bun directamente (sin envoltorio de Node);
// Bun carga el .env desde `cwd`.
const path = require("node:path")

module.exports = {
  apps: [
    {
      name: "reto2",
      cwd: __dirname,
      script: path.join(process.env.HOME || "", ".bun", "bin", "bun"),
      args: "src/index.ts",
      interpreter: "none",
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
    },
  ],
}
