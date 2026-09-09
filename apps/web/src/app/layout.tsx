import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./styles.css";

export const metadata: Metadata = {
  title: "Vector — Executable Thesis",
  description: "Intent execution layer for tokenized markets on Base.",
  other: {
    "base:app_id": "6aa1c0f1fa92e96bd08c5a46",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
