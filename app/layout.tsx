import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Muse Concierge',
  description: 'Hotel guests phone in; Meta models run the calls and a delivery robot fleet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#14161a', color: '#eceae6' }}>{children}</body>
    </html>
  );
}
