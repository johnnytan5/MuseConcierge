// The hotel's fact sheet: the only place the call agent gets policy and
// facility answers from. A question with no entry goes to the front desk.
// ponytail: static record; a Supabase table when staff need to edit it live.
export const HOTEL_FACTS = {
  check_in_out: 'Check-in from 3pm, check-out by 12 noon. Early check-in depends on availability; the front desk can confirm on the day. Late check-out: $30 for each extra hour after 12 noon. The latest is 5pm, which is $150. On request, subject to availability.',
  late_checkout: 'Late check-out: $30 for each extra hour after the 12 noon check-out. The latest is 5pm, which is 5 extra hours, $150; later is not possible. So 2pm is $60 and 3pm is $90. On request, subject to availability.',
  facilities: 'Lobby, front desk and café on the ground floor. Gym on level 3, open 6am to 10pm. Pool on level 5, open 7am to 9pm. Restaurant on level 2: breakfast 6:30 to 10:30am, dinner 6 to 10pm. Rooftop bar on level 15, open 5pm to midnight.',
  wifi: "Wi-Fi network 'Concierge-Guest', no password. Sign in with your room number and surname.",
  breakfast: 'Breakfast is served at the level 2 restaurant, 6:30 to 10:30am.',
  parking: 'Basement car park, levels B1 and B2. Valet at the main entrance, free for hotel guests.',
  laundry: 'Laundry bags are in the wardrobe. Leave them out by 9am for same-day return by 6pm.',
};
export const HOTEL_TOPICS = Object.keys(HOTEL_FACTS);
