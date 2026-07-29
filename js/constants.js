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

/* ----- GDPR consent (see cookie.js) ----- */

/** @type {string} localStorage key recording that the cookie banner was answered */
export const COOKIE_CONSENT_KEY = "cardanoskating-cookie-consent";

/** @type {string} localStorage key recording the consent to load Google Maps */
export const MAPS_CONSENT_KEY = "cardanoskating-maps-consent";

/** @type {string} value written in the consent keys once a choice is made */
export const CONSENT_ACCEPTED = "accepted";

/**
 * @type {string} Google Maps embed URL of the venue. Requested only after
 * explicit consent, never at page load.
 */
export const MAPS_EMBED_SRC = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3523.2955218952584!2d8.754816176685756!3d45.647898736423926!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x4786621e97732ca7%3A0xf3e767fe66f8c607!2sPista%20di%20Pattinaggio%20Cardano%20al%20Campo!5e1!3m2!1sit!2sit!4v1785311146491!5m2!1sit!2sit";

/** @type {string} translation key of the map iframe accessible title */
export const MAPS_TITLE_KEY = "map.iframeTitle";

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
        "a11y.cookieBanner": "Preferenze cookie",

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
        "hero.sub": "Pattinaggio corsa dal 1981. Rotelle e ghiaccio: entra in pista con noi.",
        "hero.cta": "Scopri i corsi",

        "about.title": "Una storia che corre da tre generazioni",
        "about.p1": "Cardano Skating nasce nel 2018 dalla fusione di due storiche società del territorio: il Faro Skating Club, fondato nel 1981, e Cardano Inline, nata nel 2007. Due tradizioni diverse, un'unica passione: la velocità sui pattini.",
        "about.p2": "Oggi la società allena atleti di tutte le età al pattinodromo di via Carreggia, portando i colori di Cardano al Campo sulle piste di tutta Italia, su rotelle e su ghiaccio.",
        "about.t1981": "Nasce la prima anima del club: decenni di pattinaggio corsa a Cardano al Campo.",
        "about.t2007": "La seconda anima: una nuova generazione di pattinatori in linea cresce in città.",
        "about.t2018": "Le due società si fondono: nasce Cardano Skating, un solo club per rotelle e ghiaccio.",

        "disciplines.title": "Due modi di andare veloce",
        "disciplines.rollerTitle": "Corsa a rotelle",
        "disciplines.rollerText": "La disciplina regina del club: pattinaggio corsa in linea su pista e su strada, dalle prime gare regionali ai campionati nazionali.",
        "disciplines.iceTitle": "Ghiaccio pista lunga",
        "disciplines.iceText": "D'inverno le rotelle lasciano il posto alle lame: velocità pura sull'anello di ghiaccio, nella tradizione dello speed skating.",

        "venue.title": "La nostra casa: il pattinodromo di via Carreggia",
        "venue.p1": "Il pattinodromo comunale di via Carreggia, a Cardano al Campo, è il cuore delle nostre attività: una pista sopraelevata di 200m con curve a pendenza variabile e un circuito stradale asfaltato, immersi nel verde.",
        "venue.f1": "Pista per pattinaggio corsa",
        "venue.f2": "Circuito stradale asfaltato",
        "venue.f3": "Illuminazione per gli allenamenti serali",
        "venue.photoAlt": "L'impianto di Cardano al Campo illuminato al tramonto",

        "courses.title": "In pista si comincia da piccoli. O da grandi.",
        "courses.p1": "Dai primi passi sui pattini fino all'agonismo: i nostri corsi accompagnano bambini, ragazzi e adulti con lo staff tecnico della società. Scrivici per conoscere giorni, orari e come provare.",
        "courses.cta": "Scrivici per i corsi",
        "courses.note": "corsi@cardanoskating.it · Flora ti risponderà",

        "gallery.title": "L'impianto",
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
        "contacts.mapTitle": "Dove siamo",

        "map.consentText": "La mappa è fornita da Google Maps (Google LLC, Stati Uniti): caricandola, Google riceve il tuo indirizzo IP e può installare cookie di terze parti sul tuo dispositivo. Finché non acconsenti, nessun dato viene inviato a Google.",
        "map.consentBtn": "Accetta e mostra la mappa",
        "map.consentNote": "Puoi revocare il consenso in qualsiasi momento. Tutti i dettagli nella",
        "map.externalLink": "Oppure apri il pattinodromo su Google Maps in una nuova finestra",
        "map.iframeTitle": "Mappa Google Maps del pattinodromo di Cardano al Campo",

        "cookie.text": "Questo sito usa solo tecnologie tecniche necessarie al suo funzionamento, salvate nel tuo browser. Nella sezione Contatti la mappa di Google Maps viene caricata soltanto se accetti i cookie di terze parti.",
        "cookie.accept": "Accetta tutti",
        "cookie.reject": "Solo tecnici",
        "cookie.policy": "Privacy & Cookie Policy",
        "cookie.prefs": "Gestisci preferenze cookie",

        "footer.tag": "Pattinaggio corsa a rotelle e su ghiaccio",

        "policy.metaTitle": "Privacy & Cookie Policy — Cardano Skating",
        "policy.back": "Torna al sito",
        "policy.tag": "Informativa",
        "policy.title": "Privacy & Cookie Policy",
        "policy.updated": "Ultimo aggiornamento: luglio 2026",

        "policy.s1title": "1. Titolare del trattamento",
        "policy.s1p1": "Il titolare del trattamento dei dati personali raccolti tramite questo sito è Cardano Skating S.S.D. S.R.L., con sede a Cardano al Campo (VA), Italia.",
        "policy.s1p2": "Per qualsiasi richiesta relativa alla privacy puoi scrivere a:",

        "policy.s2title": "2. Cosa sono cookie e localStorage",
        "policy.s2p1": "I cookie sono piccoli file di testo che un sito salva nel browser di chi lo visita. Questa informativa riguarda anche il localStorage, un'area di memoria del browser con finalità analoghe: è la tecnologia effettivamente usata da questo sito.",
        "policy.s2p2": "Il sito non imposta alcun cookie proprio: le informazioni elencate al punto 3 restano nel tuo browser e non vengono mai trasmesse ai nostri server.",

        "policy.s3title": "3. Dati salvati nel tuo browser",
        "policy.s3p1": "Il sito usa esclusivamente tecnologie tecniche strettamente necessarie, esenti dall'obbligo di consenso ai sensi dell'art. 122 del D.Lgs. 196/2003:",
        "policy.s3li1": "Memorizza la lingua che hai scelto (\"it\" oppure \"en\"). Tipo: localStorage. Durata: fino alla cancellazione manuale.",
        "policy.s3li2": "Registra che hai risposto al banner cookie, così non ti viene mostrato a ogni visita. Tipo: localStorage. Durata: fino alla cancellazione manuale.",
        "policy.s3li3": "Registra il tuo consenso al caricamento di Google Maps. Tipo: localStorage. Durata: fino alla cancellazione manuale.",
        "policy.s3p2": "Nessuna di queste voci contiene dati identificativi e nessuna consente di profilarti.",

        "policy.s4title": "4. Servizi di terze parti",
        "policy.s4p1": "Font, immagini e video sono ospitati direttamente su questo sito: al caricamento della pagina il browser non contatta alcun dominio esterno.",
        "policy.s4maps": "Nella sezione Contatti è disponibile una mappa interattiva fornita da Google Maps (Google LLC, Stati Uniti). L'iframe viene caricato soltanto dopo il tuo consenso esplicito: prima di quel momento vedi un segnaposto locale e nessuna richiesta raggiunge i server di Google. Se acconsenti, Google riceve il tuo indirizzo IP e può installare cookie sul tuo dispositivo, tra cui:",
        "policy.s4liNid": "Cookie di preferenza e personalizzazione di Google. Durata: 6 mesi dall'ultimo utilizzo. Dominio: .google.com.",
        "policy.s4liSocs": "Memorizza le scelte di consenso relative ai servizi Google. Durata: 13 mesi. Dominio: .google.com.",
        "policy.s4mapsNote": "L'elenco è indicativo: i cookie effettivamente installati sono decisi da Google e possono cambiare nel tempo. Per i dettagli aggiornati:",
        "policy.s4googleLink": "Informativa sui cookie di Google",
        "policy.s4social": "Il sito contiene link alle pagine ufficiali del club su Instagram e Facebook (Meta Platforms, Inc., Stati Uniti). Sono semplici collegamenti ipertestuali: nessun widget, pixel o script di Meta è incorporato nelle pagine. Meta tratta i tuoi dati solo se scegli di seguire il link.",
        "policy.s4metaLink": "Informativa sulla privacy di Meta",
        "policy.s4hosting": "Il sito è pubblicato tramite GitHub Pages (GitHub, Inc. / Microsoft Corporation, Stati Uniti), che distribuisce i contenuti attraverso la CDN di Fastly (Fastly, Inc., Stati Uniti). Per erogare il servizio questi fornitori registrano automaticamente dati tecnici di accesso, indipendentemente dai cookie:",
        "policy.s4liGithub": "Hosting dei contenuti statici. Registra log tecnici (indirizzo IP, user-agent, URL richiesto, data e ora) e li conserva secondo le proprie policy.",
        "policy.s4liFastly": "Rete di distribuzione dei contenuti (CDN) usata da GitHub Pages. Elabora gli stessi dati tecnici lungo il percorso di rete, secondo le proprie policy operative.",
        "policy.s4retention": "GitHub e Fastly non pubblicano un termine numerico di conservazione per i log di accesso: si applicano i periodi e i criteri indicati nelle rispettive informative, collegate qui sotto.",
        "policy.s4hostingNote": "Per approfondire:",
        "policy.s4githubLink": "Privacy Statement di GitHub",
        "policy.s4fastlyLink": "Privacy Policy di Fastly",

        "policy.s5title": "5. Trasferimento dei dati fuori dall'Unione Europea",
        "policy.s5p1": "Google LLC, GitHub, Inc. e Fastly, Inc. hanno sede negli Stati Uniti: l'uso della mappa e la semplice consultazione del sito possono comportare il trasferimento di dati tecnici (in particolare l'indirizzo IP) al di fuori dello Spazio Economico Europeo.",
        "policy.s5p2": "I trasferimenti avvengono con le garanzie previste dal Capo V del GDPR: la decisione di adeguatezza sul Data Privacy Framework UE–USA del 10 luglio 2023 per i fornitori certificati e/o le Clausole Contrattuali Standard approvate dalla Commissione Europea (art. 46 GDPR). Puoi verificare la certificazione di ciascun fornitore nell'elenco ufficiale:",
        "policy.s5dpfLink": "Elenco Data Privacy Framework",

        "policy.s6title": "6. Dati che raccogliamo direttamente",
        "policy.s6p1": "Questo sito non raccoglie direttamente dati personali: non ci sono moduli di contatto, aree riservate, iscrizioni a newsletter né strumenti di analisi statistica o di tracciamento.",
        "policy.s6p2": "Gli indirizzi email e i numeri di telefono pubblicati nella sezione Contatti servono solo a permetterti di scriverci o chiamarci. Se ci contatti, i dati che ci fornisci (nome, recapito, contenuto del messaggio) sono trattati per rispondere alla tua richiesta e conservati per il tempo necessario a gestirla.",

        "policy.s7title": "7. Base giuridica del trattamento",
        "policy.s7p1": "Tecnologie tecniche necessarie al funzionamento del sito: legittimo interesse del titolare (art. 6, par. 1, lett. f GDPR), con esenzione dal consenso ai sensi dell'art. 122 del D.Lgs. 196/2003.",
        "policy.s7p2": "Caricamento di Google Maps: tuo consenso esplicito (art. 6, par. 1, lett. a GDPR), prestato tramite il banner o il pulsante sul segnaposto della mappa e revocabile in qualsiasi momento.",
        "policy.s7p3": "Log tecnici di hosting e CDN: legittimo interesse a erogare il sito in modo sicuro e affidabile (art. 6, par. 1, lett. f GDPR).",

        "policy.s8title": "8. Revocare il consenso e cancellare i dati",
        "policy.s8p1": "Puoi revocare il consenso a Google Maps in qualsiasi momento con il pulsante \"Gestisci preferenze cookie\", presente in basso a sinistra e nel footer di ogni pagina: la mappa torna subito al segnaposto e i consensi salvati vengono cancellati.",
        "policy.s8p2": "Puoi anche cancellare tutto manualmente dalle impostazioni del browser (eliminazione di cookie e dati dei siti) oppure dagli strumenti per sviluppatori, alla voce Application › Local Storage. Dopo la cancellazione il sito torna alla lingua predefinita e il banner ricompare.",

        "policy.s9title": "9. I tuoi diritti",
        "policy.s9intro": "Ai sensi degli artt. 15–22 del GDPR (Reg. UE 2016/679) puoi esercitare in qualsiasi momento i seguenti diritti:",
        "policy.s9r1t": "Accesso",
        "policy.s9r1d": "Sapere se trattiamo tuoi dati e ottenerne copia.",
        "policy.s9r2t": "Rettifica",
        "policy.s9r2d": "Chiedere la correzione di dati inesatti o incompleti.",
        "policy.s9r3t": "Cancellazione",
        "policy.s9r3d": "Chiedere la cancellazione dei dati (\"diritto all'oblio\").",
        "policy.s9r4t": "Limitazione",
        "policy.s9r4d": "Chiedere che il trattamento sia limitato a determinate finalità.",
        "policy.s9r5t": "Opposizione",
        "policy.s9r5d": "Opporti al trattamento basato sul legittimo interesse.",
        "policy.s9r6t": "Portabilità",
        "policy.s9r6d": "Ricevere i tuoi dati in un formato strutturato e leggibile.",
        "policy.s9r7t": "Revoca",
        "policy.s9r7d": "Revocare in ogni momento i consensi prestati, senza pregiudicare la liceità del trattamento precedente.",
        "policy.s9p2": "Per esercitare questi diritti scrivi a:",
        "policy.s9p3": "Se ritieni che il trattamento dei tuoi dati violi la normativa puoi proporre reclamo all'autorità di controllo italiana:",
        "policy.s9garante": "Garante per la protezione dei dati personali",

        "policy.s10title": "10. Modifiche a questa informativa",
        "policy.s10p1": "Possiamo aggiornare questa informativa per riflettere modifiche al sito o alla normativa applicabile. La versione in vigore è sempre quella pubblicata su questa pagina, con la data di aggiornamento indicata in alto."
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
        "a11y.cookieBanner": "Cookie preferences",

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
        "hero.sub": "Speed skating since 1981. Inline and ice: hit the track with us.",
        "hero.cta": "Discover our courses",

        "about.title": "A story racing across three generations",
        "about.p1": "Cardano Skating was born in 2018 from the merger of two historic local clubs: Faro Skating Club, founded in 1981, and Cardano Inline, founded in 2007. Two different traditions, one passion: speed on skates.",
        "about.p2": "Today the club trains athletes of all ages at the via Carreggia skating track, flying the colours of Cardano al Campo on tracks all over Italy, on wheels and on ice.",
        "about.t1981": "The club's first soul is born: decades of speed skating in Cardano al Campo.",
        "about.t2007": "The second soul: a new generation of inline skaters grows up in town.",
        "about.t2018": "The two clubs merge: Cardano Skating is born, one club for wheels and ice.",

        "disciplines.title": "Two ways to go fast",
        "disciplines.rollerTitle": "Inline speed skating",
        "disciplines.rollerText": "The club's flagship discipline: inline speed skating on track and road, from the first regional races to national championships.",
        "disciplines.iceTitle": "Long track ice skating",
        "disciplines.iceText": "In winter, wheels give way to blades: pure speed on the ice ring, in the tradition of speed skating.",

        "venue.title": "Our home: the via Carreggia skating track",
        "venue.p1": "The municipal skating track in via Carreggia, Cardano al Campo, is the heart of our activities: a 200m banked track with variable-slope curves and a paved road circuit, surrounded by greenery.",
        "venue.f1": "Speed skating track",
        "venue.f2": "Paved road circuit",
        "venue.f3": "Floodlights for evening training",
        "venue.photoAlt": "The Cardano al Campo venue lit up at sunset",

        "courses.title": "You can start young. Or grown up.",
        "courses.p1": "From the very first steps on skates to competitive racing: our courses support kids, teens and adults with the club's technical staff. Write to us to find out days, times and how to try.",
        "courses.cta": "Ask about courses",
        "courses.note": "corsi@cardanoskating.it · Flora will get back to you",

        "gallery.title": "The venue",
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
        "contacts.mapTitle": "Where we are",

        "map.consentText": "The map is provided by Google Maps (Google LLC, USA): loading it means Google receives your IP address and may set third-party cookies on your device. Until you agree, no data is sent to Google.",
        "map.consentBtn": "Accept and show the map",
        "map.consentNote": "You can withdraw your consent at any time. Full details in our",
        "map.externalLink": "Or open the skating track on Google Maps in a new window",
        "map.iframeTitle": "Google Maps map of the Cardano al Campo skating track",

        "cookie.text": "This site only uses technical technologies needed to work, stored in your browser. In the Contacts section the Google Maps map is loaded only if you accept third-party cookies.",
        "cookie.accept": "Accept all",
        "cookie.reject": "Technical only",
        "cookie.policy": "Privacy & Cookie Policy",
        "cookie.prefs": "Manage cookie preferences",

        "footer.tag": "Roller and ice speed skating",

        "policy.metaTitle": "Privacy & Cookie Policy — Cardano Skating",
        "policy.back": "Back to the site",
        "policy.tag": "Legal notice",
        "policy.title": "Privacy & Cookie Policy",
        "policy.updated": "Last updated: July 2026",

        "policy.s1title": "1. Data controller",
        "policy.s1p1": "The controller of the personal data collected through this website is Cardano Skating S.S.D. S.R.L., based in Cardano al Campo (VA), Italy.",
        "policy.s1p2": "For any privacy-related request you can write to:",

        "policy.s2title": "2. What cookies and localStorage are",
        "policy.s2p1": "Cookies are small text files a website saves in the visitor's browser. This notice also covers localStorage, a browser storage area serving a similar purpose: that is the technology actually used by this site.",
        "policy.s2p2": "The site sets no cookies of its own: the entries listed in section 3 stay in your browser and are never transmitted to our servers.",

        "policy.s3title": "3. Data stored in your browser",
        "policy.s3p1": "The site only uses strictly necessary technical technologies, exempt from consent under art. 122 of Italian Legislative Decree 196/2003:",
        "policy.s3li1": "Stores the language you selected (\"it\" or \"en\"). Type: localStorage. Duration: until manually deleted.",
        "policy.s3li2": "Records that you answered the cookie banner, so it is not shown on every visit. Type: localStorage. Duration: until manually deleted.",
        "policy.s3li3": "Records your consent to load Google Maps. Type: localStorage. Duration: until manually deleted.",
        "policy.s3p2": "None of these entries contains identifying data and none allows you to be profiled.",

        "policy.s4title": "4. Third-party services",
        "policy.s4p1": "Fonts, images and videos are hosted on this site itself: when the page loads, your browser contacts no external domain.",
        "policy.s4maps": "The Contacts section offers an interactive map provided by Google Maps (Google LLC, USA). The iframe is loaded only after your explicit consent: before that you see a local placeholder and no request reaches Google's servers. If you agree, Google receives your IP address and may set cookies on your device, including:",
        "policy.s4liNid": "Google preference and personalisation cookie. Duration: 6 months from your last use. Domain: .google.com.",
        "policy.s4liSocs": "Stores your consent choices for Google services. Duration: 13 months. Domain: .google.com.",
        "policy.s4mapsNote": "This list is indicative: the cookies actually set are decided by Google and may change over time. For up-to-date details:",
        "policy.s4googleLink": "Google cookie notice",
        "policy.s4social": "The site links to the club's official Instagram and Facebook pages (Meta Platforms, Inc., USA). These are plain hyperlinks: no Meta widget, pixel or script is embedded in the pages. Meta processes your data only if you choose to follow the link.",
        "policy.s4metaLink": "Meta privacy policy",
        "policy.s4hosting": "The site is published through GitHub Pages (GitHub, Inc. / Microsoft Corporation, USA), which delivers the content via Fastly's CDN (Fastly, Inc., USA). To provide the service these vendors automatically record technical access data, regardless of cookies:",
        "policy.s4liGithub": "Hosting of the static content. Records technical logs (IP address, user-agent, requested URL, date and time) and retains them according to its own policies.",
        "policy.s4liFastly": "Content delivery network (CDN) used by GitHub Pages. Processes the same technical data along the network path, according to its own operational policies.",
        "policy.s4retention": "GitHub and Fastly do not publish a numeric retention term for access logs: the periods and criteria set out in their own privacy notices apply, linked below.",
        "policy.s4hostingNote": "Further reading:",
        "policy.s4githubLink": "GitHub Privacy Statement",
        "policy.s4fastlyLink": "Fastly Privacy Policy",

        "policy.s5title": "5. Data transfers outside the European Union",
        "policy.s5p1": "Google LLC, GitHub, Inc. and Fastly, Inc. are based in the United States: using the map, and simply browsing the site, may involve transferring technical data (in particular your IP address) outside the European Economic Area.",
        "policy.s5p2": "Transfers rely on the safeguards of Chapter V of the GDPR: the EU–US Data Privacy Framework adequacy decision of 10 July 2023 for certified vendors and/or the Standard Contractual Clauses approved by the European Commission (art. 46 GDPR). You can check each vendor's certification in the official list:",
        "policy.s5dpfLink": "Data Privacy Framework list",

        "policy.s6title": "6. Data we collect directly",
        "policy.s6p1": "This site collects no personal data directly: there are no contact forms, no restricted areas, no newsletter sign-ups and no analytics or tracking tools.",
        "policy.s6p2": "The email addresses and phone numbers published in the Contacts section are there so you can write or call us. If you contact us, the data you provide (name, contact details, message content) is processed to answer your request and kept for as long as needed to handle it.",

        "policy.s7title": "7. Legal basis for processing",
        "policy.s7p1": "Technical technologies needed for the site to work: the controller's legitimate interest (art. 6(1)(f) GDPR), exempt from consent under art. 122 of Italian Legislative Decree 196/2003.",
        "policy.s7p2": "Loading Google Maps: your explicit consent (art. 6(1)(a) GDPR), given through the banner or the button on the map placeholder and withdrawable at any time.",
        "policy.s7p3": "Hosting and CDN technical logs: legitimate interest in delivering the site securely and reliably (art. 6(1)(f) GDPR).",

        "policy.s8title": "8. Withdrawing consent and deleting data",
        "policy.s8p1": "You can withdraw your consent to Google Maps at any time with the \"Manage cookie preferences\" button, available at the bottom left and in the footer of every page: the map immediately returns to its placeholder and the stored consents are deleted.",
        "policy.s8p2": "You can also delete everything manually from your browser settings (clearing cookies and site data) or from the developer tools, under Application › Local Storage. After deletion the site goes back to its default language and the banner reappears.",

        "policy.s9title": "9. Your rights",
        "policy.s9intro": "Under artt. 15–22 of the GDPR (Reg. EU 2016/679) you may exercise the following rights at any time:",
        "policy.s9r1t": "Access",
        "policy.s9r1d": "Know whether we process your data and obtain a copy of it.",
        "policy.s9r2t": "Rectification",
        "policy.s9r2d": "Ask for inaccurate or incomplete data to be corrected.",
        "policy.s9r3t": "Erasure",
        "policy.s9r3d": "Ask for your data to be deleted (\"right to be forgotten\").",
        "policy.s9r4t": "Restriction",
        "policy.s9r4d": "Ask for processing to be restricted to specific purposes.",
        "policy.s9r5t": "Objection",
        "policy.s9r5d": "Object to processing based on legitimate interest.",
        "policy.s9r6t": "Portability",
        "policy.s9r6d": "Receive your data in a structured, machine-readable format.",
        "policy.s9r7t": "Withdrawal",
        "policy.s9r7d": "Withdraw any consent at any time, without affecting the lawfulness of prior processing.",
        "policy.s9p2": "To exercise these rights, write to:",
        "policy.s9p3": "If you believe the processing of your data breaches the law, you may lodge a complaint with the Italian supervisory authority:",
        "policy.s9garante": "Italian Data Protection Authority",

        "policy.s10title": "10. Changes to this notice",
        "policy.s10p1": "We may update this notice to reflect changes to the site or to applicable law. The version in force is always the one published on this page, with the update date shown at the top."
    }
};
