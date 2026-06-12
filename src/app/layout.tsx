import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans_JP, Shippori_Mincho } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["400", "600"],
});

const shipporiMincho = Shippori_Mincho({
  subsets: ["latin"],
  variable: "--font-shippori",
  weight: ["500", "700"],
});

const plexSansJp = IBM_Plex_Sans_JP({
  subsets: ["latin"],
  variable: "--font-plex-jp",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "interlink",
  description: "問いの構造を、図にする。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        className={`${fraunces.variable} ${shipporiMincho.variable} ${plexSansJp.variable} font-sans`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
