export type NotificationEntry = { id: string; at: number; room: string; text: string };

export default function RoomNotifications({ items }: { items: NotificationEntry[] }) {
  return (
    <section className="panel">
      <h2>Room notifications</h2>
      <ol className="notes">
        {items.map((n) => (
          <li key={n.id} className={n.text.startsWith('Delayed') ? 'delayed' : n.text.startsWith('Arrived') ? 'arrived' : ''}>
            <span className="room">{n.room}</span>
            <span>{n.text}</span>
            <small>{new Date(n.at).toLocaleTimeString()}</small>
          </li>
        ))}
        {!items.length && <li className="muted">Nothing sent to rooms yet</li>}
      </ol>
    </section>
  );
}
