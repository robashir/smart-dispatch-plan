import "./globals.css";

export const metadata = {
  title: "Smart Dispatch",
  description: "AI-powered driving plan for rideshare drivers",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  );
}
