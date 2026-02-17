import "../styles/globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Crypto Live Updates",
  description: "Real-time crypto price tracker",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-50">
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
