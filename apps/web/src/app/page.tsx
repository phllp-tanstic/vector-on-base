import type { Metadata } from "next";

import { LandingPage } from "../components/landing-page";

export const metadata: Metadata = {
  title: "Vector — Execute Intent on Base",
  description:
    "Vector turns market theses into personalized, risk-constrained, execution-ready positions on Base.",
  openGraph: {
    title: "Vector — Execute Intent on Base",
    description:
      "Turn market theses into personalized, risk-constrained, execution-ready positions on Base.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Vector — Execute Intent on Base",
    description:
      "Turn market theses into personalized, risk-constrained, execution-ready positions on Base.",
  },
};

export default function HomePage() {
  return <LandingPage />;
}
