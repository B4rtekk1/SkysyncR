import { defineConfig, loadEnv, type Plugin } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

function contentSecurityPolicy(connectSources: string[], scriptSources = ["'self'"]) {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src ${connectSources.join(' ')}`,
  ].join('; ')
}

function developmentDocumentHeaders(policy: string): Plugin {
  return {
    name: 'skysyncr-development-document-headers',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.headers.accept?.includes('text/html')) {
          response.setHeader('Content-Security-Policy', policy)
          response.setHeader('Cache-Control', 'no-store')
        }

        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE ?? 'http://localhost:3000'
  const developmentPolicy = contentSecurityPolicy([
    "'self'",
    apiBase,
    'ws://localhost:*',
  ], ["'self'", "'unsafe-inline'"])

  return {
    plugins: [
      developmentDocumentHeaders(developmentPolicy),
      react(),
      babel({ presets: [reactCompilerPreset()] })
    ],
    build: {
      modulePreload: {
        polyfill: false,
      },
    },
    server: {
      headers: {
        'Content-Security-Policy': developmentPolicy,
      },
    },
    preview: {
      headers: {
        'Content-Security-Policy': contentSecurityPolicy(["'self'", apiBase]),
      },
    },
  }
})
