import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Memorandone — know what to do next",
  description: "A calm place to capture tasks, choose what matters, and keep the context behind your work.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
