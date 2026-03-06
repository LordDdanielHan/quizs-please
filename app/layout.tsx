import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quizzes Please - AI Quiz Generator",
  description:
    "Generate structured quizzes in Bitmark format from a topic prompt and turn count.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

