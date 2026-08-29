import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ContatoCerto",
  description: "Marketplace conversacional de prestadores de serviços.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
