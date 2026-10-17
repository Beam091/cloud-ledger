import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
const environment = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env || {}
const codespaceName = environment.CODESPACE_NAME
const forwardingDomain = environment.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
const proxyOrigin = codespaceName && forwardingDomain
  ? `https://${codespaceName}-5173.${forwardingDomain}`
  : 'http://localhost:5173'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.app.github.dev'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest) => {
            proxyRequest.setHeader('origin', proxyOrigin)
          })
        },
      },
    },
  },
})