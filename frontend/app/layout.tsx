import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "Kasra OS",
  description: "Intelligent Business Operating System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
    <body className="font-sans">{children}</body>

    </html>
  );
}