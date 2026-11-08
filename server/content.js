/*
 * Search-friendly content rendered on the server: the homepage FAQ and the service pages.
 * Facts that change (subsidy amounts, GST rates) are dated where it helps; nothing here is a
 * customer review or a made-up statistic. Paragraph text is plain; `html` blocks are trusted markup.
 */

const FAQ = [
  { q: 'How much roof space do I need?', a: 'About 80–100 sq ft of shade-free roof per kWp. A 3 kWp home system needs roughly 300 sq ft. Metal-sheet and RCC roofs both work, and ground-mount is possible where there is open land.' },
  { q: 'What size of system do I need?', a: 'In Tamil Nadu each kWp of panels makes about 4 units a day, or roughly 120 units a month. Divide your average monthly units by 120 for a first estimate — the calculator on this page does it for you, and our site survey fine-tunes it.' },
  { q: 'How much subsidy can I get for my home?', a: 'Under PM Surya Ghar: Muft Bijli Yojana, eligible homes get ₹30,000 per kW for the first 2 kW and ₹18,000 for the 3rd kW — ₹30,000 for 1 kW, ₹60,000 for 2 kW and a maximum of ₹78,000 for 3 kW and above. It needs a grid-connected system with made-in-India (DCR) panels.' },
  { q: 'How does the subsidy reach me?', a: 'You apply on the national PM Surya Ghar portal (we help with the paperwork). After installation, net-metering and inspection, the subsidy is paid directly to your bank account. It is not deducted from the installer’s bill.' },
  { q: 'Will solar work during a power cut?', a: 'On-grid systems switch off when the grid fails, to keep EB line workers safe. If you need backup, we design a hybrid system with batteries.' },
  { q: 'What is net metering?', a: 'A two-way EB meter records the power you take from the grid and the surplus solar power you send back. You are billed only for the difference. We file the net-meter application and follow it up with the EB.' },
  { q: 'How long does installation take?', a: 'Usually 3–4 weeks from advance to switch-on for homes, depending on site readiness, material and EB approvals. The panels and wiring themselves go in within a few days.' },
  { q: 'What GST applies to a solar system?', a: 'For a complete supply-and-installation contract, 70% of the value is taxed as goods at 5% and 30% as services at 18% — about 8.9% overall, at the rates in force since 22 September 2025. Your quotation shows the full GST breakup with HSN/SAC codes.' },
  { q: 'What maintenance does solar need?', a: 'Regular panel cleaning plus periodic inverter, wiring and earthing checks. Our care and AMC plans cover all of it, and the monitoring app shows if output drops.' },
  { q: 'What warranties come with the system?', a: 'Panels and inverters carry their manufacturers’ warranties — panels typically include a long-term performance warranty and inverters a product warranty of several years. The exact terms for the brands you choose are written on your quotation, along with our workmanship cover.' },
];

const STEPS = [
  ['Site survey', 'Roof measurement, shadow analysis and a look at your EB bills.'],
  ['Design', 'Panel layout, inverter sizing and a structure built for local wind loads.'],
  ['Procurement', 'Modules, inverters and cables from vetted brands, checked before dispatch.'],
  ['Installation', 'Mounting, wiring, earthing and lightning protection by trained crews.'],
  ['Approvals', 'EB net-metering, inspection and subsidy filing — tracked to closure.'],
  ['Switch-on', 'Commissioning, handover and your customer portal login.'],
];

const SERVICES = [
  {
    slug: 'rooftop-solar-for-homes',
    nav: 'Homes',
    short: 'Homes',
    type: 'Home',
    title: 'Home Rooftop Solar in Tamil Nadu — PM Surya Ghar Subsidy',
    description: 'Rooftop solar for your home with the PM Surya Ghar subsidy (up to ₹78,000), net-metering and EB paperwork handled by one local team. Free site survey.',
    eyebrow: 'Homes',
    h1: 'Rooftop solar for your home — subsidy and net-metering done for you',
    intro: 'A grid-connected rooftop system cuts your EB bill from the first month. We survey your roof, size the system to your usage, install it and take the subsidy and net-meter applications all the way to closure.',
    service: 'Residential rooftop solar installation',
    sections: [
      { h2: 'What you get', list: [
        'Made-in-India (DCR) solar panels from the government’s approved list, so your system qualifies for the subsidy',
        'A grid-tie inverter sized to your panels, with a monitoring app on your phone',
        'Hot-dip galvanised mounting structure designed for local wind load',
        'DC and AC cabling, ACDB / DCDB with surge protection, earthing and a lightning arrester',
        'Net-meter application, EB inspection and the subsidy claim — followed up until the money reaches you',
      ] },
      { h2: 'PM Surya Ghar subsidy at a glance', p: [
        'The central subsidy under PM Surya Ghar: Muft Bijli Yojana is ₹30,000 per kW for the first 2 kW and ₹18,000 for the 3rd kW. Systems larger than 3 kW still receive the ₹78,000 maximum.',
      ], table: { head: ['System size', 'Central subsidy'], rows: [['1 kW', '₹30,000'], ['2 kW', '₹60,000'], ['3 kW and above', '₹78,000 (maximum)']] },
        note: 'The subsidy is paid by the government to your bank account after installation, net-metering and inspection. Rates are set by government order — we confirm the current position when we quote.' },
      { h2: 'Which size is right for you?', p: [
        'Each kWp of panels makes about 4 units a day in Tamil Nadu — roughly 120 units a month. A home using 300 units a month is usually well served by 2.5–3 kWp, which needs about 250–300 sq ft of shade-free roof.',
        'Want power during cuts? An on-grid system shuts down when the grid fails, for the safety of EB staff. A hybrid system with batteries keeps essential loads running.',
      ] },
    ],
    faq: [0, 2, 3, 4, 5],
  },
  {
    slug: 'commercial-industrial-solar',
    nav: 'Business & industry',
    short: 'Business & industry',
    type: 'Business',
    title: 'Commercial & Industrial Solar in Tamil Nadu',
    description: 'Rooftop and ground-mount solar for shops, offices, schools, hospitals, mills and factories in Tamil Nadu. Design, installation, approvals and O&M by one team.',
    eyebrow: 'Business & industry',
    h1: 'Solar for shops, offices, mills and factories',
    intro: 'Businesses use most of their power in daylight, exactly when solar produces. A plant on your roof or land offsets the costliest daytime units and keeps working for decades with simple upkeep.',
    service: 'Commercial and industrial solar EPC',
    sections: [
      { h2: 'What we build', list: [
        'Rooftop plants on RCC roofs and metal-sheet sheds, with structures matched to the roof',
        'Ground-mount plants for factories and estates with open land',
        'String inverters and monitoring, sized to your connected load and tariff',
        'Protection, earthing and cabling to the standards your EB inspection expects',
      ] },
      { h2: 'Why it pays', p: [
        'Commercial and industrial tariffs are higher than domestic ones, so every solar unit you use yourself saves more. Daytime-heavy loads — looms, compressors, cold rooms, air-conditioning — match the solar curve closely.',
        'Businesses registered under GST can usually claim input tax credit on the system, and solar plants generally qualify for accelerated depreciation. Confirm both with your CA for your situation.',
      ] },
      { h2: 'Metering and approvals', p: [
        'The arrangement your plant can use — net metering or another scheme — depends on your EB connection, tariff category and plant size. We check what your connection allows before we design, then file the applications and arrange the inspection.',
      ] },
      { h2: 'After switch-on', p: [
        'Monitoring shows daily generation so drops are caught early. Our maintenance plans cover cleaning schedules, inverter checks, thermal and earthing tests, and quick breakdown support.',
      ] },
    ],
    faq: [1, 5, 7, 8],
  },
  {
    slug: 'solar-water-pumps',
    nav: 'Farms & pumps',
    short: 'Farms & pumps',
    type: 'Farm',
    title: 'Solar Water Pumps & Off-grid Solar for Farms, Tamil Nadu',
    description: 'Solar water pumps and off-grid solar for farms in Tamil Nadu — replace diesel, run borewell and surface pumps on sunlight, with installation and service by AVN Solar.',
    eyebrow: 'Farms',
    h1: 'Solar water pumps and off-grid power for farms',
    intro: 'A solar pump runs on free daylight — no diesel to buy, carry or store, and no waiting for three-phase supply hours. We size the panels and pump to your water source and how much you irrigate.',
    service: 'Solar water pump and off-grid solar installation',
    sections: [
      { h2: 'What we install', list: [
        'Solar pumping systems for borewells (submersible) and open wells or canals (surface pumps)',
        'Panels on a sturdy ground structure, with a controller matched to the pump',
        'Off-grid solar with batteries for farm houses, sheds and lighting',
        'Earthing and lightning protection for open fields',
      ] },
      { h2: 'Sizing a solar pump', p: [
        'The right size depends on the depth to water, how far and how high the water travels, and how much you need each day. We measure these on site before recommending a pump and panel size, so the system delivers water through the season you need it most.',
        'Pumping is strongest from mid-morning to afternoon and slows on cloudy days, so many farmers schedule irrigation around the sun or store water in a sump or tank.',
      ] },
      { h2: 'Government pump schemes', p: [
        'Central and state schemes such as PM-KUSUM have supported solar pumps for farmers, with eligibility and openings that vary by district and year. Tell us your location and we will check what is currently open for you.',
      ] },
    ],
    faq: [8, 9],
  },
  {
    slug: 'solar-maintenance-amc',
    nav: 'Maintenance & AMC',
    short: 'Maintenance',
    type: 'Home',
    title: 'Solar Panel Cleaning, Maintenance & AMC in Tamil Nadu',
    description: 'Solar panel cleaning, inverter and earthing checks, generation monitoring and annual maintenance contracts (AMC) for homes, businesses and farms across Tamil Nadu.',
    eyebrow: 'Care & AMC',
    h1: 'Solar maintenance and AMC that keep every panel earning',
    intro: 'Dust, bird droppings and loose connections quietly eat into generation. A simple maintenance routine keeps your system producing what it was designed to — and catches problems before they become breakdowns.',
    service: 'Solar plant maintenance and annual maintenance contracts',
    sections: [
      { h2: 'What a visit covers', list: [
        'Panel cleaning with soft water and non-abrasive tools',
        'Inverter health check, error log review and firmware status',
        'Tightness and heating checks on DC and AC connections, MC4 connectors and ACDB / DCDB',
        'Earthing resistance and lightning arrester checks',
        'Structure and fastener inspection, and a generation review against what your system should make',
      ] },
      { h2: 'Plans for every size', p: [
        'Homes usually need a few cleanings and one or two technical visits a year. Commercial and industrial plants benefit from more frequent cleaning and scheduled preventive maintenance. We quote an annual maintenance contract to suit your site, including systems installed by others after an initial inspection.',
      ] },
      { h2: 'Breakdown support', p: [
        'If your app shows zero or low generation, call or WhatsApp us. Our local team diagnoses inverter faults, tripping and wiring issues, and coordinates manufacturer warranty claims where they apply.',
      ] },
    ],
    faq: [8, 9],
  },
];

module.exports = { FAQ, STEPS, SERVICES };
