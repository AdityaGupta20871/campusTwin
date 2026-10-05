Redesign the existing Campus Twin workplace wayfinding prototype into a polished, distinctive editorial-style product while preserving the existing static architecture and all current functionality.

CORE PRODUCT:
Campus Twin — Sopra Steria, Noida. This is a sample/illustrative building dataset and must remain clearly identified as such. Do not invent real building data, live room availability, backend services, or turn-by-turn indoor routing.

PRESERVE ALL EXISTING FUNCTIONALITY:
- Interactive Three.js 3D building map
- Colorful translucent 3D/holographic floor model
- Floor switching
- 3D / 2D floor-plan toggle
- Room search
- Facility filters
- Room selection
- Room information/details panel
- Nearby spaces
- Shareable room links
- “You are here” QR links
- Floor QR code that links to the selected floor and lets users view all rooms/facilities on that floor
- Printable QR-code page
- Emergency action
- Existing static/sample architecture and data model
Do not redesign the product into a different information architecture.

VISUAL DIRECTION:
Take inspiration from the editorial, cinematic, minimal and typographic character of thenickel.co.uk, but do not copy its branding or layout. Make Campus Twin feel like a sophisticated architectural/cultural product rather than a generic SaaS dashboard.

Overall aesthetic:
- Editorial
- Architectural
- Minimal
- Premium
- Monochrome interface
- Warm paper-like background
- Strong typography
- Generous whitespace
- Thin rules and borders
- Subtle shadows
- Restrained rounded corners
- High contrast
- Quiet, sophisticated UI
- The 3D building is the primary visual expression

COLOR SYSTEM:
Primary UI should be black, white and warm grey.

Background:
#F7F6F2

Surface:
#FFFFFF

Muted surface:
#F0EEE8

Primary text:
#111111

Secondary text:
#5F5D58

Muted text:
#898780

Border:
#D8D6D0

Strong border:
#111111

Hover:
#E8E6E0

Primary button:
#111111 with white text

Secondary button:
#FFFFFF with black border/text

Emergency:
#B42318

Success:
#217346

Warning:
#9A6700

Information:
#2457A6

3D HOLOGRAM COLORS:
Keep the interface monochrome, but make the Three.js building colorful, translucent and holographic.

Floor 7: #C9B6FF lavender
Floor 6: #8FD3FF sky blue
Floor 5: #8FE3C0 mint
Floor 4: #FFE09A soft yellow
Floor 3: #FFB3A7 coral
Floor 2: #B9B5FF violet
Floor 1: #9ED8FF blue
Ground: #C7E6C2 green

Use these as translucent materials with approximately 20–55% opacity, subtle glass effects and thin dark outlines. Avoid making the entire UI colorful. Color should primarily communicate the architectural model and selected spatial elements.

TYPOGRAPHY:
Replace the existing typography with:

Display font:
Instrument Serif

UI/body font:
DM Sans

Use Instrument Serif for:
- Hero headlines
- Major page headings
- Room names
- Floor titles
- Editorial moments

Use DM Sans for:
- Navigation
- Buttons
- Search
- Filters
- Metadata
- Body text
- Room dimensions
- Floor numbers
- Status messages

Typography should feel editorial but remain highly readable and accessible.

Suggested type scale:
Desktop:
Hero 72px
Page heading 48px
Section heading 32px
Room name 40px
Card heading 20px
Body 16px
Small text 14px
Metadata 12px

Mobile:
Hero 42px
Page heading 32px
Room name 32px
Section heading 24px
Body 15px
Metadata 12px

Use tight tracking and line-height on large Instrument Serif headings.

DESKTOP WEB EXPERIENCE:
Make the 3D map the primary experience.

Layout:
- Minimal top header
- Campus Twin branding on the left
- Large global search
- Facility filters
- Emergency action
- Floor selector on the left
- Large central Three.js building visualization
- 2D / 3D controls near the map
- Compass/navigation control
- “You are here” indicator
- Right-side contextual panel for selected floor/room
- Floor plan preview
- Spaces on selected floor
- Selected room information
- Nearby spaces
- Share room link
- Floor QR access
- Sample-data disclaimer

The 3D building should visually dominate the page.

MOBILE EXPERIENCE:
Design mobile-first.

Use:
- Bottom navigation
- Large touch targets
- Sticky search when appropriate
- Horizontal facility filter chips
- Compact floor selector
- Large 3D map viewport
- Bottom sheets for room information
- Clear selected-room states
- Clear loading states
- Clear empty-search states
- Clear error states
- Accessible contrast
- Minimum approximately 44px touch targets

Bottom navigation:
Map
Rooms
Floor QR
More

3D MAP:
The 3D building must be colorful and translucent while the surrounding UI remains monochrome.

Include:
- Floor-by-floor stacked geometry
- Visible room blocks
- Selected floor emphasis
- “You are here” marker
- Floor labels
- Compass
- Zoom controls
- 3D / 2D toggle
- Smooth interaction
- Loading state while Three.js initializes
- Empty/error fallback if the model cannot render

Do not make the hologram overly neon or futuristic. It should feel like a refined architectural model with subtle colored glass.

ROOM DETAILS:
When a room is selected, show:
- Room name
- Floor
- Area
- Category
- Description if available in existing data
- Location
- Nearby spaces
- Share room link
- View on floor plan
- Floor QR access where appropriate

Do not add fake availability information.

QR SYSTEM:
There should be ONE QR code representing the selected floor.

Scanning the floor QR should conceptually open that floor inside Campus Twin and allow the user to browse all rooms and facilities on that floor.

The QR page should be extremely clean and print-friendly:
- White/off-white background
- Large high-contrast QR code
- Floor name
- Building name
- Short instruction: “Scan to explore this floor”
- Clear location label
- Print button
- Minimal decorative UI
- Printer-friendly spacing
- QR code must remain black and white with sufficient quiet zone
- Include a small disclaimer that this is sample/demo data

Do not generate multiple QR codes for every room on the floor.

ACCESSIBILITY:
- WCAG-conscious contrast
- Do not rely solely on color to communicate state
- Use labels/icons alongside colors
- Clear focus states
- Large touch targets
- Readable typography
- Avoid tiny controls
- Maintain strong contrast for the black/white UI
- Emergency state must be visually distinct

STATES TO DESIGN:
- Initial loading
- 3D map loading
- Floor selected
- Room selected
- Search active
- Search results
- No search results
- Filter selected
- No rooms on floor
- QR page
- Share confirmation
- Error/fallback
- Emergency state
- “You are here” state

IMPORTANT:
Do not add backend services.
Do not invent building information.
Do not claim live room availability.
Do not claim turn-by-turn indoor navigation.
Keep the current sample floor-plan/building data editable and explicitly label it as illustrative/demo data.

The final product should feel like:
“an editorial architectural wayfinding system with a colorful digital building model”
rather than
“a conventional enterprise dashboard.”