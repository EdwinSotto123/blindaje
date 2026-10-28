import type { Dict } from "./types";
import { SOURCES } from "./sources";

const src = {
  exitosa: { ...SOURCES.exitosa, name: "Exitosa, with Public Ministry data (in Spanish)" },
  larepublica: { ...SOURCES.larepublica, name: "La República, editorial of June 22, 2026 (in Spanish)" },
  americatv: { ...SOURCES.americatv, name: "América TV (in Spanish)" },
  elcomercio: { ...SOURCES.elcomercio, name: "El Comercio (in Spanish)" },
  ley29733: { ...SOURCES.ley29733, name: "Law 29733 on Personal Data Protection (in Spanish)" },
};

export const en: Dict = {
  lang: "en",
  htmlLang: "en",
  meta: {
    title: "Blindaje: community intelligence against extortion",
    description:
      "An app that looks like an ordinary app for your business. Inside, it keeps the evidence of extortion, builds your police report and, if you choose, links your case with your association’s.",
    ogLocale: "en_US",
  },
  skip: "Skip to content",
  help: {
    ariaLabel: "Immediate help in Peru",
    danger: "In danger right now?",
    dangerCta: "Call 105",
    report: "To report extortion:",
    reportCta: "Línea 1818",
    exit: "Quick exit",
    exitShort: "Exit",
    exitHint: "Opens a neutral page. Shortcut: press Esc twice.",
  },
  nav: {
    ariaLabel: "Sections",
    how: "How it works",
    commitments: "Commitments",
    tech: "Technology",
    results: "Results",
    pilot: "Pilot",
    switchLabel: "Leer en español",
    switchName: "Español",
    switchShort: "ES",
    switchHref: "/",
    switchLang: "es",
  },
  hero: {
    outside: "Outside, an ordinary app for your business.",
    inside: "Inside, your case against extortion.",
    lead:
      "For shopkeepers, mototaxi drivers, transport workers and market vendors threatened with extortion in Peru. Keep voice notes, messages and photos out of sight, build a solid police report and, if you choose, link your case with your association’s so the network behind it shows.",
    ledgerLabel: "What each one gets",
    actors: [
      {
        id: "victima",
        actor: "Victim",
        text: "Keeps the evidence out of sight and builds a police report.",
        total: "Report ready",
      },
      {
        id: "comunidad",
        actor: "Community",
        text: "With consent, their case is compared with others in the association.",
        total: "Anonymous alerts",
      },
      {
        id: "autoridad",
        actor: "Authorities",
        text: "Receive already linked cases, with a timeline and chain of custody.",
        total: "Network case file",
      },
    ],
    formIntro: "Blindaje reaches people through their trade associations. Do you run one?",
    formLabel: "Your association’s name",
    formPlaceholder: "Mototaxi drivers’ association…",
    formCta: "Request a pilot",
    victimLine: "Not running an association? Tell yours about Blindaje. If you are in danger right now, call 105.",
    shotCaption: "It looks like an ordinary app for your business, and you choose which one.",
    shotAlt: "Screenshot of the Blindaje app: private notes with saved evidence",
  },
  problem: {
    label: "The problem",
    title: "Thousands of reports, and each victim faces a network alone.",
    lead:
      "Gangs work in series: the same voice calls several victims and the same account collects from different vendors. That information exists, but it is scattered across the phones of people who never meet.",
    sourcePrefix: "Source:",
    figures: [
      {
        value: "13,892",
        text: "extortion reports were filed with Peru’s Public Ministry between January and July 2026.",
        detail:
          "Prosecution districts with the most cases: Lima Este (1,806), La Libertad (1,625), Lima Sur (1,346), Lima Norte (1,305) and Lima Centro (1,178).",
        source: src.exitosa,
      },
      {
        value: "27,000+",
        text: "extortion reports closed out 2025, according to Public Prosecutor data.",
        source: src.larepublica,
      },
      {
        value: "80%",
        text: "of public transport companies admitted to paying monthly protection fees to criminal gangs.",
        detail: "At least 69 drivers were killed on the job in 2025, with extortion as the main motive.",
        source: src.larepublica,
      },
      {
        value: "4,761 to 26,217",
        text: "extortion reports over the period analyzed, while sentenced prisoners fell from 712 to 650.",
        detail: "The outlet notes the figures alone do not explain the gap: more reports do not automatically mean more convictions.",
        source: src.elcomercio,
      },
    ],
    gapTitle: "And the numbers fall short: many victims never report, for fear of retaliation.",
    gapSource: src.americatv,
    gaps: [
      {
        title: "Weak evidence",
        text: "Untranscribed WhatsApp voice notes, undated screenshots, timelines rebuilt from memory.",
      },
      {
        title: "Disconnected cases",
        text: "No one compares the voice threatening a shopkeeper with the one threatening a mototaxi driver in another district.",
      },
      {
        title: "Fear of reporting",
        text: "Victims doubt reporting helps, fear the extortioner will find out and have no one they trust to turn to.",
      },
    ],
  },
  victim: {
    label: "Victim",
    title: "Keep the evidence where no one will notice.",
    lead:
      "On the phone, Blindaje looks like an ordinary app for your business, and you choose which one. It really works. Private notes open with a secret entry and your PIN.",
    features: [
      {
        title: "Secret entry and PIN",
        text: "A gesture or a secret sale amount opens the private notes. A decoy PIN opens empty, believable notes.",
      },
      {
        title: "Quick exit",
        text: "One tap returns to the everyday app and locks it. It also locks itself when sent to the background.",
      },
      {
        title: "No traces",
        text: "Zero notifications. Evidence never lands in the photo gallery or recent files.",
      },
      {
        title: "Record, snap or paste",
        text: "WhatsApp voice notes, messages and photos go straight into the private notes.",
      },
      {
        title: "What we found",
        text: "Blindaje transcribes and highlights the facts: payment channel, deadline, the group they claim to be.",
      },
      {
        title: "Prepare my report",
        text: "Four steps to a report with a timeline and integrity fingerprints, ready to take to the police station.",
      },
    ],
    found: {
      caption: "Case A, fictitious:",
      chips: ["Demands 2,000 soles", "Via Yape", "48-hour deadline", "Photo of the shop with a bullet", "Claims to be “Los X”"],
    },
    consentTitle: "You decide what is shared.",
    consent: [
      {
        title: "My report only",
        tag: "Default",
        text: "Blindaje helps you organize your evidence and build your report. Nothing leaves your case.",
      },
      {
        title: "Community mode",
        tag: "You turn it on",
        text: "Your pseudonymized signals are compared with other cases. You can withdraw at any time.",
      },
    ],
    cloud:
      "Evidence is uploaded encrypted as soon as you save it, and only authorized people can see it. Without signal, it waits encrypted on the phone and is deleted there once the upload is confirmed.",
    shotOutside: "Outside: one of the apps you can choose.",
    shotOutsideAlt: "Screenshot of the app from the outside: it looks like an ordinary business app",
    shotReport: "Inside: your report, ready for the police station.",
    shotReportAlt: "Screenshot of a finished report in Blindaje, with timeline and evidence",
  },
  community: {
    label: "Community",
    title: "They changed the number, not the voice.",
    lead:
      "Every victim holds one piece: a voice note, a number, a Yape account, a photo. Alone, it barely helps. Joined with consent, the pieces reveal the network behind them.",
    method:
      "Blindaje never compares raw data: it compares encrypted voiceprints, HMAC-protected identifiers and case summaries without the victim’s personal data. When several pieces match, it proposes a link, and a person reviews it before it exists.",
    demoTitle: "One case over four weeks",
    fictitious: "Fictitious data",
    tablistLabel: "Weeks of the case",
    weekWord: "Week",
    next: "Next",
    restart: "Back to week 1",
    legend: { voice: "Same voiceprint (V-3)", account: "Same collection account" },
    happensLabel: "What happens",
    detectsLabel: "What Blindaje detects",
    weeks: [
      {
        label: "Week 1",
        happens:
          "Person A, a shopkeeper, receives two voice notes from a male voice, a message demanding 2,000 soles via Yape within 48 hours and a photo of her shop with a bullet on it.",
        detects: "Case A is created with its summary, voiceprint, identifiers and images.",
      },
      {
        label: "Week 2",
        happens: "Person B, a mototaxi driver in another district, receives a voice note from a different number.",
        detects:
          "The voiceprint matches case A even though the number is different, and the script repeats: “talk to the boss”, “don’t call the police”. Blindaje proposes the A–B link and a reviewer confirms it.",
      },
      {
        label: "Week 3",
        happens: "Person C, a market vendor, is told to pay into the same Yape account given to B.",
        detects: "The encrypted identifier matches. C links to B and a three-case network appears.",
      },
      {
        label: "Week 4",
        happens: "An agent analyzes the network and an authorized analyst reviews the profile.",
        detects:
          "One voice that calls, one account that collects, a shared script and physical intimidation days after the deadline. The authorities get the case file; the association gets an alert.",
      },
    ],
    table: {
      caption: "Signals across the three cases",
      cols: {
        case: "Case",
        who: "Who",
        phone: "Number",
        voice: "Voice",
        account: "Yape account",
        note: "Reviewer’s note",
      },
      rows: [
        { id: "A", who: "Shopkeeper", phone: "···204", voice: "V-3", account: "···117", note: "", week: 1 },
        {
          id: "B",
          who: "Mototaxi driver",
          phone: "···951",
          voice: "V-3",
          account: "···488",
          note: "Same voice as A. Confirmed.",
          week: 2,
        },
        {
          id: "C",
          who: "Market vendor",
          phone: "···630",
          voice: "",
          account: "···488",
          note: "Same account as B. Confirmed.",
          week: 3,
        },
      ],
      noAudio: "no audio",
      ghost: "Arrives in week {n}",
    },
    alertTitle: "Alert approved by the association",
    alert:
      "Voice notes claiming to be from “Los X” are demanding payment via Yape. Don’t pay or negotiate: report it to Línea 1818 or at your police station.",
    gate: "No link exists until a person confirms it. Victims are never shown data from other cases.",
  },
  authority: {
    label: "Authorities",
    title: "Network case files for police and prosecutors.",
    lead:
      "When an authorized analyst approves a network, Blindaje assembles the case file and exports it as a PDF. It is only sent through a formal channel with the authorities.",
    example: "Fictitious example: the A–B–C network, three cases over four weeks, one voice (V-3) and one account (···488).",
    dossierTitle: "What the case file contains",
    dossier: [
      { title: "Network summary", text: "Size, period, sectors, aggregated territory and shared modus operandi." },
      { title: "Unified timeline", text: "Events from every case, in order." },
      { title: "Links and their explanation", text: "Each link with its score, its signals and the cited evidence." },
      { title: "Evidence with SHA-256 fingerprints", text: "Every original file with its integrity fingerprint and UTC time." },
      { title: "Chain of custody", text: "Who uploaded what and when, in a hash-chained log." },
    ],
    channel:
      "Accounts that appear in several cases are flagged so the authorities can request them through legal channels. Blindaje shares no data with banks or fintechs.",
  },
  commitments: {
    label: "Commitments",
    title: "What Blindaje does not do.",
    lead: "These limits are part of the design, not a footnote. They protect victims and prevent serious mistakes.",
    items: [
      { title: "It does not identify people by name.", text: "It links cases and signals. It never puts a name to a voice or searches for anyone on social media." },
      { title: "It does not investigate individuals online.", text: "The analysis agents have no web search." },
      { title: "It does not show a victim other victims’ data.", text: "Nor does it tell them their case was linked." },
      { title: "It does not decide guilt.", text: "Every link is a hypothesis with a confidence level and its evidence, and goes through human review." },
      { title: "It does not replace the police or prosecutors.", text: "It always refers people to official channels." },
      { title: "It never advises paying or negotiating with extortioners.", text: "" },
      { title: "It does not publish maps or open data.", text: "What the community sees is aggregated and needs at least 5 cases." },
      { title: "It has no political content.", text: "" },
    ],
    honestyTitle: "And we say it plainly",
    honesty:
      "The server processes evidence to transcribe and compare it, so this is not end-to-end encryption. Evidence is encrypted in transit and at rest, and only authorized roles can see it, with a hash-chained audit log.",
    legal: "Before any pilot with real victims, a legal review is required under Peru’s",
    legalLink: src.ley29733,
  },
  tech: {
    label: "Technology",
    title: "Meta models, each with a specific job.",
    lead: "Evidence flows through a pipeline on Cloudflare: every piece is transcribed, segmented, summarized into a case record and turned into comparable signals.",
    states: { pipeline: "In the pipeline", optional: "Optional", evaluated: "Evaluated" },
    rows: [
      {
        name: "Muse Voice Transcribe",
        id: "muse-voice-transcribe-1.0",
        role: "Transcribes voice notes with speaker separation, per-turn timestamps and a custom vocabulary: Yape, Plin, cupo, derecho de piso.",
        state: "pipeline",
      },
      {
        name: "Muse Spark 1.3",
        id: "muse-spark-1.3",
        role: "Builds the case record with structured output and drives the four agents with tool calling over the Responses API.",
        state: "pipeline",
      },
      {
        name: "Muse Spark 1.2",
        id: "muse-spark-1.2",
        role: "Listens to audio directly when needed, since 1.3 lacks full audio support.",
        state: "pipeline",
      },
      {
        name: "SAM 3.1",
        id: "sam-3.1",
        role: "Finds bullets, handwritten notes and license plates in photos and video, masks bystanders’ faces and tracks vehicles across frames.",
        state: "pipeline",
      },
      {
        name: "FAISS",
        id: "Meta open-source library",
        role: "Three search indexes: voice, text and image.",
        state: "pipeline",
      },
      {
        name: "DINOv2",
        id: "Meta open model",
        role: "Turns each image crop into a vector to find reused images even when they are not identical.",
        state: "pipeline",
      },
      {
        name: "Muse Wonder",
        id: "muse-wonder-1.0",
        role: "For analyzing very large networks, when the context calls for it.",
        state: "optional",
      },
      {
        name: "Muse Image",
        id: "muse-image-1.0",
        role: "Sober cards the association can share with its alerts.",
        state: "optional",
      },
      {
        name: "Muse Glimmer",
        id: "open weights",
        role: "We evaluated it for building the case record on the phone, offline. It is a dense 30B-parameter model, about 17 GB even at 4 bits: it does not fit on a phone. The record is built on the server, with consent.",
        state: "evaluated",
      },
    ],
    agentsTitle: "Four agents, and always a person who approves.",
    agentsLead: "No agent decides alone. Every output is a draft until an authorized person approves it.",
    approvesLabel: "Approved by",
    agents: [
      {
        name: "Linker",
        text: "Evaluates each candidate pair of cases, adjusts the score when it spots contradictions and explains the possible link citing evidence.",
        approves: "An association reviewer",
      },
      {
        name: "Cartographer",
        text: "Analyzes a network: period, modus operandi, roles suggested by the graph structure and missing evidence. Keeps facts apart from hypotheses.",
        approves: "An authorized analyst",
      },
      {
        name: "Lookout",
        text: "Detects a pattern repeated in at least 5 cases from 3 different victims within 14 days and drafts the alert.",
        approves: "The association",
      },
      {
        name: "Case writer",
        text: "Turns an approved network into a PDF case file with a timeline, links and chain of custody.",
        approves: "An authorized analyst",
      },
    ],
    rules: "Every claim cites evidence: without a citation, the output is invalid. Never names of people. Web search is off.",
    thirdParty:
      "Voiceprints and text vectors use third-party open models, because the Meta Model API has no embeddings endpoint.",
  },
  results: {
    label: "Results",
    title: "What we measure, with fictitious test cases.",
    lead:
      "The evaluation uses threat scripts written for the project and voices from an open corpus of Peruvian Spanish (OpenSLR SLR73), compressed the way WhatsApp does. We publish the real results, whatever they are.",
    placeholder: "[evaluation results]",
    pendingNote: "The evaluation has not published its report yet. Targets are working goals, not results.",
    cols: { what: "What is measured", target: "Target", result: "Result" },
    pending: "pending",
    metrics: [
      { id: "voice_top1", label: "Voice linking: the right case ranks first", target: "80% or more" },
      { id: "voice_top3", label: "Voice linking: the right case is in the top 3", target: "90% or more" },
      { id: "false_links_per_100", label: "Wrong links per 100 comparisons above the review threshold", target: "2 at most" },
      { id: "identifier_match", label: "Exact identifier matches detected", target: "100%" },
      { id: "ficha_accuracy", label: "Case record fields correct against manual labels", target: "90% or more" },
      { id: "citation_fidelity", label: "Agent claims with cited, verifiable evidence", target: "100%" },
      { id: "small_stats", label: "Territorial statistics shown with fewer than 5 cases", target: "0" },
      { id: "infiltrator", label: "Infiltrator test: receives no link", target: "Pass" },
    ],
    generatedAt: "Report generated on",
    passed: "Pass",
    failed: "Fail",
    sample: "samples",
    meets: "Meets the target",
    misses: "Misses the target",
    noTarget: "No target",
    extraTitle: "Other results, no target",
    fullReport: "Full evaluation report (in Spanish)",
    reportedNote: "Real results from a run on fictitious data. Targets are working goals, not guarantees.",
  },
  pilot: {
    label: "Pilot",
    title: "Request a pilot for your association.",
    lead:
      "Blindaje is not an app open to anyone: it reaches victims through organizations that already exist and verify their members.",
    who: "Transport unions, mototaxi and market associations, neighborhood councils and district chambers of commerce. A pilot starts with a small group of verified members and, before handling real data, a legal review.",
    fields: {
      org: "Association or union name",
      name: "Your name",
      contact: "WhatsApp, mobile or email",
      contactHint: "So we can reply. We never share it.",
      sector: "Your members’ trade",
      sectorNone: "Choose one",
      sectors: [
        { value: "bodega", label: "Corner shops" },
        { value: "mototaxi", label: "Mototaxis" },
        { value: "transporte", label: "Transport" },
        { value: "mercado", label: "Markets" },
        { value: "restaurante", label: "Restaurants" },
        { value: "construccion", label: "Construction" },
        { value: "otro", label: "Other" },
      ],
      district: "District or province",
      members: "How many members",
      message: "Anything we should know?",
      optional: "optional",
      more: "Add details (optional)",
    },
    errors: {
      org: "Enter your association’s name (at least 2 letters).",
      name: "Enter your name (at least 2 letters).",
      contact: "Enter a mobile number (6 digits or more) or an email so we can reply.",
      members: "Enter a whole number, without dots or commas.",
      summary: "Check the highlighted fields.",
    },
    verifying: "Automatic spam check",
    verifyingWait: "It starts by itself once you begin filling in the form.",
    captchaLoad: "We could not load the automatic check. Check your connection and reload the page.",
    noscript: "To send this form, turn on JavaScript in your browser.",
    submit: "Send request",
    sending: "Sending…",
    successTitle: "We received your request.",
    success: "We will write to the contact you left to talk about your association and the next steps, starting with the legal review. Thank you for looking out for your members.",
    fail: "We could not send your request. Check your connection and try again.",
    rateLimited: "Too many requests came from your connection. Wait a few minutes and try again.",
    captcha: "The automatic check has not finished yet. Wait a few seconds and send again.",
    unavailable: "The form is not available right now. Try again in a few minutes.",
    privacy:
      "We use this data only to answer your request. This form is not for reporting a crime: if you are in danger, call 105.",
  },
  helpSection: {
    label: "Help",
    title: "If you are in danger right now, call 105.",
    lines: [
      { number: "105", name: "Peruvian National Police, emergencies", cta: "Call 105" },
      { number: "1818", name: "Línea 1818, the Interior Ministry’s single reporting line", cta: "Call Línea 1818" },
    ],
    station: "You can also report at your nearest police station.",
    note: "Don’t pay or negotiate. Keep the voice notes and messages, and report it.",
  },
  footer: {
    hackathon: "Built for the Meta Global AI Developer Hackathon, from October 26 to November 4, 2026.",
    repo: "Code on GitHub",
    fictitious: "All demo and evaluation data is fictitious. Nothing on this page comes from real victims.",
    license: "Open source under the Apache-2.0 license.",
  },
  notFound: {
    title: "This page is not in the notebook.",
    text: "The link may be mistyped.",
    home: "Back to the home page",
  },
};
