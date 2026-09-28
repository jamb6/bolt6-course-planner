/**
 * 2027 LPGA schedule — seeds the course list on first run.
 * Source: the schedule PDF supplied by Bolt6.
 *
 * `lngLat: null` means we have a venue name but no coordinates yet. The app
 * geocodes it with Mapbox the first time the course is opened and caches the
 * result — better than shipping coordinates nobody has checked.
 *
 * `tbc: true` marks a slot whose venue the tour has not announced. It appears
 * in the list so the season is complete, but it cannot be opened until someone
 * fills in the course.
 *
 * Plain data, no logic. Replace or extend freely.
 */
export const LPGA_SEASON = '2027';

export const LPGA_SCHEDULE = [
  { dates: 'Feb 1 – 7',        event: 'Hilton Grand Vacations TOC',         venue: 'Lake Nona Golf & Country Club',      place: 'Orlando, Florida' },
  { dates: 'Feb 15 – 21',      event: 'Honda LPGA Thailand',                venue: 'Siam Country Club, Old Course',      place: 'Pattaya, Thailand' },
  { dates: 'Feb 22 – 28',      event: "HSBC Women's Singapore",             venue: 'Sentosa Golf Club, Tanjong Course',  place: 'Singapore' },
  { dates: 'Mar 1 – 7',        event: 'FUTU Ladies Championship',           venue: 'Clearwater Bay Golf & Country Club', place: 'Hong Kong' },
  { dates: 'Mar 8 – 14',       event: 'Nanea Cup',                          venue: 'Nanea Golf Club',                    place: 'Kona, Hawaii' },
  { dates: 'Mar 15 – 21',      event: 'Lotte Championship',                 venue: 'TBD',                                place: 'Hawaii', tbc: true },
  { dates: 'Mar 22 – 28',      event: 'Ford Championship',                  venue: 'Whirlwind Golf Club at Wild Horse Pass', place: 'Chandler, Arizona' },
  { dates: 'Mar 29 – Apr 4',   event: 'Fortinet Founders Cup',              venue: 'Sharon Heights Golf & Country Club', place: 'Menlo Park, California' },
  { dates: 'Apr 12 – 18',      event: 'JM Eagle LA Championship',           venue: 'Wilshire Country Club',              place: 'Los Angeles, California' },
  { dates: 'Apr 19 – 25',      event: 'The Chevron Championship',           venue: 'Memorial Park Golf Course',          place: 'Houston, Texas', major: true },
  { dates: 'May 10 – 16',      event: 'Mizuho Americas Open',               venue: 'Mountain Ridge Country Club',        place: 'West Caldwell, New Jersey' },
  { dates: 'May 24 – 30',      event: 'The Classic',                        venue: 'Corning Country Club',               place: 'Corning, New York' },
  { dates: 'May 31 – Jun 6',   event: "U.S. Women's Open",                  venue: 'Inverness Club',                     place: 'Toledo, Ohio', major: true },
  { dates: 'Jun 7 – 13',       event: 'ShopRite LPGA Classic',              venue: 'Seaview, Bay Course',                place: 'Galloway, New Jersey' },
  { dates: 'Jun 14 – 20',      event: 'Meijer LPGA Classic',                venue: 'Blythefield Country Club',           place: 'Belmont, Michigan' },
  { dates: 'Jun 21 – 27',      event: "KPMG Women's PGA Championship",      venue: 'Congressional Country Club',         place: 'Bethesda, Maryland', major: true },
  { dates: 'Jul 5 – 11',       event: 'Amundi Evian Championship',          venue: 'Evian Resort Golf Club',             place: 'Évian-les-Bains, France', major: true },
  { dates: 'Jul 19 – 25',      event: 'PIF Championship London',            venue: 'TBD',                                place: 'London, England', tbc: true },
  { dates: 'Jul 26 – Aug 1',   event: "AIG Women's Open",                   venue: "Royal St George's Golf Club",        place: 'Sandwich, England', major: true },
  { dates: 'Aug 16 – 22',      event: "CPKC Women's Open",                  venue: 'Royal Ottawa Golf Club',             place: 'Gatineau, Quebec, Canada' },
  { dates: 'Aug 23 – 29',      event: 'FM Championship',                    venue: 'TPC Boston',                         place: 'Norton, Massachusetts' },
  { dates: 'Sep 6 – 12',       event: 'International Crown',                venue: 'Lake Merced Golf Club',              place: 'Daly City, California' },
  { dates: 'Sep 13 – 19',      event: 'The Standard Portland Classic',      venue: 'Columbia Edgewater Country Club',    place: 'Portland, Oregon' },
  { dates: 'Sep 20 – 26',      event: 'Walmart NW Arkansas Championship',   venue: 'Pinnacle Country Club',              place: 'Rogers, Arkansas' },
  { dates: 'Sep 27 – Oct 3',   event: 'Dow Championship',                   venue: 'Midland Country Club',               place: 'Midland, Michigan' },
  { dates: 'Oct 11 – 17',      event: 'BMW Ladies Championship',            venue: 'TBD',                                place: 'South Korea', tbc: true },
  { dates: 'Oct 18 – 24',      event: 'Buick LPGA Shanghai',                venue: 'Sheshan International Golf Club',    place: 'Shanghai, China' },
  { dates: 'Oct 25 – 31',      event: 'Maybank Championship',               venue: 'Kuala Lumpur Golf & Country Club',   place: 'Kuala Lumpur, Malaysia' },
  { dates: 'Nov 1 – 7',        event: 'Konami Japan Classic',               venue: 'Taiheiyo Club, Minori Course',       place: 'Japan' },
  { dates: 'Nov 8 – 14',       event: 'ANNIKA driven by Gainbridge at Pelican', venue: 'Pelican Golf Club',              place: 'Belleair, Florida', lngLat: [-82.8175, 27.9345] },
  { dates: 'Nov 15 – 21',      event: 'CME Group Tour Championship',        venue: 'Tiburón Golf Club',                  place: 'Naples, Florida' },
  { dates: 'Dec 6 – 12',       event: 'Grant Thornton Invitational',        venue: 'Tiburón Golf Club',                  place: 'Naples, Florida' },
];
