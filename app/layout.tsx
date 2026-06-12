import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import PWAInstallPrompt from '@/components/pwa-install-prompt';
import Providers from '@/components/providers';

export const dynamic = 'force-dynamic';

const devServiceWorkerCleanupScript = `
(() => {
  const reloadKey = 'antigravity-dev-sw-cleaned';
  const cleanup = async () => {
    const registrations = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistrations()
      : [];
    const cacheKeys = 'caches' in window ? await caches.keys() : [];
    const needsCleanup = registrations.length > 0 || cacheKeys.length > 0;

    await Promise.all([
      ...registrations.map(registration => registration.unregister()),
      ...cacheKeys.map(cacheKey => caches.delete(cacheKey)),
    ]);

    if (needsCleanup && sessionStorage.getItem(reloadKey) !== '1') {
      sessionStorage.setItem(reloadKey, '1');
      window.location.reload();
      return;
    }

    if (!needsCleanup) {
      sessionStorage.removeItem(reloadKey);
    }
  };

  cleanup().catch(() => undefined);
})();
`;

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Antigravity Agent',
  description: 'Chat with the Antigravity AI Agent from any browser',
  applicationName: 'Antigravity Agent',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Antigravity Agent',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        {process.env.NODE_ENV === 'development' && (
          <script
            dangerouslySetInnerHTML={{ __html: devServiceWorkerCleanupScript }}
          />
        )}
        <Providers>
          {children}
        </Providers>
        <PWAInstallPrompt />
      </body>
    </html>
  );
}
