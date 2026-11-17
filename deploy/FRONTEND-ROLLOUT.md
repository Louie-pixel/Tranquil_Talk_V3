# Clinic discovery, booking and consultation experience

The shared browser/Qt frontend now implements the updated clinic map/list, appointment calendar, appointment management, local waiting-room checks, account timezone/email preferences, and responsive/accessibility styling. This source depends on the backend notification/timezone/import implementation from PR #7. Neither implementation is deployed by pushing a draft PR.

## Clinic discovery

Search by area or clinic name in the existing real database, or explicitly request device location. Filters narrow the loaded results by care category and available contact details. Source categories and source attribution come from imported records; unclassified legacy listings remain visible under All listed care. No clinic ratings, opening hours, route estimates or medical endorsements are fabricated.

The result list is linked to a numbered interactive map. Selecting a clinic highlights its marker; selecting a marker focuses the matching clinic card. The map supports drag/touch panning, keyboard arrows, zoom buttons and fit-to-results. A separate blue search-location marker represents the chosen search origin. Directions remain an explicit external link. List-only mode and empty/error states remain usable when map tiles are unavailable.

The tile service is **off until the user enables it**. Enabling allows the browser to request visible raster tiles from `https://tile.openstreetmap.org`, sharing its IP, origin referrer and viewed area with the service. Tiles are loaded only for the visible map viewport; there is no background prefetch, bulk/offline download, third-party JavaScript library or external geocoder. Browser caching follows the tile response headers. Turning the map off removes the layer and stops future tile requests; already-started requests cannot be recalled. The map is off again after pagehide/reload. The visible OpenStreetMap attribution is retained. The CSP permits only that tile host in addition to existing image sources.

OSM community tiles are best effort and may be unavailable or inappropriate for sustained production traffic. Before launch, choose an appropriate map provider, configure its allowed host/URL and review the current [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Native Qt WebEngine and browser referrer/cache behavior need validation in the final phase. Real clinic records still need to be reviewed and imported; enabling a map does not create directory records.

## Booking and appointments

The booking dialog separates consultation method, available day/time and display alias. Only available dates are enabled. Calendar dates follow the chosen account timezone (falling back to the device zone or UTC); each time button includes its UTC offset to distinguish repeated clock-change times. The selected time, location/method and confirmation requirement appear in a request summary. Refresh preserves applicable choices, while a booking conflict refreshes availability and requires another time selection.

The calendar has month navigation, marked dates, current-date indication, roving keyboard focus and arrow/Home/End navigation. Time buttons are keyboard-operable radio choices. No time is reserved until the request reaches the backend; a professional must accept before confirmation.

Appointments show actual counts, the next confirmed appointment, date filtering, upcoming/needs-response/past/all filters, and professional/alias search within loaded records. Cards explain status and current next steps. Cancellation/decline require a confirmation dialog; conflicting revisions refresh the list. Experts can propose an alternative from current available times, which still requires patient acceptance. In-person appointments link to directions rather than online rooms.

Accepted appointments can be downloaded as neutral-title UTC `.ics` files. The file excludes patient alias/email, clinical details, consultation credentials and venue. External calendars do not automatically sync later changes; the UI states that limitation. The API currently returns up to 200 appointments, so counts/search are scoped to the records returned by that API.

Availability entry sends an explicit local time, named timezone and optional earlier/later occurrence to the backend. The backend still validates UTC half-hour boundaries, notice period, booking horizon and conflicts. Event management uses the same named-zone contract. Account controls connect to `/api/account/preferences` for timezone and appointment email/reminder preferences. Changing a timezone changes presentation, not the instant of existing appointments.

## Waiting room

An accepted appointment can open its waiting-room screen before the join window, allowing a local microphone/camera check. The device check does not request a room ticket, enter signalling, offer media to another participant or obtain location access. It obtains the existing authenticated RTC configuration, then requests only the media required by the appointment mode. Audio consultations never request camera access.

After permission, the user can choose available devices, view microphone activity and camera preview, toggle microphone/camera, and play an explicit short speaker tone. Permission denial, missing devices and unavailable audio meters have recovery guidance. No recording is added. The readiness checkbox and join-window clock gate entering; they do not replace backend authorization.

Entering requests a fresh participant-bound appointment ticket. Changed appointment time/mode is rejected locally, while the backend remains authoritative for membership, accepted status, current account/session, professional approval and timing. The UI distinguishes device preparation, waiting for a participant, connection and reconnection. It does not claim the other person is present until a real signalling event arrives. Microphone/camera controls reflect track state. A manual audio-play button handles browsers that block autoplay.

Leave, device-stop, peer departure, signalling failure, offline events, sign-out, pagehide and consultation-window expiry release owned tracks and connections. Reconnection starts a fresh explicit device check and obtains a new ticket when re-entering. A suspended tab may delay JavaScript timers; server-side time/access enforcement still applies. Existing ICE restart behavior remains in the shared call engine.

## Mobile and accessibility

The charcoal/muted-red visual system covers cards, calendar controls, map controls, dialogs and empty states. Responsive layouts move the map above the list and stack booking/waiting-room columns on narrow screens. Form controls use readable font sizes; dialogs scroll within the viewport and respect safe dimensions.

Native dialogs provide modal focus handling and Escape behavior. Route changes announce the page and move focus to its heading; the skip link focuses main content without changing the app route. Inputs retain native validation, with invalid-state attributes. Live errors are assertive, routine status updates are polite, and the waiting countdown updates its live text only when its displayed message changes. Controls include text labels and visible focus states. Reduced-motion and forced-color styles are included. These are implementation provisions, not a claim of verified WCAG compliance.

## Final validation still pending

No syntax checks, automated tests, browser QA, screenshots, media calls or deployment were run for this implementation, following the user's tests-last instruction. Existing UI tests must be adapted to the new calendar/slot controls and fresh-ticket join sequence during the final testing phase. The test command now includes the new JavaScript modules but was not executed.

Final work must validate browser/Qt startup and CSP, account preference loading, timezone/DST behavior, keyboard and screen-reader flows, narrow-screen layouts and zoom, real booking conflicts and revision changes, all appointment roles/actions, permission/device changes, speaker/audio playback, offline/reconnect/expiry cleanup, and actual two-participant calls. Use local fixture tile responses during automated browser tests; do not generate bulk tile traffic against the community service. Then validate live map attribution/referrer/caching and actual provider availability manually within permitted normal use.

To run the complete local application after source integration, rebuild with the existing `tools/start.ps1`/Docker workflow. A previously built Docker image does not update its copied frontend files until rebuilt. The Node layout preview serves current source but cannot authenticate users or simulate live appointments/clinics.
