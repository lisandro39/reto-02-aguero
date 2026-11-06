// Configuración pm2 para el VPS. Bun carga el .env desde `cwd`.
const path = require("node:path")

module.exports = {
  apps: [
    {
      name: "reto2",
      cwd: __dirname,
      script: "src/index.ts",
      interpreter: path.join(process.env.HOME || "", ".bun", "bin", "bun"),
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_memory_restart: "300M",
    },
  ],
}
