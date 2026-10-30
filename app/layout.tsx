import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Muse Concierge',
  description: 'Hotel guests phone in; Meta models run the calls and a delivery robot fleet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
