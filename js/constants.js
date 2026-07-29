/*
 * constants.js — shared constants: no logic here.
 */

/** @type {string} localStorage key holding the chosen language */
export const LANG_STORAGE_KEY = "cardanoskating-lang";

/** @type {string} language the page ships in (the HTML source is Italian) */
export const DEFAULT_LANG = "it";

/** @type {number} scroll offset (px) after which the top bar turns solid */
export const TOPBAR_SOLID_SCROLL_Y = 40;

/** @type {number} duration (ms) of the nav overlay fade-out transition */
export const NAV_OVERLAY_FADE_MS = 350;

/**
 * @type {number} safety timeout (ms) used to end a programmatic scroll on
 * browsers that do not fire the `scrollend` event
 */
export const SCROLLEND_FALLBACK_MS = 1500;

/**
 * Translation dictionaries, flat "section.key" keys.
 * The HTML elements reference them through data attributes:
 *   data-i18n         -> text content
 *   data-i18n-label   -> aria-label attribute
 *   data-i18n-alt     -> alt attribute (images)
 *   data-i18n-content -> content attribute (meta tags)
 * @type {Object<string, Object<string, string>>}
 */
export const TRANSLATIONS = {
    it: {
        "meta.title": "Cardano Skating — Pattinaggio corsa a rotelle e ghiaccio",
        "meta.description": "Cardano Skating: società di pattinaggio corsa a rotelle e su ghiaccio a Cardano al Campo (VA). Corsi per tutte le età al pattinodromo di via Carreggia.",

        "a11y.skip": "Salta al contenuto",
        "a11y.brandHome": "Cardano Skating — Home",
        "a11y.openMenu": "Apri il menu",
        "a11y.closeMenu": "Chiudi il menu",
        "a11y.mainNav": "Navigazione principale",
        "a11y.scrollDown": "Scorri alla sezione successiva",
        "a11y.closeImage": "Chiudi l'immagine",
        "a11y.switchLang": "Switch to English",

        "nav.home": "Home",
        "nav.about": "Chi siamo",
        "nav.disciplines": "Discipline",
        "nav.venue": "Impianto",
        "nav.courses": "Corsi",
        "nav.gallery": "Gallery",
        "nav.sponsors": "Sponsor",
        "nav.contacts": "Contatti",

        "hero.kicker": "Cardano al Campo · Varese",
        "hero.title1": "Velocità su rotelle",
        "hero.title2": "e su ghiaccio",
        "hero.sub": "Pattinaggio corsa dal 1981. Rotelle, freestyle e ghiaccio: entra in pista con noi.",
        "hero.cta": "Scopri i corsi",

        "about.title": "Una storia che corre da tre generazioni",
        "about.p1": "Cardano Skating nasce nel 2018 dalla fusione di due storiche società del territorio: il Faro Skating Club, fondato nel 1981, e Cardano In Line, nata nel 2007. Due tradizioni diverse, un'unica passione: la velocità sui pattini.",
        "about.p2": "Oggi la società allena atleti di tutte le età al pattinodromo di via Carreggia, portando i colori di Cardano al Campo sulle piste di tutta Italia, su rotelle e su ghiaccio.",
        "about.t1981": "Nasce la prima anima del club: decenni di pattinaggio corsa a Cardano al Campo.",
        "about.t2007": "La seconda anima: una nuova generazione di pattinatori in linea cresce in città.",
        "about.t2018": "Le due società si fondono: nasce Cardano Skating, un solo club per rotelle e ghiaccio.",

        "disciplines.title": "Tre modi di andare veloce",
        "disciplines.rollerTitle": "Corsa a rotelle",
        "disciplines.rollerText": "La disciplina regina del club: pattinaggio corsa in linea su pista e su strada, dalle prime gare regionali ai campionati nazionali.",
        "disciplines.freestyleTitle": "Freestyle",
        "disciplines.freestyleText": "Slalom tra i coni, salti e tecnica: la faccia più spettacolare e creativa del pattinaggio a rotelle.",
        "disciplines.iceTitle": "Ghiaccio pista lunga",
        "disciplines.iceText": "D'inverno le rotelle lasciano il posto alle lame: velocità pura sull'anello di ghiaccio, nella tradizione dello speed skating.",

        "venue.title": "La nostra casa: il pattinodromo di via Carreggia",
        "venue.p1": "Il pattinodromo comunale di via Carreggia, a Cardano al Campo, è il cuore delle nostre attività: un anello dedicato alla velocità e un circuito stradale asfaltato, immersi nel verde.",
        "venue.f1": "Anello per il pattinaggio corsa",
        "venue.f2": "Circuito stradale asfaltato",
        "venue.f3": "Illuminazione per gli allenamenti serali",
        "venue.photoAlt": "L'impianto di Cardano al Campo illuminato al tramonto",

        "courses.title": "In pista si comincia da piccoli. O da grandi.",
        "courses.p1": "Dai primi passi sui pattini fino all'agonismo: i nostri corsi accompagnano bambini, ragazzi e adulti con lo staff tecnico della società. Scrivici per conoscere giorni, orari e come provare.",
        "courses.cta": "Scrivici per i corsi",
        "courses.note": "corsi@cardanoskating.it · Flora ti risponderà",

        "gallery.title": "L'impianto visto dal drone",
        "gallery.alt1": "Vista aerea del pattinodromo di Cardano al Campo",
        "gallery.alt2": "L'anello di pattinaggio visto dall'alto",
        "gallery.alt3": "Panoramica dell'impianto e del circuito stradale",
        "gallery.alt4": "Il pattinodromo immerso nel verde",
        "gallery.alt5": "L'impianto illuminato al tramonto",
        "gallery.alt6": "La pista sotto i riflettori in notturna",

        "sponsors.title": "Chi corre con noi",

        "contacts.title": "Vieni a trovarci in pista",
        "contacts.intro": "Pattinodromo di via Carreggia, Cardano al Campo (VA)",
        "contacts.email": "Email",
        "contacts.phone": "Telefono",

        "footer.tag": "Pattinaggio corsa a rotelle e su ghiaccio"
    },

    en: {
        "meta.title": "Cardano Skating — Roller and ice speed skating",
        "meta.description": "Cardano Skating: roller and ice speed skating club in Cardano al Campo (VA), Italy. Courses for all ages at the via Carreggia skating track.",

        "a11y.skip": "Skip to content",
        "a11y.brandHome": "Cardano Skating — Home",
        "a11y.openMenu": "Open menu",
        "a11y.closeMenu": "Close menu",
        "a11y.mainNav": "Main navigation",
        "a11y.scrollDown": "Scroll to the next section",
        "a11y.closeImage": "Close image",
        "a11y.switchLang": "Passa all'italiano",

        "nav.home": "Home",
        "nav.about": "About us",
        "nav.disciplines": "Disciplines",
        "nav.venue": "Venue",
        "nav.courses": "Courses",
        "nav.gallery": "Gallery",
        "nav.sponsors": "Sponsors",
        "nav.contacts": "Contacts",

        "hero.kicker": "Cardano al Campo · Varese, Italy",
        "hero.title1": "Speed on wheels",
        "hero.title2": "and on ice",
        "hero.sub": "Speed skating since 1981. Inline, freestyle and ice: hit the track with us.",
        "hero.cta": "Discover our courses",

        "about.title": "A story racing across three generations",
        "about.p1": "Cardano Skating was born in 2018 from the merger of two historic local clubs: Faro Skating Club, founded in 1981, and Cardano In Line, founded in 2007. Two different traditions, one passion: speed on skates.",
        "about.p2": "Today the club trains athletes of all ages at the via Carreggia skating track, flying the colours of Cardano al Campo on tracks all over Italy, on wheels and on ice.",
        "about.t1981": "The club's first soul is born: decades of speed skating in Cardano al Campo.",
        "about.t2007": "The second soul: a new generation of inline skaters grows up in town.",
        "about.t2018": "The two clubs merge: Cardano Skating is born, one club for wheels and ice.",

        "disciplines.title": "Three ways to go fast",
        "disciplines.rollerTitle": "Inline speed skating",
        "disciplines.rollerText": "The club's flagship discipline: inline speed skating on track and road, from the first regional races to national championships.",
        "disciplines.freestyleTitle": "Freestyle",
        "disciplines.freestyleText": "Cone slalom, jumps and technique: the most spectacular and creative side of roller skating.",
        "disciplines.iceTitle": "Long track ice skating",
        "disciplines.iceText": "In winter, wheels give way to blades: pure speed on the ice ring, in the tradition of speed skating.",

        "venue.title": "Our home: the via Carreggia skating track",
        "venue.p1": "The municipal skating track in via Carreggia, Cardano al Campo, is the heart of our activities: a ring dedicated to speed and a paved road circuit, surrounded by greenery.",
        "venue.f1": "Speed skating ring",
        "venue.f2": "Paved road circuit",
        "venue.f3": "Floodlights for evening training",
        "venue.photoAlt": "The Cardano al Campo venue lit up at sunset",

        "courses.title": "You can start young. Or grown up.",
        "courses.p1": "From the very first steps on skates to competitive racing: our courses support kids, teens and adults with the club's technical staff. Write to us to find out days, times and how to try.",
        "courses.cta": "Ask about courses",
        "courses.note": "corsi@cardanoskating.it · Flora will get back to you",

        "gallery.title": "The venue seen from the drone",
        "gallery.alt1": "Aerial view of the Cardano al Campo skating track",
        "gallery.alt2": "The skating ring seen from above",
        "gallery.alt3": "Overview of the venue and the road circuit",
        "gallery.alt4": "The skating track surrounded by greenery",
        "gallery.alt5": "The venue lit up at sunset",
        "gallery.alt6": "The track under the floodlights at night",

        "sponsors.title": "Who races with us",

        "contacts.title": "Come and see us at the track",
        "contacts.intro": "Via Carreggia skating track, Cardano al Campo (VA), Italy",
        "contacts.email": "Email",
        "contacts.phone": "Phone",

        "footer.tag": "Roller and ice speed skating"
    }
};
