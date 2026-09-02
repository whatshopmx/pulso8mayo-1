import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  const metadata = (messages as any).metadata;

  return {
    title: metadata?.title || "Pulso - Plataforma de Gestión HORECA",
    description: metadata?.description || "Sistema de gestión operativa para restaurantes, hoteles y cafeterías",
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      title: "Pulso",
      statusBarStyle: "default",
    },
    icons: {
      icon: [
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: "/apple-touch-icon.png",
    },
  };
}

/**
 * `viewport` va aparte de `metadata` (Next 14+ lo separó) y aquí importa por
 * dos cosas del uso real: `viewportFit: "cover"` para que la barra de estado
 * del modo standalone no coma contenido en iPhone, y `maximumScale` sin tope
 * porque limitarlo bloquea el zoom del navegador — un empleado en cocina
 * acercando una foto de evidencia es exactamente el gesto que no hay que
 * romper (WCAG 1.4.4).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const messages = await getMessages();

  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <QueryProvider>
              {children}
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
