import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { brand } from "@crowdquiz/shared";
import { readPublicEnv } from "@/lib/env";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: brand.productName, template: `%s · ${brand.productName}` },
  description: brand.shortDescription,
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const env = readPublicEnv();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col font-sans">
        {env.ok ? (
          <ToastProvider>{children}</ToastProvider>
        ) : (
          <main className="mx-auto max-w-lg px-6 py-24">
            <h1 className="text-xl font-semibold">Configuration needed</h1>
            <p className="mt-2 text-sm text-ink-muted">
              {brand.productName} can&apos;t start because these settings are missing:
            </p>
            <ul className="mt-3 list-disc pl-5 font-mono text-sm">
              {env.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-ink-muted">
              Copy <code>.env.example</code> to <code>apps/web/.env.local</code>, fill in the values from your Supabase
              project, and restart the server.
            </p>
          </main>
        )}
      </body>
    </html>
  );
}
